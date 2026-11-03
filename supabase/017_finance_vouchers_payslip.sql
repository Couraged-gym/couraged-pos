-- =====================================================================
-- 017  Bookkeeper's requests. Safe to re-run; run it after every other
-- patch (it rewrites their permission checks).
--
-- 1. Finance role: the bookkeeper's login. Expenses, vouchers, payroll
--    and reports like an admin; can read sales and receipts; no
--    register, inventory edits or staff management.
-- 2. Payslip lines: salary adjustment, holidays, cash bond, and typed
--    overrides of the suggested SSS / PhilHealth / Pag-IBIG / tax.
-- 3. Check vouchers and journal vouchers (Expenses tab).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Finance role
-- ---------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'staff', 'finance', 'inactive'));

create or replace function public.is_finance()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('admin', 'finance') from public.profiles where id = auth.uid()), false)
$$;

-- ---------------------------------------------------------------------
-- 2. Payslip lines
-- ---------------------------------------------------------------------
alter table public.payroll_items add column if not exists salary_adjustment numeric(12,2) not null default 0;  -- + or -
alter table public.payroll_items add column if not exists holiday_days      numeric(5,2);
alter table public.payroll_items add column if not exists holiday_pay       numeric(12,2) not null default 0 check (holiday_pay >= 0);
alter table public.payroll_items add column if not exists cash_bond         numeric(12,2) not null default 0 check (cash_bond >= 0);
-- Amounts typed over the suggestion, e.g. {"sss_ee": 280}. Missing key = suggestion used.
alter table public.payroll_items add column if not exists manual            jsonb not null default '{}';

-- ---------------------------------------------------------------------
-- 3. Vouchers. Documents for the books; they don't add to Expenses
-- (record the expense itself there, or it comes from a pay run).
-- lines: [{ "code": "601-002-0001", "title": "Government remittances - SSS premium", "debit": 190.25, "credit": 0 }]
-- ---------------------------------------------------------------------
create table if not exists public.vouchers (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('check', 'journal')),
  voucher_no      text not null check (length(trim(voucher_no)) > 0),
  voucher_date    date not null,
  payee           text,
  bank            text,
  check_no        text,
  check_date      date,
  reference       text,
  explanation     text,
  amount          numeric(12,2) not null default 0 check (amount >= 0),
  lines           jsonb not null default '[]',
  prepared_by     text,
  noted_by        text,
  approved_by     text,
  received_by     text,
  payroll_run_id  uuid references public.payroll_runs(id),
  status          text not null default 'active' check (status in ('active', 'voided')),
  void_reason     text,
  created_by      uuid references auth.users(id) default auth.uid(),
  created_at      timestamptz not null default now(),
  unique (kind, voucher_no)
);
create index if not exists vouchers_date_idx on public.vouchers (voucher_date);

alter table public.vouchers enable row level security;
drop policy if exists "vouchers read"   on public.vouchers;
drop policy if exists "vouchers insert" on public.vouchers;
drop policy if exists "vouchers update" on public.vouchers;
create policy "vouchers read"   on public.vouchers for select to authenticated using (public.is_finance());
create policy "vouchers insert" on public.vouchers for insert to authenticated with check (public.is_finance() and status = 'active');
-- Voided vouchers are locked; never deleted, so the numbers have no gaps.
create policy "vouchers update" on public.vouchers for update to authenticated using (public.is_finance() and status = 'active') with check (public.is_finance());
revoke delete on public.vouchers from authenticated, anon;

-- ---------------------------------------------------------------------
-- 4. Hand finance the admin's checks on the money side:
--    - every policy on the expense, payroll and voucher tables, and on
--      the receipts bucket;
--    - every read policy elsewhere (sales, receipts, names);
--    - the expense, payroll and report functions.
-- Rewritten from their live definitions, so the latest patch wins.
-- ---------------------------------------------------------------------
do $$
declare
  p   record;
  q   text;
  c   text;
  fin text[] := array['expenses', 'expense_categories', 'recurring_expenses', 'expense_changes', 'employees', 'employee_changes',
                      'payroll_rates', 'payroll_runs', 'payroll_items', 'cash_advances', 'vouchers'];
  f   record;
begin
  for p in select * from pg_policies where schemaname in ('public', 'storage') loop
    if p.cmd = 'SELECT'
       or (p.schemaname = 'public' and p.tablename = any (fin))
       or (p.schemaname = 'storage' and coalesce(p.qual, '') || coalesce(p.with_check, '') like '%receipts%') then
      q := replace(p.qual, 'is_admin()', 'is_finance()');
      c := replace(p.with_check, 'is_admin()', 'is_finance()');
      if q is distinct from p.qual or c is distinct from p.with_check then
        execute format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename)
             || coalesce(' using (' || q || ')', '') || coalesce(' with check (' || c || ')', '');
      end if;
    end if;
  end loop;

  for f in select oid from pg_proc where pronamespace = 'public'::regnamespace
             and proname in ('void_expense', 'finalize_payroll', 'void_payroll_run', 'void_cash_advance', 'sales_report', 'sales_export', 'stock_report') loop
    execute replace(pg_get_functiondef(f.oid), 'public.is_admin()', 'public.is_finance()');
  end loop;
  -- The day summary printout, for the bookkeeper too.
  for f in select oid from pg_proc where pronamespace = 'public'::regnamespace and proname = 'day_summary' loop
    if pg_get_functiondef(f.oid) not like '%is_finance%' then
      execute replace(pg_get_functiondef(f.oid), 'not public.is_staff()', 'not (public.is_staff() or public.is_finance())');
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 5. Plans by calendar month. A 30-day plan bought Oct 27 now runs to
-- Nov 26 (renews Nov 27), not a fixed 30 days. Lengths in 30s are
-- months, 365s are years, anything else stays days. Same rule as
-- planEnd() in src/lib/util.js.
-- ---------------------------------------------------------------------
create or replace function public.plan_end(p_start date, p_days integer, p_qty integer default 1)
returns date language sql immutable as $$
  select case
    when p_days % 365 = 0 then (p_start + make_interval(years => p_days / 365 * p_qty))::date - 1
    when p_days % 30 = 0  then (p_start + make_interval(months => p_days / 30 * p_qty))::date - 1
    else p_start + p_days * p_qty - 1
  end
$$;

do $$
declare
  f record;
begin
  for f in select oid from pg_proc where pronamespace = 'public'::regnamespace and proname = 'record_sale' loop
    if pg_get_functiondef(f.oid) like '%v_start + v_product.duration_days * v_qty - 1%' then
      execute replace(pg_get_functiondef(f.oid), 'v_start + v_product.duration_days * v_qty - 1', 'public.plan_end(v_start, v_product.duration_days, v_qty)');
    end if;
  end loop;
end $$;

-- Periods already sold: recount from their start date the same way.
-- Re-running gives the same dates.
update public.member_periods mp
   set ends_on = public.plan_end(mp.starts_on, p.duration_days, ((mp.ends_on - mp.starts_on + 1) / p.duration_days)::int)
  from public.products p
 where p.id = mp.product_id and mp.sale_id is not null and not mp.voided
   and p.duration_days is not null and (p.duration_days % 30 = 0 or p.duration_days % 365 = 0)
   and (mp.ends_on - mp.starts_on + 1) % p.duration_days = 0;

notify pgrst, 'reload schema';
