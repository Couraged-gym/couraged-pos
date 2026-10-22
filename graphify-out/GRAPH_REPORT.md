# Graph Report - couraged-pos  (2026-10-22)

## Corpus Check
- 63 files · ~74,392 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 5 file(s) not represented in the graph (top: (none) 2, .example 1, .bat 1)

## Summary
- 485 nodes · 1337 edges · 19 communities (18 shown, 1 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 22 edges (avg confidence: 0.86)
- Token cost: 74,043 input · 0 output

## Community Hubs (Navigation)
- Sales Excel Export
- Shared Utils & Inventory
- App Shell & Navigation
- PDF Reports & Analytics
- UI & Form Components
- Staff API & Supabase
- Product Docs & Modules
- Payroll Computation
- Receipt Printing
- PDF Rendering Helpers
- Expenses Module
- Package Manifest
- Runtime Dependencies
- NPM Scripts & Tests
- Dev Dependencies
- PWA Icons & Branding
- Entry Point & Fonts
- Vercel Config

## God Nodes (most connected - your core abstractions)
1. `money()` - 51 edges
2. `Sheet()` - 24 edges
3. `manilaToday()` - 21 edges
4. `PayRun()` - 20 edges
5. `react` - 19 edges
6. `motion` - 18 edges
7. `useAuth()` - 18 edges
8. `addDays()` - 18 edges
9. `Problem()` - 18 edges
10. `ExportSheet()` - 18 edges

## Surprising Connections (you probably didn't know these)
- `handler()` --calls--> `handleStaff()`  [EXTRACTED]
  api/staff.js → server/staff.js
- `onRequestPost()` --calls--> `handleStaff()`  [EXTRACTED]
  functions/api/staff.js → server/staff.js
- `Sales()` --indirect_call--> `presets()`  [INFERRED]
  src/pages/Sales.jsx → src/components/RangePicker.jsx
- `robots noindex, nofollow` --conceptually_related_to--> `CourageD POS`  [INFERRED]
  index.html → README.md
- `Shell()` --calls--> `Inventory()`  [EXTRACTED]
  src/App.jsx → src/pages/Inventory.jsx

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **CouRageD PWA Icon Set** — public_assets_icon_192_app_icon, public_assets_icon_512_app_icon, public_assets_icon_512_maskable_maskable_icon, public_assets_apple_touch_icon_apple_touch_icon, public_assets_logo_couraged_brand_logo [INFERRED 0.85]
- **Never-delete audit trail (void with reason)** — readme_sales, readme_expenses, readme_payroll, readme_void_with_reason, readme_inventory [INFERRED 0.85]
- **Membership sell/renew flow** — readme_register, readme_membership_plans, readme_member_code, readme_membership_renewal, readme_members [EXTRACTED 1.00]
- **Admin reporting outputs** — readme_analytics, readme_reports_pdf, readme_export_sales [INFERRED 0.85]

## Communities (19 total, 1 thin omitted)

### Community 0 - "Sales Excel Export"
Cohesion: 0.08
Nodes (43): xlsx, RangePicker(), BORDER, buildExport(), cnt(), daysOf(), fileName(), itemOf() (+35 more)

### Community 1 - "Shared Utils & Inventory"
Cohesion: 0.12
Nodes (46): fmtDay(), CountUp(), Segmented(), stockOf(), manilaToday(), memberCode(), money(), moneyInput() (+38 more)

### Community 2 - "App Shell & Navigation"
Cohesion: 0.10
Nodes (39): animejs, Analytics, App(), Expenses, Gate(), Main(), Members, NAV (+31 more)

### Community 3 - "PDF Reports & Analytics"
Cohesion: 0.12
Nodes (44): addDays(), monthStart(), presets(), downloadPayslips(), downloadSalesReport(), fetchAll(), loadPdf(), logoData() (+36 more)

### Community 4 - "UI & Form Components"
Cohesion: 0.15
Nodes (39): lucide-react, motion, react, field, label, MoneyField(), Notice(), Problem() (+31 more)

### Community 5 - "Staff API & Supabase"
Cohesion: 0.08
Nodes (23): handler(), onRequestPost(), @electric-sql/pglite, @supabase/supabase-js, fail(), handleStaff(), ROLES, a (+15 more)

### Community 6 - "Product Docs & Modules"
Cohesion: 0.08
Nodes (30): index.html app shell, PWA / mobile web-app meta tags, Analytics, Annual Membership, api/staff.js, CourageD Marketing Site, CourageD POS, Day Pass (Member) (+22 more)

### Community 7 - "Payroll Computation"
Cohesion: 0.11
Nodes (25): addToPrior(), clamp(), computePayslip(), EMPTY_PRIOR, pagibig(), PERIODS_PER_MONTH, philhealth(), round2() (+17 more)

### Community 8 - "Receipt Printing"
Cohesion: 0.13
Nodes (24): RECEIPT, ascii(), peso(), printReceipt(), receiptBytes(), saleReceipt(), b, lines (+16 more)

### Community 9 - "PDF Rendering Helpers"
Cohesion: 0.15
Nodes (26): amt(), CRIMSON, day(), footer(), GOLD, header(), INK, LINE (+18 more)

### Community 10 - "Expenses Module"
Cohesion: 0.24
Nodes (17): BillsSheet(), CategoriesSheet(), EXP_FIELD, ExpenseHistory(), Expenses(), ExpenseSheet(), fmtDay(), monthBounds() (+9 more)

### Community 11 - "Package Manifest"
Cohesion: 0.16
Nodes (13): name, private, type, version, jspdf, jspdf-autotable, react-router, recharts (+5 more)

### Community 12 - "Runtime Dependencies"
Cohesion: 0.14
Nodes (14): dependencies, animejs, @fontsource/barlow, @fontsource-variable/big-shoulders-display, jspdf, jspdf-autotable, lucide-react, motion (+6 more)

### Community 13 - "NPM Scripts & Tests"
Cohesion: 0.17
Nodes (12): scripts, build, dev, dev:tablet, preview, test, test:api, test:db (+4 more)

### Community 14 - "Dev Dependencies"
Cohesion: 0.29
Nodes (7): devDependencies, @electric-sql/pglite, tailwindcss, @tailwindcss/vite, vite, vite-plugin-pwa, @vitejs/plugin-react

### Community 15 - "PWA Icons & Branding"
Cohesion: 0.53
Nodes (6): Apple Touch Icon, PWA Icon 192x192, PWA Icon 512x512, PWA Maskable Icon 512x512, CouRageD Brand Logo, PWA Install Icons

### Community 16 - "Entry Point & Fonts"
Cohesion: 0.40
Nodes (3): @fontsource/barlow, @fontsource-variable/big-shoulders-display, react-dom

### Community 18 - "Vercel Config"
Cohesion: 0.50
Nodes (3): framework, outputDirectory, rewrites

## Knowledge Gaps
- **128 isolated node(s):** `name`, `private`, `version`, `type`, `dev` (+123 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 152 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `index.html app shell` connect `Product Docs & Modules` to `Entry Point & Fonts`?**
  _High betweenness centrality (0.124) - this node is a cross-community bridge._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _128 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Sales Excel Export` be split into smaller, more focused modules?**
  _Cohesion score 0.08163265306122448 - nodes in this community are weakly interconnected._
- **Why does `react` connect `UI & Form Components` to `Sales Excel Export`, `Shared Utils & Inventory`, `App Shell & Navigation`, `PDF Reports & Analytics`, `Receipt Printing`, `Expenses Module`, `Package Manifest`, `Entry Point & Fonts`?**
  _High betweenness centrality (0.118) - this node is a cross-community bridge._
- **Should `Shared Utils & Inventory` be split into smaller, more focused modules?**
  _Cohesion score 0.11673469387755102 - nodes in this community are weakly interconnected._
- **Should `App Shell & Navigation` be split into smaller, more focused modules?**
  _Cohesion score 0.0975177304964539 - nodes in this community are weakly interconnected._
- **Should `PDF Reports & Analytics` be split into smaller, more focused modules?**
  _Cohesion score 0.11655874190564293 - nodes in this community are weakly interconnected._