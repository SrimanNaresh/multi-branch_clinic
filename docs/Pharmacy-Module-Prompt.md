# Prompt – Pharmacy Module (updated 03-11-2026, as built for Saravana Clinic)

Copy everything below the line into Claude (or another AI coding assistant) inside the clinic's project.
Change the words in **[square brackets]** first. This version includes every change made while building it
for Saravana Clinic (October – November 2026).

---

Build a complete **Pharmacy module** for **[Abi Homoeo Clinic]**'s clinic management app. Follow the existing
project's stack, code style, permissions and UI components. If the project has no stack yet, use React (Vite) +
Tailwind for the web app, Node.js (Express) for the API and Microsoft SQL Server for the database.

- **Single clinic:** no clinic / branch column. Document numbers use one fixed clinic code:
  `[SC]-<PREFIX><4 digits>`, e.g. `SC-PO0001`. (For a multi-branch app, add `clinic_id` to every table and keep
  every list, number series and report per clinic.)
- **Language:** English only. (Add Tamil only if the app already has translations.)
- **Roles:** "Admin" and other users. Only an Admin may delete orders / Stock Ins or edit a saved Stock In; the
  server checks the role too.

## General rules for every screen

- **Screens, not pop-ups.** Add / edit forms open as full pages. Small extra forms (e.g. "Add vendor") open inline.
- **Compact, professional layout.** Short one-line page header, small padding, short table rows (about 28 px),
  one-line column headings, tinted header row, light grid lines, light stripe on every other row and a soft
  hover colour. Number columns right-aligned with even (tabular) digits; text left; short codes and dates centred.
- **Fit the screen.** Wide tables use fixed column shares that add up to 100 %, so there is no sideways scroll on a
  normal laptop screen (1280 px and up); below that the table scrolls.
- **Master / List pattern.** Each part has a *Master* page (add / edit form) and a *List* page (search + table).
  After saving a new record the form clears for the next one; after saving an edit it goes back to the list.
- **Item tables are editable grids** with a "Sum of Total" footer, a **+** button on each row (adds a row under it
  and puts the cursor in the new row's Item Name) and a delete (bin) button.
- **Input boxes inside grids** look like plain text until hovered or focused (then a border and a focus ring).
- **Keyboard:** in every editable table ← / → move to the previous / next box (inside a text box the cursor moves
  through the text first) and also reach the row's + / bin buttons (Enter / Space presses them); ↑ / ↓ move to the
  same column in the row above / below. Number boxes never step their value on ↑ / ↓ or the mouse wheel. Arriving in a
  number box selects its value. A drop-down may keep ↑ / ↓ for itself (see Sales).
- **Searchable pickers:** Item Name and Vendor Name are type-to-search boxes that open the full list on click
  (A–Z, first 50) and narrow as you type — **names starting with the typed text come first**, then names containing
  it; ↑ / ↓ / Enter / Esc work.
- **Show / hide column groups with an arrow.** Where a table has more columns than fit, some are grouped behind a
  small round **›** button in a heading; clicking it shows the group (tinted in its own colour: sky, amber, emerald)
  and **‹** hides it again. The table keeps fitting the screen in every combination.
- **Months as MM/YY.** Mf.Date / Exp.Date are typed as digits only (`0228` → `02/28`); saved as the first (Mf) /
  last (Exp) day of the month.
- **Validation on screen and again on the server** (the server never trusts the screen's sums; a bad save is
  refused with a clear message and nothing is saved).
- **Stock is worked out from the documents** (received − returned − sold, per batch). A stock history table holds
  only opening stock and adjustments: item, +/− quantity, balance after, reason, reference, note, user, time.
  Stock-changing saves are serialised (e.g. SQL `sp_getapplock`) so two bills can't take the last units.

## Menu

```
Pharmacy
  Item             → Master · List · Bulk Update
  Vendor           → Master · List
  Purchase / Order → Master · List
  Stock In         → Master · List
  Return           → Master · List
  Sales            → Master · List
  Report           → Stock Report · Vendor Payments
```

Top menu bar: each group opens a drop-down **top to bottom** (short slide-down animation) under its own button.
Groups with sub-parts show them as **cards side by side** (heading with icon in a tinted square, Master / List
under each) with a **search box** at the top (Enter opens the first match, Esc clears then closes). The drop-down
**fits the screen**: as wide as its cards need, never wider than the screen (cards wrap into more rows), kept 8 px
inside both edges, never taller than the screen below the menu bar (it scrolls inside), and it re-fits when the
window is resized. On phones the menu is a collapsible list.

## 1. Item

**Item → Master** (add / edit). Two rows on wide screens:
- Row 1: Item Name\*, **Pack, Type / Unit, HSN Code** (in this order), Quantity, MRP, CGST %, SGST %, Rack, Box.
- Row 2: Generic Name, Manufacturer, Category, Potency, Schedule (None / H / H1), Status (Active / Inactive).
- **Type / Unit** holds the number of pieces in one pack (e.g. `15` = 15 tablets a strip); it is used for unit-wise
  prices and for selling single units. Type / Unit, Generic Name, Manufacturer, Category, Potency are pick-lists with
  **+ New / Edit / Delete** at the bottom of the list (delete only hides a value; renaming does not change saved items).
- **Quantity**: on Add it is the opening stock; on Edit a change is saved in the stock history as an *adjustment*.
- Item Code is automatic (`SC-I0001`). Selling price = MRP when saved here (Stock In sets it later).
- GST % = CGST % + SGST % (max 28).

**Item → List**: Item Code, Item Name, Category, Unit, Price, Stock (red when at/below re-order level), Status,
Edit. Search + category filter.

**Item → Bulk Update**: the item list as an editable grid (50 per page, search, category filter). Editable:
Category, Potency, Pack, HSN Code, Manufacturer, MRP, CGST %, SGST %, Rack, Box, Status. Item Code and Item Name stay
pinned on the left. Changed cells turn amber and are kept across pages; "N item(s) changed – not saved yet" with
**Save N item(s)** / **Discard changes**. One request saves all; if any row is wrong nothing is saved and the wrong
rows turn red with the reason. A lower MRP also brings the selling price down to it.

## 2. Vendor

**Vendor → Master** (full screen):
- Row 1: Vendor name\*, Contact person, Address\* (text area), Email.
- Row 2: State (Indian states and union territories), Pin code (6 digits), Phone No, Mobile No\*, GSTIN (15
  characters, capitals), DL No 1, DL No 2 (capitals).
- Row 3: Status. Address and Mobile No are required on the screen and on the server.

**Vendor → List**: Vendor name, Contact person, Mobile No, State, GSTIN, Status, Edit; "+ New vendor".

## 3. Purchase / Order

An order placed with a vendor. **It does not change stock.**

**Master** – top row: Vendor Name\* (searchable; last row **+ Add vendor** opens a small inline form: name, address,
mobile – all required), a **›** button to show **Details** (vendor address, State – Pin, phones, email, GSTIN, DL
numbers; hidden until clicked), Date\* (today).

Item table (fits the screen, no sideways scroll):
`# | Item Name › | Category | Pack | Unit | MRP | Old Price | P.Rate | Free | Disc% | Qty | Amount | GST% | CGST% | SGST% | GST Amt | Total | + / bin`
- Category, Pack, Unit come from Item Master. Picking an item fills them, MRP and CGST / SGST.
- **Item Name ›** swaps the GST% / CGST% / SGST% / GST Amt columns for **Generic Name / Manufacturer / HSN**
  (amber); **‹** swaps back.
- **Old Price** = this vendor's last net rate for the item (its P.Rate less Disc %), or 0 if never ordered from them.
- **P.Rate** is the purchase rate; **Free** = free units (received with the rest, not charged).
- **GST %** is editable and splits itself evenly into CGST % and SGST % (CGST / SGST also editable; GST % = their sum).
- Validation: **P.Rate ≤ MRP** (screen and server).

Formulas (same code on screen and server):
- Rate = P.Rate − (P.Rate × Disc % / 100)
- Amount = Qty × Rate (Free units are not charged)
- GST % = CGST % + SGST %; GST Amount = Amount / 100 × GST %
- Total = Amount + GST Amount; Sum of Total = Σ Total

**Bulk add items** (inline panel above the table): search, Category and Manufacturer filters, a ticked list
(Select all; items already in the table shown ticked and greyed); **Add N item(s)** adds them and removes empty rows.

Item details are copied into the order lines. Number: `SC-PO0001`. Once a Stock In exists for an order, the order
can no longer be edited.

**List**: Order No, Date, Vendor, Items, Sum of Total, Edit (Admin also sees **Delete**; the server refuses a
delete once a Stock In uses the order).

## 4. Stock In

Goods received against a purchase order. **Adds stock and sets the selling price.**

**Master** – top row: Vendor Name\* (searchable), Purchase No\* (drop-down of that vendor's orders
"SC-PO0001 · date · ₹total" — **orders already fully received are left out**; disabled until a vendor is chosen),
Date\*.

Choosing the order lists its items. Columns shown by default:
`☐ | Item Name | Pack | Unit | MRP | Amount › | GST Amt › | Total | Ordered | Free | Received | R.Order | R.Free | Batch No | Mf.Date | Exp.Date | S.Disc% | Sel.Amount ›`
- **Amount ›** shows **P.Rate | Disc%** (the order's, sky tint); **GST Amt ›** shows **GST% | CGST% | SGST%**
  (amber); **Sel.Amount ›** adds **Unit Price** (emerald). Each opens and closes on its own.
- **Ordered / Free** = what the order asked for (paid / free units); "earlier: N" under a box shows what earlier
  Stock Ins already received.
- **Received** = total arriving now; it starts at what is still due. Typing it splits into **R.Order** (paid) first,
  then **R.Free** (free); typing R.Order / R.Free shows their sum in Received. Rows with nothing received are skipped.
  Can't receive more than is still due.
- Amount = R.Order × the order's rate; GST and Total from the order's CGST / SGST — only R.Order is charged.
- **Mf.Date / Exp.Date as MM/YY.** Exp can't be a past month; Mf can't be a future month; Exp must be after Mf.
- **Sel.Amount = MRP less S.Disc %** (the selling discount), e.g. MRP 32.12, S.Disc 5 % → 30.51.
- **Unit Price = Sel.Amount ÷ the units in the pack** (Item Master Type / Unit, e.g. 30.51 ÷ 15 = 2.03).
- **Bulk fill:** tick rows (header box ticks all) → "Fill the ticked rows" bar with Batch No, Mf.Date, Exp.Date,
  Discount % and **Apply to N row(s)** – only the boxes filled are applied.

On save: stock goes up by R.Order + R.Free; each item's **selling price = its Sel.Amount**. Number: `SC-SI0001`.
**Only an Admin may edit or delete** a saved Stock In; it can't be edited or deleted once a Return or a Sale uses its
batches (it then opens read-only with the reason shown).

**List** – two tabs, plus a totals bar above and a dark **Total** row at the bottom (search: item, batch,
Stock In No, vendor):
- **Item wise**: one heading row per item (click to show / hide its batches) with batch count and totals; batch rows
  show Batch No, Exp, Stock In No (date on hover), Vendor, Quantity ("incl. N free"), the amounts, and (Admin only)
  **Edit / Delete**.
- **Date wise**: one heading row per date; each Stock In's rows grouped as one block with its Stock In No + vendor +
  order no, and (Admin only) one **Edit / Delete** in merged cells.
- Amounts per row, each with its single-quantity amount under it in small grey text ("₹24.25 / 1"):
  Buy Amount = paid Qty × Rate; Sale Amount = Qty × MRP; Discount Amount = S.Disc % of Sale Amount;
  Net Sale Amount = Qty × Sel.Amount (Qty includes free units).

## 5. Return

Goods sent back to the vendor from one Stock In. **Reduces stock.**

**Master** – top row: Vendor Name\*, Stock In No\* ("SC-SI0001 · date · PO no"), Date\*.
Table: Item Name | Batch No | Mf.Date | Exp.Date | Cur.Rate | Received | Returned (earlier) | **Return Qty** |
Amount (= Qty × Cur.Rate), Sum of Total. Return Qty can't exceed Received − Returned (a line with nothing left is
disabled); stock can't go below zero. Edits apply the difference. Number: `SC-RT0001`.

**List**: Return No, Date, Vendor, Stock In No, Item Name (all items, comma-separated), Items, Total Qty, Amount,
Edit; search also by item name.

## 6. Sales (counter sale)

**Master** – first row: Date\*, Customer Name\*, Mobile No.

Table (compact, fits the screen):
`# | Item Name | Batch | Sell by | Rack | Box | Stock | MRP | Purchase Price | Sale Price | Quantity | Disc% | Amount | + / bin`
- **Batch** lists only the item's batches with stock left, **earliest expiry first** ("12345 · Exp 02/28 · 8"); the
  first is chosen automatically. Batch stock = received − returned − sold.
- **Sell by**: **Pack (15)** or **Unit** (one piece; only when the item's Type / Unit count is more than 1). Stock,
  MRP, Purchase Price and Sale Price are shown per pack or per unit to match; stock is counted in packs, so 5 units of
  a 15's pack take 0.3333 pack.
- **MRP** and **Purchase Price** (P.Rate less Disc %) come from the batch's own Stock In (the item's for older
  batches); Rack / Box from the item (small blue tags).
- **Sale Price** = the batch's Sel.Amount (editable, not above the batch's MRP).
- **Disc%** per row: **Amount = Quantity × Sale Price less Disc %**.
- Footer: **Sub Total** (Σ Amount), **Bill Discount %** box with the amount taken off, **TOTAL** = Sub Total less
  Bill Discount.
- **Checks** (screen and server):
  - Quantity ≤ batch stock — "Only N in stock" (lines selling from the same batch count together).
  - Sale Price ≤ MRP; Disc % and Bill Discount % 0 – 100.
  - **No selling below cost:** each row's Amount ≥ Quantity × Purchase Price ("Below cost …"), and the bill's
    TOTAL ≥ the sum of the rows' purchase cost ("Total is below the purchase cost … — lower the Bill Discount").
  - Any red box disables Save.
- **Quick billing keyboard:** pick the item (type + Enter) → the cursor goes to **Batch** → Enter → **Sell by** →
  Enter → **Quantity** → Enter → **Disc%** → Enter → the next row's Item Name (a row is added if needed). On Batch and
  Sell by, **↑ / ↓ change the choice** (prices and stock update); ← → still reach Sale Price and the buttons. A short
  hint under the table says this. Goal: 5 – 7 items billed in a few seconds.
- **Speed:** each item's batch list is fetched once per bill and reused (cleared after a save); the database has
  indexes on the item column of every received / returned / sold line table.
- **Save** and **Save & Print** (Update & Print when editing): Save & Print saves, then opens the print dialog with
  the receipt; after an edit it returns to the list when printing is done. After a plain Save a bar offers **Print**.
- **Receipt:** clinic name / contact / address, bill no, customer, date, then Item ("(unit)" for unit sales),
  Batch, Qty, Rate, Disc% (only when used), Amount; Sub Total and Discount (N %) rows only when a bill discount was
  given; Total.
- Number: `SC-S0001`.

**List**: Sale No, Date, Customer, Mobile, Item Name, Total Qty, Amount, Edit, Print (reprints the receipt);
total of all sales in the subtitle.

## 7. Reports

**Stock Report** (item-wise): Item Code | Item Name | Category | Pack | Opening | Stock In | Return | Sold |
Adjustment | **Current Stock** | Sell Price | Stock Value, Total row.
- Opening + Stock In − Return − Sold + Adjustment = Current Stock; Stock Value = Current Stock × selling price.
- Filters: search (name, code, generic), category, Show: items with stock history (default) / in stock only /
  out of stock / all items. Stock In green, Return / Sold red, Current Stock shaded, out-of-stock rows grey.
- Click an item → its stock history opens under the row: Date & Time, Type (coloured tag), Details, Vendor,
  Change (+/−), Stock after, By.

**Vendor Payments**: per vendor (name · mobile): Stock In count | Amount | GST | **Stock In Total** | Return count |
**Return Total** | **Net Payable**, Total row; From / To date filter (empty = all time).
- Stock In Amount = **paid units only** × Rate (free units aren't charged); GST from the order line's CGST + SGST %;
  Return uses the GST % of the Stock In line it came from; Net Payable = Stock In Total − Return Total.
- Click a vendor → its Stock Ins and Returns under the row (returns shown as −); clicking a line opens it.

## Database (safe to run again: create / alter only when missing)

- Lists: generic, manufacturer, unit, category, potency masters.
- Items: item_code, pack, unit (count per pack), rack, box, cgst_percent, sgst_percent, potency, mrp, sell_price,
  purchase_rate.
- Vendors: address, state, pincode, phone, mobile, gstin, dl_no1, dl_no2.
- `purchase_orders` / `purchase_order_items`: item details copied; unit, mrp, p_rate, free_qty, disc_percent, rate,
  qty, amount, cgst, sgst, gst_percent, gst_amount, total.
- `stock_ins` / `stock_in_items`: po_item_id, batch_no, mfg_date, exp_date, quantity (paid), free_qty, rate, mrp,
  disc_percent, sel_amount.
- `stock_returns` / `stock_return_items`: stock_in_item_id, batch and dates copied, qty, rate, amount.
- `sales`: customer_name, mobile, sub_total, disc_percent, discount_amount, total_amount, created_by.
- `sale_items`: item, batch, expiry, quantity (in packs, 4 decimals), sale_unit (pack / unit), unit_qty (as typed),
  pack_size, rate, disc_percent, amount.
- `stock_movements`: opening stock and adjustments only (item, qty change, balance after, reason, ref, note, user,
  time).
- Indexes on the item column of stock_in_items, stock_return_items, sale_items (and any older purchase / inward /
  return line tables) for the batch stock lookup.

## Done means

- Every screen above works on desktop and narrower screens and fits a 1280 px screen without sideways scroll.
- Stock is right after any mix of Stock In, Return, Sale and edits (check it against the Stock Report history).
- All server-side checks refuse bad input with a clear message and save nothing.
- A counter sale of 5 – 7 items can be keyed in a few seconds with the keyboard only.
