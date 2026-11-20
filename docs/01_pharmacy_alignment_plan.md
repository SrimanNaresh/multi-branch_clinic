# Pharmacy module — align with Ayush All In One (plan)

Reference (read-only): `D:\Source File\Client Source\ALL IN ONE` (SrimanNaresh/TAyush, `main`,
commit cc6a51b), files `backend/src/db/schema/pharmacy.js`, `backend/src/pharmacy/**`,
`frontend/src/modules/pharmacy/**`, `docs/07_ips_draft_mode.md`, `docs/12_*.md`.

Target: this repo (SmartClinic multi-branch), branch `Naresh`.

## 1. How the two projects differ (structure)

| | All In One (reference) | SmartClinic (this repo) |
|---|---|---|
| Backend | Express 4, ES modules, `mssql` | own `mini-express`, Tedious driver bundled, no `npm install` |
| Tables | PascalCase (`PharmacyItem`, `StockIn`) | snake_case (`items`, `stock_ins`) |
| Tenancy | single clinic | **every row has `clinic_id`** (multi-branch) |
| Schema | `src/db/schema/pharmacy.js` | `database/schema.sql` (idempotent, run by `init-db.js`) |
| Access | Menu keys `pharmacy.*` + Full/View | role permissions in `shared/permissions.js` (`item.manage`, `stock.manage`, `dispense` …) |
| Stock | computed from documents per batch | `items.stock_qty` + `stock_movements` ledger; batch stock from `stock_in_items` |
| Doc numbers | `TA-PO0001` from identity id | `CLA-PO0001` per clinic from `code_sequences` |

**Proposal:** keep this repo's stack, table naming, `clinic_id` scoping, permissions and stock
ledger (changing them would break the branch isolation and existing data). Copy the reference's
**screens, fields, calculations and documents** into this structure. Only add tables/columns;
never drop or rename.

## 2. What already matches

Item (Master / List / Bulk Update, pick-lists for unit, category, potency, generic, manufacturer,
Schedule H/H1, CGST/SGST, rack/box, pack), Vendor (incl. state, pincode, DL No 1/2), Purchase /
Order (P.Rate, Disc %, Free qty, GST split), Stock In (batch, Mf/Exp, R.Order / R.Free,
Sales % → Sel.Amount), Purchase Return (from one Stock In), Sales (pack / unit sale, line and bill
discount, batch pick), Stock Report, Vendor Payments report.

## 3. Gaps — what the reference has and we don't

| # | Feature | Reference | DB change here | Screens here |
|---|---|---|---|---|
| G1 | **Vendor Payment entry** (pay against one Stock In; balance per bill) | `VendorPayment`, `vendorPayment.js`, `VendorPaymentEntry.jsx` | new `vendor_payments` | Vendor → Payments; report reads real payments |
| G2 | **Stock In Bill No** (supplier's invoice no.) | `StockIn.BillNo` | `stock_ins.bill_no` | field on Stock In + List |
| G3 | **Sales Return** entry + list (from a sale, back into its batch) | `SalesReturn(+Item)`, `salesReturn.js` | new `sales_returns`, `sales_return_items`; ledger reason `sales_return` | Return → Sales Return Entry / List |
| G4 | **Stock Adjustment** entry + list (In / Out per batch, opening stock) | `StockAdjustment(+Item)` | new `stock_adjustments`, `stock_adjustment_items` | Stock In → Adjustment Entry / List |
| G5 | **Round Off** on Purchase Order and Sales | `PurchaseOrder.RoundOff`, `SalesBilling.RoundOff` | `purchase_orders.round_off`, `sales.round_off` | field in totals |
| G6 | **PO last rates** (last P.Rate / Disc of an item from this vendor) | `GET /purchase-order/last-rates` | none | auto-fill on PO grid |
| G7 | **Pharmacy Dashboard** (today's sales, purchases, low stock, near expiry, dues) | `dashboard.js`, `PharmacyDashboard.jsx` | none | Pharmacy → Dashboard |
| G8 | **Stock history** per item (every in/out with running balance) | `GET /report/stock/:id/history` | none | drill-down on Stock Report |
| G9 | **Delete** of PO / Stock In / Return / Sale / Adjustment (Admin only, blocked when later docs depend on it) | `router.delete` in every doc | none | bin button on Lists |
| G10 | **Three in One (IPS)**: one screen enters new items + order + Stock In from a supplier bill, with **Drafts** | `StockIps.jsx`, `07_ips_draft_mode.md`, `IpsDraft` | new `ips_drafts` | Stock In → Three in One |
| G11 | **Scan Bill** (photo/PDF of supplier bill → OCR → grid rows) | `ScanBillModal.jsx`, `billOcr.js` | none | button on IPS / Stock In |
| G12 | **All in One report** (pick a screen, columns, filters, export) | `allInOneReport.js`, `AllInOneReport.jsx` | none | Reports menu |
| G13 | Excel / PDF export on Lists | `xlsx`, `jspdf` | none | List pages |

Business rules carried over unchanged from the reference: Rate = P.Rate − Disc %, Amount = Qty × Rate,
GST = Amount × (CGST + SGST)/100, Sel.Amount = Rate + Sales % − Disc %, unit sale qty in packs
(4 decimals), return qty ≤ received − already returned, sale qty ≤ batch stock, stock-changing saves
serialised with `sp_getapplock`. Existing GST / stock / batch logic in this repo is **not changed**.

## 4. Phases (one commit each, tested with `init-db` + the running app on :5180)

1. **DB + small fields:** G2, G5, G6, G9 — `schema.sql` additions, API, form fields.
2. **Vendor Payments:** G1.
3. **Sales Return:** G3 (stock back into the batch; batch stock look-up includes returns).
4. **Stock Adjustment:** G4 (also usable for opening stock per batch).
5. **Dashboard + Stock history:** G7, G8.
6. **Three in One (IPS) with Drafts:** G10.
7. **Scan Bill + All in One report + exports:** G11, G12, G13 — these need new frontend packages
   (`tesseract.js` / `pdfjs`, `xlsx`, `jspdf`), so `frontend/dist` must be rebuilt and shipped.

New permissions: `stock.adjust` (Adjustment), `sales.return` (Sales Return), `vendor.pay`
(Payments) — default on for Admin / Pharmacist, editable in Menu Permission.

## 5. Questions

1. Keep this repo's structure (proposal above), or rebuild the pharmacy on the reference's
   PascalCase tables?
2. All phases, or only some (Phase 7 is the largest and adds packages)?
3. Tamil labels for the new screens too (the app has `ta.js`)?

## 6. Result (20-11-2026, branch `Naresh`)

Decisions: keep this repo's structure; all 7 phases. Each phase was tested against the API on the dev
database (`T_multi_branch`) with test documents that were then deleted, and the screens were checked in the browser.

| Phase | Commit | What was built |
|---|---|---|
| 1 | 884aef1 | `stock_ins.bill_no`, `purchase_orders.round_off`, `sales.round_off` (+ receipt); Admin delete of Sales and Purchase Returns; new tables for the later phases |
| 2–3 | 1ebe58f | Vendor → Payments (`vendor_payments`, `/api/vendor-payments`), Paid / Balance in the Vendor Payments report; Return → Sales Return entry / list (`sales_returns`, `sales_return_items`, `/api/sales-returns`) |
| 4 | 9a30d7e | Stock In → Adjustment entry / list (`stock_adjustments`, `stock_adjustment_items`, `/api/stock-adjustments`) |
| 5 | 828ce1d | Pharmacy Dashboard (`/api/pharmacy-dashboard`); Stock Report counts Sales Returns (in Sold) and Adjustments. G8 (stock history) already existed in the Stock Report. |
| 6 | a51601f | Stock In → Three in One (IPS) with Drafts (`ips_drafts`, `/api/ips`) – one transaction for new items + order + Stock In |
| 7 | (this commit) | Scan Bill in Three in One (Tesseract / PDF.js, `lib/billOcr.js` + `lib/billScan.js` copied from All In One); Report → All in One (`/api/all-in-one`); Excel / PDF export on the pharmacy lists and reports |

Rules that hold across the new documents:
- Batch stock = received (paid + free) − purchase returned − sold + sales returned + adjusted in − adjusted out
  (`utils/stock.js → batchLeftSql`); Sales, Adjustment and Sales Return use it; no batch or item goes below zero.
- A Stock In can no longer be edited / deleted once a Return, Sale, Payment, Adjustment or Sales Return uses it;
  a Sale once a Sales Return is made from it.
- Deletes of documents are Admin-only; every stock change is in `stock_movements`.
- New permissions `vendor.pay`, `sales.return`, `stock.adjust` (on for Pharmacist; editable in Menu Permission).

Notes:
- Scan Bill loads the Tesseract engine and English data from the jsDelivr CDN the first time it is used, so it
  needs internet on that PC.
- `xlsx@0.18.5` (same version as All In One) is used only to write files; its known advisories are about reading files.
