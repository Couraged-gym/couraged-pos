-- =====================================================================
-- 026  Website pass linking ignores how the name is written. The front
-- desk saves most names as "LAST, FIRST" (with or without a space after
-- the comma, usually in capitals), so 021's "first word" compared the
-- surname on file with the first name typed online and sent people to
-- the gym-code step. Now the first name on file (the word after the
-- comma, or the first word if there is no comma) only has to appear
-- somewhere in the name typed, in any case or order. Safe to re-run.
-- =====================================================================

-- Words of a name, lower case, letters only: 'DELA CRUZ,Juan' -> {dela,cruz,juan}.
create or replace function public.name_words(p text) returns text[]
language sql immutable as $$
  select coalesce(array_agg(w), '{}') from regexp_split_to_table(lower(coalesce(p, '')), '[^[:alpha:]]+') w where w <> ''
$$;

-- First name of a stored name: 'DELA CRUZ, MA. CLARA' -> 'ma', 'Juan Dela Cruz' -> 'juan'.
create or replace function public.first_name_key(p text) returns text
language sql immutable as $$
  select (public.name_words(case when p like '%,%' then split_part(p, ',', 2) else p end))[1]
$$;

create or replace function public.member_start(p_full_name text, p_phone text, p_consent text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_name  text := btrim(coalesce(p_full_name, ''));
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
    insert into public.members (full_name, phone, email, user_id, consent_version, consented_at, created_by)
    values (v_name, btrim(p_phone), (select email from auth.users where id = v_uid), v_uid, p_consent, now(), v_uid)
    returning code into v_code;
    return jsonb_build_object('result', 'joined', 'code', v_code);
  end if;

  select array_agg(id) into v_ids from public.members
   where id = any(v_ids) and user_id is null and public.first_name_key(full_name) = any(public.name_words(v_name));
  if coalesce(array_length(v_ids, 1), 0) <> 1 then
    insert into public.member_link_attempts (user_id) values (v_uid);
    return jsonb_build_object('result', 'need_code');
  end if;

  update public.members
     set user_id = v_uid, email = (select email from auth.users where id = v_uid),
         consent_version = p_consent, consented_at = now()
   where id = v_ids[1] and user_id is null
  returning code into v_code;
  return jsonb_build_object('result', 'linked', 'code', v_code);
end $$;

revoke all on function public.member_start(text, text, text) from public, anon;
revoke all on function public.first_name_key(text)           from public, anon;
revoke all on function public.name_words(text)               from public, anon;
grant execute on function public.member_start(text, text, text) to authenticated;

notify pgrst, 'reload schema';
