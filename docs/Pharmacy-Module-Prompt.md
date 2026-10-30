# Prompt – Pharmacy Module (same pattern as Abi Homoeo Clinic / SmartClinic)

Copy everything below the line into Claude (or another AI coding assistant) inside the other clinic's project.
Change the words in **[square brackets]** first.

---

Build a complete **Pharmacy module** for **[Clinic name]**'s clinic management app. It is a multi-branch app:
every record belongs to one clinic (branch) and every list, number series and report is per clinic. Follow the
existing project's stack, code style, permissions, translations (English + Tamil) and UI components. If the project
has no stack yet, use React (Vite) for the web app, Node.js for the API and Microsoft SQL Server for the database.

## General rules for every screen

- **Screens, not pop-ups.** Add / edit forms open as full pages. Small extra forms (e.g. "Add vendor") open inline on
  the same page.
- **Compact layout.** Short page header (title and subtitle on one line), small padding, short table rows.
- **Master / List pattern.** Each part has a *Master* page (add / edit form) and a *List* page (search + table + Edit).
  New records get a per-clinic number: `<CLINIC CODE>-<PREFIX><4 digits>`, e.g. `CLA-PO0001`.
- **After saving a new record** the form clears for the next one; after saving an edit it goes back to the list.
- **Item tables are editable grids** with grid lines on every cell, a tinted header (brand colour, bold), a "Sum of
  Total" footer row, a **+** button on each row (adds a row under it) and a delete (bin) button.
- **Keyboard:** in every editable table ← / → move to the previous / next box (inside a text box the cursor moves through
  the text first) and ↑ / ↓ move to the same column in the row above / below. Number boxes must not step their value
  on ↑ / ↓. On arriving in a number box its value is selected.
- **Optional columns:** Generic Name, Manufacturer, HSN Code, Category are hidden by default; a small **›** button at the
  right edge of the "Item Name" heading shows them (in amber, so they stand apart) and **‹** hides them again.
- **Searchable pickers:** Item Name and Vendor Name are type-to-search boxes that open the full list on click
  (A–Z, first 50) and narrow as you type; ↑ / ↓ / Enter / Esc work.
- **Validation on screen and again on the server** (the server must never trust the screen's sums).
- Every stock change writes a **stock history** row: item, +/− quantity, balance after, reason, reference
  (document type + id), vendor, note, user, time.

## Menu

```
Pharmacy
  Item             → Master · List · Bulk Update
  Vendor           → Master · List
  Purchase / Order → Master · List
  Stock In         → Master · List
  Return           → Master · List
  Sales            → Master · List · Dispense (existing prescription dispensing, if the app has it)
  Report           → Stock Report · Vendor Payments
```

Left side menu: each part is a collapsible sub-menu (opens by itself on its own pages). Top menu bar mode: the Pharmacy
drop-down shows the parts side by side as columns (heading with icon in a tinted square, brand colour, a line under it;
Master / List under each), centred on the screen, wrapping to a second row on small screens.

## 1. Item

**Item → Master** (add / edit). Two rows on wide screens:
- Row 1: Item Name\*, Type / Unit, HSN Code, Pack, Quantity, MRP, CGST %, SGST %, Rack, Box (Item Name and Type / Unit
  wider, the rest narrow).
- Row 2: Generic Name, Manufacturer, Category, Potency, Schedule (drop-down: None / H / H1), Status (Active / Inactive).
- **Type / Unit, Generic Name, Manufacturer, Category, Potency** are pick-lists with **+ New / Edit / Delete** at the
  bottom of the list (one list per clinic and field; delete only hides a value; renaming does not change items already
  saved). Start each list with the values items already use (Type / Unit also: nos, bottle, strip, tablet, ml, gm, dram,
  box, tube, sachet; Potency also: 6C, 30C, 200C, 1M, 10M, Q).
- **Quantity**: on Add it is the opening stock; on Edit it can be changed – the difference is saved in the stock
  history as an *adjustment* ("Quantity changed on Edit Item").
- Item Code is automatic (`CLA-I0001`). Selling price = MRP when saved here (Stock In sets it later).
- GST % used for billing = CGST % + SGST % (max 28).

**Item → List**: Item Code, Item Name, Category, Unit, Price, Stock (red when at/below re-order level), Status, Edit.
Search + category filter. No "Stock In" button and no "Low stock only" filter here.

**Item → Bulk Update**: the item list as an editable grid (50 per page, search, category filter). Editable columns:
Category, Potency, Pack (drop-downs from their lists), HSN Code, Manufacturer, MRP, CGST %, SGST % (narrow), Rack, Box
(narrow), Status. Item Code and Item Name stay pinned on the left while the grid scrolls sideways. Changed cells and rows
turn amber; changes are kept across pages / searches; header shows "N item(s) changed – not saved yet" with
**Save N item(s)** and **Discard changes**. One request saves all; if any row is wrong nothing is saved and the wrong
rows turn red with the item name and reason. A lower MRP also brings the selling price down to it.

## 2. Vendor

**Vendor → Master** (full screen, no pop-up):
- Row 1: Vendor name\*, Contact person, Address\* (text area), Email.
- Row 2 (one row): State (drop-down of Indian states and union territories), Pin code (6 digits), Phone No, Mobile No\*,
  GSTIN (15 characters, capitals), DL No 1, DL No 2 (capitals).
- Row 3: Status.
- Address and Mobile No are required on the screen and on the server (an edit cannot clear them).

**Vendor → List** (compact): Vendor name, Contact person, Mobile No, State, GSTIN, Status, Edit; "+ New vendor".

## 3. Purchase / Order

An order placed with a vendor. **It does not change stock.**

**Master** – top row: Vendor Name\* (searchable; last row of its list is **+ Add vendor** which opens a small inline form:
Vendor name, Address, Mobile – all required), a **›** button to show **Details**, Date\* (today).
Choosing a vendor fills **Details** (text area, hidden until › is clicked) with its address, State – Pin code, phones,
email, GSTIN, DL numbers.

Item table: # | Item Name (searchable, › for optional columns) | [Generic Name | Manufacturer | HSN Code | Category] |
Pack | MRP | Disc % | Cur.Rate | Quantity | Amount | GST % | CGST % | SGST % | GST Amount | Total Amount | + / bin.
Picking an item fills Generic, Manufacturer, HSN, Category, Pack, MRP, CGST, SGST (MRP / CGST / SGST stay editable).

Formulas (same code on screen and server):
- Cur.Rate = MRP − (MRP × Disc % / 100)
- Amount = Quantity × Cur.Rate
- GST % = CGST % + SGST %
- GST Amount = Amount / 100 × GST %
- Total Amount = Amount + GST Amount
- Sum of Total = Σ Total Amount

**Bulk add items** button above the table opens an inline panel: search, Category filter, Manufacturer filter, a ticked
list (Select all shown; items already in the table shown ticked and greyed "already added"); **Add N item(s)** adds each
as a row with its details filled and removes empty rows.

Item details are copied into the order lines (so old orders keep them). Number: `CLA-PO0001`.
Once a Stock In exists for an order, the order can no longer be edited.

**List**: Order No, Date, Vendor, Items, Sum of Total, Edit.

## 4. Stock In

Goods received against a purchase order. **Adds stock and sets the selling price.**

**Master** – top row: Vendor Name\* (searchable, no add), Purchase No\* (drop-down of that vendor's orders:
"CLA-PO0001 · date · total"; disabled until a vendor is chosen), Date\*.
Choosing the order lists its items: tick box | Item Name (› optional columns) | Pack | MRP | Cur.Rate | Ordered |
Received (by earlier Stock Ins) | **Batch No | Mf.Date | Exp.Date | Quantity | Sales % | Discount %** | Sel.Amount.
- Quantity starts at what is still due (Ordered − Received); rows left at 0 are skipped.
- **Mf.Date / Exp.Date are month + year only.** Exp.Date cannot be a past month; Mf.Date cannot be a future month;
  Exp must be after Mf. Saved as the last day (Exp) / first day (Mf) of the month. An unchanged old value may be kept
  when editing.
- **Sel.Amount = Cur.Rate + Sales % of it, then less Discount %** (e.g. 90 → +20 % → 108 → −5 % → 102.60).
  Sel.Amount above MRP turns red and cannot be saved.
- **Bulk fill:** tick rows (header box ticks all) → a "Fill the ticked rows" bar with Batch No, Mf.Date, Exp.Date,
  Sales %, Discount % and **Apply to N row(s)** – only the boxes filled are applied.

On save: each item's stock goes up by its quantity (history reason *purchase*, note "Stock In CLA-SI0001"), and each
item's **selling price = its Sel.Amount**. Editing changes stock by the difference only (reason *adjustment*) and never
below zero. A Stock In cannot be edited once a Return or a Sale uses its batches. Number: `CLA-SI0001`.

**List** – two tabs:
- **Item wise**: one heading row per item (click to show / hide its batches; › / ⌄ arrow) with batch count and totals;
  batch rows show Batch No, Exp (month), Stock In No (date on hover), Vendor, Quantity and the amounts. No Edit here.
- **Date wise**: one heading row per date (Stock In count, batch count, totals); each Stock In's rows grouped as one block
  with its Stock In No + vendor and one Edit in merged cells (centred).
- Amounts per row, each with the single-quantity amount under it in small grey text ("₹175.75 / 1"):
  Buy Amount = Qty × Cur.Rate; Sale Amount = Qty × (Cur.Rate + Sales %); Discount Amount = Discount % of Sale Amount;
  Net Sale Amount = Qty × Sel.Amount.
- A totals bar above and a dark **Total** row at the bottom (over everything the search matches). Search: item, batch,
  Stock In No, vendor.

## 5. Return

Goods sent back to the vendor from one Stock In. **Reduces stock.**

**Master** – top row: Vendor Name\*, Stock In No\* (that vendor's Stock Ins: "CLA-SI0001 · date · PO no"), Date\*.
Table: Item Name | Batch No | Mf.Date | Exp.Date | Cur.Rate | Received | Returned (earlier) | **Return Qty** | Amount
(= Qty × Cur.Rate), Sum of Total. Return Qty cannot exceed Received − Returned (a line with nothing left is disabled);
stock cannot go below zero. Save: stock goes down (reason *return*, "Return CLA-RT0001 to vendor"); edits apply the
difference. Number: `CLA-RT0001`.

**List**: Return No, Date, Vendor, Stock In No, Item Name (all items, comma-separated), Items, Total Qty, Amount, Edit;
search also by item name.

## 6. Sales (counter sale)

**Master** – first row: Date\*, Customer Name\*, Mobile No.
Table: Item Name (searchable) | Batch (drop-down) | Rack | Box | Stock | Sale Price | Quantity | Amount | + / bin.
- The Batch drop-down lists only that item's batches with stock left, **earliest expiry first**
  ("12345 · Exp May 2028 · 1"), the first chosen automatically. Batch stock = received − returned − sold.
- Rack / Box come from the item (bold, brand colour). Sale Price = the batch's Sel.Amount (editable, not above MRP).
- Amount = Quantity × Sale Price; Total row.
- **Quantity ≤ Stock:** a larger quantity turns the box red with "Only N in stock" under it and disables Save
  (lines selling from the same batch are counted together). The server checks it again.
- Save: stock goes down (reason *issue*, reference *sale*) – shows as *Sold* in the Stock Report. Number: `CLA-S0001`.

**List**: Sale No, Date, Customer, Mobile, Item Name, Total Qty, Amount, Edit; total of all sales in the subtitle.

## 7. Reports

**Stock Report** (item-wise): Item Code | Item Name | Category | Pack | Opening | Stock In | Return | Sold | Adjustment |
**Current Stock** | Sell Price | Stock Value, Total row.
- Opening + Stock In − Return − Sold + Adjustment = Current Stock; Stock Value = Current Stock × selling price
  (shown as a note above the table). Stock In / Return include their later edits.
- Filters: search (name, code, generic), category, Show: items with stock history (default) / in stock only /
  out of stock / all items. Stock In green, Return / Sold red, Current Stock column shaded, out-of-stock rows grey.
- Click an item → its **stock history** opens under the row (no pop-up): Date & Time, Type (coloured tag), Details,
  Vendor, Change (+/−), Stock after, By.

**Vendor Payments**: per vendor (name · mobile): Stock In count | Amount | GST | **Stock In Total** | Return count |
**Return Total** | **Net Payable**, Total row; From / To date filter (empty = all time).
- Stock In Amount = Qty × Cur.Rate; GST from the purchase-order line's CGST + SGST %; Return uses the GST % of the
  Stock In line it came from; Net Payable = Stock In Total − Return Total.
- Click a vendor → its Stock Ins and Returns under the row: Date, Type, No, Against (PO / Stock In no), Item Name(s),
  Items, Quantity, Amount, GST, Total (returns shown as −). Clicking a line opens that document.

## Database (one row per clinic; add `clinic_id` to every table)

- Lists: `generic_master`, `manufacturer_master`, `unit_master`, `category_master`, `item_potency_master`
  (value, sort_order, is_default, is_deleted, created_by).
- `items` gets: item_code, pack, rack, box, cgst_percent, sgst_percent, potency (gst_percent = cgst + sgst).
- `suppliers` gets: state, pincode, phone, dl_no1, dl_no2 (address, mobile required by the API).
- `purchase_orders` / `purchase_order_items` (item details copied; mrp, disc_percent, rate, qty, amount, cgst, sgst,
  gst_percent, gst_amount, total).
- `stock_ins` / `stock_in_items` (po_item_id, batch_no, mfg_date, exp_date, qty, rate, mrp, sales_percent,
  disc_percent, sel_amount).
- `purchase_returns` / `purchase_return_items` (stock_in_item_id, batch and dates copied, qty, rate, amount).
- `sales` / `sale_items` (customer_name, mobile; stock_in_item_id for the batch, qty, price, amount).
- `stock_movements` (item_id, qty_change, balance_after, reason: opening / purchase / issue / adjustment / return,
  ref_type, ref_id, supplier_id, note, created_by, created_at).
- Schema changes must be safe to run again (create / alter only when missing).

## Done means

- Every screen above works in English and Tamil, on desktop and narrower screens.
- Stock is right after any mix of Stock In, Return, Sale and edits (check it against the Stock Report history).
- All server-side checks refuse bad input with a clear message and save nothing.
- Existing tests still pass.
