-- =====================================================================
-- 013  Gym rates. The annual membership (yearly insurance) is tracked
-- apart from gym time: paying it makes someone a member for a year but
-- doesn't let them train, and a monthly plan doesn't make them a member.
-- Member-rate items (Day pass, member) need a current annual membership.
-- Also adds the gym's price list. Safe to re-run.
-- =====================================================================

alter table public.products add column if not exists is_membership boolean not null default false;
alter table public.products add column if not exists members_only  boolean not null default false;
grant insert (is_membership, members_only), update (is_membership, members_only) on public.products to authenticated;
alter table public.member_periods add column if not exists is_membership boolean not null default false;

-- Same as 012, plus the two flags in the product history.
create or replace function public.log_product_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  f text;
begin
  if tg_op = 'INSERT' then
    insert into public.product_changes (product_id, field, new_value, changed_by)
    values (new.id, 'created', new.name, auth.uid());
    return new;
  end if;
  foreach f in array array['name', 'code', 'category', 'kind', 'unit_cost', 'selling_price', 'reorder_level', 'is_active', 'duration_days', 'student_price', 'is_membership', 'members_only'] loop
    if (to_jsonb(old) ->> f) is distinct from (to_jsonb(new) ->> f) then
      insert into public.product_changes (product_id, field, old_value, new_value, changed_by)
      values (new.id, f, to_jsonb(old) ->> f, to_jsonb(new) ->> f, auth.uid());
    end if;
  end loop;
  return new;
end $$;

-- Same as 011, but plan_name / ends_on / status are gym time only;
-- member_until is the annual membership.
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
  (select max(p.ends_on) from public.member_periods p where p.member_id = m.id and not p.voided and p.is_membership) as member_until
from public.members m
left join lateral (
  select p.plan_name, p.ends_on
    from public.member_periods p
   where p.member_id = m.id and not p.voided and not p.is_membership
   order by p.ends_on desc
   limit 1
) cur on true;

-- Same as 009, except: membership lines go first (so a member day pass
-- can be bought in the same sale as the membership), each kind of period
-- extends only its own kind, and members_only items check the membership.
create or replace function public.record_sale(
  p_items            jsonb,
  p_payment_method   text    default 'cash',
  p_discount         numeric default 0,
  p_amount_tendered  numeric default null,
  p_customer_name    text    default null,
  p_note             text    default null,
  p_sold_at          timestamptz default null,
  p_client_ref       uuid    default null,
  p_payment_ref      text    default null,
  p_member_id        uuid    default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_sale_id   uuid;
  v_item      jsonb;
  v_product   public.products%rowtype;
  v_qty       integer;
  v_subtotal  numeric := 0;
  v_discount  numeric := coalesce(p_discount, 0);
  v_total     numeric;
  v_sold_at   timestamptz := case when p_sold_at is not null and public.is_admin() then p_sold_at else now() end;
  v_day       date := (v_sold_at at time zone 'Asia/Manila')::date;
  v_member    text;
  v_start     date;
begin
  if not public.is_staff() then
    raise exception 'Not authorized';
  end if;

  -- Retry of a checkout that already went through: hand back that sale.
  if p_client_ref is not null then
    select id into v_sale_id from public.sales where client_ref = p_client_ref;
    if found then
      return v_sale_id;
    end if;
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Cart is empty';
  end if;

  if p_payment_method = 'gcash' and coalesce(p_payment_ref, '') !~ '^\d{4}$' then
    raise exception 'Enter the last 4 digits of the GCash reference number';
  end if;

  -- Locks the member so two renewals at once can't both start on the same day.
  if p_member_id is not null then
    select full_name into v_member from public.members where id = p_member_id for update;
    if not found then
      raise exception 'Member not found';
    end if;
  end if;

  insert into public.sales (sold_at, payment_method, payment_ref, discount, customer_name, note, staff_id, client_ref)
  values (v_sold_at, p_payment_method, case when p_payment_method = 'gcash' then p_payment_ref end,
          v_discount, coalesce(p_customer_name, v_member), p_note, auth.uid(), p_client_ref)
  returning id into v_sale_id;

  for v_item in
    select e from jsonb_array_elements(p_items) e
     order by coalesce((select is_membership from public.products where id = (e->>'product_id')::uuid), false) desc
  loop
    v_qty := (v_item->>'qty')::integer;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Invalid quantity in cart';
    end if;

    select * into v_product
      from public.products
     where id = (v_item->>'product_id')::uuid
       and is_active
       for update;

    if not found then
      raise exception 'Product not found or inactive';
    end if;

    -- Blocks selling more than is in stock. To allow negative stock while
    -- opening counts are still being set up, comment out this block.
    if v_product.kind = 'good' and v_product.stock_qty < v_qty then
      raise exception 'Not enough stock for % (have %, need %)',
        v_product.name, v_product.stock_qty, v_qty;
    end if;

    if v_product.members_only and not exists (
      select 1 from public.member_periods
       where member_id = p_member_id and is_membership and not voided and ends_on >= v_day
    ) then
      raise exception '% is for members with a current annual membership. Choose the member, or sell the non-member rate.', v_product.name;
    end if;

    insert into public.sale_items (sale_id, product_id, product_code, product_name, qty, unit_price, unit_cost)
    values (v_sale_id, v_product.id, v_product.code, v_product.name, v_qty, v_product.selling_price, v_product.unit_cost);

    if v_product.kind = 'good' then
      insert into public.stock_movements (product_id, movement_type, qty, unit_cost, sale_id, occurred_at)
      values (v_product.id, 'sale', -v_qty, v_product.unit_cost, v_sale_id, v_sold_at);
    end if;

    if v_product.duration_days is not null then
      if p_member_id is null then
        raise exception 'Choose the member this % is for', v_product.name;
      end if;
      select greatest(v_day, max(ends_on) + 1) into v_start
        from public.member_periods
       where member_id = p_member_id and not voided and is_membership = v_product.is_membership;
      insert into public.member_periods (member_id, sale_id, product_id, plan_name, starts_on, ends_on, is_membership)
      values (p_member_id, v_sale_id, v_product.id, v_product.name, v_start, v_start + v_product.duration_days * v_qty - 1, v_product.is_membership);
    end if;

    v_subtotal := v_subtotal + v_qty * v_product.selling_price;
  end loop;

  if v_discount > v_subtotal then
    raise exception 'Discount is larger than the subtotal';
  end if;

  v_total := v_subtotal - v_discount;

  if p_amount_tendered is not null and p_amount_tendered < v_total then
    raise exception 'Amount tendered (%) is less than the total (%)', p_amount_tendered, v_total;
  end if;

  update public.sales
     set subtotal        = v_subtotal,
         total           = v_total,
         amount_tendered = p_amount_tendered,
         change_due      = case when p_amount_tendered is not null then p_amount_tendered - v_total end
   where id = v_sale_id;

  return v_sale_id;
end $$;

revoke all on function public.record_sale(jsonb, text, numeric, numeric, text, text, timestamptz, uuid, text, uuid) from public, anon;
grant execute on function public.record_sale(jsonb, text, numeric, numeric, text, text, timestamptz, uuid, text, uuid) to authenticated;

-- The price list. A month is 30 days. Skips any code or name already in
-- use, so plans you made yourself are left alone (fix their prices in
-- Members › Plans).
insert into public.products (code, name, category, kind, selling_price, student_price, duration_days, is_membership, members_only)
select v.* from (values
  ('MEMBERSHIP', 'Annual Membership',               'Membership',    'service', 500.00,   450.00::numeric, 365, true,  false),
  ('DAY',        'Day Pass (Non-member)',           'Day pass',      'service', 200.00,   180.00,          null, false, false),
  ('DAY-M',      'Day Pass (Member)',               'Day pass',      'service', 150.00,   135.00,          null, false, true),
  ('MONTH',      'Monthly',                         'Membership',    'service', 1500.00,  1350.00,         30,   false, false),
  ('M3',         '3 Months',                        'Membership',    'service', 4200.00,  null,            90,   false, false),
  ('M6',         '6 Months',                        'Membership',    'service', 7800.00,  null,            180,  false, false),
  ('Y1',         '1 Year',                          'Membership',    'service', 14400.00, null,            365,  false, false),
  ('PROMO-3+1',  'Promo: 3 Months + 1 Free',        'Membership',    'service', 4500.00,  null,            120,  false, false),
  ('PROMO-5+2',  'Promo: 5 Months + 2 Free',        'Membership',    'service', 7500.00,  null,            210,  false, false),
  ('PT15',       '1-on-1 Personal Training (15 sessions)', 'Personal training', 'service', 2000.00, null,   null, false, false)
) as v(code, name, category, kind, selling_price, student_price, duration_days, is_membership, members_only)
where not exists (
  select 1 from public.products p
   where p.code = v.code or (lower(p.name) = lower(v.name) and p.deleted_at is null)
);

notify pgrst, 'reload schema';
