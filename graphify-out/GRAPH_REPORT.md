# Graph Report - couraged-pos  (2026-11-10)

## Corpus Check
- 93 files · ~124,234 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 6 file(s) not represented in the graph (top: (none) 3, .example 1, .bat 1)

## Summary
- 877 nodes · 2027 edges · 66 communities (36 shown, 30 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 23 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Shared UI Components
- Check-in Scanning
- Sales Export Sheets
- App Shell & Routing
- Analytics & PDF Reports
- Receipt Printing
- PDF Documents
- Payroll Calculations
- Expenses Page
- Database Test Suite
- Member Lifts & Friends
- Core POS Schema
- Day Summary & Advances
- Expenses Schema
- Package Manifest
- Payroll Schema
- Runtime Dependencies
- Member Reminders
- Friends Adults Only
- Member Accounts
- Friend Codes
- NPM Scripts
- Members Schema
- Name Format Guard
- Admin Features (README)
- Check-in Schema
- API Tests
- Staff API
- Project Setup (README)
- Member API
- Membership Concepts (README)
- Finance Vouchers
- Dev Dependencies
- Name Matching
- Export Discounts by Kind
- App Icons
- Sales Export SQL
- Gym Rates
- Member Codes & Payslips
- Member Start
- Misspelled Surname Signup
- App Entry Point
- Inventory Schema
- Staff Schema
- Member Codes
- Vercel Config

## God Nodes (most connected - your core abstractions)
1. `money()` - 59 edges
2. `manilaToday()` - 31 edges
3. `Problem()` - 28 edges
4. `Sheet()` - 28 edges
5. `PayRun()` - 24 edges
6. `react` - 23 edges
7. `motion` - 22 edges
8. `lucide-react` - 21 edges
9. `addDays()` - 21 edges
10. `useAuth()` - 20 edges

## Surprising Connections (you probably didn't know these)
- `handler()` --calls--> `handleMember()`  [EXTRACTED]
  api/member.js → server/member.js
- `handler()` --calls--> `handleStaff()`  [EXTRACTED]
  api/staff.js → server/staff.js
- `onRequestPost()` --calls--> `handleMember()`  [EXTRACTED]
  functions/api/member.js → server/member.js
- `onRequestPost()` --calls--> `handleStaff()`  [EXTRACTED]
  functions/api/staff.js → server/staff.js
- `Sales()` --indirect_call--> `presets()`  [INFERRED]
  src/pages/Sales.jsx → src/components/RangePicker.jsx

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **CouRageD PWA Icon Set** — public_assets_icon_192_app_icon, public_assets_icon_512_app_icon, public_assets_icon_512_maskable_maskable_icon, public_assets_apple_touch_icon_apple_touch_icon, public_assets_logo_couraged_brand_logo [INFERRED 0.85]
- **Void-with-reason audit trail (no hard deletes)** — readme_sales, readme_expenses, readme_payroll, readme_inventory [INFERRED 0.85]
- **Membership sale and door-access flow** — readme_memberships, readme_register, readme_member_code, readme_check_in, readme_members [EXTRACTED 1.00]
- **Admin financial reporting** — readme_analytics, readme_reports_pdf, readme_export_sales, readme_day_summary_x_reading [INFERRED 0.85]

## Communities (66 total, 30 thin omitted)

### Community 0 - "Shared UI Components"
Cohesion: 0.12
Nodes (56): lucide-react, motion, react, field, label, MoneyField(), Notice(), Problem() (+48 more)

### Community 1 - "Check-in Scanning"
Cohesion: 0.10
Nodes (48): react-router, fmtDay(), daysLeft(), longDay(), manilaDay(), renewOnRegister(), ResultCard(), ScanAnywhere() (+40 more)

### Community 2 - "Sales Export Sheets"
Cohesion: 0.07
Nodes (48): RangePicker(), BORDER, buildExport(), cnt(), daysOf(), discOf(), fileName(), itemOf() (+40 more)

### Community 3 - "App Shell & Routing"
Cohesion: 0.09
Nodes (42): animejs, Analytics, App(), BOOKS, CheckIn, Expenses, FLOOR, Gate() (+34 more)

### Community 4 - "Analytics & PDF Reports"
Cohesion: 0.11
Nodes (47): addDays(), monthStart(), presets(), downloadPayslips(), downloadSalesReport(), fetchAll(), loadPdf(), logoData() (+39 more)

### Community 5 - "Receipt Printing"
Cohesion: 0.09
Nodes (39): fmtDateTime(), RECEIPT, LOANS, OTHERS, ascii(), daySummaryBytes(), fmtDate(), layout() (+31 more)

### Community 6 - "PDF Documents"
Cohesion: 0.11
Nodes (38): amountInWords(), amt(), coverage(), CRIMSON, day(), footer(), GOLD, header() (+30 more)

### Community 7 - "Payroll Calculations"
Cohesion: 0.09
Nodes (33): addToPrior(), clamp(), computePayslip(), EMPTY_PRIOR, OVERRIDABLE, pagibig(), PERIODS_PER_MONTH, philhealth() (+25 more)

### Community 8 - "Expenses Page"
Cohesion: 0.12
Nodes (33): moneyInput(), BillsSheet(), CategoriesSheet(), EXP_FIELD, ExpenseHistory(), Expenses(), ExpenseSheet(), fmtDay() (+25 more)

### Community 9 - "Database Test Suite"
Cohesion: 0.11
Nodes (22): @electric-sql/pglite, [annual, dayM], as(), bal(), day(), dayOf(), dayOf0(), db (+14 more)

### Community 10 - "Member Lifts & Friends"
Cohesion: 0.11
Nodes (8): public.exercises, public.friend_request(), public.friends_leaderboard(), public.member_delete_account(), public.member_me(), public.my_friends(), public.my_lifts(), public.my_prs()

### Community 11 - "Core POS Schema"
Cohesion: 0.16
Nodes (15): on_auth_user_created, products_updated_at, public.is_admin(), public.is_staff(), public.products, public.profiles, public.sale_items, public.sales (+7 more)

### Community 12 - "Day Summary & Advances"
Cohesion: 0.13
Nodes (6): cash_advances_employee_idx, cash_advances_one_open, public.cash_advances, public.day_summary(), public.one_open_advance(), public.v_cash_advances

### Community 13 - "Expenses Schema"
Cohesion: 0.20
Nodes (10): expense_changes_idx, expenses_bill_month_uniq, expenses_category_idx, expenses_date_idx, expenses_log_change, expenses_updated_at, public.expense_categories, public.expense_changes (+2 more)

### Community 14 - "Package Manifest"
Cohesion: 0.15
Nodes (14): name, private, type, version, jspdf, jspdf-autotable, qrcode.react, recharts (+6 more)

### Community 15 - "Payroll Schema"
Cohesion: 0.20
Nodes (9): employees_log_change, employees_updated_at, payroll_items_employee_idx, payroll_runs_pay_date_idx, public.employee_changes, public.employees, public.payroll_items, public.payroll_rates (+1 more)

### Community 16 - "Runtime Dependencies"
Cohesion: 0.13
Nodes (15): dependencies, animejs, @fontsource/barlow, @fontsource-variable/big-shoulders-display, jspdf, jspdf-autotable, lucide-react, motion (+7 more)

### Community 17 - "Member Reminders"
Cohesion: 0.16
Nodes (4): public.member_delete_account(), public.member_payments(), public.renewal_due(), public.renewal_reminders

### Community 18 - "Friends Adults Only"
Cohesion: 0.20
Nodes (7): public.friend_request(), public.friend_respond(), public.friends_leaderboard(), public.member_me(), public.member_set_adult(), public.member_set_sharing(), public.my_friends()

### Community 19 - "Member Accounts"
Cohesion: 0.21
Nodes (6): member_link_attempts_idx, public.member_join(), public.member_link(), public.member_link_attempts, public.member_me(), public.public_price_list()

### Community 20 - "Friend Codes"
Cohesion: 0.16
Nodes (4): public.member_delete_account(), public.member_me(), public.my_friends(), public.new_friend_code()

### Community 21 - "NPM Scripts"
Cohesion: 0.15
Nodes (13): scripts, build, dev, dev:tablet, preview, test, test:api, test:db (+5 more)

### Community 22 - "Members Schema"
Cohesion: 0.22
Nodes (6): member_periods_member_idx, member_periods_sale_idx, members_name_idx, public.member_periods, public.members, sales_void_member_periods

### Community 24 - "Admin Features (README)"
Cohesion: 0.21
Nodes (12): Analytics, Cash Advances, Print Day Summary (X-reading), Expenses, Export Sales (CSV/Excel), SSS / PhilHealth / Pag-IBIG / BIR Withholding, Inventory, Payroll (+4 more)

### Community 25 - "Check-in Schema"
Cohesion: 0.27
Nodes (6): checkins_day_idx, checkins_member_idx, public.check_in(), public.checkins, public.member_me(), public.v_members

### Community 26 - "API Tests"
Cohesion: 0.18
Nodes (4): a, good, a, good

### Community 27 - "Staff API"
Cohesion: 0.33
Nodes (7): handler(), onRequestPost(), Staff Page, @supabase/supabase-js, fail(), handleStaff(), ROLES

### Community 28 - "Project Setup (README)"
Cohesion: 0.28
Nodes (6): index.html app shell, PWA / mobile web-app meta tags, CourageD POS, DB Tests in PGlite, Supabase Backend, Vercel Deployment

### Community 29 - "Member API"
Cohesion: 0.43
Nodes (5): handler(), onRequestPost(), SUPABASE_SERVICE_ROLE_KEY (server only), fail(), handleMember()

### Community 30 - "Membership Concepts (README)"
Cohesion: 0.29
Nodes (8): Annual Membership (yearly insurance), Check-in (QR door scan), CourageD Marketing Site (../couraged), Member Code (M0012), Members, Memberships & Plans, Register, Student/Senior/PWD Discount

### Community 31 - "Finance Vouchers"
Cohesion: 0.29
Nodes (3): public.is_finance(), public.vouchers, vouchers_date_idx

### Community 32 - "Dev Dependencies"
Cohesion: 0.29
Nodes (7): devDependencies, @electric-sql/pglite, tailwindcss, @tailwindcss/vite, vite, vite-plugin-pwa, @vitejs/plugin-react

### Community 35 - "App Icons"
Cohesion: 0.53
Nodes (6): Apple Touch Icon, PWA Icon 192x192, PWA Icon 512x512, PWA Maskable Icon 512x512, CouRageD Brand Logo, PWA Install Icons

### Community 38 - "Member Codes & Payslips"
Cohesion: 0.47
Nodes (3): members_code, public.members_code(), public.v_members

### Community 41 - "App Entry Point"
Cohesion: 0.40
Nodes (3): @fontsource/barlow, @fontsource-variable/big-shoulders-display, react-dom

### Community 46 - "Vercel Config"
Cohesion: 0.50
Nodes (3): framework, outputDirectory, rewrites

## Knowledge Gaps
- **159 isolated node(s):** `name`, `private`, `version`, `type`, `dev` (+154 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 336 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **30 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `@supabase/supabase-js` connect `Staff API` to `App Shell & Routing`, `Member API`, `Package Manifest`?**
  _High betweenness centrality (0.046) - this node is a cross-community bridge._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _159 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Shared UI Components` be split into smaller, more focused modules?**
  _Cohesion score 0.12152777777777778 - nodes in this community are weakly interconnected._
- **Why does `money()` connect `Shared UI Components` to `Check-in Scanning`, `Sales Export Sheets`, `App Shell & Routing`, `Analytics & PDF Reports`, `Receipt Printing`, `Expenses Page`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **Should `Check-in Scanning` be split into smaller, more focused modules?**
  _Cohesion score 0.1025974025974026 - nodes in this community are weakly interconnected._
- **Why does `react` connect `Shared UI Components` to `Check-in Scanning`, `Sales Export Sheets`, `App Shell & Routing`, `Analytics & PDF Reports`, `Receipt Printing`, `Expenses Page`, `App Entry Point`, `Package Manifest`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **Should `Sales Export Sheets` be split into smaller, more focused modules?**
  _Cohesion score 0.07467532467532467 - nodes in this community are weakly interconnected._