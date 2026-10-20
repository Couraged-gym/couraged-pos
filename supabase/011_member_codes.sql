-- =====================================================================
-- 011  Member codes. Every member gets a short number, shown as M0012,
-- that staff type (or scan) on the register to renew. Existing members
-- are numbered in the order they were added. Safe to re-run.
-- =====================================================================

alter table public.members add column if not exists member_no bigint generated always as identity unique;

-- Same as 009, plus member_no.
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
  m.member_no
from public.members m
left join lateral (
  select p.plan_name, p.ends_on
    from public.member_periods p
   where p.member_id = m.id and not p.voided
   order by p.ends_on desc
   limit 1
) cur on true;

notify pgrst, 'reload schema';
