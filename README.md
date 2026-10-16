# SmartClinic (Ayush Pro) – Multi-branch

Two-level clinic management:

- **Main Clinic** (Super Admin / Admin): dashboard of all branches, employee registration, clinic / pharmacy / lab generation.
- **Branch clinics** (Clinic A, Clinic B, …): same menu everywhere – Registration, Patient & Queue, Doctor, Pharmacy, Billing.

Patient flow: **Patient Registration → Confirm & Search (token) → Doctor Examine → Pharmacy Dispense (stock reduces) → Patient Bill (print / PDF)**

```
database/schema.sql      MySQL 8 schema (16 tables)
shared/permissions.js    role → permission matrix, used by API and UI
backend/                 Node 20 API + web server (built-in modules, bundled mysql2)
frontend/                React 18 UI (pre-built in dist/), English / தமிழ், mobile-responsive
```

## Setup

Needs only **Node.js 20+** and **MySQL 8** (or XAMPP MariaDB). No `npm install`: the web pages are pre-built in `frontend/dist`, and the backend uses Node's built-in modules plus the MySQL driver bundled in `backend/node_modules`.

**Windows:** double-click `start-windows.bat`.
- On the first run, Notepad opens `backend\.env`. Set `DB_USER` and `DB_PASSWORD`, save, and close it. The launcher then creates the database and demo data.
- It then starts SmartClinic and opens **http://localhost:5180**. Keep the window open while you use the app.
- To use another port, edit `set APP_PORT=5180` at the top of the file.

**Any OS (manual):**
```bash
cd backend
cp .env.example .env            # set DB_USER / DB_PASSWORD
node scripts/init-db.js         # create database + tables
node scripts/seed.js            # Super Admin + demo clinics
node src/server.js              # http://localhost:5180
```

Log in with `superadmin` / `ChangeMe@123` (from `SEED_ADMIN_*` in `.env`). With `SEED_DEMO=1` you also get Clinic A (CLA), Clinic B (CLB) and Clinic A staff `cla.reception`, `cla.doctor`, `cla.pharmacy`, `cla.billing` (password `Demo@123`).

**Editing the UI:** `cd frontend && npm install && npm run dev` starts Vite on :5181 with hot reload (it forwards `/api` to the server on :5180). Run `npm run build` to refresh `frontend/dist`.

**Production:** run `node backend/src/server.js` with `NODE_ENV=production` and a long random `JWT_SECRET`, behind your web server (it serves both the pages and `/api`). Set MySQL (or `DB_TIME_ZONE`) to `+05:30` so "today" matches the clinic.

## How clinic isolation works

- Every operational row (patient, employee, queue, visit, prescription, item, supplier, stock movement, issue, bill, bill line) has `clinic_id`.
- `clinicScope()` middleware (`backend/src/middleware/access.js`) sets `req.clinicId` for each request:
  - **Branch users** always get their own `clinic_id`. Any `X-Clinic-Id` they send is ignored.
  - **Super Admin / Admin** have `clinic_id = NULL` and pick a clinic in the top-bar switcher. The UI sends it as `X-Clinic-Id`. Branch menus stay hidden until a clinic is picked.
- Every branch query filters `WHERE clinic_id = ?`. Updates use `WHERE id = ? AND clinic_id = ?`, so an ID from another clinic returns 404.
- Patient IDs, bill numbers, employee codes and daily tokens come from `code_sequences`, locked inside the same transaction as the insert. They are unique per clinic even under concurrent use: `CLA-0001`, `CLA-B0001`, `CLA-E001`, and token 1, 2, 3… per clinic per day.

## Roles

Defined in `shared/permissions.js`. The API enforces them; the UI hides menus and routes a role can't use.

| Menu | Super Admin | Admin | Receptionist | Doctor | Pharmacist | Billing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Dashboard, Clinic / Pharmacy / Lab Generation | ✓ | ✓ | | | | |
| Employee Registration | ✓ (incl. admins) | ✓ (not admins) | | | | |
| Patient Registration | ✓ | ✓ | | | | |
| Patient List (view) / edit | ✓ | ✓ | ✓ / ✓ | ✓ / – | ✓ / – | ✓ / – |
| Employee List | ✓ | ✓ | ✓ | | | |
| Confirm & Search | ✓ | ✓ | ✓ | | | |
| Confirm List | ✓ | ✓ | ✓ | ✓ | | ✓ |
| Examine, Patient History | ✓ | ✓ | | ✓ | | |
| Item, Supplier, Stock in, Dispense | ✓ | ✓ | | | ✓ | |
| Item List | ✓ | ✓ | | ✓ | ✓ | |
| Patient Bill, Bill List | ✓ | ✓ | | | | ✓ |
| Cancel bill | ✓ | ✓ | | | | |

Per the requirement, only Admin / Super Admin can create branches, employees and patients. If receptionists should register patients, add `'patient.create'` to `receptionist` in `shared/permissions.js`.

## Database (database/schema.sql)

| Table | Purpose |
|---|---|
| `clinics` | branches: name, unique `code`, address, phone, default consultation fee, status |
| `pharmacies`, `labs` | units, each linked to a clinic |
| `employees` | staff + login (username, bcrypt hash), role, assigned clinic / pharmacy / lab. CHECKs: admins have no clinic, everyone else has one |
| `code_sequences` | per-clinic counters (patient, bill, employee, `token:YYYY-MM-DD`) |
| `patients` | `UNIQUE(clinic_id, patient_code)` |
| `queue_entries` | daily token + status `waiting → with_doctor → done` (or `cancelled`), `UNIQUE(clinic_id, queue_date, token_no)` |
| `visits` | doctor examination: complaints, notes, diagnosis, vitals (JSON), advice, follow-up, fee |
| `prescriptions` | medicine lines per visit; `item_id` links to stock (free text allowed); tracks `issued_qty` |
| `items` | stock per clinic: name, category, unit, price, GST %, `stock_qty` (CHECK ≥ 0), reorder level |
| `suppliers` | per clinic |
| `stock_movements` | ledger of every stock change (opening, purchase, issue, adjustment, return) |
| `pharmacy_issues`, `pharmacy_issue_items` | medicines handed over against a visit |
| `bills`, `bill_items` | `UNIQUE(clinic_id, bill_no)`; lines = consultation + issued medicines + other charges |

## API

All routes are under `/api`, return JSON, and need `Authorization: Bearer <token>` except login. Admins add `X-Clinic-Id` for branch routes.

**Auth** – `POST /auth/login`, `GET /auth/me`, `POST /auth/change-password`

**Main Clinic**
- `GET /dashboard/summary?date=` – per-branch patients, today's queue by status, billing today / month, low stock
- `GET|POST /clinics`, `GET|PUT /clinics/:id` – the code can't change once patients exist
- `GET|POST /pharmacies`, `GET|PUT /pharmacies/:id`, and the same for `/labs` (`?clinic_id=` filter)
- `GET /employees?clinic_id=|all|main&role=&q=&page=`, `POST /employees`, `GET|PUT /employees/:id`

**Registration** – `GET /patients?q=&page=`, `POST /patients` (409 `POSSIBLE_DUPLICATE` on same name + mobile; resend with `force: true`), `GET|PUT /patients/:id`

**Patient & Queue** – `GET /queue/search?q=`, `GET /queue/doctors`, `POST /queue {patient_id, visit_type, doctor_id}`, `GET /queue?date=&status=`, `PATCH /queue/:id/status {status}`

**Doctor** – `POST /visits/start {queue_id}`, `GET /visits/:id`, `PUT /visits/:id {…, prescriptions:[…], complete}`, `GET /visits/patient/:patientId`

**Pharmacy** – `GET /items?q=&category=&low_stock=1`, `GET /items/categories`, `POST /items` (with `opening_stock`), `GET|PUT /items/:id`, `POST /items/:id/stock {qty, reason, supplier_id}`, `GET /items/:id/movements`, `GET|POST /suppliers`, `GET|PUT /suppliers/:id`, `GET /dispense/pending?date=`, `GET|POST /dispense/visit/:visitId`

**Billing** – `GET /bills/pending?date=`, `GET /bills/draft/:visitId`, `POST /bills {visit_id, extra_lines, discount, paid_amount, payment_mode}`, `GET /bills?from=&to=&q=`, `GET /bills/:id`, `POST /bills/:id/cancel`

Bill amounts are always recomputed on the server from the visit fee and the issued items. The client never sends prices for those. Item prices are treated as tax-inclusive (MRP).

## Language

All menus and labels live in `frontend/src/i18n/en.js` and `ta.js` (same keys). The EN / தமிழ் toggle is in the top bar and on the login page, and the choice is remembered. A key missing in Tamil falls back to English.

## Tests

`cd backend && node --test` runs unit tests for the built-in router, login tokens and passwords, and for the permission matrix, code formats, dates (IST) and the clinic-scope / permission middleware.
