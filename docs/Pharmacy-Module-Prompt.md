# Prompt – Pharmacy Module (updated 22-11-2026, as built in Demo_Homoeo / Abi Homeo)

Copy everything below the line into Claude (or another AI coding assistant) inside the clinic's project. Change the
words in **[square brackets]** first. This version describes the module as it is in the code today: every screen,
the design rules, every formula, the server checks, the API and the database tables. (The 03-11-2026 Saravana Clinic
version is in git history.)

How this repo differs from the prompt (kept on purpose): `docs/02_pharmacy_prompt_22-11_gaps.md`, section 3.

---

Build a complete **Pharmacy module** for **[Clinic name]**'s clinic management app. Follow the existing project's
stack, code style, permissions and UI components. If the project has no stack yet, use React 18 + Vite + Tailwind
CSS 3 + lucide-react for the web app, Node.js 20+ for the API and Microsoft SQL Server for the database (driver tedious).

- **Clinic scope:** every table has `clinic_id`; every list, number series and report is per clinic. A single-clinic
  install has one row in `clinics` and no clinic switcher.
- **Document numbers:** `<CLINIC CODE>-<PREFIX><4 digits>`, from a `code_sequences` table: Item I, Purchase Order PO,
  Stock In SI, Purchase Return RT, Sale S, Sales Return SR, Adjustment AD, Vendor Payment VP (e.g. `[AH]-PO0001`).
- **Language:** all screen text through `t()` with keys in English and Tamil (`i18n/en.js`, `i18n/ta.js`).
- **Roles:** Admin and other users. Deletes, the item import and editing a saved Stock In are Admin only; the server
  checks the role too.

## A. Design system (keep every screen looking the same)

- **Tokens** (`tailwind.config.js`): colours `brand` (primary blue), `teal` (clinical accent), `ink` (greys);
  emerald / red / amber only for status (Active / error / warning). Menu-section colours from `config/tones.js`. Never
  hard-code hex colours. Text sizes `text-9 … text-15` (`text-13` body and tables, `text-12` subtitles, `text-10` small
  labels), all rem. Shadows `shadow-card | soft | elevated | glow`; font Inter (Noto Sans Tamil for Tamil).
- **Shared classes** (`index.css`): `btn-primary` (Save / New), `btn-secondary` (Cancel / Back), `btn-danger` (Delete),
  `btn-ghost !p-1` + 15 px icon for row actions; each button = lucide icon 16 + short label. Fields `label` + `input`
  (30 px tall, also on select / textarea). One card per screen. Tables `table-head` / `table-row`; lists
  `list-pinned pin-first w-full min-w-[720px] text-left text-13` inside `overflow-x-auto rounded-lg`.
- **Shared components** (`components/ui.jsx`): `CardHeader({icon, title, subtitle, actions})` first in every card;
  `Spinner`, `EmptyState`, `Modal`, `useToast()` (one app-wide toast), `SearchBox` (350 ms debounce), `DateFilter`,
  `SummaryBar`, `RowAction`, `DataTable`, `Pagination`, `Field/Input/Select/TextArea`; class constants `GRID_WIDE`,
  `GRID_SHORT`, `FORM_ACTIONS`, `GRID_INPUT` / `GRID_BAD` (boxes in editable grids), `PICKER_MENU` / `pickerRow`.
  Phones: `ItemCard`, `CardField`, `PhoneTabs`, `PhoneFooter`. Dashboards: `StatCards`, `QuickActionsPanel`. Print:
  `PrintBar`, `Doc`, `DocHead`, `DocMeta`, `DOC_TABLE`, `SignLine`. Pickers: `ItemPicker`, `VendorPicker`, `ItemBulkPicker`.
- **List screen:** card → `CardHeader` (actions = `SearchBox` + `btn-primary` "New x") → `Spinner` / `EmptyState` /
  pinned table; main column `font-medium text-ink-700`, others `text-ink-500`, `-` for empty; Edit (Pencil) last,
  right-aligned.
- **Master screen:** one card, `<form onSubmit={save} noValidate>`; title "X Master" / "Register a new x" when adding,
  "Edit X" / "Update or delete this x" when editing; fields in `GRID_WIDE` / `GRID_SHORT`; sentence-case labels, `*`
  on required ones, example placeholders ("e.g. 98765 43210"); phones `type="tel" inputMode="numeric"`; codes (GSTIN,
  DL No, Bill No) upper-cased. Validate first and toast the first problem. Buttons in `FORM_ACTIONS`: Cancel → Delete
  (disabled unless editing) → Save ("Saving..." while busy). After add: toast + reset for the next one; after edit /
  delete: toast, then back to the list. Server errors: `toast(err.message || t('common.saveFailed'), 'error')`. Never
  `alert()`; `confirm()` before a delete is fine.
- **Entry screens with item lines** (Purchase Order, Three in One, Stock In, Returns, Sales, Adjustment, Dispense): an
  editable grid on md and up, one `ItemCard` per line on phones. Grid boxes look like plain text until hovered /
  focused. "Sum of Total" footer; **+** on each row (adds a row under it, cursor in its Item Name) and a bin.
- **Keyboard in grids:** ← / → move between boxes (inside text the cursor moves through the text first) and reach the
  row's + / bin (Enter / Space presses them); ↑ / ↓ go to the same column one row up / down. Number boxes never step
  on ↑ / ↓ or the mouse wheel (`no-spin`); arriving in one selects its value.
- **Searchable pickers:** Item Name and Vendor Name open the full list on click (A–Z, first 50) and narrow as you type;
  names starting with the text first, then names containing it; ↑ / ↓ / Enter / Esc work.
- **Show / hide column groups:** a small round › in a heading shows extra columns (tinted sky / amber / emerald); ‹ hides them.
- **Months as MM/YY:** Mf.Date / Exp.Date typed as digits (`0228` → `02/28`), saved as the 1st (Mf) / last day (Exp)
  of the month. Exp can't be a past month, Mf can't be a future month, Exp must be after Mf.
- **Phone first:** no sideways page scroll; wide tables scroll inside their wrapper with the first column pinned;
  `no-print` on anything that must not print. Check every screen at ~375 px and on desktop.
- **Validation twice:** on screen and again on the server. The server never trusts the screen's sums (it works every
  amount out again with the same shared code) and a bad save is refused with a clear message, saving nothing.

## B. Menu and access

```
Pharmacy
  Dashboard
  Sales        → Sales Billing · List · Dispense
  Item         → Item Master · List · Bulk Update
  Vendor       → Vendor Master · List · Payments
  Purchase     → Purchase Order · List
  Stock In     → Stock In · List · Three in One · Adjustment (Entry · List)
  Return       → Sales Return (Entry · List) · Purchase Return (Entry · List)
  Report       → Stock Report · Vendor Payments · All in One
```

Top-bar group: a drop-down panel with one column per sub-menu (icon in a tinted square, coloured from
`config/tones.js`), a search box at the top (Enter opens the first match, Esc clears then closes); it fits the screen
and scrolls inside. Phones: a collapsible list.

**Menu Access** per employee and page: full / view / none, keyed by a fixed `pharmacy.<page>` key (never rename a
key). Saving through an API needs Admin or Full on a page that saves through it; reading needs the role permission or
at least View on a page that reads through it. Keys: `dashboard, sales-billing, sales-billing-list, dispense, item,
item-list, item-list-new, vendor-master, vendor-list, vendor-payment, purchase-master, purchase-master-list,
stock-inward, stock-inward-list, stock-ips, stock-adjustment, stock-adjustment-list, sales-return, sales-return-list,
purchase-return, purchase-return-list, stock-report, vendor-payments, all-in-one-report`.

## C. Screens

### 1. Pharmacy Dashboard (read only)
Stat cards: Today's Sales (n bills), This Month's Sales ("less ₹x returned"), This Month's Purchases (n Stock Ins, at
Cur.Rate + GST), Stock Value (Σ stock × selling price, n items). Boxes: Last 7 Days sales, Running Low (at or below
Reorder Level, or 5 packs when none is set), Expiring within 90 days (batches with stock left), Latest Sales; each box
shows a few rows and "+n more". Quick Actions column as on the main Dashboard.

### 2. Item
**Item Master** – 16 boxes, every box the same width: 8 to a row on desktop (two rows), 4 on a tablet, 2 on a phone
(Item Name full width): Item Name*, Generic Name, Manufacturer, Type / Unit, Pack, HSN Code, Quantity, MRP, CGST %,
SGST %, Rack, Box, Category, Potency, Schedule (None / H / H1), Status (Active / Inactive).

- Type / Unit = pieces in one pack (15 = a strip of 15); used for unit prices and selling single units.
- Generic Name, Manufacturer, Type / Unit, Category, Potency are pick-lists with + New / Edit / Delete at the bottom
  (delete only hides a value; renaming does not change saved items).
- Quantity: on Add = opening stock; on Edit a change is saved in the stock history as an adjustment.
- Item Code automatic. GST % = CGST % + SGST % (max 28). Selling price = MRP until a Stock In sets it.
- Import: CSV template; every row checked first, if any is wrong nothing is saved and problems come back per line; an
  existing Item Name + Unit updates that item (blank cells keep the value), others are added; stock never changes.
- Add / Edit Item popup (`ItemFormModal`, same fields, 5 to a row, no Quantity) from Purchase Order's item box: a last
  row + Add new item "…" when the typed name is new, and a pencil on each suggestion.

**Item List:** Item Code, Item Name, Category, Unit, Price, Stock (red at / below reorder level), Status, Edit; search +
category filter.

**Bulk Update:** the items as an editable grid (50 per page, search, category filter). Editable: Category, Potency,
Pack, HSN, Manufacturer, MRP, CGST %, SGST %, Rack, Box, Status; Item Code + Name pinned left. Changed cells turn amber
and are kept across pages: "N item(s) changed – not saved yet" with Save N item(s) / Discard changes. One request saves
all; any bad row → nothing saved, bad rows red with the reason. A lower MRP also lowers the selling price to it.

### 3. Vendor
**Vendor Master:** one grid, 7 to a row on desktop: Vendor name*, Contact person, Email, State (Indian states / UTs),
Pin code (6 digits), Phone, Mobile*, GSTIN (15, capitals), DL No 1, DL No 2 (capitals), Status, then Address* (3
columns wide). Address and Mobile required on screen and server (an edit can't clear them).

**Vendor List:** Vendor name, Contact person, Mobile, State, GSTIN, Status, Edit; "+ New vendor".

**Vendor → Payments** (pay against one Stock In = the vendor's invoice): pick the vendor, then the invoice (only those
with a balance; tick "Show paid" for all; the vendor's Bill No shown). Shows Total, Returns, Paid, Balance, its items
and earlier payments. Enter Date (not before the invoice), Amount (≤ balance), Mode (Cash / UPI / Bank / Cheque / Card)
and Reference No (required for every mode except Cash), Notes. Only an Admin may delete a payment. Payments are
serialised per clinic so two can't use the same balance.

### 4. Purchase Order (does not change stock)
Top: Vendor Name* (searchable; last row + Add vendor opens an inline form: name, address, mobile – all required), a ›
to show vendor Details (address, State – Pin, phones, email, GSTIN, DL nos), Date*.

Grid: `# | Item Name › | Category | Pack | Unit | MRP | Old Price | Disc% | P.Rate | Free | Qty | Amount | GST% | CGST% | SGST% | GST Amt | Total | + / bin`

- Picking an item fills Category, Pack, Unit, MRP, CGST / SGST; P.Rate starts at this vendor's last rate for it (else
  the item's purchase rate), Disc % worked out, Qty 1.
- Item Name › swaps the GST columns for Generic Name / Manufacturer / HSN (amber).
- Old Price = this vendor's last P.Rate for the item (0 if never ordered).
- MRP, Disc %, P.Rate are linked: typing MRP or Disc % works out P.Rate; typing P.Rate works out Disc %.
- GST % editable, split evenly into CGST / SGST (each also editable; GST % = their sum).
- Bulk add items panel: search, Category / Manufacturer filters, tick list (Select all; items already in the order
  ticked and greyed) → Add N item(s).
- Line checks (screen + server; the line turns red with the reason): Qty > 0, MRP > 0, P.Rate > 0, P.Rate ≤ MRP,
  Free ≥ 0, Disc % 0–100, CGST + SGST ≤ 28, the same item twice.
- Footer: Sum of Total · Round Off (tick, on by default; an edit keeps how it was saved) · Net Amount.
- Item details are copied into the order lines. Once a Stock In exists for the order its lines are fixed.

**List:** Order No, Date, Vendor, Items, Net Amount, Edit; Admin also Delete (refused once a Stock In uses it).

### 5. Stock In (goods received against an order: adds stock and sets the selling price)
Top: Vendor Name*, Purchase No* (the vendor's orders "PO0001 · date · ₹total", fully received ones left out; disabled
until a vendor is chosen), Date*.

Default columns: `☐ | Item Name | Pack | Unit | MRP | Amount › | GST Amt › | Total | Ordered | Free | Received | R.Order | R.Free | Batch No | Mf.Date | Exp.Date | S.Disc% | Sel.Amount ›`

- Amount › shows P.Rate | Disc % (sky); GST Amt › shows GST % | CGST % | SGST % (amber); Sel.Amount › adds Unit Price (emerald).
- Ordered / Free = what the order asked for; "earlier: N" under a box = what earlier Stock Ins received.
- Received starts at what is still due; typing it fills R.Order (paid) first, then R.Free (free). Can't receive more
  than is still due. Rows with nothing received are skipped.
- Amount = R.Order × the order's P.Rate; GST / Total from the order line — only R.Order is charged.
- Sel.Amount = MRP less S.Disc % (MRP 32.12, 5 % → 30.51); Unit Price = Sel.Amount ÷ pack size (÷ 15 → 2.03).
- Bulk fill: tick rows → "Fill the ticked rows" bar (Batch No, Mf.Date, Exp.Date, Discount %) → Apply to N row(s).
- On save: stock + (R.Order + R.Free), each item's selling price = its Sel.Amount.
- Only an Admin may edit or delete; not once a Return, Sale or Adjustment uses its batches (it opens read-only with the
  reason and a Back to Stock In List button). An edit applies only the change in quantity.

**Stock In List** – totals bar on top, dark Total row at the bottom, search (item, batch, Stock In No, Bill No,
vendor), two tabs:

- **Item wise:** a heading row per item (click to show / hide its batches) with batch count and totals; batch rows:
  Batch No, Exp, Stock In No (date on hover, "Bill …" under it), Vendor, Quantity ("incl. N free"), amounts, Admin
  Edit / Delete.
- **Date wise:** a heading row per date; each Stock In's rows as one block (Stock In No + Bill + vendor + order no),
  one Admin Edit / Delete in merged cells.
- Amounts, each with its one-quantity amount in small grey text ("₹24.25 / 1"): Buy Amount = paid Qty × Rate; Sale
  Amount = Qty × MRP; Discount Amount = S.Disc % of Sale Amount; Net Sale Amount = Qty × Sel.Amount.

### 6. Three in One (Item + Purchase Order + Stock In in one entry)
For typing a supplier's bill straight in. Top: Vendor (+ Add vendor inline; › vendor details box), Bill No* (the
vendor's invoice no, upper-cased, max 50; refused if this vendor already has it – "Bill No X is already saved for this
vendor (Stock In Y)"), Date. Buttons: Scan Bill, Stock In List, Clear / Start over, Save all. "N lines · M new items"
beside the header.

Grid (headings stay on top, # / Item Name stay left while it scrolls), three column groups that open / close:

- **Item:** Generic, Manufacturer, HSN, Category, Pack (pack size), Unit, Rack.
- **Purchase:** MRP, Old Price, Disc %, P.Rate (linked as on Purchase Order), Qty, Free, Amount, GST %, GST Amt, Total.
- **Stock In:** Batch No, Mf.Date, Exp.Date, S.Disc %, Sel.Amount.

Under each name: "In Item List · code" or "New – added to the Item List on save". A typed name links to the item with
that exact name (and no other HSN / Category).

- **Disc % on all lines** box (beside the footer, for a supplier bill with one discount): sets Disc % on every line
  (P.Rate = MRP less Disc %), so each Total and the Sum of Total come down; a line can still be changed after.
- Row checks: Qty, MRP, P.Rate > 0, P.Rate ≤ MRP, Disc %, GST %, Free ≥ 0, Batch No and Exp.Date required, month
  rules, S.Disc % 0–100, repeated rows (same Item Name + HSN + Batch). Problem rows red with the reason.
- Footer: Sum of Total · Round Off (tick, on by default) · Net Amount.
- One Save, three steps (each through its own screen's server checks): 1. adds the new items to the Item List (with
  Generic, Pack, Unit, Rack; selling price = Sel.Amount); 2. saves the Purchase Order (Round Off, vendor details, Bill
  No); 3. saves the Stock In. If step 3 fails the order is kept ("Order X is saved but the Stock In is not: … – correct
  it and save again") and Save retries only the Stock In.
- **Scan Bill** (popup): upload a photo / PDF (several pages; each turned upright, turn / zoom buttons) or take a photo
  on a phone → drag a box round the item table (or Read whole page) → Match columns: the table as read with a tile per
  Three in One column, clear headings pre-placed (Item Description → Item Name, Batch, Exp, Qty, Free, MRP, Rate →
  P.Rate, Disc, GST…); drag / tap to fix, remove stray columns or lines → Fill the table (after rows already typed; a
  repeat Item Name + HSN + Batch is left out; no line is lost across pages). Also fills the bill date and the vendor
  (when one in the list has very nearly that name; otherwise + Add vendor opens filled from the bill). Bill No is
  typed. Rules: Disc % is a % of the MRP; no rate column → Amount ÷ Qty is the rate (Disc 0); a Disc > 100 is an
  amount; no GST % column → from CGST + SGST, GST Amt or Total ("9%+9%" = 18); "10's" / "1x15" → pack size. OCR runs
  in the browser (tesseract.js + pdfjs-dist, loaded only when used); the bill never leaves the browser.

### 7. Stock Adjustment (count differences, breakage, expiry)
Date, Reason (e.g. "Physical stock count"), then lines: Item → Batch (or No batch for older stock) → Cur.Stock and Rate
(purchase price per pack) fill in → In Qty or Out Qty (packs, not both) → Amount = Qty × Rate. Footer In Total / Out
Total. No batch and no item may go below zero (server checks again inside the stock lock). An edit applies only the
change. Only an Admin may delete (its moves are undone). List: Adjustment No, Date, Reason, items, In / Out totals,
Edit, newest first.

### 8. Purchase Return (goods back to the vendor, from one Stock In: reduces stock)
Vendor*, Stock In No* ("SI0001 · date · PO no"), Date*. Grid: `Item Name | Batch No | Mf.Date | Exp.Date | Cur.Rate | Received | Returned (earlier) | Return Qty | Amount` (= Qty × Cur.Rate), Sum of Total. Return Qty ≤ Received − Returned
(lines with nothing left disabled); stock never below zero. Edits apply the difference. List: Return No, Date, Vendor,
Stock In No, Item Names, Items, Total Qty, Amount, Edit; search also by item.

### 9. Sales Billing (counter sale)
Top: Date*, Customer Name*, Mobile No.

Grid: `# | Item Name | Batch | Sell by | Rack | Box | Stock | MRP | Purchase Price | Sale Price | Quantity | Disc% | Amount | + / bin`

- Batch: only batches with stock left, earliest expiry first ("12345 · Exp 02/28 · 8"); the first is chosen.
- Sell by: Pack (15) or Unit (only when pack size > 1). Stock, MRP, Purchase Price, Sale Price shown per pack or per
  unit to match; stock is counted in packs (5 units of a 15's pack = 0.3333 pack).
- MRP and Purchase Price come from the batch's Stock In line; Rack / Box from the item (small blue tags).
- Sale Price = the batch's Sel.Amount (editable, not above MRP). Amount = Qty × Sale Price less Disc %.
- Footer: Sub Total, Bill Discount % (amount shown), Round Off (tick; on for a new sale, an edit keeps how it was
  saved; + / − amount), TOTAL.
- Checks (screen + server): Quantity ≤ batch stock ("Only N in stock"; lines on the same batch count together); Sale
  Price ≤ MRP; Disc % and Bill Discount % 0–100; no selling below cost – each row's Amount ≥ Qty × Purchase Price
  ("Below cost …") and the bill's Total before Round Off ≥ the rows' total cost ("Total … is below the purchase cost …
  — lower the Bill Discount"). Any red box disables Save.
- Quick billing keyboard: item + Enter → Batch → Enter → Sell by → Enter → Quantity → Enter → Disc% → Enter → next
  row's Item Name (a row is added). On Batch and Sell by, ↑ / ↓ change the choice. Hint under the table. Goal: 5–7
  items in a few seconds. Each item's batch list is fetched once per bill and reused.
- Save / Save & Print (Update & Print when editing). After a plain Save a bar "Sale X saved – ₹y" offers Print.
- Receipt (80 mm): clinic name / contact / address, Bill No, customer, date; Item ("(unit)" for unit sales), Batch,
  Qty, Rate, Disc% (only when used), Amount; Sub Total and Discount (n %) only when a bill discount was given; Round
  Off when not zero; Total.
- A sale with a Sales Return can no longer be edited.

**Sales List:** Sale No, Date, Customer, Mobile, Item Names, Total Qty, Amount, Edit, Print; "n sales · ₹total".

### 10. Sales Return (goods a customer brings back, from one sale: adds stock back)
Find the sale by Sales Date or by sale no / customer / mobile (a typed search looks across all dates) → pick it →
Return Date, Reason → per sale line: Sold, Returned (earlier), Return Qty (in the line's own Sell by unit; "Up to n can
be returned"), Refund. Refund = Qty × Sale Price less the line's Disc % and the sale's Bill Discount % ("Bill Discount
n% applied to the refund"); the sale's Round Off is not refunded. Stock goes back to the item and its batch. An edit
applies only the change; a saved Sales Return cannot be deleted. List: Return No, Date, Sale No, Customer, Item Name,
Total Qty, Reason, Refund, Edit; "n returns · ₹total"; search by return no, sale no, customer or item.

### 11. Dispense (medicines from a doctor's prescription)
Pick a date → visits with prescription lines not fully issued ("n to issue"). Open one → each line: Prescribed, Stock
item (linked, or "Pick stock item…"), stock, price, Issued earlier, Issue qty, Amount, Select → Total → Issue n
item(s). Stock reduces (no batch); "Issued earlier" history with Issued by. Phones: one card per medicine.

### 12. Reports
- **Stock Report** (item-wise): `Item Code | Item Name | Category | Pack | Opening | Stock In | Return | Sold | Adjustment | Current Stock | Sell Price | Stock Value`, Total row. Opening + Stock In − Return − Sold (net of Sales
  Returns) + Adjustment = Current Stock; Stock Value = Current Stock × selling price. Filters: search (name, code,
  generic), category, Show: items with stock history (default) / in stock / out of stock / all. Stock In green, Return
  / Sold red, Current Stock shaded, out-of-stock rows grey. Click an item → its stock history under the row (Date &
  Time, Type tag, Details, Vendor, Change +/−, Stock after, By).
- **Vendor Payments:** per vendor (name · mobile): `Stock In count | Amount | GST | Stock In Total | Return count | Return Total | Net Payable | Paid | Balance`, Total row; From / To dates (empty = all time). Stock In amount = paid
  units only × Rate + the order line's GST; a Return uses the GST % of its Stock In line; Paid = Σ Vendor Payments;
  Balance = Net Payable − Paid. Click a vendor → its Stock Ins and Returns (returns as −); a line opens its document.
- **All in One:** pick a screen (Item, Vendor, Purchase Order, Stock In, Purchase Return, Sale, Sales Return,
  Adjustment, Vendor Payment), tick the columns to show and a date range (where the screen has a date) → Show report →
  table, printable. Ticking any item-line column ("line") gives one row per line, else one row per document. The
  server only allows the columns it lists (each column is a fixed SQL expression).

## D. Formulas (one shared file used by both screen and server; every step rounded to paise)

| Where | Rule |
|---|---|
| Purchase line (`shared/purchase.js`) | P.Rate = MRP − MRP × Disc % / 100; Disc % = (1 − P.Rate / MRP) × 100; Amount = Qty × P.Rate (Free not charged); GST % = CGST + SGST; GST Amt = Amount / 100 × GST %; Total = Amount + GST Amt |
| Purchase bill | Sum of Total = Σ Total; Round Off = nearest rupee; Net Amount = Sum + Round Off (saved as `total_amount`). The server also accepts an optional whole-bill discount (`disc_percent` → `disc_amount`, taken off before Round Off; the screens send 0 and use "Disc % on all lines" instead); Vendor Payment invoices take it off the amount owed |
| Stock In (`shared/stockin.js`) | Sel.Amount = MRP × (1 − S.Disc % / 100); pack size = Type / Unit when it is a number, else 1; Unit Price = Sel.Amount ÷ pack size |
| Sale (`shared/sale.js`) | packs = Qty ÷ (pack size when sold by unit, else 1), 4 decimals; Amount = Qty × Price × (1 − Disc % / 100); cost = Qty × batch cost ÷ units per pack; Sub Total = Σ Amount; Discount = Sub × Bill Disc %; Total = Sub − Discount + Round Off |
| Round Off | round(total) − total: 99.75 → +0.25; 24.25 → −0.25; 24.50 → +0.50 |
| Batch stock | received (paid + free) − purchase returns − sold + sales returns + adjusted in − adjusted out; order: earliest expiry first, no expiry last |
| Vendor balance | Total − Returns − Paid |

## E. Stock rules

- `items.stock_qty` (DECIMAL 12,4, CHECK ≥ 0) is changed only together with a `stock_movements` row (qty_change,
  balance_after, reason, ref_type, ref_id, note, user, time). Never below zero.
- Reasons / ref_types: `opening`; `purchase` (stock_in); `return` (purchase_return); `issue` (sale, sales_return with a
  positive change, dispense); `adjustment` (Item Master edit, stock_adjustment).
- Every stock-changing save runs in one transaction under a per-clinic lock (SQL `sp_getapplock`) and reads batch stock
  inside the lock, so two bills can't take the last units. Item rows are locked `UPDLOCK, ROWLOCK` in id order.
- Edits apply only the difference (new − old packs per item). A document's own lines are left out when its edit reads
  batch stock.

## F. API (mounted at `/api/pharmacy`, JSON, all checks repeated on the server)

| Path | Endpoints |
|---|---|
| `/item-master` | GET `/?q&category&manufacturer&low_stock&status&page` · GET `/options` · GET `/categories` · GET `/stock-report?q&category&show=moved\|instock\|out\|all&page` · GET `/:id` · GET `/:id/movements` · POST `/` · POST `/import` (Admin) · POST `/bulk` · PUT `/:id` · POST `/:id/stock` |
| `/vendors` | GET `/` · GET `/:id` · POST `/` · PUT `/:id` |
| `/purchase-orders` | GET `/?q&supplier_id&page` · GET `/old-prices?supplier_id&item_ids` · GET `/:id` · POST `/` · PUT `/:id` · DELETE `/:id` (Admin, no Stock In) |
| `/stock-ins` | GET `/?q&page` · GET `/lines?q&group=item\|date&page` · GET `/order/:poId?except` · GET `/bill-no?supplier_id&bill_no` · GET `/:id` · POST `/` · PUT `/:id` (Admin) · DELETE `/:id` (Admin) |
| `/stock-returns` | GET `/?q&page` · GET `/stock-in/:siId?except` · GET `/:id` · POST `/` · PUT `/:id` |
| `/stock-adjustments` | GET `/?q&page` · GET `/batches/:itemId?except` · GET `/:id` · POST `/` · PUT `/:id` · DELETE `/:id` (Admin) |
| `/sales-billings` | GET `/?q&page` · GET `/batches/:itemId?except` · GET `/:id` (with clinic details for the receipt) · POST `/` · PUT `/:id` |
| `/sales-returns` | GET `/?q&page` · GET `/sales?date\|q` · GET `/sale/:saleId?except` · GET `/:id` · POST `/` · PUT `/:id` |
| `/dispense` | GET `/pending?date` · GET `/visit/:visitId` · POST `/visit/:visitId` |
| `/vendor-bill-payments` | GET `/invoices?supplier_id&all` · GET `/invoices/:stockInId` · POST `/` · DELETE `/:id` (Admin) |
| `/pharmacy-reports` | GET `/vendor-payments?from&to` · GET `/vendor-payments/:supplierId?from&to` · GET `/all-in-one/screens` · GET `/all-in-one?screen&columns&from&to` |
| `/dashboard` | GET `/` |

Example bodies: Purchase Order `{ supplier_id, po_date, details, disc_percent, round_off, lines: [{ item_id, mrp, p_rate, free_qty, disc_percent, qty, cgst_percent, sgst_percent }] }`; Stock In `{ supplier_id, po_id, si_date, bill_no?, lines: [{ po_item_id, batch_no, mfg_date: 'YYYY-MM', exp_date: 'YYYY-MM', qty, free_qty, disc_percent }] }`;
Sale `{ sale_date, customer_name, mobile, disc_percent, round_off, lines: [{ item_id, stock_in_item_id?, sale_unit: 'pack'|'unit', qty, price, disc_percent }] }`; Sales Return `{ sale_id, return_date, reason, lines: [{ sale_item_id, qty }] }`;
Adjustment `{ adj_date, remarks, lines: [{ item_id, stock_in_item_id?, in_qty, out_qty, rate? }] }`; Vendor Payment
`{ stock_in_id, pay_date, amount, pay_mode, reference_no?, notes? }`.

## G. Database (SQL Server; one script safe to run again: create / alter only when missing)

Common to every table: `id INT IDENTITY PK`, `clinic_id INT NOT NULL → clinics`, `created_by → employees`,
`created_at` / `updated_at DATETIME2(0)` defaulting to clinic local time (`DATEADD(MINUTE, 330, SYSUTCDATETIME())`).
Money DECIMAL(10,2) / (12,2), percentages DECIMAL(5,2), pack quantities DECIMAL(12,4).

**Masters**
- `items`: name, item_code, category, unit (Type / Unit, pieces per pack), pack, hsn_code, generic_name, brand_name,
  manufacturer, potency, item_type, rack, box, mrp, price (selling price), purchase_rate, discount_percent,
  cgst_percent, sgst_percent, gst_percent (= sum), schedule_h, schedule_h1, stock_qty DECIMAL(12,4) CHECK ≥ 0,
  reorder_level, supplier_id, pharmacy_id, status ('active'|'inactive'). UNIQUE (clinic_id, name, unit).
- Pick-lists `generic_master`, `manufacturer_master`, `unit_master`, `category_master`, `item_potency_master`: value,
  sort_order, is_default, is_deleted; UNIQUE (clinic_id, value).
- `suppliers` (vendors): name, contact_person, mobile, phone, email, address, state, pincode, gstin, dl_no1, dl_no2, status.

**Purchase**
- `purchase_orders`: po_no (UNIQUE per clinic), supplier_id, po_date, details (vendor details / Bill No text),
  disc_percent, disc_amount (optional whole-bill discount, 0 from the screens), round_off, total_amount (Net Amount).
- `purchase_order_items`: po_id, item_id, item_name, generic_name, hsn_code, manufacturer, category, pack, unit (copied
  from the item), mrp, disc_percent, p_rate, rate, qty, free_qty, amount, cgst_percent, sgst_percent, gst_percent,
  gst_amount, total. Index po_id.
- `stock_ins`: si_no (UNIQUE), supplier_id, po_id, si_date, bill_no.
- `stock_in_items` (= a batch): stock_in_id, po_item_id, item_id, item_name, batch_no, mfg_date, exp_date, qty (paid),
  free_qty, rate (P.Rate), mrp, sales_percent, disc_percent (S.Disc), sel_amount. Indexes stock_in_id, po_item_id, item_id.
- `purchase_returns`: return_no, supplier_id, stock_in_id, return_date, total_amount.
- `purchase_return_items`: return_id, stock_in_item_id, item_id, item_name, batch_no, mfg_date, exp_date, qty, rate,
  amount. Indexes return_id, stock_in_item_id, item_id.
- `vendor_payments`: vp_no, supplier_id, stock_in_id, pay_date, amount, pay_mode CHECK IN ('cash','upi','bank',
  'cheque','card'), reference_no, notes. Index stock_in_id.

**Sales**
- `sales`: sale_no, sale_date, customer_name, mobile, sub_total, disc_percent, discount_amount, round_off, total_amount
  (after Round Off).
- `sale_items`: sale_id, item_id, item_name, stock_in_item_id (batch, NULL for older stock), batch_no, exp_date,
  sale_unit ('pack'|'unit'), unit_qty (as typed), pack_size, qty DECIMAL(12,4) (packs), price, disc_percent, amount.
  Indexes sale_id, stock_in_item_id, item_id.
- `sales_returns`: sr_no, sale_id, return_date, reason, total_amount.
- `sales_return_items`: sr_id, sale_item_id, item_id, item_name, stock_in_item_id, batch_no, exp_date, sale_unit,
  pack_size, unit_qty, qty (packs), price, disc_percent, amount. Indexes sr_id, sale_item_id, stock_in_item_id.
- `pharmacy_issues` / `pharmacy_issue_items` (Dispense): visit_id, patient_id, items_total, status ('issued'|'billed'),
  bill_id / issue_id, prescription_id, item_id, qty, rate, gst_percent, amount.

**Stock**
- `stock_adjustments`: adj_no, adj_date, remarks, in_total, out_total.
- `stock_adjustment_items`: adjustment_id, item_id, item_name, stock_in_item_id, batch_no, exp_date, in_qty, out_qty
  (DECIMAL 12,4), rate, amount. Indexes adjustment_id, stock_in_item_id.
- `stock_movements`: item_id, qty_change, balance_after (DECIMAL 12,4), reason CHECK IN ('opening','purchase','issue',
  'adjustment','return'), ref_type, ref_id, supplier_id, note. Index (clinic_id, item_id, created_at).
- `code_sequences`: the next number per clinic and prefix.
- `menu_access`: employee_id, menu_key, access_level ('full'|'view'|'none'); UNIQUE (employee_id, menu_key).

## H. Done means

- Every screen above works on a phone (~375 px) and on desktop, looks like the existing screens, and has its text in
  English and Tamil.
- Stock is right after any mix of Stock In, Three in One, Purchase Return, Sale, Sales Return, Adjustment, Dispense and
  edits (check against the Stock Report history and the batch lists).
- All server checks refuse bad input with a clear message and save nothing; the shared formula files have unit tests
  (Round Off, P.Rate / Disc % linking, Scan Bill column and price rules).
- A counter sale of 5–7 items can be keyed in a few seconds with the keyboard only.
- Before finishing, compare each screen with an existing one of the same type and list any new shared class or
  component with the reason the existing ones were not enough.
