-- =====================================================================
-- 018  Member accounts for the website (couragedph.com). Members sign
-- up with email + password; Supabase confirms the email before they get
-- a session. Signed in, they either link to the record the front desk
-- already made (gym code + phone on file) or create a new one. Each
-- member gets a random QR token for the door scanner. Members never get
-- a staff profile and never read tables directly: only the member_*
-- functions below, which return their own record. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Link, contact email, QR token and privacy consent on members.
-- qr_token: 122 random bits, so a pass can't be guessed from a gym code.
-- Adding it with a volatile default gives every existing member their own.
-- ---------------------------------------------------------------------
alter table public.members add column if not exists user_id uuid unique references auth.users(id) on delete set null;
alter table public.members add column if not exists email text;
alter table public.members add column if not exists qr_token text unique default ('CDQ' || replace(gen_random_uuid()::text, '-', ''));
alter table public.members alter column qr_token set not null;
alter table public.members add column if not exists consent_version text;
alter table public.members add column if not exists consented_at timestamptz;
-- Staff can't edit these through the API (009 grants only name, phone, notes; 015 code).

-- ---------------------------------------------------------------------
-- 2. Website sign-ups get no staff profile, so they never show on the
-- Staff page. (raw_user_meta_data is set by the person signing up, but
-- skipping a profile can only take access away: no profile = inactive.)
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.raw_user_meta_data->>'account', '') = 'member' then
    return new;
  end if;
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 3. Failed link attempts, to stop guessing code + phone pairs.
-- ---------------------------------------------------------------------
create table if not exists public.member_link_attempts (
  user_id uuid not null references auth.users(id) on delete cascade,
  at      timestamptz not null default now()
);
create index if not exists member_link_attempts_idx on public.member_link_attempts (user_id, at desc);
alter table public.member_link_attempts enable row level security;
revoke all on public.member_link_attempts from anon, authenticated;

create or replace function public.phone_key(p text) returns text
language sql immutable as $$ select right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 10) $$;

-- ---------------------------------------------------------------------
-- 4. The signed-in member's own pass. Leaves out staff notes.
-- ---------------------------------------------------------------------
drop function if exists public.member_me();
create function public.member_me()
returns table (code text, full_name text, phone text, email text, qr_token text,
               plan_name text, ends_on date, status text, member_until date, joined date)
language sql stable security definer set search_path = public as $$
  select v.code, v.full_name, v.phone, m.email, m.qr_token,
         v.plan_name, v.ends_on, v.status, v.member_until, (v.created_at at time zone 'Asia/Manila')::date
    from public.members m
    join public.v_members v on v.id = m.id
   where m.user_id = auth.uid()
$$;

-- New member, no front-desk record yet. Returns their gym code.
create or replace function public.member_join(p_full_name text, p_phone text, p_consent text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_name text := btrim(coalesce(p_full_name, ''));
  v_code text;
begin
  if v_uid is null then raise exception 'Sign in first'; end if;
  if exists (select 1 from public.members where user_id = v_uid) then raise exception 'This account already has a membership'; end if;
  if v_name = '' or length(v_name) > 80 then raise exception 'Enter your full name'; end if;
  if length(public.phone_key(p_phone)) <> 10 then raise exception 'Enter a mobile number like 0917 123 4567'; end if;
  if coalesce(btrim(p_consent), '') = '' then raise exception 'Agree to the privacy notice first'; end if;

  insert into public.members (full_name, phone, email, user_id, consent_version, consented_at, created_by)
  values (v_name, btrim(p_phone), (select email from auth.users where id = v_uid), v_uid, p_consent, now(), v_uid)
  returning code into v_code;
  return v_code;
end $$;

-- Existing member: gym code + the phone on file must both match a record
-- not linked yet. Five misses an hour, then it stops answering. Returns
-- their code, or null on no match (the miss is kept, so no exception).
create or replace function public.member_link(p_code text, p_phone text, p_consent text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
  v_code text;
begin
  if v_uid is null then raise exception 'Sign in first'; end if;
  if exists (select 1 from public.members where user_id = v_uid) then raise exception 'This account already has a membership'; end if;
  if coalesce(btrim(p_consent), '') = '' then raise exception 'Agree to the privacy notice first'; end if;
  if (select count(*) from public.member_link_attempts where user_id = v_uid and at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many tries. Wait an hour, or ask the front desk to link you';
  end if;

  select id, code into v_id, v_code from public.members
   where code = upper(btrim(coalesce(p_code, '')))
     and user_id is null
     and length(public.phone_key(phone)) = 10
     and public.phone_key(phone) = public.phone_key(p_phone)
     for update;
  if not found then
    insert into public.member_link_attempts (user_id) values (v_uid);
    return null;
  end if;

  update public.members
     set user_id = v_uid, email = (select email from auth.users where id = v_uid),
         consent_version = p_consent, consented_at = now()
   where id = v_id;
  return v_code;
end $$;

-- New QR if a screenshot of the pass got around. The old one stops working.
create or replace function public.member_new_qr()
returns text language plpgsql security definer set search_path = public as $$
declare v_token text;
begin
  update public.members set qr_token = 'CDQ' || replace(gen_random_uuid()::text, '-', '')
   where user_id = auth.uid()
   returning qr_token into v_token;
  if v_token is null then raise exception 'No membership on this account'; end if;
  return v_token;
end $$;

-- ---------------------------------------------------------------------
-- 5. Public price list for the website, straight from Members › Plans,
-- so prices are edited in one place. Anyone can read it.
-- ---------------------------------------------------------------------
drop function if exists public.public_price_list();
create function public.public_price_list()
returns table (code text, name text, category text, price numeric, student_price numeric,
               duration_days integer, is_membership boolean, members_only boolean)
language sql stable security definer set search_path = public as $$
  select p.code, p.name, p.category, p.selling_price, p.student_price, p.duration_days, p.is_membership, p.members_only
    from public.products p
   where p.kind = 'service' and p.is_active and p.deleted_at is null
   order by p.is_membership desc, p.duration_days nulls first, p.selling_price
$$;

revoke all on function public.member_me()                         from public, anon;
revoke all on function public.member_join(text, text, text)       from public, anon;
revoke all on function public.member_link(text, text, text)       from public, anon;
revoke all on function public.member_new_qr()                     from public, anon;
revoke all on function public.phone_key(text)                     from public, anon;
grant execute on function public.member_me()                      to authenticated;
grant execute on function public.member_join(text, text, text)    to authenticated;
grant execute on function public.member_link(text, text, text)    to authenticated;
grant execute on function public.member_new_qr()                  to authenticated;
grant execute on function public.public_price_list()              to anon, authenticated;

notify pgrst, 'reload schema';
