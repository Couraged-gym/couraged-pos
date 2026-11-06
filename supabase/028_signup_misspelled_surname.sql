-- =====================================================================
-- 028  Website sign-up also spots a desk record whose surname is spelled
-- differently (MABANGUE vs MBANAGUE): when the first and middle names
-- (two words or more) all match, it asks for the gym code instead of
-- making a double. "I'm new here" still lets a different person join.
-- Safe to re-run.
-- =====================================================================

-- Given-name words of a stored name: 'MABANGUE, GIOVANNE GOMEZ' -> {giovanne,gomez}; no comma -> {}.
create or replace function public.given_name_words(p text) returns text[]
language sql immutable set search_path = public as $$
  select case when p like '%,%' then public.name_words(split_part(p, ',', 2)) else '{}' end
$$;
revoke all on function public.given_name_words(text) from public, anon;

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
                  and ((public.last_name_words(full_name) <@ v_words and public.first_name_key(full_name) = any(v_words))
                       -- surname misspelled on one side: first + middle names (2+ words) all match
                       or (cardinality(public.given_name_words(full_name)) >= 2 and public.given_name_words(full_name) <@ v_words))) then
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

revoke all on function public.member_start(text, text, text) from public, anon;
grant execute on function public.member_start(text, text, text) to authenticated;

notify pgrst, 'reload schema';
