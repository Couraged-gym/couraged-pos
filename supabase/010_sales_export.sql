-- =====================================================================
-- 010  Sales export (Analytics › Export sales). One call returns the
-- rows behind the daily, summary and transaction-log exports, grouped
-- here rather than in the browser. Admin only; not security definer,
-- so the sales read policies still apply. Safe to re-run.
--
-- Amounts come from the sale_items snapshot (price and cost at the time
-- of sale), never from today's product prices. Days are Manila days.
-- Line amounts are before receipt discounts; discounts come back
-- separately so the export can take them off and match Analytics.
-- =====================================================================

create or replace function public.sales_export(p_from date, p_to date, p_log boolean default false)
returns jsonb
language plpgsql stable set search_path = public as $$
declare
  v jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can export sales';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Pick a valid date range';
  end if;
  if p_to - p_from > 731 then
    raise exception 'Pick a range of two years or less';
  end if;

  with
  s as (
    select s.*, s.sold_at at time zone 'Asia/Manila' as local
      from public.sales s
     where s.sold_at >= p_from::timestamp at time zone 'Asia/Manila'
       and s.sold_at < (p_to + 1)::timestamp at time zone 'Asia/Manila'
  ),
  li as (
    select s.local::date as d, s.sale_no, s.local, s.payment_method, s.status, s.staff_id,
           si.product_id, si.product_code, si.product_name, si.qty, si.unit_price, si.unit_cost, si.line_total, p.kind
      from s
      join public.sale_items si on si.sale_id = s.id
      join public.products p on p.id = si.product_id
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    -- One row per day, product and price (a mid-day price change gives two rows).
    'lines', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'date', d, 'kind', kind, 'code', product_code, 'name', product_name,
               'unit_price', unit_price, 'unit_cost', unit_cost, 'qty', qty,
               'cash', cash, 'gcash', gcash, 'other', other)
             order by d, kind, product_code, unit_price), '[]'::jsonb)
        from (select d, kind, product_code, product_name, unit_price, unit_cost, sum(qty) as qty,
                     coalesce(sum(line_total) filter (where payment_method = 'cash'), 0) as cash,
                     coalesce(sum(line_total) filter (where payment_method = 'gcash'), 0) as gcash,
                     coalesce(sum(line_total) filter (where payment_method not in ('cash', 'gcash')), 0) as other
                from li where status = 'completed'
               group by d, kind, product_code, product_name, unit_price, unit_cost) q),
    'discounts', (
      select coalesce(jsonb_agg(jsonb_build_object('date', d, 'cash', cash, 'gcash', gcash, 'other', other) order by d), '[]'::jsonb)
        from (select local::date as d,
                     coalesce(sum(discount) filter (where payment_method = 'cash'), 0) as cash,
                     coalesce(sum(discount) filter (where payment_method = 'gcash'), 0) as gcash,
                     coalesce(sum(discount) filter (where payment_method not in ('cash', 'gcash')), 0) as other
                from s where status = 'completed' and discount > 0
               group by 1) q),
    'other_methods', (
      select coalesce(jsonb_agg(distinct payment_method), '[]'::jsonb)
        from s where status = 'completed' and payment_method not in ('cash', 'gcash')),
    'voided', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'date', s.local::date, 'time', to_char(s.local, 'HH24:MI'), 'sale_no', s.sale_no,
               'items', (select string_agg(si.qty || ' x ' || si.product_name, ', ' order by si.product_name)
                           from public.sale_items si where si.sale_id = s.id),
               'total', s.total, 'reason', s.void_reason)
             order by s.sold_at), '[]'::jsonb)
        from s where s.status = 'voided'),
    'log', case when p_log then (
      select coalesce(jsonb_agg(jsonb_build_object(
               'sale_no', li.sale_no, 'date', li.d, 'time', to_char(li.local, 'HH24:MI'),
               'staff', coalesce(pf.full_name, 'Unknown'), 'code', li.product_code, 'name', li.product_name,
               'qty', li.qty, 'unit_price', li.unit_price, 'line_total', li.line_total,
               'method', li.payment_method, 'status', li.status)
             order by li.local, li.sale_no, li.product_name), '[]'::jsonb)
        from li left join public.profiles pf on pf.id = li.staff_id) end
  ) into v;

  return v;
end $$;

revoke all on function public.sales_export(date, date, boolean) from public, anon;
grant execute on function public.sales_export(date, date, boolean) to authenticated;

notify pgrst, 'reload schema';
