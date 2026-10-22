# CourageD POS

Staff-only register, inventory and analytics for CourageD Fitness Hub.
Separate app and Vercel project from the marketing site (`../couraged`); same brand tokens.

## Setup

1. Supabase › SQL Editor: run `supabase/schema.sql` (already done), then every numbered patch in `supabase/` in order (`001_…` to `014_…`). Each patch is safe to run again.
2. Supabase › Authentication › Sign In / Providers: turn **off** "Allow new users to sign up". Create staff accounts yourself under Authentication › Users › Add user. New accounts start `inactive`; give them a role:
   ```sql
   update public.profiles set role = 'staff' where id = (select id from auth.users where email = 'staff@example.com');
   ```
3. For the Staff page (adding logins, resetting passwords), add `SUPABASE_SERVICE_ROLE_KEY` in Vercel › Settings › Environment Variables (Supabase › Project Settings › API keys › service_role). Server only: never name it `VITE_…`, never put it in `.env.local` that gets committed. It is used only by `api/staff.js`, which checks the caller is an admin first.
4. Copy `.env.example` to `.env.local` and fill in the URL and anon key (Project Settings › API).
5. `npm install` then `npm run dev` (`npm run dev:tablet` to open it from a tablet on the same wifi).

## Deploy

New Vercel project from this repo; add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as environment variables. Add the deployed URL under Supabase › Authentication › URL Configuration.

## Memberships

Membership plans and other services (no stock) live in **Members › Plans**, not Inventory. Give a plan a length in days (Monthly = 30) to track it per member; leave it blank for walk-ins and other services. The **Annual Membership** (yearly insurance) is tracked apart from gym time, and **Day Pass (Member)** only sells to someone whose annual membership is current (patch 013 adds the full price list). A plan can also have a **Student/Senior/PWD price**: on the register, that button charges it instead (recorded as a discount, with the sale noted "Student/Senior/PWD discount"). Each plan shows as a card on the register. The Memberships analytics tab reads the `Membership` category.

Register people in **Members**; each gets a member code like **M0012**. To sell or renew, add the plan card on the register and enter their code (or name) when the cart asks who it's for, or type the code in the register search and press Enter. The days are added after their current end date, or from today if they've lapsed; voiding the sale takes them back off. Members shows Active / Expired / All with a search by name, code or phone.

## What each part does

- **Register** (staff + admin): checkout, cash change, receipt.
- **Inventory** (staff + admin): stock items only. Receive deliveries, count shelves, write off spoilage, add and edit products and prices (admins can also delete). Stock only changes through these actions, and every change is in the product's History with who made it.
- **Members** (staff + admin): register members (each gets a code like M0012), see who is active or expired, and manage plans and services under Plans.
- **Sales** (admin only): every receipt with filters, cash-in-drawer totals, and voiding with a reason. **Print day summary** (pick a single day) prints an X-reading on the receipt printer for every sale that day: gross, discounts, net, voids, payments, categories and expected cash. It resets nothing and says it is not an official receipt; it is not a BIR Z-reading.
- **Staff** (admin only): add logins with a temporary password, change access (admin, staff, inactive), set a new password. There is always at least one admin.
- **Expenses** (admin only): one-off expenses and a monthly-bills checklist (rent, electricity, water…), with optional receipt photos/PDFs in a private storage bucket. Never deleted: voided with a reason, and every edit is logged.
- **Payroll** (admin only): employees (own pay schedule, monthly/daily/hourly rate, government numbers), pay runs from draft to finalized, SSS + PhilHealth + Pag-IBIG + BIR withholding settled month-to-date, editable rate tables with effective dates (pre-filled with 2025 rates; have the accountant confirm). Finalizing posts salaries and employer contributions to Expenses; voiding a run voids them. **Cash advances** (one open per employee, signed authorization required, no interest) are repaid by a deduction filled in on each pay run; they are a receivable, not an expense. Payslips can be downloaded, printed on a normal printer (Print payslips), or printed one at a time on the receipt printer.
- **Reports** (admin only): Analytics > Download PDF gives a sales & profit report for this/last week, this/last month or the dates on screen (P&L vs previous period, breakdowns, payroll, every expense with OR numbers, signature lines). Each pay run has a payslips PDF (summary, remittance table, one payslip per person); drafts are stamped DRAFT.
- **Analytics** (admin only): General, Merchandise, Memberships and Staff tabs for any date range. Gross profit counts goods at their cost when sold. Inventory purchases (Receive) are shown as cash spent but not subtracted; stock losses (spoilage and count shortages, at cost) are taken off net profit.
- **Export sales** (admin only, Analytics > Export sales): the payment sheet (SOLD ITEMS / SERVICES with GCash, Cash and Total) as CSV or Excel. Daily (a tab per day plus Summary), Summary (grouped by product) or a transaction log. Uses the price and cost at the time of each sale; voided sales are listed separately and left out of the totals; totals are after discounts, so they match Analytics. Excel is written with SheetJS (installed from cdn.sheetjs.com, not npm), and the bold headers, yellow subtotal rows and frozen header row are added to the file afterwards, since the free SheetJS edition doesn't write styles.

## Tests

`npm test` runs every suite. `npm run test:payroll` checks the payroll arithmetic with worked examples; `npm run test:pdf` builds both PDFs. `npm run test:export` builds every export from sample data and reads the Excel file back. `npm run test:api` checks the staff server function's rules. `npm run test:db` runs the schema and every patch in an in-process Postgres (PGlite) and checks permissions, checkout, stock and reports as staff, admin and an inactive user.
