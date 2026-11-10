-- =====================================================================
-- 029  Sales export in the gym's manual layout: adds 'units', one row
-- per unit sold with its share of the receipt discount, for the daily
-- tabs and the Summary of Items / Summary of Services tabs. Same as 010
-- otherwise. Safe to re-run.
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
    select s.local::date as d, s.id as sale_id, s.discount, s.note, s.sale_no, s.local, s.payment_method, s.status, s.staff_id,
           si.product_id, si.product_code, si.product_name, si.qty, si.unit_price, si.unit_cost, si.line_total, p.kind
      from s
      join public.sale_items si on si.sale_id = s.id
      join public.products p on p.id = si.product_id
  ),
  -- One row per unit sold, as the gym's manual sheet lists them. Each receipt's discount is
  -- shared over its units by price; a student discount only over its services. The last
  -- weighted unit takes the rounding, so a receipt's units always add up to its total.
  units as (
    select li.*, g.n, coalesce(li.note, '') ilike '%student%' as student,
           bool_or(li.kind = 'service') over (partition by li.sale_id) as has_service
      from li cross join lateral generate_series(1, li.qty) g(n)
     where li.status = 'completed'
  ),
  weighted as (
    select u.*, case when u.student and u.has_service and u.kind <> 'service' then 0 else u.unit_price end as wt
      from units u
  ),
  shared as (
    select w.*,
           coalesce(round(w.discount * w.wt / nullif(sum(w.wt) over (partition by w.sale_id), 0), 2), 0) as own,
           row_number() over (partition by w.sale_id order by w.wt > 0, w.kind, w.product_name, w.n) as rn,
           count(*) over (partition by w.sale_id) as cnt
      from weighted w
  ),
  priced as (
    select x.*, case when x.rn = x.cnt then x.discount - (sum(x.own) over (partition by x.sale_id) - x.own) else x.own end as disc
      from shared x
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
    'units', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'date', d, 'time', to_char(local, 'HH24:MI'), 'sale_no', sale_no, 'kind', kind,
               'code', product_code, 'name', product_name, 'unit_price', unit_price, 'unit_cost', unit_cost,
               'method', payment_method, 'student', student,
               'disc', disc)
             order by local, sale_no, kind, product_name, n), '[]'::jsonb)
        from priced),
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
