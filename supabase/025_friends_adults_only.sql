-- =====================================================================
-- 025  Friends is for members 18 and older (owner's decision, 2026-11-05).
--
-- Sign-up only asks "18+ or a guardian agrees", which doesn't say which.
-- So members answer once on the Friends tab: members.adult is null until
-- they do. A member can set it themselves only while it is null; after
-- that the front desk changes it (staff can update members).
--
-- Under 18 (or not answered yet): no friend requests either way, not on
-- anyone's friends list or leaderboard, sharing forced off. Lifts still
-- work; they're private. Saying "under 18" removes any friends and blocks
-- they already had. A request to a minor's code answers "no member has
-- that code", so a code never reveals that its owner is a minor.
--
-- Run after 024. Safe to re-run.
-- =====================================================================

alter table public.members add column if not exists adult boolean;

create or replace function public.member_set_adult(p_adult boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.my_member_id();
begin
  if v_me is null then raise exception 'Set up your pass first'; end if;
  if p_adult is null then raise exception 'Choose one'; end if;
  if (select adult from public.members where id = v_me) is not null then
    raise exception 'Already answered. Ask the front desk to change it';
  end if;
  update public.members set adult = p_adult where id = v_me;
  if not p_adult then
    update public.members set share_visits = false, share_lifts = false where id = v_me;
    delete from public.friends       where v_me in (requester_id, addressee_id);
    delete from public.friend_blocks where v_me in (blocker_id, blocked_id);
  end if;
end $$;

-- Same as 024, plus the adult checks.
create or replace function public.friend_request(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me   uuid := public.my_member_id();
  v_in   text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_them uuid;
  v_name text;
  v_row  public.friends;
begin
  if v_me is null then raise exception 'Set up your pass first'; end if;
  if (select adult from public.members where id = v_me) is not true then
    raise exception 'Friends is for members 18 and older';
  end if;
  if (select count(*) from public.friend_code_misses where member_id = v_me and at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many wrong codes. Wait an hour and try again';
  end if;
  if (select count(*) from public.friends where requester_id = v_me and created_at > now() - interval '1 day') >= 20 then
    raise exception 'You''ve sent 20 requests today. Try again tomorrow';
  end if;
  if (select count(*) from public.friends where v_me in (requester_id, addressee_id)) >= 200 then
    raise exception 'You''ve reached 200 friends';
  end if;

  select id, full_name into v_them, v_name from public.members
   where friend_code = v_in and user_id is not null and adult is true;
  if v_them is null then
    insert into public.friend_code_misses (member_id) values (v_me);
    return jsonb_build_object('result', 'not_found');
  end if;
  if v_them = v_me then raise exception 'That''s your own friend code'; end if;

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
  return jsonb_build_object('result', 'sent');
end $$;

create or replace function public.friend_respond(p_member_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.my_member_id();
begin
  if (select adult from public.members where id = v_me) is not true then
    raise exception 'Friends is for members 18 and older';
  end if;
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

-- Same as 024; empty unless I'm an adult, and only lists adults.
create or replace function public.my_friends()
returns table (member_id uuid, name text, state text, trained_today boolean, last_visit date)
language sql stable security definer set search_path = public as $$
  with me as (select id from public.members where user_id = auth.uid() and adult is true),
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
    join public.members m on m.id = p.other and m.adult is true
    left join lateral (select max((c.checked_at at time zone 'Asia/Manila')::date) as d
                         from public.checkins c where c.member_id = m.id) lv on true
   order by p.state = 'incoming' desc, lv.d desc nulls last, 2
$$;

-- Same as 023; friends only when both are adults.
create or replace function public.friends_leaderboard(p_exercise_id uuid)
returns table (name text, is_me boolean, weight_kg numeric, reps integer, lifted_on date)
language sql stable security definer set search_path = public as $$
  with me as (select id, adult from public.members where user_id = auth.uid()),
  people as (
    select me.id as member_id from me
    union
    select m.id from public.members m, me
     where me.adult is true and m.adult is true and m.share_lifts and public.are_friends(me.id, m.id)
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

-- Sharing stays off for anyone not confirmed 18+.
create or replace function public.member_set_sharing(p_visits boolean, p_lifts boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if (p_visits or p_lifts) and (select adult from public.members where user_id = auth.uid()) is not true then
    raise exception 'Friends is for members 18 and older';
  end if;
  update public.members
     set share_visits = coalesce(p_visits, share_visits), share_lifts = coalesce(p_lifts, share_lifts)
   where user_id = auth.uid();
end $$;

-- Same as 024, plus adult.
drop function if exists public.member_me();
create function public.member_me()
returns table (code text, full_name text, phone text, email text, qr_token text,
               plan_name text, ends_on date, status text, member_until date, joined date, consented boolean, reminders boolean,
               share_visits boolean, share_lifts boolean, friend_code text, adult boolean)
language sql stable security definer set search_path = public as $$
  select v.code, v.full_name, v.phone, m.email, m.qr_token,
         v.plan_name, v.ends_on, v.status, v.member_until, (v.created_at at time zone 'Asia/Manila')::date,
         m.consented_at is not null, m.reminders, m.share_visits, m.share_lifts, m.friend_code, m.adult
    from public.members m
    join public.v_members v on v.id = m.id
   where m.user_id = auth.uid()
$$;

revoke all on function public.member_set_adult(boolean)              from public, anon;
revoke all on function public.friend_request(text)                   from public, anon;
revoke all on function public.friend_respond(uuid, boolean)          from public, anon;
revoke all on function public.my_friends()                           from public, anon;
revoke all on function public.friends_leaderboard(uuid)              from public, anon;
revoke all on function public.member_set_sharing(boolean, boolean)   from public, anon;
revoke all on function public.member_me()                            from public, anon;
grant execute on function public.member_set_adult(boolean)            to authenticated;
grant execute on function public.friend_request(text)                 to authenticated;
grant execute on function public.friend_respond(uuid, boolean)        to authenticated;
grant execute on function public.my_friends()                         to authenticated;
grant execute on function public.friends_leaderboard(uuid)            to authenticated;
grant execute on function public.member_set_sharing(boolean, boolean) to authenticated;
grant execute on function public.member_me()                          to authenticated;

notify pgrst, 'reload schema';
