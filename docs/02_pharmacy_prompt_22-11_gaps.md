# Pharmacy module — gaps against the 22-11-2026 prompt (plan)

Source: the "Prompt – Pharmacy Module (updated 22-11-2026, as built in Demo_Homoeo / Abi Homeo)" pasted in chat.
Baseline: this repo, branch `Naresh` (commit aaa0d01). Earlier alignment: `docs/01_pharmacy_alignment_plan.md`.

## 1. Already in place (no work)

Every screen in the prompt's menu exists: Dashboard, Sales Billing / List / Dispense, Item Master / List /
Bulk Update, Vendor Master / List / Payments, Purchase Order / List, Stock In / List (item-wise and date-wise),
Three in One with Scan Bill, Adjustment, Sales Return, Purchase Return, Stock Report with history, Vendor
Payments report, All in One. These already match the prompt:

- Shared formula files `shared/purchase.js`, `shared/stockin.js`, `shared/sale.js` (P.Rate / Disc % link,
  Sel.Amount = MRP less S.Disc %, Unit Price, packs to 4 decimals, Round Off = round(total) − total).
- Stock ledger: `items.stock_qty` with CHECK ≥ 0 and `stock_movements` (same five reasons), `sp_getapplock`
  per clinic, batch stock = received − returned − sold + sales returned ± adjusted (`utils/stock.js`).
- Below-cost checks on Sales, PO old prices, Bill No duplicate check in Three in One, Item Master quantity
  edit logged as an adjustment, Tamil + English labels, no-spin number boxes and grid keyboard (`lib/tableKeys.js`).

## 2. Gaps

| # | Gap | Prompt says | Here today | Change |
|---|---|---|---|---|
| P1 | Whole-bill discount on a Purchase Order | `purchase_orders.disc_percent`, `disc_amount`, taken off before Round Off; Vendor Payment invoices take it off the amount owed | no columns | DB: 2 columns (default 0). API accepts them; Payments / Vendor Payments report subtract it. Screens keep sending 0 |
| P2 | Bill No unique per vendor on **Stock In** too | `GET /stock-ins/bill-no`; refused if this vendor already has it | checked only in Three in One | server check on Stock In save + live check on the Stock In screen |
| P3 | "Disc % on all lines" box in Three in One | sets Disc % on every line; lines can still be changed after | missing | screen only |
| P4 | Vendor Payment Reference No | required for every mode except Cash (screen + server) | optional | screen + server check |
| P5 | Dashboard Quick Actions column | Quick Actions as on the main Dashboard; "+n more" on boxes | not on the pharmacy dashboard | screen only (keep our extra boxes: expired, vendor dues) |
| P6 | Stale schema comment | — | `stock_in_items` comment still says "rate + sales_percent" | comment only (formula is already right) |
| P7 | Unit tests | tests for Round Off, P.Rate / Disc % link, Scan Bill column and price rules | `backend/test/pharmacy.test.js` covers formulas; Scan Bill rules not tested | add tests for `lib/billScan.js` rules |
| P8 | Screen-by-screen check | 16-box Item Master (8 a row), 7-a-row Vendor Master, phone ~375 px, every check message | not re-checked against this version | browser pass on desktop + 375 px; fix differences found |
| P9 | Prompt file | — | `docs/Pharmacy-Module-Prompt.md` is the 03-11 version | replace with the 22-11 text (old one stays in git history) |

## 3. Differences I recommend NOT copying (need your decision)

| # | Prompt | Here | Recommendation |
|---|---|---|---|
| D1 | Tailwind tokens, `text-9 … text-15`, lucide-react, `CardHeader` / `StatCards` … | plain CSS variables (`styles.css`), own `Icon.jsx`, `Card` / `PageHeader` in `ui.jsx` | **Keep ours.** The prompt itself says "follow the existing project's stack". Moving to Tailwind would restyle every screen in the app, not just pharmacy. |
| D2 | Menu Access table `menu_access` with 24 `pharmacy.<page>` keys, Full / View / None | per-employee permission ticks over role defaults (`shared/permissions.js`, Menu Permission page) | **Keep ours.** It already gives per-employee control; a second access system would conflict. (Can add a "View only" level later if you need it.) |
| D3 | API under `/api/pharmacy/...` (`/item-master`, `/stock-ins` …) | `/api/items`, `/api/stock-in`, `/api/purchases` … | **Keep ours.** Renaming paths changes every screen's calls for no user-visible gain. |
| D4 | Three in One saves in three steps; if Stock In fails the order is kept and Save retries | one transaction (items + order + Stock In all or nothing) + Drafts | **Keep ours.** One transaction never leaves half-saved orders; Drafts cover the "save and come back" need. |

## 4. Phases (one commit each)

1. **DB + server rules:** P1, P2, P4, P6 — `schema.sql` additions (safe to re-run), API checks; `init-db` on the dev DB.
2. **Screens:** P2 (Stock In Bill No), P3, P4, P5 — with English + Tamil labels.
3. **Tests + docs:** P7, P9.
4. **Check pass:** P8 in the browser at 375 px and desktop; fix what differs; list any new shared class/component.

No existing billing, GST, stock or batch rule changes. P1 adds an optional discount that is 0 for every saved order.
