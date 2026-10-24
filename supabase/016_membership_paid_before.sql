-- =====================================================================
-- 016  Annual membership paid before the POS. Staff set the date it
-- ends; it is kept as a membership period with no sale, so the
-- members-only rate and early renewals (a year from that date) work as
-- if it had been sold here. Safe to re-run.
-- =====================================================================

alter table public.member_periods alter column sale_id drop not null;

-- Replaces the member's earlier paid-before period. Null clears it.
create or replace function public.set_member_until(p_member_id uuid, p_until date)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_product uuid;
begin
  if not public.is_staff() then
    raise exception 'Only staff can set a membership date';
  end if;
  delete from public.member_periods where member_id = p_member_id and sale_id is null and is_membership;
  if p_until is null then
    return;
  end if;
  select id into v_product from public.products where is_membership and deleted_at is null order by created_at limit 1;
  if v_product is null then
    raise exception 'Add the Annual Membership plan first (Members › Plans)';
  end if;
  insert into public.member_periods (member_id, sale_id, product_id, plan_name, starts_on, ends_on, is_membership)
  values (p_member_id, null, v_product, 'Annual membership (paid before)', p_until - 364, p_until, true);
end $$;
