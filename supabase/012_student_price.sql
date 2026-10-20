-- =====================================================================
-- 012  Student price for plans and services (Members › Plans). Blank =
-- no student rate. On the register, the Student button takes the
-- difference off as a discount, and the sale is noted "Student discount"
-- so it can be told apart from other discounts. Safe to re-run.
-- =====================================================================

alter table public.products add column if not exists student_price numeric(10,2) check (student_price >= 0);
alter table public.products drop constraint if exists products_student_price_max;
alter table public.products add constraint products_student_price_max check (student_price is null or student_price <= selling_price);
grant insert (student_price), update (student_price) on public.products to authenticated;

-- Same as 009, plus student_price in the product history.
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
  foreach f in array array['name', 'code', 'category', 'kind', 'unit_cost', 'selling_price', 'reorder_level', 'is_active', 'duration_days', 'student_price'] loop
    if (to_jsonb(old) ->> f) is distinct from (to_jsonb(new) ->> f) then
      insert into public.product_changes (product_id, field, old_value, new_value, changed_by)
      values (new.id, f, to_jsonb(old) ->> f, to_jsonb(new) ->> f, auth.uid());
    end if;
  end loop;
  return new;
end $$;

notify pgrst, 'reload schema';
