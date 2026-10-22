-- =====================================================================
-- 014  Day summary (X-reading), cash advances, inventory purchases and
-- stock losses. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Day summary for the receipt printer: every sale of one Manila day,
-- whoever rang it up. Staff can print it at closing. Internal only: it
-- resets nothing and is not a BIR Z-reading.
-- ---------------------------------------------------------------------
create or replace function public.day_summary(p_date date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then
    raise exception 'Not authorized';
  end if;
  return (
    with s as (select * from public.v_sale_totals where sale_date = p_date),
    done as (select * from s where status = 'completed')
    select jsonb_build_object(
      'date', p_date,
      'first_no', (select min(sale_no) from s),
      'last_no', (select max(sale_no) from s),
      'receipts', (select count(*) from done),
      'gross', (select coalesce(sum(subtotal), 0) from done),
      'discounts', (select coalesce(sum(discount), 0) from done),
      'net', (select coalesce(sum(total), 0) from done),
      'voids', (select jsonb_build_object('count', count(*), 'total', coalesce(sum(total), 0)) from s where status = 'voided'),
      'payments', (
        select coalesce(jsonb_agg(jsonb_build_object('method', payment_method, 'receipts', n, 'total', t) order by t desc), '[]'::jsonb)
          from (select payment_method, count(*) as n, sum(total) as t from done group by payment_method) q),
      -- Line totals, before receipt discounts (they add up to gross).
      'categories', (
        select coalesce(jsonb_agg(jsonb_build_object('category', category, 'total', t) order by t desc), '[]'::jsonb)
          from (select p.category, sum(si.line_total) as t
                  from public.sale_items si
                  join done d on d.id = si.sale_id
                  join public.products p on p.id = si.product_id
                 group by p.category) q)
    )
  );
end $$;
revoke all on function public.day_summary(date) from public, anon;
grant execute on function public.day_summary(date) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Cash advances. Money the employee owes back, repaid by payroll
-- deduction: not an expense. One open advance per employee. DOLE needs
-- the employee's written authorization, and no interest is charged.
-- Advances are voided with a reason, never deleted.
-- ---------------------------------------------------------------------
create table if not exists public.cash_advances (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees(id),
  given_on     date not null,
  amount       numeric(12,2) not null check (amount > 0),
  installment  numeric(12,2) not null check (installment > 0),  -- deducted per payday
  reason       text,
  authorized   boolean not null check (authorized),            -- employee signed the deduction authorization
  status       text not null default 'active' check (status in ('active', 'voided')),
  void_reason  text,
  voided_by    uuid references auth.users(id),
  voided_at    timestamptz,
  created_by   uuid references auth.users(id) default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists cash_advances_employee_idx on public.cash_advances (employee_id);

alter table public.payroll_items add column if not exists advance_id uuid references public.cash_advances(id);
alter table public.payroll_items add column if not exists cash_advance numeric(12,2) not null default 0 check (cash_advance >= 0);
alter table public.payroll_items add column if not exists advance_balance numeric(12,2); -- left to repay after this payslip, set at finalize

-- Repaid = deductions on finalized payslips; a voided pay run gives its deductions back.
create or replace view public.v_cash_advances with (security_invoker = true) as
select a.*,
       coalesce(sum(i.cash_advance) filter (where r.status = 'finalized'), 0)            as repaid,
       a.amount - coalesce(sum(i.cash_advance) filter (where r.status = 'finalized'), 0) as balance
  from public.cash_advances a
  left join public.payroll_items i on i.advance_id = a.id
  left join public.payroll_runs r on r.id = i.run_id
 group by a.id;

create or replace function public.one_open_advance()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.v_cash_advances
              where employee_id = new.employee_id and status = 'active' and balance > 0) then
    raise exception 'This employee still has a cash advance to repay. Finish or void it first.';
  end if;
  return new;
end $$;
drop trigger if exists cash_advances_one_open on public.cash_advances;
create trigger cash_advances_one_open before insert on public.cash_advances
  for each row execute function public.one_open_advance();

create or replace function public.void_cash_advance(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can void a cash advance';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to void a cash advance';
  end if;
  if exists (select 1 from public.v_cash_advances where id = p_id and repaid > 0) then
    raise exception 'Repayments were already deducted from payslips; void those pay runs first';
  end if;
  update public.cash_advances
     set status = 'voided', void_reason = trim(p_reason), voided_by = auth.uid(), voided_at = now()
   where id = p_id and status = 'active';
  if not found then
    raise exception 'Cash advance not found or already voided';
  end if;
end $$;
revoke all on function public.void_cash_advance(uuid, text) from public, anon;
grant execute on function public.void_cash_advance(uuid, text) to authenticated;

alter table public.cash_advances enable row level security;
drop policy if exists "advances admin read"   on public.cash_advances;
drop policy if exists "advances admin insert" on public.cash_advances;
create policy "advances admin read"   on public.cash_advances for select to authenticated using (public.is_admin());
create policy "advances admin insert" on public.cash_advances for insert to authenticated
  with check (public.is_admin() and status = 'active' and created_by = auth.uid());

-- Finalize (from 007), now also checking cash advance deductions and
-- stamping the balance left on each payslip.
create or replace function public.finalize_payroll(p_run_id uuid, p_rates jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  r        public.payroll_runs%rowtype;
  v_gross  numeric;
  v_er     numeric;
  v_n      integer;
  v_label  text;
  v_cat_pay uuid;
  v_cat_gov uuid;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can finalize payroll';
  end if;
  select * into r from public.payroll_runs where id = p_run_id for update;
  if not found then
    raise exception 'Pay run not found';
  end if;
  if r.status <> 'draft' then
    raise exception 'This pay run is already %', r.status;
  end if;

  select count(*), coalesce(sum(gross_pay), 0), coalesce(sum(sss_er + sss_ec + philhealth_er + pagibig_er), 0)
    into v_n, v_gross, v_er
    from public.payroll_items where run_id = p_run_id;
  if v_n = 0 then
    raise exception 'Add at least one employee before finalizing';
  end if;
  if exists (select 1 from public.payroll_items where run_id = p_run_id and net_pay < 0) then
    raise exception 'A payslip has a negative net pay; fix the deductions first';
  end if;
  if exists (
    select 1 from public.payroll_items i
      left join public.v_cash_advances a on a.id = i.advance_id
     where i.run_id = p_run_id and i.cash_advance > 0
       and (a.id is null or a.employee_id <> i.employee_id or a.status <> 'active' or i.cash_advance > a.balance)
  ) then
    raise exception 'A cash advance deduction is more than the employee owes';
  end if;

  update public.payroll_runs
     set status = 'finalized', rates = p_rates, finalized_by = auth.uid(), finalized_at = now()
   where id = p_run_id;
  update public.payroll_items i
     set advance_balance = a.balance
    from public.v_cash_advances a
   where i.run_id = p_run_id and a.id = i.advance_id;

  insert into public.expense_categories (name) values ('Payroll'), ('Government contributions') on conflict (name) do nothing;
  select id into v_cat_pay from public.expense_categories where name = 'Payroll';
  select id into v_cat_gov from public.expense_categories where name = 'Government contributions';
  v_label := to_char(r.period_start, 'Mon DD') || ' – ' || to_char(r.period_end, 'Mon DD, YYYY');

  insert into public.expenses (expense_date, category_id, description, amount, payment_method, payroll_run_id, created_by)
  values (r.pay_date, v_cat_pay, 'Salaries & wages, ' || v_label || ' (' || v_n || ' staff)', v_gross, 'cash', p_run_id, auth.uid());
  if v_er > 0 then
    insert into public.expenses (expense_date, category_id, description, amount, payment_method, payroll_run_id, created_by)
    values (r.pay_date, v_cat_gov, 'Employer SSS, PhilHealth & Pag-IBIG, ' || v_label, v_er, 'other', p_run_id, auth.uid());
  end if;
end $$;
revoke all on function public.finalize_payroll(uuid, jsonb) from public, anon;
grant execute on function public.finalize_payroll(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Stock report for Analytics. Purchases are cash spent restocking;
-- profit already counts goods as cost when they sell, so purchases are
-- shown but not subtracted. Losses = spoilage and stock-count
-- differences at cost (a count that finds extra stock lowers it), and
-- are taken off net profit.
-- ---------------------------------------------------------------------
create or replace function public.stock_report(p_from date, p_to date)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_days integer := p_to - p_from + 1;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can view reports';
  end if;
  return (
    -- ponytail: spoilage and counts have no cost of their own, so they use the product's current cost.
    with m as (
      select (sm.occurred_at at time zone 'Asia/Manila')::date as d,
             sm.movement_type = 'purchase' as bought,
             sm.qty * coalesce(sm.unit_cost, p.unit_cost) as v
        from public.stock_movements sm
        join public.products p on p.id = sm.product_id
       where sm.movement_type in ('purchase', 'spoilage', 'adjustment')
         and (sm.occurred_at at time zone 'Asia/Manila')::date between p_from - v_days and p_to
    )
    select jsonb_build_object(
      'purchases', coalesce(sum(v) filter (where bought and d >= p_from), 0),
      'losses', coalesce(-sum(v) filter (where not bought and d >= p_from), 0),
      'previous_losses', coalesce(-sum(v) filter (where not bought and d < p_from), 0),
      'daily', (
        select coalesce(jsonb_agg(jsonb_build_object('date', d, 'purchases', pu, 'losses', lo) order by d), '[]'::jsonb)
          from (select d, coalesce(sum(v) filter (where bought), 0) as pu, coalesce(-sum(v) filter (where not bought), 0) as lo
                  from m where d >= p_from group by d) q))
    from m
  );
end $$;
revoke all on function public.stock_report(date, date) from public, anon;
grant execute on function public.stock_report(date, date) to authenticated;

notify pgrst, 'reload schema';
