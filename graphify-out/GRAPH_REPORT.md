# Graph Report - couraged-pos  (2026-10-20)

## Corpus Check
- 54 files · ~63,455 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 5 file(s) not represented in the graph (top: (none) 2, .example 1, .bat 1)

## Summary
- 400 nodes · 1080 edges · 18 communities (17 shown, 1 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 21 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Staff API & App Shell
- Reports & Date Ranges
- Shared UI & Forms
- Expenses & Money Utils
- App Routing & Navigation
- Receipt Printing
- PDF Generation
- Payroll Computation
- Inventory Management
- Package Manifest
- Runtime Dependencies
- Staff Management
- NPM Scripts
- Dev Dependencies
- PWA Icons & Logo
- App Entry Point
- Vercel Config

## God Nodes (most connected - your core abstractions)
1. `money()` - 47 edges
2. `Sheet()` - 20 edges
3. `PayRun()` - 20 edges
4. `useAuth()` - 18 edges
5. `motion` - 17 edges
6. `react` - 17 edges
7. `fmtDateTime()` - 16 edges
8. `lucide-react` - 15 edges
9. `manilaToday()` - 15 edges
10. `ExpenseSheet()` - 15 edges

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
- **Payroll posts to Expenses, summarized in PDF Reports** — readme_payroll, readme_expenses, readme_reports, readme_ph_contributions [EXTRACTED 1.00]
- **Staff account management and role enforcement** — readme_staff_page, api_staff, readme_service_role_key, readme_role_model [EXTRACTED 1.00]
- **CouRageD PWA Icon Set** — public_assets_icon_192_app_icon, public_assets_icon_512_app_icon, public_assets_icon_512_maskable_maskable_icon, public_assets_apple_touch_icon_apple_touch_icon, public_assets_logo_couraged_brand_logo [INFERRED 0.85]

## Communities (18 total, 1 thin omitted)

### Community 0 - "Staff API & App Shell"
Cohesion: 0.05
Nodes (36): handler(), onRequestPost(), index.html app shell, PWA / mobile web-app meta tags, Analytics, Shared brand tokens, CourageD marketing site (../couraged), CourageD POS (+28 more)

### Community 1 - "Reports & Date Ranges"
Cohesion: 0.12
Nodes (46): addDays(), fmtDay(), monthStart(), presets(), RangePicker(), downloadPayslips(), downloadSalesReport(), fetchAll() (+38 more)

### Community 2 - "Shared UI & Forms"
Cohesion: 0.14
Nodes (42): lucide-react, motion, field, label, MoneyField(), Notice(), Problem(), StatusPill() (+34 more)

### Community 3 - "Expenses & Money Utils"
Cohesion: 0.15
Nodes (31): CountUp(), EASE_OUT, money(), moneyInput(), quickCash(), round2(), uuid(), BillsSheet() (+23 more)

### Community 4 - "App Routing & Navigation"
Cohesion: 0.13
Nodes (25): animejs, react, Analytics, App(), Expenses, Gate(), Main(), NAV (+17 more)

### Community 5 - "Receipt Printing"
Cohesion: 0.13
Nodes (23): RECEIPT, ascii(), peso(), printReceipt(), receiptBytes(), saleReceipt(), b, lines (+15 more)

### Community 6 - "PDF Generation"
Cohesion: 0.15
Nodes (26): amt(), CRIMSON, day(), footer(), GOLD, header(), INK, LINE (+18 more)

### Community 7 - "Payroll Computation"
Cohesion: 0.12
Nodes (22): clamp(), computePayslip(), EMPTY_PRIOR, pagibig(), PERIODS_PER_MONTH, philhealth(), round2(), sss() (+14 more)

### Community 8 - "Inventory Management"
Cohesion: 0.22
Nodes (19): Segmented(), stockOf(), BLANK, DeleteProduct(), DetailsTab(), Drawer(), FIELD_LABEL, fmtVal() (+11 more)

### Community 9 - "Package Manifest"
Cohesion: 0.16
Nodes (13): name, private, type, version, jspdf, jspdf-autotable, react-router, recharts (+5 more)

### Community 10 - "Runtime Dependencies"
Cohesion: 0.15
Nodes (13): dependencies, animejs, @fontsource/barlow, @fontsource-variable/big-shoulders-display, jspdf, jspdf-autotable, lucide-react, motion (+5 more)

### Community 11 - "Staff Management"
Cohesion: 0.40
Nodes (12): fmtDateTime(), AddSheet(), EditSheet(), Handover(), makePassword(), PasswordField(), Problem(), ROLE (+4 more)

### Community 12 - "NPM Scripts"
Cohesion: 0.18
Nodes (11): scripts, build, dev, dev:tablet, preview, test, test:api, test:db (+3 more)

### Community 13 - "Dev Dependencies"
Cohesion: 0.29
Nodes (7): devDependencies, @electric-sql/pglite, tailwindcss, @tailwindcss/vite, vite, vite-plugin-pwa, @vitejs/plugin-react

### Community 14 - "PWA Icons & Logo"
Cohesion: 0.53
Nodes (6): Apple Touch Icon, PWA Icon 192x192, PWA Icon 512x512, PWA Maskable Icon 512x512, CouRageD Brand Logo, PWA Install Icons

### Community 15 - "App Entry Point"
Cohesion: 0.40
Nodes (3): @fontsource/barlow, @fontsource-variable/big-shoulders-display, react-dom

### Community 17 - "Vercel Config"
Cohesion: 0.50
Nodes (3): framework, outputDirectory, rewrites

## Ambiguous Edges - Review These
- `CourageD POS` → `Vercel deployment`  [AMBIGUOUS]
  README.md · relation: references

## Knowledge Gaps
- **103 isolated node(s):** `name`, `private`, `version`, `type`, `dev` (+98 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 123 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `CourageD POS` and `Vercel deployment`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **Why does `@supabase/supabase-js` connect `Staff API & App Shell` to `Package Manifest`, `App Routing & Navigation`?**
  _High betweenness centrality (0.101) - this node is a cross-community bridge._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _103 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Staff API & App Shell` be split into smaller, more focused modules?**
  _Cohesion score 0.05254901960784314 - nodes in this community are weakly interconnected._
- **Why does `money()` connect `Expenses & Money Utils` to `Inventory Management`, `Reports & Date Ranges`, `Shared UI & Forms`, `Receipt Printing`?**
  _High betweenness centrality (0.087) - this node is a cross-community bridge._
- **Should `Reports & Date Ranges` be split into smaller, more focused modules?**
  _Cohesion score 0.11564625850340136 - nodes in this community are weakly interconnected._
- **Why does `react` connect `App Routing & Navigation` to `Reports & Date Ranges`, `Shared UI & Forms`, `Expenses & Money Utils`, `Receipt Printing`, `Inventory Management`, `Package Manifest`, `Staff Management`, `App Entry Point`?**
  _High betweenness centrality (0.074) - this node is a cross-community bridge._