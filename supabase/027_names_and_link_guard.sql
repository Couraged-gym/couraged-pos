-- =====================================================================
-- 027  Names are stored one way, linked records can't be repurposed,
-- and website sign-ups stop making doubles. Safe to re-run.
--
-- What went wrong (Nov 4–6): an online account made its own record,
-- then the front desk typed a different member's name and mobile over
-- that record and sold them a plan. The account then showed that other
-- member's pass. Separately, people whose desk record has a mistyped
-- mobile got a second, new record when they signed up online.
--
--  1. format_name: every name is saved as "LAST, FIRST MIDDLE": capitals,
--     single spaces, one space after the comma. A trigger applies it to
--     every insert and update, from the POS, the website or SQL.
--  2. Staff can't change the name or mobile of a record that is linked
--     to a website account. Reformatting (same words) is still fine.
--     Admins can, and so can SQL run in the dashboard.
--  3. member_start: a stored "LAST, FIRST" name must match on surname and
--     first name. If the mobile is new but the name matches a desk record,
--     it asks for the gym code instead of making a second record.
--  4. merge_members(keep, drop): admin only. Moves visits, plans, lifts,
--     friends and the website login from a double onto the real record,
--     then deletes the double.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. One way to write a name. 'lontok,augosto  antonio' -> 'LONTOK, AUGOSTO ANTONIO'
-- ---------------------------------------------------------------------
create or replace function public.format_name(p text) returns text
language sql immutable as $$
  select nullif(upper(btrim(regexp_replace(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g'), '\s*,\s*', ', ', 'g'))), '')
$$;

-- Surname words of a stored name: 'DELA CRUZ, JUAN' -> {dela,cruz}; no comma -> {}.
create or replace function public.last_name_words(p text) returns text[]
language sql immutable as $$
  select case when p like '%,%' then public.name_words(split_part(p, ',', 1)) else '{}' end
$$;

-- Same words in any order and case: used to tell a reformat from a rename.
create or replace function public.name_set(p text) returns text[]
language sql immutable as $$
  select coalesce(array_agg(w order by w), '{}') from unnest(public.name_words(p)) w
$$;

-- Not security definer on purpose: current_user is 'authenticated' only for
-- POS/website API calls, and 'postgres' for dashboard SQL and our functions.
create or replace function public.members_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  new.full_name := coalesce(public.format_name(new.full_name), new.full_name);
  if tg_op = 'UPDATE' and old.user_id is not null and current_user = 'authenticated' and not public.is_admin()
     and (public.name_set(new.full_name) <> public.name_set(old.full_name)
          or public.phone_key(new.phone) is distinct from public.phone_key(old.phone)) then
    raise exception 'This member uses the CourageD app, so their name and mobile can only be changed by an admin. If this is a different person, register them as a new member.';
  end if;
  return new;
end $$;

drop trigger if exists members_guard on public.members;
create trigger members_guard before insert or update of full_name, phone on public.members
  for each row execute function public.members_guard();

-- ---------------------------------------------------------------------
-- 3. Website sign-up: stricter name match, no silent doubles.
-- ---------------------------------------------------------------------
create or replace function public.member_start(p_full_name text, p_phone text, p_consent text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_name  text := btrim(coalesce(p_full_name, ''));
  v_words text[] := public.name_words(p_full_name);
  v_phone text := public.phone_key(p_phone);
  v_ids   uuid[];
  v_code  text;
begin
  if v_uid is null then raise exception 'Sign in first'; end if;
  if exists (select 1 from public.members where user_id = v_uid) then raise exception 'This account already has a membership'; end if;
  if v_name = '' or length(v_name) > 80 then raise exception 'Enter your full name'; end if;
  if length(v_phone) <> 10 then raise exception 'Enter a mobile number like 0917 123 4567'; end if;
  if coalesce(btrim(p_consent), '') = '' then raise exception 'Agree to the privacy notice first'; end if;
  if (select count(*) from public.member_link_attempts where user_id = v_uid and at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many tries. Wait an hour, or ask the front desk to link you';
  end if;

  select array_agg(id) into v_ids from public.members where public.phone_key(phone) = v_phone;

  if v_ids is null then
    -- New mobile, but the front desk may have them under a mistyped one.
    if exists (select 1 from public.members
                where user_id is null
                  and cardinality(public.last_name_words(full_name)) > 0
                  and public.last_name_words(full_name) <@ v_words
                  and public.first_name_key(full_name) = any(v_words)) then
      return jsonb_build_object('result', 'need_code', 'reason', 'name');
    end if;
    insert into public.members (full_name, phone, email, user_id, consent_version, consented_at, created_by)
    values (v_name, btrim(p_phone), (select email from auth.users where id = v_uid), v_uid, p_consent, now(), v_uid)
    returning code into v_code;
    return jsonb_build_object('result', 'joined', 'code', v_code);
  end if;

  select array_agg(id) into v_ids from public.members
   where id = any(v_ids) and user_id is null
     and public.first_name_key(full_name) = any(v_words)
     and public.last_name_words(full_name) <@ v_words;
  if coalesce(array_length(v_ids, 1), 0) <> 1 then
    insert into public.member_link_attempts (user_id) values (v_uid);
    return jsonb_build_object('result', 'need_code', 'reason', 'phone');
  end if;

  update public.members
     set user_id = v_uid, email = (select email from auth.users where id = v_uid),
         consent_version = p_consent, consented_at = now()
   where id = v_ids[1] and user_id is null
  returning code into v_code;
  return jsonb_build_object('result', 'linked', 'code', v_code);
end $$;

-- ---------------------------------------------------------------------
-- 4. Merge a double into the real record. Admin only.
-- ---------------------------------------------------------------------
create or replace function public.merge_members(p_keep uuid, p_drop uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  k public.members;
  d public.members;
begin
  if auth.uid() is not null and not public.is_admin() then raise exception 'Only an admin can merge members'; end if;
  select * into k from public.members where id = p_keep for update;
  select * into d from public.members where id = p_drop for update;
  if k.id is null or d.id is null or k.id = d.id then raise exception 'Pick two different members'; end if;
  if k.user_id is not null and d.user_id is not null then
    raise exception 'Both records have their own app login. Unlink one first.';
  end if;

  update public.member_periods     set member_id = k.id where member_id = d.id;
  update public.checkins           set member_id = k.id where member_id = d.id;
  update public.lifts              set member_id = k.id where member_id = d.id;
  update public.friend_code_misses set member_id = k.id where member_id = d.id;
  update public.renewal_reminders r set member_id = k.id where member_id = d.id
     and not exists (select 1 from public.renewal_reminders x where x.member_id = k.id and x.ends_on = r.ends_on and x.kind = r.kind);
  update public.friends f set requester_id = k.id where requester_id = d.id and addressee_id <> k.id
     and not exists (select 1 from public.friends x where x.requester_id = k.id and x.addressee_id = f.addressee_id);
  update public.friends f set addressee_id = k.id where addressee_id = d.id and requester_id <> k.id
     and not exists (select 1 from public.friends x where x.addressee_id = k.id and x.requester_id = f.requester_id);
  update public.friend_blocks b set blocker_id = k.id where blocker_id = d.id and blocked_id <> k.id
     and not exists (select 1 from public.friend_blocks x where x.blocker_id = k.id and x.blocked_id = b.blocked_id);
  update public.friend_blocks b set blocked_id = k.id where blocked_id = d.id and blocker_id <> k.id
     and not exists (select 1 from public.friend_blocks x where x.blocked_id = k.id and x.blocker_id = b.blocker_id);

  delete from public.members where id = d.id;  -- frees user_id, qr_token, friend_code

  update public.members set
    phone           = case when regexp_replace(coalesce(k.phone, ''), '\D', '', 'g') ~ '^(09|639)\d{9}$' then k.phone else coalesce(d.phone, k.phone) end,
    notes           = concat_ws(E'\n', k.notes, d.notes, format('Merged %s (%s, %s)', coalesce(d.code, 'no code'), d.full_name, coalesce(d.phone, 'no mobile'))),
    user_id         = coalesce(k.user_id, d.user_id),
    email           = case when k.user_id is null and d.user_id is not null then d.email else k.email end,
    consent_version = case when k.user_id is null and d.user_id is not null then d.consent_version else k.consent_version end,
    consented_at    = case when k.user_id is null and d.user_id is not null then d.consented_at else k.consented_at end,
    qr_token        = case when k.user_id is null and d.user_id is not null then d.qr_token else k.qr_token end,
    friend_code     = case when k.user_id is null and d.user_id is not null then d.friend_code else k.friend_code end,
    reminders       = case when k.user_id is null and d.user_id is not null then d.reminders else k.reminders end,
    share_visits    = case when k.user_id is null and d.user_id is not null then d.share_visits else k.share_visits end,
    share_lifts     = case when k.user_id is null and d.user_id is not null then d.share_lifts else k.share_lifts end,
    adult           = coalesce(k.adult, d.adult)
  where id = k.id;
  return k.code;
end $$;

-- ---------------------------------------------------------------------
-- 5. Reminder emails greet by first name: 'LONTOK, AUGOSTO ANTONIO' -> 'Augosto'
-- (020 took the first word, which is the surname in "LAST, FIRST").
-- ---------------------------------------------------------------------
create or replace function public.greet_name(p text) returns text
language sql immutable as $$
  select initcap(split_part(btrim(case when p like '%,%' then split_part(p, ',', 2) else p end), ' ', 1))
$$;
revoke all on function public.greet_name(text) from public, anon;

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
          '<p style="margin:0 0 12px;font-size:20px;color:#FFFFFF;">Hi ' || public.html_escape(public.greet_name(r.full_name)) || ',</p>' ||
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

revoke all on function public.member_start(text, text, text) from public, anon;
revoke all on function public.merge_members(uuid, uuid)      from public, anon;
revoke all on function public.format_name(text)              from public, anon;
revoke all on function public.last_name_words(text)          from public, anon;
revoke all on function public.name_set(text)                 from public, anon;
grant execute on function public.member_start(text, text, text) to authenticated;
grant execute on function public.merge_members(uuid, uuid)      to authenticated;

notify pgrst, 'reload schema';
