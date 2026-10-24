-- =====================================================================
-- 015  Gym codes like CRDFH26-0012 (26 = year registered) and more
-- payslip deduction lines. Safe to re-run.
--
-- 1. members.code: typed in by staff for members who already have a
--    card, or given automatically (next number for this year) when left
--    blank. Members registered before this patch get codes by year, in
--    the order they joined.
-- 2. payroll_items: Pag-IBIG loan, SSS loan, rice, paraphernalia, loan.
-- =====================================================================

alter table public.members add column if not exists code text unique;

update public.members m
   set code = x.yr || lpad(x.rn::text, 4, '0')
  from (
    select id,
           'CRDFH' || to_char(created_at at time zone 'Asia/Manila', 'YY') || '-' as yr,
           row_number() over (partition by to_char(created_at at time zone 'Asia/Manila', 'YY') order by member_no) as rn
      from public.members
     where code is null
  ) x
 where m.id = x.id and m.code is null;

-- Blank code: next number for this year's prefix, as wide as the codes
-- already entered (4 digits if none).
-- ponytail: two registrations in the same instant can pick the same number; the unique constraint rejects the second and staff save again.
create or replace function public.members_code() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  p text := 'CRDFH' || to_char(now() at time zone 'Asia/Manila', 'YY') || '-';
begin
  new.code := upper(nullif(btrim(new.code), ''));
  if new.code is null then
    select p || lpad((coalesce(max(substring(code from length(p) + 1)::bigint), 0) + 1)::text,
                     coalesce((select max(length(code) - position('-' in code)) from public.members where code ~ '^CRDFH\d{2}-\d+$'), 4), '0')
      into new.code
      from public.members
     where code like p || '%' and substring(code from length(p) + 1) ~ '^\d+$';
  end if;
  return new;
end $$;
drop trigger if exists members_code on public.members;
create trigger members_code before insert or update of code on public.members
  for each row execute function public.members_code();

alter table public.members alter column code set not null;
grant update (code) on public.members to authenticated;

-- Same as 013, plus code.
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
  m.code
from public.members m
left join lateral (
  select p.plan_name, p.ends_on
    from public.member_periods p
   where p.member_id = m.id and not p.voided and not p.is_membership
   order by p.ends_on desc
   limit 1
) cur on true;

alter table public.payroll_items add column if not exists pagibig_loan  numeric(12,2) not null default 0 check (pagibig_loan >= 0);
alter table public.payroll_items add column if not exists sss_loan      numeric(12,2) not null default 0 check (sss_loan >= 0);
alter table public.payroll_items add column if not exists rice          numeric(12,2) not null default 0 check (rice >= 0);
alter table public.payroll_items add column if not exists paraphernalia numeric(12,2) not null default 0 check (paraphernalia >= 0);
alter table public.payroll_items add column if not exists loan          numeric(12,2) not null default 0 check (loan >= 0);

notify pgrst, 'reload schema';
