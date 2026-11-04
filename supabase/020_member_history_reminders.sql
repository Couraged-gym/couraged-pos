-- =====================================================================
-- 020  For website members: their payment history, deleting their own
-- online account, and renewal reminder emails.
--
-- Reminders run inside Supabase: pg_cron calls send_renewal_reminders()
-- every morning, which emails through Resend with pg_net. Before running
-- this patch: Database › Extensions › enable pg_cron and pg_net. After:
--   select vault.create_secret('re_YOUR_RESEND_KEY', 'resend_api_key');
-- Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Payment history: every plan period with its receipt, newest first.
-- Voided ones are listed as voided; paid-before-the-POS ones have no sale.
-- ---------------------------------------------------------------------
drop function if exists public.member_payments();
create function public.member_payments()
returns table (plan_name text, starts_on date, ends_on date, is_membership boolean, voided boolean,
               sale_no bigint, paid_on date, amount numeric, payment_method text)
language sql stable security definer set search_path = public as $$
  select p.plan_name, p.starts_on, p.ends_on, p.is_membership, p.voided or coalesce(s.status = 'voided', false),
         s.sale_no::bigint, (s.sold_at at time zone 'Asia/Manila')::date,
         (select sum(i.line_total)::numeric from public.sale_items i where i.sale_id = s.id and i.product_id = p.product_id),
         s.payment_method::text
    from public.member_periods p
    join public.members m on m.id = p.member_id
    left join public.sales s on s.id = p.sale_id
   where m.user_id = auth.uid()
   order by p.ends_on desc
$$;

-- ---------------------------------------------------------------------
-- 2. Delete my online account. The gym record, plans, payments and visits
-- stay (tax and accounting records); the login goes, the link and email
-- are cleared and the QR stops working. The front desk can still serve
-- them, and they can sign up again and relink later.
-- ---------------------------------------------------------------------
create or replace function public.member_delete_account()
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Sign in first'; end if;
  if exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'Staff logins are removed by an admin on the POS Staff page';
  end if;
  update public.members
     set user_id = null, email = null, consent_version = null, consented_at = null,
         created_by = nullif(created_by, v_uid), -- joined online: they created their own record
         qr_token = 'CDQ' || replace(gen_random_uuid()::text, '-', '')
   where user_id = v_uid;
  delete from auth.users where id = v_uid;
end $$;

-- ---------------------------------------------------------------------
-- 3. Renewal reminders. Members can turn them off on their pass.
-- One email per member per plan end date per kind, ever.
-- ---------------------------------------------------------------------
alter table public.members add column if not exists reminders boolean not null default true;

create table if not exists public.renewal_reminders (
  member_id  uuid not null references public.members(id) on delete cascade,
  ends_on    date not null,
  kind       text not null check (kind in ('soon', 'ended')),
  sent_at    timestamptz not null default now(),
  primary key (member_id, ends_on, kind)
);
alter table public.renewal_reminders enable row level security;
drop policy if exists "reminders read" on public.renewal_reminders;
create policy "reminders read" on public.renewal_reminders for select to authenticated using (public.is_staff());
revoke insert, update, delete on public.renewal_reminders from authenticated, anon;

create or replace function public.member_set_reminders(p_on boolean)
returns void language sql security definer set search_path = public as $$
  update public.members set reminders = coalesce(p_on, true) where user_id = auth.uid()
$$;

-- Who gets an email today (Manila): gym time ending in p_days_before days
-- ('soon'), or that ended yesterday with nothing after it ('ended').
-- Only members with a website account who agreed to the privacy notice.
create or replace function public.renewal_due(p_days_before integer default 3)
returns table (member_id uuid, email text, full_name text, plan_name text, ends_on date, kind text)
language sql stable security definer set search_path = public as $$
  with today as (select (now() at time zone 'Asia/Manila')::date as d)
  select v.id, m.email, v.full_name, v.plan_name, v.ends_on,
         case when v.ends_on = today.d + p_days_before then 'soon' else 'ended' end
    from public.v_members v
    join public.members m on m.id = v.id
    cross join today
   where m.user_id is not null and m.email is not null and m.reminders and m.consented_at is not null
     and v.ends_on in (today.d + p_days_before, today.d - 1)
     and not exists (select 1 from public.renewal_reminders r
                      where r.member_id = v.id and r.ends_on = v.ends_on
                        and r.kind = case when v.ends_on = today.d + p_days_before then 'soon' else 'ended' end)
$$;

create or replace function public.html_escape(t text) returns text language sql immutable as $$
  select replace(replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;')
$$;

-- Queues one email per due member through Resend and records it, so a
-- second run the same day sends nothing. Returns how many were queued.
-- ponytail: pg_net is fire-and-forget, so a Resend failure isn't retried; check net._http_response if emails go missing.
create or replace function public.send_renewal_reminders(p_days_before integer default 3, p_site text default 'https://couragedph.com')
returns integer language plpgsql security definer set search_path = public as $$
declare
  r      record;
  v_key  text;
  v_n    integer := 0;
  v_subj text;
  v_line text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'resend_api_key';
  if v_key is null then raise exception 'Add the Resend key first: select vault.create_secret(''re_...'', ''resend_api_key'');'; end if;

  for r in select * from public.renewal_due(p_days_before) loop
    if r.kind = 'soon' then
      v_subj := 'Your CourageD plan ends ' || to_char(r.ends_on, 'Mon FMDD');
      v_line := 'Your ' || public.html_escape(r.plan_name) || ' ends on <strong style="color:#FFFFFF;">' || to_char(r.ends_on, 'FMMonth FMDD') ||
                '</strong>. Renew at the front desk before then and your new plan starts the day after, so you don''t lose a day.';
    else
      v_subj := 'Your CourageD plan has ended';
      v_line := 'Your ' || public.html_escape(r.plan_name) || ' ended on <strong style="color:#FFFFFF;">' || to_char(r.ends_on, 'FMMonth FMDD') ||
                '</strong>. Come back any time: renew at the front desk and show your pass.';
    end if;

    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
      body := jsonb_build_object(
        'from', 'CourageD Fitness Hub <no-reply@couragedph.com>',
        'reply_to', 'couragedph@gmail.com',
        'to', jsonb_build_array(r.email),
        'subject', v_subj,
        'html',
          '<div style="background:#F2F2F2;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">' ||
          '<div style="max-width:480px;margin:0 auto;background:#19171B;border-radius:16px;padding:28px;color:#D9D5DD;font-size:16px;line-height:1.55;">' ||
          '<p style="margin:0 0 20px;font-family:Arial Narrow,Arial,sans-serif;font-size:18px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#FFFFFF;">CourageD <span style="color:#FEBE10;">Fitness Hub</span></p>' ||
          '<p style="margin:0 0 12px;font-size:20px;color:#FFFFFF;">Hi ' || public.html_escape(split_part(r.full_name, ' ', 1)) || ',</p>' ||
          '<p style="margin:0 0 24px;">' || v_line || '</p>' ||
          '<a href="' || p_site || '/pass" style="display:block;background:#FEBE10;border-radius:10px;padding:15px 20px;text-align:center;font-family:Arial Narrow,Arial,sans-serif;font-size:18px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#19171B;text-decoration:none;">Open my pass</a>' ||
          '<p style="margin:24px 0 0;font-size:12px;color:#8A8590;">CourageD Fitness Hub · 3rd Floor CRD Bldg., Miñoza St., Talamban, Cebu City · 0933 816 9412. ' ||
          'Don''t want these? Turn off reminders on <a href="' || p_site || '/pass" style="color:#B4AFB9;">your pass</a>.</p>' ||
          '</div></div>'));

    insert into public.renewal_reminders (member_id, ends_on, kind) values (r.member_id, r.ends_on, r.kind);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Every day at 9:00 Manila (01:00 UTC). Skipped where pg_cron isn't enabled.
do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.schedule('renewal-reminders', '0 1 * * *', 'select public.send_renewal_reminders()');
  end if;
end $$;

-- Same as 019, plus the reminders setting.
drop function if exists public.member_me();
create function public.member_me()
returns table (code text, full_name text, phone text, email text, qr_token text,
               plan_name text, ends_on date, status text, member_until date, joined date, consented boolean, reminders boolean)
language sql stable security definer set search_path = public as $$
  select v.code, v.full_name, v.phone, m.email, m.qr_token,
         v.plan_name, v.ends_on, v.status, v.member_until, (v.created_at at time zone 'Asia/Manila')::date,
         m.consented_at is not null, m.reminders
    from public.members m
    join public.v_members v on v.id = m.id
   where m.user_id = auth.uid()
$$;

revoke all on function public.member_payments()                     from public, anon;
revoke all on function public.member_delete_account()               from public, anon;
revoke all on function public.member_set_reminders(boolean)         from public, anon;
revoke all on function public.member_me()                           from public, anon;
revoke all on function public.renewal_due(integer)                  from public, anon, authenticated;
revoke all on function public.send_renewal_reminders(integer, text) from public, anon, authenticated;
grant execute on function public.member_payments()             to authenticated;
grant execute on function public.member_delete_account()       to authenticated;
grant execute on function public.member_set_reminders(boolean) to authenticated;
grant execute on function public.member_me()                   to authenticated;

notify pgrst, 'reload schema';
