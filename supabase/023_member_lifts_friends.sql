-- =====================================================================
-- 023  Website members: lift log with PRs, and friends.
--
-- Members log sets (exercise, kg, reps). A PR is the heaviest weight they
-- have logged for an exercise, with most reps breaking ties; it is worked
-- out from the log, never stored. Staff cannot read lifts: like everything
-- a member owns, lifts and friends are only reachable through the
-- functions below, which act on the signed-in member only.
--
-- Friends: send a request with a member code, the other person accepts.
-- Friends see each other's first name and last initial only. Two separate
-- opt-ins, both off until the member turns them on:
--   share_visits  friends see that you trained today / your last visit
--   share_lifts   you appear on your friends' leaderboards
--
-- 022 is reserved for the security clean-up. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Exercises: one shared list so "bench" and "Bench Press" are the same
-- lift. Everyone signed in can read it; admins edit it (POS, later).
-- ---------------------------------------------------------------------
create table if not exists public.exercises (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (btrim(name) <> '' and length(name) <= 60),
  sort       integer not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.exercises enable row level security;
drop policy if exists "exercises read" on public.exercises;
drop policy if exists "exercises admin" on public.exercises;
create policy "exercises read"  on public.exercises for select to authenticated using (true);
create policy "exercises admin" on public.exercises for all    to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.exercises from anon;

insert into public.exercises (name, sort) values
  ('Bench Press', 10), ('Back Squat', 20), ('Deadlift', 30), ('Overhead Press', 40),
  ('Barbell Row', 50), ('Incline Bench Press', 60), ('Front Squat', 70), ('Romanian Deadlift', 80),
  ('Hip Thrust', 90), ('Leg Press', 100), ('Pull-up', 110), ('Dip', 120)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------
-- 2. Lifts. No policies on purpose: functions only (same as checkins for
-- members). Going with the member when their gym record is removed.
-- ---------------------------------------------------------------------
create table if not exists public.lifts (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.members(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id),
  weight_kg   numeric(6,2) not null check (weight_kg >= 0 and weight_kg <= 1000),
  reps        integer not null check (reps between 1 and 100),
  lifted_on   date not null,
  note        text check (length(note) <= 280),
  created_at  timestamptz not null default now()
);
create index if not exists lifts_member_exercise on public.lifts (member_id, exercise_id, weight_kg desc, reps desc);
alter table public.lifts enable row level security;
revoke all on public.lifts from anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Friends. One row per pair, whoever asked first. A pair can't exist
-- twice in either direction.
-- ---------------------------------------------------------------------
create table if not exists public.friends (
  requester_id uuid not null references public.members(id) on delete cascade,
  addressee_id uuid not null references public.members(id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  primary key (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);
create unique index if not exists friends_pair on public.friends (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index if not exists friends_addressee on public.friends (addressee_id);
alter table public.friends enable row level security;
revoke all on public.friends from anon, authenticated;

alter table public.members add column if not exists share_visits boolean not null default false;
alter table public.members add column if not exists share_lifts  boolean not null default false;

-- ---------------------------------------------------------------------
-- Helpers (not callable from the website).
-- ---------------------------------------------------------------------
create or replace function public.my_member_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.members where user_id = auth.uid()
$$;

-- 'Karl Wilmer Mendoza' -> 'Karl M.'  What friends see of each other.
create or replace function public.friend_name(p text) returns text
language sql immutable set search_path = public as $$
  select initcap(split_part(btrim(p), ' ', 1)) ||
         case when btrim(p) ~ '\s' then ' ' || upper(left(regexp_replace(btrim(p), '^.*\s', ''), 1)) || '.' else '' end
$$;

create or replace function public.are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.friends
                  where status = 'accepted'
                    and least(requester_id, addressee_id) = least(a, b)
                    and greatest(requester_id, addressee_id) = greatest(a, b))
$$;

-- ---------------------------------------------------------------------
-- 4. Lift log
-- ---------------------------------------------------------------------
-- Returns { id, pr } where pr is true when this set beats every earlier one.
create or replace function public.lift_add(p_exercise_id uuid, p_weight_kg numeric, p_reps integer,
                                           p_lifted_on date default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me    uuid := public.my_member_id();
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_day   date := coalesce(p_lifted_on, v_today);
  v_pr    boolean;
  v_id    uuid;
begin
  if v_me is null then raise exception 'Set up your pass first'; end if;
  if not exists (select 1 from public.exercises where id = p_exercise_id and is_active) then raise exception 'Pick an exercise'; end if;
  if p_weight_kg is null or p_weight_kg < 0 or p_weight_kg > 1000 then raise exception 'Enter the weight in kg'; end if;
  if p_reps is null or p_reps < 1 or p_reps > 100 then raise exception 'Enter reps from 1 to 100'; end if;
  if v_day > v_today or v_day < v_today - 3650 then raise exception 'Pick a date up to today'; end if;
  if (select count(*) from public.lifts where member_id = v_me and created_at > now() - interval '1 day') >= 200 then
    raise exception 'That''s a lot of sets for one day. Try again tomorrow';
  end if;

  v_pr := not exists (select 1 from public.lifts
                       where member_id = v_me and exercise_id = p_exercise_id
                         and (weight_kg > p_weight_kg or (weight_kg = p_weight_kg and reps >= p_reps)));

  insert into public.lifts (member_id, exercise_id, weight_kg, reps, lifted_on, note)
  values (v_me, p_exercise_id, p_weight_kg, p_reps, v_day, nullif(btrim(p_note), ''))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'pr', v_pr);
end $$;

create or replace function public.lift_delete(p_id uuid)
returns void language sql security definer set search_path = public as $$
  delete from public.lifts where id = p_id and member_id = public.my_member_id()
$$;

-- My log, newest first. Optional exercise filter.
create or replace function public.my_lifts(p_exercise_id uuid default null)
returns table (id uuid, exercise_id uuid, exercise text, weight_kg numeric, reps integer, lifted_on date, note text)
language sql stable security definer set search_path = public as $$
  select l.id, l.exercise_id, e.name, l.weight_kg, l.reps, l.lifted_on, l.note
    from public.lifts l join public.exercises e on e.id = l.exercise_id
   where l.member_id = public.my_member_id()
     and (p_exercise_id is null or l.exercise_id = p_exercise_id)
   order by l.lifted_on desc, l.created_at desc
   limit 300
$$;

-- My best set per exercise.
create or replace function public.my_prs()
returns table (exercise_id uuid, exercise text, weight_kg numeric, reps integer, lifted_on date)
language sql stable security definer set search_path = public as $$
  select distinct on (l.exercise_id) l.exercise_id, e.name, l.weight_kg, l.reps, l.lifted_on
    from public.lifts l join public.exercises e on e.id = l.exercise_id
   where l.member_id = public.my_member_id()
   order by l.exercise_id, l.weight_kg desc, l.reps desc, l.lifted_on
$$;

-- ---------------------------------------------------------------------
-- 5. Friends
-- ---------------------------------------------------------------------
-- Send a request by member code. If they already asked me, it just
-- accepts. Returns { result: 'sent' | 'accepted' | 'already', name }.
-- One message for "no such code" and "no website pass", so codes can't be probed.
create or replace function public.friend_request(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me    uuid := public.my_member_id();
  v_them  uuid;
  v_name  text;
  v_row   public.friends;
begin
  if v_me is null then raise exception 'Set up your pass first'; end if;
  if (select count(*) from public.friends where requester_id = v_me and created_at > now() - interval '1 day') >= 20 then
    raise exception 'You''ve sent 20 requests today. Try again tomorrow';
  end if;
  if (select count(*) from public.friends where v_me in (requester_id, addressee_id)) >= 200 then
    raise exception 'You''ve reached 200 friends';
  end if;

  select id, full_name into v_them, v_name from public.members
   where upper(code) = upper(btrim(coalesce(p_code, ''))) and user_id is not null;
  if v_them is null then raise exception 'No member with a website pass has that code'; end if;
  if v_them = v_me then raise exception 'That''s your own code'; end if;

  select * into v_row from public.friends
   where least(requester_id, addressee_id) = least(v_me, v_them)
     and greatest(requester_id, addressee_id) = greatest(v_me, v_them);

  if v_row.requester_id is null then
    insert into public.friends (requester_id, addressee_id) values (v_me, v_them);
    return jsonb_build_object('result', 'sent', 'name', public.friend_name(v_name));
  elsif v_row.status = 'pending' and v_row.addressee_id = v_me then
    update public.friends set status = 'accepted', accepted_at = now()
     where requester_id = v_them and addressee_id = v_me;
    return jsonb_build_object('result', 'accepted', 'name', public.friend_name(v_name));
  end if;
  return jsonb_build_object('result', 'already', 'name', public.friend_name(v_name));
end $$;

-- Accept or decline a request someone sent me.
create or replace function public.friend_respond(p_member_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.my_member_id();
begin
  if p_accept then
    update public.friends set status = 'accepted', accepted_at = now()
     where requester_id = p_member_id and addressee_id = v_me and status = 'pending';
  else
    delete from public.friends where requester_id = p_member_id and addressee_id = v_me and status = 'pending';
  end if;
end $$;

-- Unfriend, or cancel a request I sent.
create or replace function public.friend_remove(p_member_id uuid)
returns void language sql security definer set search_path = public as $$
  delete from public.friends
   where (requester_id = public.my_member_id() and addressee_id = p_member_id)
      or (addressee_id = public.my_member_id() and requester_id = p_member_id)
$$;

-- Everyone I'm connected to. Visit info only from friends who share visits.
-- state: 'friend' | 'incoming' (they asked me) | 'outgoing' (I asked them)
create or replace function public.my_friends()
returns table (member_id uuid, name text, state text, trained_today boolean, last_visit date)
language sql stable security definer set search_path = public as $$
  with me as (select public.my_member_id() as id),
  pairs as (
    select case when f.requester_id = me.id then f.addressee_id else f.requester_id end as other,
           case when f.status = 'accepted' then 'friend'
                when f.addressee_id = me.id then 'incoming' else 'outgoing' end as state
      from public.friends f, me
     where me.id in (f.requester_id, f.addressee_id)
  )
  select m.id, public.friend_name(m.full_name), p.state,
         case when p.state = 'friend' and m.share_visits then lv.d = (now() at time zone 'Asia/Manila')::date end,
         case when p.state = 'friend' and m.share_visits then lv.d end
    from pairs p
    join public.members m on m.id = p.other
    left join lateral (select max((c.checked_at at time zone 'Asia/Manila')::date) as d
                         from public.checkins c where c.member_id = m.id) lv on true
   order by p.state = 'incoming' desc, lv.d desc nulls last, 2
$$;

-- Best set for one exercise: me plus friends who share lifts, heaviest first.
create or replace function public.friends_leaderboard(p_exercise_id uuid)
returns table (name text, is_me boolean, weight_kg numeric, reps integer, lifted_on date)
language sql stable security definer set search_path = public as $$
  with me as (select public.my_member_id() as id),
  people as (
    select me.id as member_id from me
    union
    select m.id from public.members m, me
     where m.share_lifts and public.are_friends(me.id, m.id)
  ),
  best as (
    select distinct on (l.member_id) l.member_id, l.weight_kg, l.reps, l.lifted_on
      from public.lifts l join people p on p.member_id = l.member_id
     where l.exercise_id = p_exercise_id
     order by l.member_id, l.weight_kg desc, l.reps desc, l.lifted_on
  )
  select public.friend_name(m.full_name), m.id = (select id from me), b.weight_kg, b.reps, b.lifted_on
    from best b join public.members m on m.id = b.member_id
   order by b.weight_kg desc, b.reps desc, b.lifted_on
$$;

create or replace function public.member_set_sharing(p_visits boolean, p_lifts boolean)
returns void language sql security definer set search_path = public as $$
  update public.members
     set share_visits = coalesce(p_visits, share_visits), share_lifts = coalesce(p_lifts, share_lifts)
   where user_id = auth.uid()
$$;

-- ---------------------------------------------------------------------
-- 6. Same as 020, plus the two sharing switches.
-- ---------------------------------------------------------------------
drop function if exists public.member_me();
create function public.member_me()
returns table (code text, full_name text, phone text, email text, qr_token text,
               plan_name text, ends_on date, status text, member_until date, joined date, consented boolean, reminders boolean,
               share_visits boolean, share_lifts boolean)
language sql stable security definer set search_path = public as $$
  select v.code, v.full_name, v.phone, m.email, m.qr_token,
         v.plan_name, v.ends_on, v.status, v.member_until, (v.created_at at time zone 'Asia/Manila')::date,
         m.consented_at is not null, m.reminders, m.share_visits, m.share_lifts
    from public.members m
    join public.v_members v on v.id = m.id
   where m.user_id = auth.uid()
$$;

-- Same as 020, plus: lifts and friends are personal, so they go with the
-- online account (the gym record, payments and visits still stay).
create or replace function public.member_delete_account()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_me  uuid;
begin
  if v_uid is null then raise exception 'Sign in first'; end if;
  if exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'Staff logins are removed by an admin on the POS Staff page';
  end if;
  select id into v_me from public.members where user_id = v_uid;
  delete from public.lifts   where member_id = v_me;
  delete from public.friends where v_me in (requester_id, addressee_id);
  update public.members
     set user_id = null, email = null, consent_version = null, consented_at = null,
         share_visits = false, share_lifts = false,
         created_by = nullif(created_by, v_uid),
         qr_token = 'CDQ' || replace(gen_random_uuid()::text, '-', '')
   where user_id = v_uid;
  delete from auth.users where id = v_uid;
end $$;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
revoke all on function public.my_member_id()                                         from public, anon, authenticated;
revoke all on function public.friend_name(text)                                      from public, anon, authenticated;
revoke all on function public.are_friends(uuid, uuid)                                from public, anon, authenticated;
revoke all on function public.lift_add(uuid, numeric, integer, date, text)           from public, anon;
revoke all on function public.lift_delete(uuid)                                      from public, anon;
revoke all on function public.my_lifts(uuid)                                         from public, anon;
revoke all on function public.my_prs()                                               from public, anon;
revoke all on function public.friend_request(text)                                   from public, anon;
revoke all on function public.friend_respond(uuid, boolean)                          from public, anon;
revoke all on function public.friend_remove(uuid)                                    from public, anon;
revoke all on function public.my_friends()                                           from public, anon;
revoke all on function public.friends_leaderboard(uuid)                              from public, anon;
revoke all on function public.member_set_sharing(boolean, boolean)                   from public, anon;
revoke all on function public.member_me()                                            from public, anon;
revoke all on function public.member_delete_account()                                from public, anon;
grant execute on function public.lift_add(uuid, numeric, integer, date, text)  to authenticated;
grant execute on function public.lift_delete(uuid)                             to authenticated;
grant execute on function public.my_lifts(uuid)                                to authenticated;
grant execute on function public.my_prs()                                      to authenticated;
grant execute on function public.friend_request(text)                          to authenticated;
grant execute on function public.friend_respond(uuid, boolean)                 to authenticated;
grant execute on function public.friend_remove(uuid)                           to authenticated;
grant execute on function public.my_friends()                                  to authenticated;
grant execute on function public.friends_leaderboard(uuid)                     to authenticated;
grant execute on function public.member_set_sharing(boolean, boolean)          to authenticated;
grant execute on function public.member_me()                                   to authenticated;
grant execute on function public.member_delete_account()                       to authenticated;

notify pgrst, 'reload schema';
