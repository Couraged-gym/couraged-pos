-- =====================================================================
-- 009  Gym members: registration, renewals and who is active or
-- expired. A plan is a product with a length in days (duration_days);
-- selling it through the register to a member adds that many days to
-- their membership. Staff and admin. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Plan length. Blank = not a tracked plan (e.g. a walk-in day pass).
-- ---------------------------------------------------------------------
alter table public.products add column if not exists duration_days integer check (duration_days > 0);
grant insert (duration_days), update (duration_days) on public.products to authenticated;

-- Same as 002, plus duration_days in the product history.
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
  foreach f in array array['name', 'code', 'category', 'kind', 'unit_cost', 'selling_price', 'reorder_level', 'is_active', 'duration_days'] loop
    if (to_jsonb(old) ->> f) is distinct from (to_jsonb(new) ->> f) then
      insert into public.product_changes (product_id, field, old_value, new_value, changed_by)
      values (new.id, f, to_jsonb(old) ->> f, to_jsonb(new) ->> f, auth.uid());
    end if;
  end loop;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 2. Members. Never deleted, so their payment history stays whole.
-- ---------------------------------------------------------------------
create table if not exists public.members (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null check (trim(full_name) <> ''),
  phone       text,
  notes       text,
  created_by  uuid references auth.users(id) default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists members_name_idx on public.members (lower(full_name));

-- ---------------------------------------------------------------------
-- 3. Membership periods: one per plan sold, written only by record_sale.
-- Voiding the sale voids the period (trigger below).
-- ---------------------------------------------------------------------
create table if not exists public.member_periods (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.members(id) on delete restrict,
  sale_id     uuid not null references public.sales(id) on delete cascade,
  product_id  uuid not null references public.products(id) on delete restrict,
  plan_name   text not null,
  starts_on   date not null,
  ends_on     date not null check (ends_on >= starts_on),
  voided      boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists member_periods_member_idx on public.member_periods (member_id, ends_on desc);
create index if not exists member_periods_sale_idx on public.member_periods (sale_id);

alter table public.members        enable row level security;
alter table public.member_periods enable row level security;

drop policy if exists "members read"   on public.members;
drop policy if exists "members insert" on public.members;
drop policy if exists "members update" on public.members;
create policy "members read"   on public.members for select to authenticated using (public.is_staff());
create policy "members insert" on public.members for insert to authenticated
  with check (public.is_staff() and created_by = auth.uid());
create policy "members update" on public.members for update to authenticated
  using (public.is_staff()) with check (public.is_staff());
revoke update, delete on public.members from authenticated, anon;
grant update (full_name, phone, notes) on public.members to authenticated;

drop policy if exists "member periods read" on public.member_periods;
create policy "member periods read" on public.member_periods for select to authenticated using (public.is_staff());
revoke insert, update, delete on public.member_periods from authenticated, anon;

create or replace function public.void_member_periods()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.member_periods set voided = true where sale_id = new.id;
  return new;
end $$;

drop trigger if exists sales_void_member_periods on public.sales;
create trigger sales_void_member_periods
  after update of status on public.sales
  for each row when (new.status = 'voided' and old.status is distinct from 'voided')
  execute function public.void_member_periods();

-- Each member with their latest plan and status (Manila dates).
-- 'new' = registered but no plan bought yet.
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
  end as status
from public.members m
left join lateral (
  select p.plan_name, p.ends_on
    from public.member_periods p
   where p.member_id = m.id and not p.voided
   order by p.ends_on desc
   limit 1
) cur on true;

-- ---------------------------------------------------------------------
-- 4. record_sale takes the member a plan is for. Each plan line adds
-- duration_days × qty, starting the day after their current end date,
-- or on the sale day if they have lapsed (no paying for missed days).
-- Signature changes again (new p_member_id), so the 008 version must go.
-- ---------------------------------------------------------------------
drop function if exists public.record_sale(jsonb, text, numeric, numeric, text, text, timestamptz, uuid, text);

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

  for v_item in select * from jsonb_array_elements(p_items) loop
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
      select greatest((v_sold_at at time zone 'Asia/Manila')::date, max(ends_on) + 1) into v_start
        from public.member_periods where member_id = p_member_id and not voided;
      insert into public.member_periods (member_id, sale_id, product_id, plan_name, starts_on, ends_on)
      values (p_member_id, v_sale_id, v_product.id, v_product.name, v_start, v_start + v_product.duration_days * v_qty - 1);
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

notify pgrst, 'reload schema';
