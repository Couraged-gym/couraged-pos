-- =====================================================================
-- 024  Safer friends (fixes from the 2026-11-05 security check of 023).
--
-- 1. Separate friend codes. The gym code also checks people in at the
--    front desk, so members shouldn't be told to share it. Each member
--    gets a random 6-character friend code (shown as K7P-Q2M) that only
--    works for friend requests. Letters/digits that look alike are left
--    out (0/O, 1/I/L).
-- 2. No name before acceptance. A request no longer tells the sender
--    whose code it was; their pending list shows the code they typed.
--    Wrong codes count: 10 misses an hour, then wait.
-- 3. Declining is remembered. The sender can't ask again (their request
--    quietly drops off their list). If the person who declined sends a
--    request later, that lifts it.
--
-- Run after 023. Safe to re-run.
-- =====================================================================

-- Runs as the column default when the POS adds a member (as a staff login),
-- so staff need EXECUTE; security definer so the uniqueness check sees every row.
create or replace function public.new_friend_code() returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  a constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- 31 characters
  b bytea;
  c text;
begin
  loop
    b := uuid_send(gen_random_uuid()); -- random bytes from the server's secure generator
    c := '';
    for i in 0..5 loop
      c := c || substr(a, 1 + get_byte(b, i) % 31, 1);
    end loop;
    exit when not exists (select 1 from public.members where friend_code = c);
  end loop;
  return c;
end $$;

alter table public.members add column if not exists friend_code text;
update public.members set friend_code = public.new_friend_code() where friend_code is null;
alter table public.members alter column friend_code set default public.new_friend_code();
alter table public.members alter column friend_code set not null;
create unique index if not exists members_friend_code on public.members (friend_code);

-- Who declined whom. Functions only, like friends.
create table if not exists public.friend_blocks (
  blocker_id uuid not null references public.members(id) on delete cascade,
  blocked_id uuid not null references public.members(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);
alter table public.friend_blocks enable row level security;
revoke all on public.friend_blocks from anon, authenticated;

-- Wrong friend codes, for the 10-an-hour limit.
create table if not exists public.friend_code_misses (
  member_id uuid not null references public.members(id) on delete cascade,
  at        timestamptz not null default now()
);
create index if not exists friend_code_misses_member on public.friend_code_misses (member_id, at);
alter table public.friend_code_misses enable row level security;
revoke all on public.friend_code_misses from anon, authenticated;

-- ---------------------------------------------------------------------
-- Send a request by friend code ('K7P-Q2M', 'k7pq2m' and so on all work).
-- Returns { result, name }:
--   sent       request sent, or already waiting (no name: they haven't accepted)
--   accepted   they had asked me, so we're friends now (name)
--   already    we're already friends (name)
--   not_found  no member with a website pass has that code
-- Misses are returned, not raised, so they're recorded.
-- ---------------------------------------------------------------------
drop function if exists public.friend_request(text);
create function public.friend_request(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me   uuid := public.my_member_id();
  v_in   text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_them uuid;
  v_name text;
  v_row  public.friends;
begin
  if v_me is null then raise exception 'Set up your pass first'; end if;
  if (select count(*) from public.friend_code_misses where member_id = v_me and at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many wrong codes. Wait an hour and try again';
  end if;
  if (select count(*) from public.friends where requester_id = v_me and created_at > now() - interval '1 day') >= 20 then
    raise exception 'You''ve sent 20 requests today. Try again tomorrow';
  end if;
  if (select count(*) from public.friends where v_me in (requester_id, addressee_id)) >= 200 then
    raise exception 'You''ve reached 200 friends';
  end if;

  select id, full_name into v_them, v_name from public.members where friend_code = v_in and user_id is not null;
  if v_them is null then
    insert into public.friend_code_misses (member_id) values (v_me);
    return jsonb_build_object('result', 'not_found');
  end if;
  if v_them = v_me then raise exception 'That''s your own friend code'; end if;

  -- Asking someone I once declined means I've changed my mind.
  delete from public.friend_blocks where blocker_id = v_me and blocked_id = v_them;

  select * into v_row from public.friends
   where least(requester_id, addressee_id) = least(v_me, v_them)
     and greatest(requester_id, addressee_id) = greatest(v_me, v_them);

  if v_row.requester_id is null then
    if not exists (select 1 from public.friend_blocks where blocker_id = v_them and blocked_id = v_me) then
      insert into public.friends (requester_id, addressee_id) values (v_me, v_them);
    end if;
    return jsonb_build_object('result', 'sent');
  elsif v_row.status = 'pending' and v_row.addressee_id = v_me then
    update public.friends set status = 'accepted', accepted_at = now()
     where requester_id = v_them and addressee_id = v_me;
    return jsonb_build_object('result', 'accepted', 'name', public.friend_name(v_name));
  elsif v_row.status = 'accepted' then
    return jsonb_build_object('result', 'already', 'name', public.friend_name(v_name));
  end if;
  return jsonb_build_object('result', 'sent'); -- my earlier request is still waiting
end $$;

-- Decline is remembered so the same person can't keep asking.
create or replace function public.friend_respond(p_member_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.my_member_id();
begin
  if p_accept then
    update public.friends set status = 'accepted', accepted_at = now()
     where requester_id = p_member_id and addressee_id = v_me and status = 'pending';
  else
    delete from public.friends where requester_id = p_member_id and addressee_id = v_me and status = 'pending';
    if found then
      insert into public.friend_blocks (blocker_id, blocked_id) values (v_me, p_member_id) on conflict do nothing;
    end if;
  end if;
end $$;

-- Same as 023, except a request I sent shows their friend code, not their
-- name, until they accept.
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
  select m.id,
         case when p.state = 'outgoing' then left(m.friend_code, 3) || '-' || right(m.friend_code, 3)
              else public.friend_name(m.full_name) end,
         p.state,
         case when p.state = 'friend' and m.share_visits then lv.d = (now() at time zone 'Asia/Manila')::date end,
         case when p.state = 'friend' and m.share_visits then lv.d end
    from pairs p
    join public.members m on m.id = p.other
    left join lateral (select max((c.checked_at at time zone 'Asia/Manila')::date) as d
                         from public.checkins c where c.member_id = m.id) lv on true
   order by p.state = 'incoming' desc, lv.d desc nulls last, 2
$$;

-- Same as 023, plus the friend code.
drop function if exists public.member_me();
create function public.member_me()
returns table (code text, full_name text, phone text, email text, qr_token text,
               plan_name text, ends_on date, status text, member_until date, joined date, consented boolean, reminders boolean,
               share_visits boolean, share_lifts boolean, friend_code text)
language sql stable security definer set search_path = public as $$
  select v.code, v.full_name, v.phone, m.email, m.qr_token,
         v.plan_name, v.ends_on, v.status, v.member_until, (v.created_at at time zone 'Asia/Manila')::date,
         m.consented_at is not null, m.reminders, m.share_visits, m.share_lifts, m.friend_code
    from public.members m
    join public.v_members v on v.id = m.id
   where m.user_id = auth.uid()
$$;

-- Same as 023, plus: blocks and misses go too, and the friend code changes
-- so the old one stops working.
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
  delete from public.lifts              where member_id = v_me;
  delete from public.friends            where v_me in (requester_id, addressee_id);
  delete from public.friend_blocks      where v_me in (blocker_id, blocked_id);
  delete from public.friend_code_misses where member_id = v_me;
  update public.members
     set user_id = null, email = null, consent_version = null, consented_at = null,
         share_visits = false, share_lifts = false,
         friend_code = public.new_friend_code(),
         created_by = nullif(created_by, v_uid),
         qr_token = 'CDQ' || replace(gen_random_uuid()::text, '-', '')
   where user_id = v_uid;
  delete from auth.users where id = v_uid;
end $$;

revoke all on function public.new_friend_code()                 from public, anon;
grant execute on function public.new_friend_code()             to authenticated; -- POS member inserts
revoke all on function public.friend_request(text)              from public, anon;
revoke all on function public.friend_respond(uuid, boolean)     from public, anon;
revoke all on function public.my_friends()                      from public, anon;
revoke all on function public.member_me()                       from public, anon;
revoke all on function public.member_delete_account()           from public, anon;
grant execute on function public.friend_request(text)          to authenticated;
grant execute on function public.friend_respond(uuid, boolean) to authenticated;
grant execute on function public.my_friends()                  to authenticated;
grant execute on function public.member_me()                   to authenticated;
grant execute on function public.member_delete_account()       to authenticated;

notify pgrst, 'reload schema';
