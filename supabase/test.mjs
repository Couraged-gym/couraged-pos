// Runs schema.sql + every numbered patch in a real Postgres (PGlite, in-process), then
// checks permissions, checkout, stock and reports as staff / admin / inactive users.
// npm run test:db
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const dir = new URL('.', import.meta.url)
const files = ['schema.sql', ...readdirSync(dir).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort()]
const db = new PGlite()
// Minimal Supabase stand-in: auth schema, auth.uid() from a session setting, the two API roles.
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}', last_sign_in_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
  alter table storage.objects enable row level security;
  grant usage on schema public, auth, storage to anon, authenticated;
  grant all on storage.objects to authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  create schema net; create table net.calls (url text, headers jsonb, body jsonb);
  create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
    returns bigint language sql as $$ insert into net.calls values (url, headers, body); select 1::bigint $$;
  create schema vault; create table vault.decrypted_secrets (name text, decrypted_secret text);
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;
`)
// Each file twice: patches must be safe to re-run.
for (const f of [...files, ...files.slice(1)]) {
  await db.exec(readFileSync(new URL(f, dir), 'utf8').replace(/create extension[^;]*;/i, '')) // gen_random_uuid is core
}
console.log(`applied ${files.join(', ')} (patches twice)`)
const A = '00000000-0000-0000-0000-00000000000a', S = '00000000-0000-0000-0000-00000000000b', X = '00000000-0000-0000-0000-00000000000c'
await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values
  ('${A}', 'admin@x', '{"full_name":"Ana Admin"}'), ('${S}', 'staff@x', '{"full_name":"Sam Staff"}'), ('${X}', 'rand@x', '{}');
  update public.profiles set role = 'admin' where id = '${A}'; update public.profiles set role = 'staff' where id = '${S}';`)
const as = async (uid, sql, params) => {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid])
  await db.exec('set role authenticated')
  try { return (await db.query(sql, params)).rows } finally { await db.exec('reset role') }
}
const fails = async (uid, sql, re, params) => { await assert.rejects(as(uid, sql, params), re); }
const one = async (sql) => (await db.query(sql)).rows[0]
const gid = (await one(`select id from products where code = 'CFH05'`)).id
let n = 0; const ok = (m) => console.log(`  ✓ ${++n} ${m}`)

assert.equal((await one(`select role from profiles where id = '${X}'`)).role, 'inactive'); ok('new sign-up starts inactive')
assert.equal((await as(X, 'select * from products')).length, 0); ok('inactive user sees no products')
await fails(X, `select record_sale('[{"product_id":"${gid}","qty":1}]')`, /Not authorized/); ok('inactive user cannot sell')

await as(S, `insert into stock_movements (product_id, movement_type, qty, unit_cost, note, created_by) values ($1, 'purchase', 24, 27.21, 'Opening', $2)`, [gid, S])
assert.equal((await one(`select stock_qty from products where id='${gid}'`)).stock_qty, 24); ok('staff receives delivery, stock 24')
await fails(S, `insert into stock_movements (product_id, movement_type, qty, created_by) values ($1, 'purchase', 5, $2)`, /row-level security/, [gid, A]); ok('cannot sign a movement as someone else')
await fails(S, `insert into stock_movements (product_id, movement_type, qty, created_by) values ($1, 'sale', -5, $2)`, /row-level security/, [gid, S]); ok('cannot fake a sale movement')

const sale = `select record_sale($1::jsonb, 'cash', 0, 200, null, null, null, $2::uuid) as id`
const items = JSON.stringify([{ product_id: gid, qty: 2 }]), ref = '11111111-1111-1111-1111-111111111111'
const id1 = (await as(S, sale, [items, ref]))[0].id, id2 = (await as(S, sale, [items, ref]))[0].id
assert.equal(id1, id2); assert.equal((await one('select count(*)::int c from sales')).c, 1); ok('retry with same client_ref returns the same sale, no duplicate')
const s1 = await one(`select total, change_due from sales where id='${id1}'`); assert.equal(+s1.total, 100); assert.equal(+s1.change_due, 100); ok('total ₱100, change ₱100 from ₱200')
assert.equal((await one(`select stock_qty from products where id='${gid}'`)).stock_qty, 22); ok('stock 22 after sale')
await fails(S, `select record_sale($1::jsonb)`, /Not enough stock/, [JSON.stringify([{ product_id: gid, qty: 30 }])]); ok('overselling blocked')

await as(S, `update products set selling_price = 55 where id = $1`, [gid])
const ch = await one(`select field, old_value, new_value, changed_by from product_changes where product_id='${gid}' and field='selling_price'`)
assert.deepEqual([ch.old_value, ch.new_value, ch.changed_by], ['50.00', '55.00', S]); ok('staff price change 50 → 55 logged under staff')
await fails(S, `update products set stock_qty = 999 where id = $1`, /permission denied/, [gid]); ok('stock_qty cannot be edited directly')
await fails(S, `insert into products (code, name, selling_price, stock_qty) values ('T1','x',1,50)`, /permission denied/); ok('new product cannot start with made-up stock')
await as(S, `insert into products (code, name, category, kind, selling_price) values ('MEM-M','Monthly','Membership','service',1200)`)
assert.equal((await one(`select count(*)::int c from product_changes where field='created' and changed_by = '${S}'`)).c, 1); ok('staff adds a membership product, creation logged')

assert.equal((await as(S, `select set_stock_count($1, 20) as d`, [gid]))[0].d, -2)
assert.equal((await one(`select stock_qty from products where id='${gid}'`)).stock_qty, 20); ok('stock count 20 records a −2 adjustment')
assert.equal((await as(S, `select set_stock_count($1, 20) as d`, [gid]))[0].d, 0); ok('matching count records nothing')
await fails(S, `select set_stock_count(id, 3) from products where code='MEM-M'`, /no stock/); ok('services cannot be counted')
assert.equal((await as(S, `select full_name from profiles`)).length, 3); ok('staff can see team names for history')

await fails(S, `select sales_report(current_date - 7, current_date)`, /Only an admin/); ok('staff cannot open reports')
const mid = (await one(`select id from products where code='MEM-M'`)).id
const gcashCart = JSON.stringify([{ product_id: mid, qty: 1 }, { product_id: gid, qty: 1 }])
await fails(S, `select record_sale($1::jsonb, 'gcash')`, /last 4 digits/, [gcashCart]); ok('gcash without a reference is blocked')
await fails(S, `select record_sale($1::jsonb, 'gcash', 0, null, null, null, null, null, '12a4')`, /last 4 digits/, [gcashCart]); ok('gcash reference must be 4 digits')
const gid2 = (await as(S, `select record_sale($1::jsonb, 'gcash', 0, null, null, null, null, null, '0427') as id`, [gcashCart]))[0].id
assert.equal((await one(`select payment_ref from sales where id='${gid2}'`)).payment_ref, '0427'); ok('gcash reference saved on the sale')
const r = (await as(A, `select sales_report((now() at time zone 'Asia/Manila')::date - 6, (now() at time zone 'Asia/Manila')::date) as r`))[0].r
assert.equal(+r.totals.revenue, 100 + 1255); assert.equal(r.totals.receipts, 2); assert.equal(r.daily.length, 7)
assert.equal(r.staff[0].name, 'Sam Staff'); assert.equal(+r.staff[0].memberships, 1)
assert.deepEqual(r.categories.map((c) => c.category).sort(), ['Drinks', 'Membership']); assert.equal(r.payments.length, 2)
ok(`admin report: revenue ₱${r.totals.revenue}, 2 receipts, 7 days, staff + membership + payments`)
await as(A, `select void_sale($1, 'Wrong item')`, [id1])
assert.equal((await one(`select stock_qty from products where id='${gid}'`)).stock_qty, 21)
const r2 = (await as(A, `select sales_report((now() at time zone 'Asia/Manila')::date - 6, (now() at time zone 'Asia/Manila')::date) as r`))[0].r
assert.equal(r2.voids.count, 1); assert.equal(r2.totals.receipts, 1); ok('void puts stock back and moves the sale out of totals')
await fails(A, `select sales_report(current_date, current_date - 1)`, /valid date range/); ok('bad range rejected')
// 004: sales are admin-only; staff see their own receipts only.
await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000d', 'staff2@x', '{"full_name":"Tess Two"}');
  update public.profiles set role = 'staff' where id = '00000000-0000-0000-0000-00000000000d';`)
const T = '00000000-0000-0000-0000-00000000000d'
assert.equal((await as(T, 'select * from sales')).length, 0); ok('staff cannot see sales they did not ring up')
assert.equal((await as(T, 'select * from sale_items')).length, 0); ok('…or their line items')
const own = (await as(T, `select record_sale($1::jsonb, 'cash') as id`, [JSON.stringify([{ product_id: gid, qty: 1 }])]))[0].id
assert.deepEqual((await as(T, 'select id from sales')).map((x) => x.id), [own]); ok('staff can read back their own receipt')
assert.ok((await as(A, 'select count(*)::int c from sales'))[0].c >= 3); ok('admin sees every sale')

// 004: delete_product.
await fails(S, `select delete_product($1)`, /Only an admin/, [gid]); ok('staff cannot delete products')
await as(A, `insert into products (code, name, selling_price) values ('TMP1', 'Never sold', 10)`)
const tmp = (await one(`select id from products where code = 'TMP1'`)).id
await as(S, `insert into stock_movements (product_id, movement_type, qty, created_by) values ($1, 'purchase', 5, $2)`, [tmp, S])
assert.equal((await as(A, `select delete_product($1) as r`, [tmp]))[0].r, 'deleted')
assert.equal((await one(`select count(*)::int c from products where id = '${tmp}'`)).c, 0); ok('unsold product is deleted completely, with its stock history')
assert.equal((await as(A, `select delete_product($1) as r`, [gid]))[0].r, 'archived')
const arch = await one(`select is_active, deleted_at, code from products where id = '${gid}'`)
assert.ok(!arch.is_active && arch.deleted_at && arch.code.startsWith('CFH05 (deleted')); ok('sold product is archived and its code freed')
await as(A, `insert into products (code, name, selling_price) values ('CFH05', 'Gatorade v2', 50)`); ok('the freed code can be reused')
const r3 = (await as(A, `select sales_report((now() at time zone 'Asia/Manila')::date - 6, (now() at time zone 'Asia/Manila')::date) as r`))[0].r
assert.ok(r3.products.some((p) => p.product_id === gid)); ok('archived product still appears in reports')
await fails(A, `select delete_product($1)`, /not found/, [gid]); ok('cannot delete twice')
// 005: staff management.
await fails(S, 'select * from staff_list()', /Only an admin/); ok('staff cannot list accounts')
const list = await as(A, 'select * from staff_list()')
assert.equal(list[0].email, 'admin@x'); assert.ok(list.some((x) => x.email === 'rand@x' && x.role === 'inactive')); ok('admin lists accounts with emails, admins first')
await fails(A, `update profiles set role = 'staff' where id = $1`, /at least one admin/, [A]); ok('the last admin cannot be demoted')
await as(A, `update profiles set role = 'admin', full_name = 'Rand Promoted' where id = $1`, [X])
await as(A, `update profiles set role = 'staff' where id = $1`, [A]); ok('with a second admin, the first can step down')
await fails(S, `update profiles set role = 'admin' where id = $1`, /row-level security|0 rows/, [S]).catch(async () => {
  assert.equal((await one(`select role from profiles where id = '${S}'`)).role, 'staff')
}); ok('staff cannot promote themselves')
await fails(X, `update profiles set created_at = now() where id = $1`, /permission denied/, [X]); ok('only name and role are editable')
// 006: expenses.
await db.exec(`update profiles set role = 'admin' where id = '${A}'`) // A stepped down in the 005 checks
const cat = (await one(`select id from expense_categories where name = 'Electricity'`)).id
await fails(S, 'select count(*) from expense_categories', /./).catch(() => {})
assert.equal((await as(S, 'select * from expense_categories')).length, 0); ok('staff cannot see expense categories')
await fails(S, `insert into expenses (expense_date, category_id, description, amount) values (current_date, $1, 'x', 10)`, /row-level security/, [cat]); ok('staff cannot record expenses')
await fails(A, `insert into expenses (expense_date, category_id, description, amount, created_by) values (current_date, $1, 'x', 10, $2)`, /permission denied|row-level/, [cat, S]); ok('cannot record an expense in someone else’s name')
const today = (await one(`select (now() at time zone 'Asia/Manila')::date::text d`)).d
const ex1 = (await as(A, `insert into expenses (expense_date, category_id, description, amount, payment_method, reference_no) values ($1, $2, 'VECO bill', 4200, 'bank_transfer', 'OR-123') returning id`, [today, cat]))[0].id
await as(A, `update expenses set amount = 4250 where id = $1`, [ex1])
const exch = await as(A, `select field, old_value, new_value, changed_by from expense_changes where expense_id = $1 order by id`, [ex1])
assert.deepEqual(exch.map((c) => c.field), ['created', 'amount']); assert.equal(exch[1].old_value, '4200.00'); assert.equal(exch[1].changed_by, A); ok('expense edits are logged with who and the old value')
await fails(A, `delete from expenses where id = $1`, /permission denied/, [ex1]); ok('expenses can never be deleted')
await fails(A, `select void_expense($1, '  ')`, /reason is required/, [ex1]); ok('voiding needs a reason')
await fails(A, `update expenses set status = 'voided' where id = $1`, /permission denied/, [ex1]); ok('status only changes through void_expense')
const bill = (await as(A, `insert into recurring_expenses (name, category_id, usual_amount, due_day) values ('VECO', $1, 4000, 15) returning id`, [cat]))[0].id
const recBill = `insert into expenses (expense_date, category_id, description, amount, recurring_id, for_month) values ($1, $2, 'VECO October', 4100, $3, date_trunc('month', $1::date)::date) returning id`
const b1 = (await as(A, recBill, [today, cat, bill]))[0].id
await fails(A, recBill, /duplicate key|unique/, [today, cat, bill]); ok('a monthly bill can only be recorded once per month')
await as(A, `select void_expense($1, 'Wrong amount')`, [b1])
await fails(A, `update expenses set amount = 1 where id = $1 returning id`, /./, [b1]).catch(async () => assert.equal(+(await one(`select amount from expenses where id = '${b1}'`)).amount, 4100))
assert.equal(+(await one(`select amount from expenses where id = '${b1}'`)).amount, 4100); ok('a voided expense cannot be edited')
await as(A, recBill, [today, cat, bill]); ok('after voiding, that month’s bill can be recorded again')
const r4 = (await as(A, `select sales_report($1::date - 6, $1::date) as r`, [today]))[0].r
assert.equal(+r4.expenses.total, 4250 + 4100); assert.equal(r4.expenses.by_category[0].category, 'Electricity')
assert.equal(r4.daily.at(-1).expenses, 8350); ok(`report: expenses ₱${r4.expenses.total} by category and per day (voided excluded)`)
assert.ok('gross_profit' in r4.totals && 'previous' in r4.expenses); ok('net profit inputs present (gross profit − expenses)')
await as(A, `insert into storage.objects (bucket_id, name) values ('receipts', '2026/10/a.jpg')`)
await fails(S, `insert into storage.objects (bucket_id, name) values ('receipts', 'x.jpg')`, /row-level security/); ok('only admins can upload receipt files')
assert.equal((await as(S, `select * from storage.objects where bucket_id = 'receipts'`)).length, 0); ok('staff cannot see receipt files')
// 007: payroll.
assert.equal((await as(S, 'select * from employees')).length, 0)
assert.equal((await as(S, 'select * from payroll_rates')).length, 0); ok('staff cannot see employees or payroll rates')
assert.equal((await one(`select count(*)::int c from payroll_rates`)).c, 4); ok('2025 rate seeds present (sss, philhealth, pagibig, tax)')
const emp = (await as(A, `insert into employees (full_name, pay_frequency, pay_basis, rate) values ('Coach Karl', 'semi_monthly', 'monthly', 20000) returning id`))[0].id
await as(A, `update employees set rate = 22000 where id = $1`, [emp])
const ech = await as(A, `select field, old_value, new_value from employee_changes where employee_id = $1 order by id`, [emp])
assert.deepEqual(ech.map((c) => [c.field, c.old_value, c.new_value]), [['created', null, 'Coach Karl'], ['rate', '20000.00', '22000.00']]); ok('employee rate changes are logged')
await fails(A, `delete from employees where id = $1`, /permission denied/, [emp]); ok('employees cannot be deleted (deactivate instead)')
const run = (await as(A, `insert into payroll_runs (pay_frequency, period_start, period_end, pay_date) values ('semi_monthly', $1::date - 14, $1::date, $1::date) returning id`, [today]))[0].id
await as(A, `insert into payroll_items (run_id, employee_id, employee_name, pay_basis, rate, basic_pay, gross_pay, sss_ee, sss_er, sss_ec, philhealth_ee, philhealth_er, pagibig_ee, pagibig_er, taxable_income, net_pay)
             values ($1, $2, 'Coach Karl', 'monthly', 22000, 11000, 11000, 550, 1100, 10, 275, 275, 200, 200, 9975, 9975)`, [run, emp])
await as(A, `update payroll_items set overtime_pay = 0 where run_id = $1`, [run]); ok('draft payslips are editable')
await fails(A, `update payroll_runs set status = 'finalized' where id = $1`, /permission denied/, [run]); ok('status only changes through finalize/void')
await fails(S, `select finalize_payroll($1, '{}')`, /Only an admin/, [run]); ok('staff cannot finalize payroll')
const before = (await as(A, `select sales_report($1::date - 6, $1::date) as r`, [today]))[0].r.expenses.total
await as(A, `select finalize_payroll($1, '{"sss":{"id":"x"}}')`, [run])
const posted = await as(A, `select c.name, e.amount, e.status from expenses e join expense_categories c on c.id = e.category_id where payroll_run_id = $1 order by c.name`, [run])
assert.deepEqual(posted.map((p) => [p.name, +p.amount]), [['Government contributions', 1585], ['Payroll', 11000]]); ok('finalize posts salaries (₱11,000) and employer contributions (₱1,585) to Expenses')
const after = (await as(A, `select sales_report($1::date - 6, $1::date) as r`, [today]))[0].r.expenses.total
assert.equal(+after - +before, 12585); ok('analytics expenses include the payroll')
assert.equal((await one(`select rates from payroll_runs where id = '${run}'`)).rates.sss.id, 'x'); ok('the rates used are stored on the run')
await as(A, `update payroll_items set basic_pay = 1 where run_id = $1`, [run])
assert.equal(+(await one(`select basic_pay from payroll_items where run_id = '${run}'`)).basic_pay, 11000); ok('finalized payslips are locked')
await fails(A, `delete from payroll_runs where id = $1 returning id`, /./, [run]).catch(async () => assert.equal((await one(`select count(*)::int c from payroll_runs where id = '${run}'`)).c, 1))
assert.equal((await one(`select count(*)::int c from payroll_runs where id = '${run}'`)).c, 1); ok('finalized runs cannot be deleted')
await fails(A, `select finalize_payroll($1, '{}')`, /already finalized/, [run]); ok('cannot finalize twice')
const payEx = (await one(`select id from expenses where payroll_run_id = '${run}' limit 1`)).id
await fails(A, `select void_expense($1, 'x')`, /void the pay run/, [payEx]); ok('payroll expenses can only be undone from Payroll')
await as(A, `update expenses set amount = 1 where id = $1`, [payEx])
assert.ok(+(await one(`select amount from expenses where id = '${payEx}'`)).amount > 1); ok('payroll expenses cannot be edited in Expenses')
await fails(A, `select void_payroll_run($1, '')`, /reason is required/, [run])
await as(A, `select void_payroll_run($1, 'Wrong period')`, [run])
assert.deepEqual((await as(A, `select distinct status from expenses where payroll_run_id = $1`, [run])).map((x) => x.status), ['voided'])
assert.equal(+(await as(A, `select sales_report($1::date - 6, $1::date) as r`, [today]))[0].r.expenses.total, +before); ok('voiding a run voids its expenses and removes them from analytics')
const run2 = (await as(A, `insert into payroll_runs (pay_frequency, period_start, period_end, pay_date) values ('monthly', $1::date - 30, $1::date, $1::date) returning id`, [today]))[0].id
await as(A, `insert into payroll_items (run_id, employee_id, employee_name, pay_basis, rate, basic_pay, gross_pay, other_deductions, net_pay) values ($1, $2, 'Coach Karl', 'monthly', 1, 100, 100, 500, -400)`, [run2, emp])
await fails(A, `select finalize_payroll($1, '{}')`, /negative net pay/, [run2]); ok('a payslip with negative net pay blocks finalizing')
await as(A, `delete from payroll_runs where id = $1`, [run2])
assert.equal((await one(`select count(*)::int c from payroll_runs where id = '${run2}'`)).c, 0); ok('draft runs can be deleted')
await as(A, `insert into payroll_rates (kind, effective_from, config) values ('sss', '2026-01-01', '{"ee_rate":0.05}')`)
await fails(A, `update payroll_rates set notes = 'x'`, /permission denied/); ok('new rate versions can be added; old ones never edited')
// 009: members.
const day = (n) => (n ? `(${`'${today}'`}::date + ${n})::text` : `'${today}'`)
const dayOf = async (n) => (await one(`select ${day(n)} d`)).d
// Plans run by calendar month/year (017): last day of `days` bought from `from`, and the renewal after it.
const endOf = async (from, days) => (await one(`select public.plan_end('${from}'::date, ${days})::text d`)).d
const M1 = await endOf(today, 30), M2 = await endOf(await dayOf0(M1), 30), Y1 = await endOf(today, 365), Y2 = await endOf(await dayOf0(Y1), 365)
async function dayOf0(d) { return (await one(`select ('${d}'::date + 1)::text d`)).d }
const mem = (await as(T, `insert into members (full_name, phone, created_by) values ('Juan Dela Cruz', '0917', $1) returning id`, [T]))[0].id; ok('staff registers a member')
await fails(T, `delete from members where id = $1`, /permission denied/, [mem]); ok('members cannot be deleted')
await as(T, `update products set duration_days = 30 where id = $1`, [mid])
const plan = JSON.stringify([{ product_id: mid, qty: 1 }])
await fails(T, `select record_sale($1::jsonb)`, /Choose the member/, [plan]); ok('a plan with a length needs a member')
const m1 = (await as(T, `select record_sale($1::jsonb, 'cash', 0, null, null, null, null, null, null, $2) as id`, [plan, mem]))[0].id
let vm = (await as(T, `select status, ends_on::text as ends_on from v_members where id = $1`, [mem]))[0]
assert.equal(vm.status, 'active'); assert.equal(vm.ends_on, M1)
assert.equal((await one(`select customer_name from sales where id = '${m1}'`)).customer_name, 'JUAN DELA CRUZ'); ok('first plan: active today to +29 days, sale named after the member')
const m2 = (await as(T, `select record_sale($1::jsonb, 'cash', 0, null, null, null, null, null, null, $2) as id`, [plan, mem]))[0].id
vm = (await as(T, `select status, ends_on::text as ends_on from v_members where id = $1`, [mem]))[0]
assert.equal(vm.ends_on, M2); ok('early renewal starts the day after the current end (+59)')
await as(A, `select void_sale($1, 'Paid twice')`, [m2])
vm = (await as(T, `select status, ends_on::text as ends_on from v_members where id = $1`, [mem]))[0]
assert.equal(vm.ends_on, M1); ok('voiding the renewal takes the days back off')
await fails(T, `insert into member_periods (member_id, sale_id, product_id, plan_name, starts_on, ends_on) values ($1, $2, $3, 'x', current_date, current_date)`, /permission denied/, [mem, m1, mid]); ok('periods only come from a sale')
const old = (await one(`insert into members (full_name) values ('Lapsed Lea') returning id`)).id
await db.query(`insert into member_periods (member_id, sale_id, product_id, plan_name, starts_on, ends_on) values ($1, $2, $3, 'Monthly', ${day(-40)}::date, ${day(-11)}::date)`, [old, m1, mid])
assert.equal((await as(T, `select status from v_members where id = $1`, [old]))[0].status, 'expired')
await as(T, `select record_sale($1::jsonb, 'cash', 0, null, null, null, null, null, null, $2)`, [plan, old])
vm = (await as(T, `select status, ends_on::text as ends_on from v_members where id = $1`, [old]))[0]
assert.deepEqual([vm.status, vm.ends_on], ['active', M1]); ok('lapsed member renews from today, not from the old end date')
await one(`insert into members (full_name) values ('New Nina')`)
assert.equal((await as(T, `select status from v_members where full_name = 'NEW NINA'`))[0].status, 'new'); ok('registered without a plan shows as new')
assert.equal((await as(X, `select * from members`)).length, (await one('select count(*)::int c from members')).c); ok('admins see members too')
// 011: member codes.
const codes = await as(T, `select member_no::int n, full_name from v_members order by member_no`)
assert.deepEqual(codes.map((c) => c.n), [1, 2, 3]); assert.equal(codes[0].full_name, 'JUAN DELA CRUZ'); ok('members are numbered in the order they joined (M0001…)')
await fails(T, `update members set member_no = 99 where id = $1`, /permission denied|DEFAULT/, [mem]); ok('member codes cannot be changed')
// 015: gym codes CRDFH26-0012.
const yy = (await one(`select to_char(now() at time zone 'Asia/Manila', 'YY') y`)).y
assert.deepEqual((await as(T, `select code from v_members order by member_no`)).map((c) => c.code), [1, 2, 3].map((n) => `CRDFH${yy}-000${n}`)); ok('members from before 015 get codes in the order they joined')
assert.equal((await as(T, `insert into members (full_name, code) values ('Old Card', ' crdfh${yy}-0040 ') returning code`))[0].code, `CRDFH${yy}-0040`); ok('an existing card code can be typed in')
assert.equal((await as(T, `insert into members (full_name) values ('Next One') returning code`))[0].code, `CRDFH${yy}-0041`); ok('a blank code gets the next number this year')
await fails(T, `insert into members (full_name, code) values ('Dup', 'CRDFH${yy}-0041')`, /duplicate key/); ok('codes are unique')
await as(T, `update members set code = 'CRDFH25-0007' where full_name = 'OLD CARD'`)
assert.equal((await as(T, `select code from members where full_name = 'OLD CARD'`))[0].code, 'CRDFH25-0007'); ok('staff can fix a code')
// 012: student price.
await as(T, `update products set student_price = 900 where id = $1`, [mid])
assert.equal((await one(`select new_value from product_changes where product_id = '${mid}' and field = 'student_price'`)).new_value, '900.00'); ok('staff set a student price, logged in history')
await fails(T, `update products set student_price = 5000 where id = $1`, /student_price_max/, [mid]); ok('student price cannot be above the normal price')
// 013: gym rates.
const rate = async (code) => (await one(`select id from products where code = '${code}'`)).id
assert.equal((await one(`select count(*)::int c from products where code in ('MEMBERSHIP','DAY','DAY-M','MONTH','M3','M6','Y1','PROMO-3+1','PROMO-5+2','PT15')`)).c, 10); ok('price list added once, even with the patch run twice')
const [annual, dayM] = [await rate('MEMBERSHIP'), await rate('DAY-M')]
const sell13 = (items, m) => as(T, `select record_sale($1::jsonb, 'cash', 0, null, null, null, null, null, null, $2) as id`, [JSON.stringify(items), m])
await fails(T, `select record_sale($1::jsonb)`, /annual membership/, [JSON.stringify([{ product_id: dayM, qty: 1 }])]); ok('member day pass needs a member')
await assert.rejects(sell13([{ product_id: dayM, qty: 1 }], mem), /annual membership/); ok('gym time alone does not get the member rate')
await sell13([{ product_id: dayM, qty: 1 }, { product_id: annual, qty: 1 }], mem); ok('membership and member day pass in the same sale')
vm = (await as(T, `select ends_on::text as ends_on, member_until::text as mu from v_members where id = $1`, [mem]))[0]
assert.deepEqual([vm.ends_on, vm.mu], [M1, Y1]); ok('membership runs a year and leaves gym time alone')
await sell13([{ product_id: await rate('MONTH'), qty: 1 }], mem)
vm = (await as(T, `select ends_on::text as ends_on, member_until::text as mu from v_members where id = $1`, [mem]))[0]
assert.deepEqual([vm.ends_on, vm.mu], [M2, Y1]); ok('monthly extends gym time only')
await sell13([{ product_id: annual, qty: 1 }], mem)
assert.equal((await as(T, `select member_until::text as mu from v_members where id = $1`, [mem]))[0].mu, Y2); ok('early membership renewal adds a year from the end')
// 016: annual membership paid before the POS.
const pb = (await as(T, `insert into members (full_name, created_by) values ('Paid Before', $1) returning id`, [T]))[0].id
await as(T, `select set_member_until($1, $2::date + 100)`, [pb, today])
await as(T, `select set_member_until($1, $2::date + 200)`, [pb, today])
assert.equal((await as(T, `select member_until::text as mu from v_members where id = $1`, [pb]))[0].mu, await dayOf(200)); ok('staff set when a paid-before membership ends, editing replaces it')
await sell13([{ product_id: dayM, qty: 1 }], pb); ok('paid-before members get the member rate')
await sell13([{ product_id: annual, qty: 1 }], pb)
assert.equal((await as(T, `select member_until::text as mu from v_members where id = $1`, [pb]))[0].mu, await endOf(await dayOf(201), 365)); ok('renewing adds a year from the paid-before end')
await fails('00000000-0000-0000-0000-0000000000ff', `select set_member_until($1, null)`, /Only staff/, [pb]); ok('non-staff cannot set it')
// 010: sales export.
await fails(S, `select sales_export(current_date, current_date)`, /Only an admin/); ok('staff cannot export sales')
const p9 = (await one(`select id from products where code = 'CFH09'`)).id
await as(S, `insert into stock_movements (product_id, movement_type, qty, unit_cost, created_by) values ($1, 'purchase', 10, 39, $2)`, [p9, S])
await as(T, `select record_sale($1::jsonb, 'gcash', 5, null, null, null, null, null, '1234')`, [JSON.stringify([{ product_id: p9, qty: 3 }])]) // with a ₱5 discount
const ex = (await as(A, `select sales_export($1::date - 6, $1::date) as r`, [today]))[0].r
const rep = (await as(A, `select sales_report($1::date - 6, $1::date) as r`, [today]))[0].r
const sum = (rows, f) => rows.reduce((s, x) => s + f(x), 0)
const paid = (x) => +x.cash + +x.gcash + +x.other
const exRevenue = sum(ex.lines, paid) - sum(ex.discounts, paid)
const exProfit = sum(ex.lines, (x) => x.qty * (x.unit_price - x.unit_cost)) - sum(ex.discounts, paid)
assert.equal(Math.round(exRevenue * 100), Math.round(rep.totals.revenue * 100))
assert.equal(Math.round(exProfit * 100), Math.round(rep.totals.gross_profit * 100)); ok(`export lines − discounts = report revenue ₱${rep.totals.revenue} and profit ₱${rep.totals.gross_profit}`)
assert.equal(sum(ex.lines, (x) => x.qty), +rep.totals.items); ok('export units = report items sold (voids excluded)')
assert.ok(ex.lines.every((x) => Math.abs(paid(x) - x.qty * x.unit_price) < 0.005)); ok('each row: GCash + Cash + Other = qty × snapshot price')
assert.equal(ex.voided.length, rep.voids.count); assert.ok(ex.voided.some((v) => v.reason === 'Paid twice' && v.items === '1 x Monthly')); ok('voided receipts listed with items and reason')
await as(A, `update products set selling_price = 999 where id = $1`, [mid])
const ex2 = (await as(A, `select sales_export($1::date - 6, $1::date) as r`, [today]))[0].r
assert.deepEqual(ex2.lines, ex.lines); ok('changing a price today leaves past export rows untouched')
assert.equal(ex.log, null); assert.equal((await as(A, `select sales_export($1::date, $1::date, true) as r`, [today]))[0].r.log.length > 0, true); ok('transaction log only when asked for')
// 014: day summary.
const ds = (await as(S, `select day_summary($1::date) as r`, [today]))[0].r
const rep1 = (await as(A, `select sales_report($1::date, $1::date) as r`, [today]))[0].r
assert.deepEqual([+ds.net, ds.receipts, ds.voids.count], [+rep1.totals.revenue, rep1.totals.receipts, rep1.voids.count]); ok(`staff day summary matches the admin report: ₱${ds.net}, ${ds.receipts} receipts`)
assert.equal(Math.round((ds.gross - ds.discounts) * 100), Math.round(ds.net * 100))
assert.equal(Math.round(sum(ds.categories, (x) => +x.total) * 100), Math.round(ds.gross * 100))
assert.equal(Math.round(sum(ds.payments, (x) => +x.total) * 100), Math.round(ds.net * 100)); ok('gross − discounts = net; categories add up to gross, payments to net')
const Z = '00000000-0000-0000-0000-00000000000f'
await db.exec(`insert into auth.users (id, email) values ('${Z}', 'new@x')`)
await fails(Z, `select day_summary(current_date)`, /Not authorized/); ok('inactive user cannot print the day summary')
// 014: cash advances.
const advSql = `insert into cash_advances (employee_id, given_on, amount, installment, authorized, created_by) values ($1, $2, 3000, 1000, $3, $4) returning id`
await fails(A, advSql, /check/, [emp, today, false, A]); ok('an advance needs the signed authorization')
const adv = (await as(A, advSql, [emp, today, true, A]))[0].id
assert.equal((await as(S, 'select * from cash_advances')).length, 0); ok('staff cannot see cash advances')
await fails(A, advSql, /still has a cash advance/, [emp, today, true, A]); ok('one open advance per employee')
const run3 = (await as(A, `insert into payroll_runs (pay_frequency, period_start, period_end, pay_date) values ('monthly', $1::date - 30, $1::date, $1::date) returning id`, [today]))[0].id
await as(A, `insert into payroll_items (run_id, employee_id, employee_name, pay_basis, rate, basic_pay, gross_pay, net_pay, advance_id, cash_advance) values ($1, $2, 'Coach Karl', 'monthly', 1, 5000, 5000, 1000, $3, 4000)`, [run3, emp, adv])
await fails(A, `select finalize_payroll($1, '{}')`, /more than the employee owes/, [run3]); ok('cannot deduct more than the balance')
await as(A, `update payroll_items set cash_advance = 1000, net_pay = 4000 where run_id = $1`, [run3])
await as(A, `select finalize_payroll($1, '{}')`, [run3])
const bal = async () => +(await as(A, `select balance from v_cash_advances where id = $1`, [adv]))[0].balance
assert.equal(await bal(), 2000); assert.equal(+(await one(`select advance_balance from payroll_items where run_id = '${run3}'`)).advance_balance, 2000); ok('finalizing deducts ₱1,000, balance ₱2,000 stamped on the payslip')
assert.equal(+(await one(`select amount from expenses where payroll_run_id = '${run3}' and description like 'Salaries%'`)).amount, 5000); ok('payroll expense is gross pay: the advance is not an expense')
await fails(A, `select void_cash_advance($1, 'x')`, /already deducted/, [adv]); ok('an advance being repaid cannot be voided')
await as(A, `select void_payroll_run($1, 'Test')`, [run3])
assert.equal(await bal(), 3000); ok('voiding the pay run gives the deduction back')
await fails(S, `select void_cash_advance($1, 'x')`, /Only an admin/, [adv])
await as(A, `select void_cash_advance($1, 'Given by mistake')`, [adv])
await as(A, advSql, [emp, today, true, A]); ok('after voiding, a new advance can be given')
// 014: stock report.
await fails(S, `select stock_report(current_date, current_date)`, /Only an admin/); ok('staff cannot open the stock report')
const stock = async () => (await as(A, `select stock_report($1::date - 6, $1::date) as r`, [today]))[0].r
const st1 = await stock()
const bought = +(await one(`select sum(qty * unit_cost) s from stock_movements where movement_type = 'purchase'`)).s
assert.equal(Math.round(st1.purchases * 100), Math.round(bought * 100)); ok(`inventory purchases ₱${st1.purchases}`)
await as(S, `insert into stock_movements (product_id, movement_type, qty, note, created_by) values ($1, 'spoilage', -1, 'Expired', $2)`, [p9, S])
const st2 = await stock()
assert.equal(Math.round((st2.losses - st1.losses) * 100), 3900); assert.equal(+st2.purchases, +st1.purchases); ok('one spoiled ₱39 item adds ₱39 to stock losses, not to purchases')
// 017: finance role and vouchers.
const F = '00000000-0000-0000-0000-0000000000f1'
await db.exec(`insert into auth.users (id, email) values ('${F}', 'books@x'); update public.profiles set role = 'finance' where id = '${F}';`)
assert.ok((await as(F, 'select * from expenses')).length > 0); ok('finance reads expenses')
assert.ok((await as(F, 'select count(*)::int c from sales'))[0].c >= 3); ok('finance reads every sale')
await as(F, `select sales_report($1::date - 6, $1::date)`, [today]); await as(F, `select stock_report($1::date - 6, $1::date)`, [today]); ok('finance opens the reports')
await as(F, `insert into expenses (expense_date, category_id, description, amount) values ($1, $2, 'Bond paper', 250)`, [today, cat]); ok('finance records expenses')
const frun = (await as(F, `insert into payroll_runs (pay_frequency, period_start, period_end, pay_date) values ('monthly', $1::date - 30, $1::date, $1::date) returning id`, [today]))[0].id
await as(F, `insert into payroll_items (run_id, employee_id, employee_name, pay_basis, rate, basic_pay, holiday_pay, salary_adjustment, cash_bond, manual, gross_pay, net_pay) values ($1, $2, 'Coach Karl', 'monthly', 1, 5000, 400, -100, 250, '{"sss_ee": 280}', 5300, 4770)`, [frun, emp])
await as(F, `select finalize_payroll($1, '{}')`, [frun]); ok('finance runs payroll with holiday pay, adjustment, cash bond and a typed SSS')
await fails(F, 'select * from staff_list()', /Only an admin/); ok('finance cannot manage staff')
await as(F, `update profiles set role = 'admin' where id = $1`, [F]).catch(() => {})
assert.equal((await one(`select role from profiles where id = '${F}'`)).role, 'finance'); ok('finance cannot promote themselves')
await fails(F, `select record_sale('[{"product_id":"${p9}","qty":1}]')`, /Not authorized/); ok('finance cannot ring up sales')
await fails(F, `select delete_product($1)`, /Only an admin/, [p9]); ok('finance cannot delete products')
const cv = `insert into vouchers (kind, voucher_no, voucher_date, payee, amount, lines) values ('check', '2026100009', $1, 'Couraged Fitness Hub Employees', 21656.25, '[{"code":"601-002-0001","title":"SSS premium","debit":190.25,"credit":0}]') returning id`
const vid = (await as(F, cv, [today]))[0].id
await fails(F, cv, /duplicate|unique/, [today]); ok('check voucher saved; its number cannot repeat')
await fails(S, 'select * from vouchers', /./).catch(() => {}); assert.equal((await as(S, 'select * from vouchers')).length, 0); ok('staff cannot see vouchers')
await fails(F, `delete from vouchers where id = $1`, /permission denied/, [vid])
await as(F, `update vouchers set status = 'voided', void_reason = 'Spoiled check' where id = $1`, [vid])
await as(F, `update vouchers set amount = 1 where id = $1`, [vid])
assert.equal(+(await one(`select amount from vouchers where id = '${vid}'`)).amount, 21656.25); ok('vouchers are voided, never deleted, and lock once voided')
assert.equal(await endOf('2026-10-27', 30), '2026-11-26'); assert.equal(await endOf('2026-01-31', 30), '2026-02-27'); assert.equal(await endOf('2026-10-27', 7), '2026-11-02'); ok('one month bought Oct 27 runs to Nov 26 and renews Nov 27')
// 018: website member accounts.
const W1 = '00000000-0000-0000-0000-0000000000e1', W2 = '00000000-0000-0000-0000-0000000000e2'
await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values
  ('${W1}', 'oldc@x', '{"account":"member"}'), ('${W2}', 'new@x', '{"account":"member","full_name":"New Person"}')`)
assert.equal((await one(`select count(*)::int c from profiles where id in ('${W1}', '${W2}')`)).c, 0); ok('website sign-ups get no staff profile')
const tk = await one(`select count(distinct qr_token)::int d, count(*)::int c from members`)
assert.equal(tk.d, tk.c); ok('every existing member got their own QR token')
const oldc = (await as(S, `insert into members (full_name, phone, created_by) values ('Old Member', '0917 555 0101', $1) returning code`, [S]))[0].code
assert.equal((await as(W1, 'select * from members')).length, 0); ok('member account cannot read the members table')
assert.equal((await as(W1, 'select * from member_me()')).length, 0); ok('unlinked account has no pass')
assert.equal((await as(W1, `select member_link($1, '0917 555 0199', 'v1') c`, [oldc]))[0].c, null); ok('right code, wrong phone: no link')
assert.equal((await as(W1, `select member_link($1, '+63 917 555 0101', 'v1') c`, [oldc]))[0].c, oldc); ok('code + phone on file (any format) links the record')
const me = (await as(W1, 'select * from member_me()'))[0]
assert.equal(me.code, oldc); assert.equal(me.email, 'oldc@x'); assert.ok(/^CDQ[0-9a-f]{32}$/.test(me.qr_token)); assert.equal(me.notes, undefined); ok('member sees own pass with QR token, never staff notes')
assert.equal((await as(W2, `select member_link($1, '0917 555 0101', 'v1') c`, [oldc]))[0].c, null); ok('an already-linked record cannot be claimed again')
for (let k = 0; k < 4; k++) await as(W2, `select member_link('CRDFH26-9999', '0917 000 0000', 'v1')`)
await fails(W2, `select member_link('CRDFH26-9999', '0917 000 0000', 'v1')`, /Too many tries/); ok('five misses an hour, then linking stops')
await fails(W2, `select member_join('New Person', '0917 555 0202', '')`, /privacy notice/); ok('joining needs privacy consent')
const nc = (await as(W2, `select member_join('New Person', '0917 555 0202', 'v1') c`))[0].c
assert.ok(/^CRDFH\d{2}-\d{4}$/.test(nc)); assert.equal((await as(W2, 'select * from member_me()'))[0].status, 'new'); ok(`new member joins online and gets ${nc}`)
await fails(W2, `select member_join('Again', '0917 555 0202', 'v1')`, /already has a membership/); ok('one membership per account')
const t2 = (await as(W2, 'select member_new_qr() t'))[0].t
assert.notEqual(t2, me.qr_token); assert.equal((await as(W2, 'select qr_token from member_me()'))[0].qr_token, t2); ok('member can replace a leaked QR')
await fails(W1, `select record_sale('[{"product_id":"${gid}","qty":1}]')`, /Not authorized/); ok('member account cannot ring up sales')
await db.exec('set role anon'); const pl = (await db.query('select * from public_price_list()')).rows; await db.exec('reset role')
assert.ok(pl.some((p) => p.code === 'MONTH') && pl.every((p) => p.unit_cost === undefined)); ok('anyone reads the plan price list, never costs')
await db.exec('set role anon'); await assert.rejects(db.query('select * from member_me()'), /permission denied/); await db.exec('reset role'); ok('signed-out visitors cannot call member functions')

// 019: door check-ins.
const scan = async (code) => (await as(S, 'select check_in($1) r', [code]))[0].r
const c1 = await scan(t2.toUpperCase())
assert.equal(c1.code, nc); assert.equal(c1.status, 'new'); assert.equal(c1.logged, true); assert.equal(c1.last_visit, null); ok('scanning a pass (any letter case) finds the member and logs the visit')
const c2 = await scan(t2)
assert.equal(c2.logged, false); assert.ok(c2.last_visit); assert.equal(c2.visits_this_month, 1); ok('a second scan within 10 minutes shows them again without a second visit')
assert.equal((await scan(oldc.toLowerCase())).full_name, 'OLD MEMBER'); ok('a typed gym code checks in too')
assert.equal(await scan(me.qr_token.replace(/.$/, (c) => (c === '0' ? '1' : '0'))), null); ok('an unknown pass returns nothing')
await fails(W2, `select check_in($1)`, /Not authorized/, [t2]); ok('members cannot check themselves in')
assert.equal((await as(W2, 'select * from checkins')).length, 0); ok('members cannot read the check-in log')
await fails(S, `insert into checkins (member_id, status) values ((select id from members limit 1), 'active')`, /permission denied/); ok('check-ins are written only by scanning')
assert.equal((await as(W2, 'select * from member_visits()')).length, 1); assert.equal((await as(W1, 'select * from member_visits()')).length, 1); ok('each member sees only their own visits')
assert.equal((await as(W2, 'select consented from member_me()'))[0].consented, true); ok('online sign-ups have consented')
await db.exec(`update members set consented_at = null where code = '${oldc}'`)
assert.equal((await as(W1, 'select consented from member_me()'))[0].consented, false)
await as(W1, `select member_consent('v1')`); assert.equal((await as(W1, 'select consented from member_me()'))[0].consented, true); ok('an invited member agrees on first sign-in')
assert.equal((await as(S, `select has_app from v_members where code = $1`, [oldc]))[0].has_app, true); ok('staff see who has a website account')

// 020: payment history, deleting an online account, renewal reminders.
const oldId = (await one(`select id from members where code = '${oldc}'`)).id
const monthId = (await one(`select id from products where code = 'MONTH'`)).id
await as(S, `select record_sale($1::jsonb, 'gcash', 0, null, null, null, null, null, '1234', $2)`, [JSON.stringify([{ product_id: monthId, qty: 1 }]), oldId])
const pay = await as(W1, 'select * from member_payments()')
assert.equal(pay.length, 1); assert.equal(pay[0].plan_name, 'Monthly'); assert.equal(+pay[0].amount, 1500); assert.equal(pay[0].payment_method, 'gcash'); assert.ok(pay[0].sale_no); ok('member sees their own payments with receipt number and amount')
assert.equal((await as(W2, 'select * from member_payments()')).length, 0); ok("another member's payments stay hidden")

await db.exec(`update members set full_name = 'Old <b>Member' where id = '${oldId}';
  update member_periods set voided = true where member_id = '${oldId}';
  insert into member_periods (member_id, product_id, plan_name, starts_on, ends_on)
  values ('${oldId}', '${monthId}', 'Monthly', (now() at time zone 'Asia/Manila')::date - 27, (now() at time zone 'Asia/Manila')::date + 3)`)
const due = (await db.query('select * from renewal_due()')).rows
assert.equal(due.length, 1); assert.equal(due[0].kind, 'soon'); assert.equal(due[0].email, 'oldc@x'); ok('a plan ending in 3 days is due a reminder; members without an account are not')
await assert.rejects(db.query('select send_renewal_reminders()'), /Resend key/); ok('sending needs the Resend key in Vault')
await db.exec(`insert into vault.decrypted_secrets values ('resend_api_key', 're_test')`)
assert.equal((await one('select send_renewal_reminders() n')).n, 1)
const mail = await one('select * from net.calls')
assert.equal(mail.url, 'https://api.resend.com/emails'); assert.equal(mail.headers.Authorization, 'Bearer re_test'); assert.deepEqual(mail.body.to, ['oldc@x'])
assert.ok(mail.body.html.includes('Hi Old,') && mail.body.subject.startsWith('Your CourageD plan ends')); ok('one branded reminder is queued through Resend')
await db.exec(`update members set full_name = '<b>Old' where id = '${oldId}'; delete from renewal_reminders`)
await db.query('select send_renewal_reminders()')
assert.ok((await one('select body from net.calls order by ctid desc limit 1')).body.html.includes('&lt;B&gt;Old')); ok('names are HTML-escaped in emails')
assert.equal((await one('select send_renewal_reminders() n')).n, 0); ok('a second run the same day sends nothing')
await db.exec('delete from renewal_reminders')
await as(W1, 'select member_set_reminders(false)')
assert.equal((await db.query('select * from renewal_due()')).rows.length, 0); assert.equal((await as(W1, 'select reminders from member_me()'))[0].reminders, false); ok('members can turn reminders off')
await fails(W1, 'select send_renewal_reminders()', /permission denied/); await fails(W1, 'select * from renewal_due()', /permission denied/); ok('members cannot trigger or list reminders')

const w2Token = (await as(W2, 'select qr_token from member_me()'))[0].qr_token
await fails(S, 'select member_delete_account()', /Staff logins/); ok('staff logins cannot delete themselves here')
await as(W2, 'select member_delete_account()')
assert.equal((await one(`select count(*)::int c from auth.users where id = '${W2}'`)).c, 0)
const gone = await one(`select user_id, email, consented_at from members where code = '${nc}'`)
assert.equal(gone.user_id, null); assert.equal(gone.email, null); assert.equal(gone.consented_at, null); ok('deleting the online account removes the login, email and consent')
assert.equal(await scan(w2Token), null); assert.equal((await scan(nc)).code, nc); ok('their old QR stops working; the gym record and visits stay for the front desk')

// 021: name + mobile, no gym code needed.
const W3 = '00000000-0000-0000-0000-0000000000e3', W4 = '00000000-0000-0000-0000-0000000000e4', W5 = '00000000-0000-0000-0000-0000000000e5'
await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values ('${W3}', 'ana@x', '{"account":"member"}'), ('${W4}', 'bea@x', '{"account":"member"}'), ('${W5}', 'carlo@x', '{"account":"member"}')`)
const ana = (await as(S, `insert into members (full_name, phone, created_by) values ('Ana Reyes', '0918 111 2222', $1) returning code`, [S]))[0].code
const start = async (uid, name, phone) => (await as(uid, `select member_start($1, $2, 'v1') r`, [name, phone]))[0].r
assert.deepEqual(await start(W3, 'ana reyes', '+63 918 111 2222'), { result: 'linked', code: ana }); ok('mobile on file + same first name links the record, no code needed')
assert.equal((await as(W3, 'select code from member_me()'))[0].code, ana); ok('the linked member sees their existing pass')
assert.deepEqual(await start(W4, 'Bea Reyes', '0918 111 2222'), { result: 'need_code', reason: 'phone' }); ok('same mobile under another first name asks for the gym code instead')
assert.equal((await as(W4, 'select * from member_me()')).length, 0); ok('and links nothing')
const carlo = await start(W5, 'Carlo Diaz', '0919 000 1111')
assert.equal(carlo.result, 'joined'); assert.ok(/^CRDFH\d{2}-\d{4}$/.test(carlo.code)); ok('a mobile nobody has on file makes a new member')
for (let k = 0; k < 4; k++) await start(W4, 'Guess' + k, '0918 111 2222')
await fails(W4, `select member_start('Guess', '0918 111 2222', 'v1')`, /Too many tries/); ok('guessing names for a known number stops after five misses an hour')
await fails(W4, `select member_start('Bea', '0918 111 2222', '')`, /privacy notice|Too many/); ok('consent still required')

// 027: one name format, linked records can't be repurposed, no silent doubles, merging.
const fmt = async (n) => (await as(S, `insert into members (full_name, created_by) values ($1, $2) returning full_name`, [n, S]))[0].full_name
assert.equal(await fmt('lontok,augosto  antonio'), 'LONTOK, AUGOSTO ANTONIO'); assert.equal(await fmt(' Dela Cruz ,  Juan '), 'DELA CRUZ, JUAN'); ok('names save as "LAST, FIRST" in capitals, comma spacing fixed')
const anaId = await one(`select id from members where code = '${ana}'`).then((x) => x.id)
await fails(S, `update members set full_name = 'FEROLINO, JOULE' where id = $1`, /CourageD app/, [anaId]); ok('staff cannot type another person over a record linked to an app login')
await fails(S, `update members set phone = '0977 857 7778' where id = $1`, /CourageD app/, [anaId]); ok('…or change its mobile')
await as(S, `update members set full_name = 'reyes, ana' where id = $1`, [anaId]); ok('reformatting the same name is still fine')
await as(A, `update members set phone = '0918 111 2299' where id = $1`, [anaId]); ok('an admin can fix a linked mobile')
const W6 = '00000000-0000-0000-0000-0000000000e6', W7 = '00000000-0000-0000-0000-0000000000e7'
await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values ('${W6}', 'juan@x', '{"account":"member"}'), ('${W7}', 'jun@x', '{"account":"member"}')`)
const desk = (await as(S, `insert into members (full_name, phone, created_by) values ('DELA CRUZ, JUANITO', '0917 555 0000', $1) returning id, code`, [S]))[0]
assert.deepEqual(await start(W6, 'Dela Cruz, Juanito', '0917 555 0001'), { result: 'need_code', reason: 'name' }); ok('a new mobile but a matching desk name asks for the gym code, no double')
assert.deepEqual(await start(W7, 'Juanito Santos', '0917 555 0000'), { result: 'need_code', reason: 'phone' }); ok('same mobile, same first name, other surname links nothing')
const dbl = (await as(W6, `select member_join('Juanito Dela Cruz', '0917 555 0001', 'v1') c`))[0].c
await db.exec(`insert into checkins (member_id, status, staff_id) values ((select id from members where code = '${dbl}'), 'new', '${S}')`)
await fails(S, `select merge_members($1, (select id from members where code = $2))`, /admin/, [desk.id, dbl]); ok('staff cannot merge')
assert.equal((await as(A, `select merge_members($1, (select id from members where code = $2)) c`, [desk.id, dbl]))[0].c, desk.code)
const merged = await one(`select user_id, phone, notes, (select count(*)::int from checkins where member_id = m.id) visits from members m where id = '${desk.id}'`)
assert.equal(merged.user_id, W6); assert.equal(merged.phone, '0917 555 0000'); assert.equal(merged.visits, 1); assert.ok(merged.notes.includes(dbl)); ok('merging moves the login and visits onto the real record and notes the old code')
assert.equal((await one(`select count(*)::int c from members where code = '${dbl}'`)).c, 0); ok('the double is gone')

// 028: a surname spelled differently online still finds the desk record by first + middle name.
const W8 = '00000000-0000-0000-0000-0000000000e8'
await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values ('${W8}', 'gio@x', '{"account":"member"}')`)
await as(S, `insert into members (full_name, phone, created_by) values ('MABANGUE, GIOVANNE GOMEZ', '0927 644 9017', $1)`, [S])
assert.deepEqual(await start(W8, 'MBANAGUE, GIOVANNE GOMEZ', '0991 362 1152'), { result: 'need_code', reason: 'name' }); ok('a misspelled surname with the same first and middle names asks for the gym code')

console.log('all passed')
