-- =====================================================================
-- 019  Door check-ins. Staff scan a member's QR pass (or type their gym
-- code) on the Check-in screen; every scan is logged with the member's
-- status at that moment, so admins can see who trained and who came in
-- lapsed. Members see their own visits on the website. Also: members
-- invited from the POS agree to the privacy notice on first sign-in.
-- Safe to re-run.
-- =====================================================================

create table if not exists public.checkins (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.members(id) on delete restrict,
  checked_at  timestamptz not null default now(),
  status      text not null check (status in ('active', 'expired', 'new')),
  staff_id    uuid references auth.users(id) default auth.uid()
);
create index if not exists checkins_member_idx on public.checkins (member_id, checked_at desc);
create index if not exists checkins_day_idx on public.checkins (checked_at desc);

alter table public.checkins enable row level security;
drop policy if exists "checkins read" on public.checkins;
create policy "checkins read" on public.checkins for select to authenticated using (public.is_staff());
revoke insert, update, delete on public.checkins from authenticated, anon;

-- Same as 015, plus what the register and check-in need: the pass token,
-- the email and whether they have a website account.
drop view if exists public.v_members; -- recreated whole, so patches can re-run in any order
create view public.v_members with (security_invoker = true) as
select
  m.id, m.full_name, m.phone, m.notes, m.created_at,
  cur.plan_name,
  cur.ends_on,
  case
    when cur.ends_on is null then 'new'
    when cur.ends_on >= (now() at time zone 'Asia/Manila')::date then 'active'
    else 'expired'
  end as status,
  m.member_no,
  (select max(p.ends_on) from public.member_periods p where p.member_id = m.id and not p.voided and p.is_membership) as member_until,
  m.code,
  m.qr_token,
  m.email,
  m.user_id is not null as has_app
from public.members m
left join lateral (
  select p.plan_name, p.ends_on
    from public.member_periods p
   where p.member_id = m.id and not p.voided and not p.is_membership
   order by p.ends_on desc
   limit 1
) cur on true;

-- Scan or typed code -> the member, logged once per 10 minutes (a second
-- scan of the same pass just shows them again). Returns null if unknown.
create or replace function public.check_in(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_in    text := upper(btrim(coalesce(p_code, '')));
  v       public.v_members%rowtype;
  v_last  timestamptz;
  v_month integer;
  v_new   boolean;
begin
  if not public.is_staff() then raise exception 'Not authorized'; end if;
  select * into v from public.v_members where upper(qr_token) = v_in or code = v_in limit 1;
  if not found then return null; end if;

  select max(checked_at) into v_last from public.checkins where member_id = v.id;
  v_new := v_last is null or v_last < now() - interval '10 minutes';
  if v_new then
    insert into public.checkins (member_id, status) values (v.id, v.status);
  end if;
  select count(*) into v_month from public.checkins
   where member_id = v.id
     and checked_at >= date_trunc('month', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila';

  return jsonb_build_object(
    'id', v.id, 'code', v.code, 'full_name', v.full_name, 'status', v.status,
    'plan_name', v.plan_name, 'ends_on', v.ends_on, 'member_until', v.member_until,
    -- logged false: last_visit is the scan a few minutes ago. Otherwise it's their visit before this one.
    'logged', v_new, 'last_visit', v_last, 'visits_this_month', v_month);
end $$;

-- The signed-in member's last 30 visits.
create or replace function public.member_visits()
returns table (checked_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.checked_at from public.checkins c
    join public.members m on m.id = c.member_id
   where m.user_id = auth.uid()
   order by c.checked_at desc
   limit 30
$$;

-- Same as 018, plus whether they've agreed to the privacy notice
-- (members invited from the POS haven't yet).
drop function if exists public.member_me();
create function public.member_me()
returns table (code text, full_name text, phone text, email text, qr_token text,
               plan_name text, ends_on date, status text, member_until date, joined date, consented boolean)
language sql stable security definer set search_path = public as $$
  select v.code, v.full_name, v.phone, m.email, m.qr_token,
         v.plan_name, v.ends_on, v.status, v.member_until, (v.created_at at time zone 'Asia/Manila')::date,
         m.consented_at is not null
    from public.members m
    join public.v_members v on v.id = m.id
   where m.user_id = auth.uid()
$$;

create or replace function public.member_consent(p_consent text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(btrim(p_consent), '') = '' then raise exception 'Agree to the privacy notice first'; end if;
  update public.members set consent_version = p_consent, consented_at = now() where user_id = auth.uid();
  if not found then raise exception 'No membership on this account'; end if;
end $$;

revoke all on function public.check_in(text)        from public, anon;
revoke all on function public.member_visits()       from public, anon;
revoke all on function public.member_me()           from public, anon;
revoke all on function public.member_consent(text)  from public, anon;
grant execute on function public.check_in(text)       to authenticated;
grant execute on function public.member_visits()      to authenticated;
grant execute on function public.member_me()          to authenticated;
grant execute on function public.member_consent(text) to authenticated;

notify pgrst, 'reload schema';
