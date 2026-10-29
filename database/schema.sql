/* =====================================================================
   SmartClinic (Ayush Pro) – Multi-branch database schema
   Microsoft SQL Server 2016+  (database: T_multi_branch)

   Run with:  node backend/scripts/init-db.js   (or paste into SSMS)
   Safe to run again: every table / index is created only if missing.

   Rules of the schema
   - Every operational record carries clinic_id. Branch users are always
     filtered to their own clinic_id by the API. Super Admin / Admin have
     clinic_id = NULL on their employee row and may open any clinic.
   - Text columns are NVARCHAR so Tamil is stored correctly.
   - Timestamps default to India time (UTC + 5:30), independent of the
     server's own time zone.
   ===================================================================== */

/* ---------- 1. MAIN CLINIC LEVEL: branches, pharmacies, labs ---------- */
IF OBJECT_ID(N'dbo.clinics', N'U') IS NULL
CREATE TABLE dbo.clinics (
  id               INT IDENTITY(1,1) PRIMARY KEY,
  name             NVARCHAR(150) NOT NULL,
  code             NVARCHAR(10)  NOT NULL CONSTRAINT uq_clinics_code UNIQUE,   -- CLA → patient IDs CLA-0001
  address          NVARCHAR(500) NULL,
  city             NVARCHAR(100) NULL,
  phone            NVARCHAR(20)  NULL,
  email            NVARCHAR(150) NULL,
  consultation_fee DECIMAL(10,2) NOT NULL DEFAULT 0,                           -- pre-filled in Examine
  status           NVARCHAR(10)  NOT NULL DEFAULT N'active' CONSTRAINT chk_clinics_status CHECK (status IN (N'active', N'inactive')),
  created_by       INT NULL,
  created_at       DATETIME2(0) NOT NULL DEFAULT DATEADD(MINUTE, 330, SYSUTCDATETIME()),
  updated_at       DATETIME2(0) NOT NULL DEFAULT DATEADD(MINUTE, 330, SYSUTCDATETIME())
);
GO

IF OBJECT_ID(N'dbo.pharmacies', N'U') IS NULL
CREATE TABLE dbo.pharmacies (
  id          INT IDENTITY(1,1) PRIMARY KEY,
  clinic_id   INT NOT NULL CONSTRAINT fk_pharmacies_clinic REFERENCES dbo.clinics(id),
  name        NVARCHAR(150) NOT NULL,
  code        NVARCHAR(10)  NOT NULL CONSTRAINT uq_pharmacies_code UNIQUE,
  address     NVARCHAR(500) NULL,
  phone       NVARCHAR(20)  NULL,
  license_no  NVARCHAR(60)  NULL,
  status      NVARCHAR(10)  NOT NULL DEFAULT N'active' CONSTRAINT chk_pharmacies_status CHECK (status IN (N'active', N'inactive')),
  created_by  INT NULL,
  created_at  DATETIME2(0) NOT NULL DEFAULT DATEADD(MINUTE, 330, SYSUTCDATETIME()),
  updated_at  DATETIME2(0) NOT NULL DEFAULT DATEADD(MINUTE, 330, SYSUTCDATETIME())
);
GO

IF OBJECT_ID(N'dbo.labs', N'U') IS NULL
CREATE TABLE dbo.labs (
  id          INT IDENTITY(1,1) PRIMARY KEY,
  clinic_id   INT NOT NULL CONSTRAINT fk_labs_clinic REFERENCES dbo.clinics(id),
  name        NVARCHAR(150) NOT NULL,
  code        NVARCHAR(10)  NOT NULL CONSTRAINT uq_labs_code UNIQUE,
  address     NVARCHAR(500) NULL,
  phone       NVARCHAR(20)  NULL,
  status      NVARCHAR(10)  NOT NULL DEFAULT N'active' CONSTRAINT chk_labs_status CHECK (status IN (N'active', N'inactive')),
  created_by  INT NULL,
  created_at  DATETIME2(0) NOT NULL DEFAULT DATEADD(MINUTE, 330, SYSUTCDATETIME()),
  updated_at  DATETIME2(0) NOT NULL DEFAULT DATEADD(MINUTE, 330, SYSUTCDATETIME())
);
GO

/* ---------- 2. EMPLOYEES (also the login table) ----------
   super_admin / admin → clinic_id NULL, unit_type 'main'
   everyone else       → clinic_id required; unit = clinic / pharmacy / lab */
IF OBJECT_ID(N'dbo.employees', N'U') IS NULL
CREATE TABLE dbo.employees (
  id             INT IDENTITY(1,1) PRIMARY KEY,
  clinic_id      INT NULL CONSTRAINT fk_employees_clinic REFERENCES dbo.clinics(id),
  unit_type      NVARCHAR(10) NOT NULL DEFAULT N'clinic' CONSTRAINT chk_employees_unit_type CHECK (unit_type IN (N'main', N'clinic', N'pharmacy', N'lab')),
  pharmacy_id    INT NULL CONSTRAINT fk_employees_pharmacy REFERENCES dbo.pharmacies(id),
  lab_id         INT NULL CONSTRAINT fk_employees_lab REFERENCES dbo.labs(id),
  emp_code       NVARCHAR(20)  NOT NULL CONSTRAINT uq_employees_code UNIQUE,   -- ADM-001 / CLA-E001
  name           NVARCHAR(150) NOT NULL,
  gender         NCHAR(1)      NULL CONSTRAINT chk_employees_gender CHECK (gender IN (N'M', N'F', N'O')),
  dob            DATE NULL,
  mobile         NVARCHAR(20)  NULL,
  email          NVARCHAR(150) NULL,
  designation    NVARCHAR(100) NULL,
  qualification  NVARCHAR(150) NULL,
  address        NVARCHAR(500) NULL,
  join_date      DATE NULL,
  role           NVARCHAR(20) NOT NULL CONSTRAINT chk_employees_role CHECK (role IN (N'super_admin', N'admin', N'receptionist', N'doctor', N'pharmacist', N'billing')),
  username       NVARCHAR(60)  NULL,                                          -- unique when set (index below)
  password_hash  NVARCHAR(100) NULL,
  can_login      BIT NOT NULL DEFAULT 1,
  status         NVARCHAR(10)  NOT NULL DEFAULT N'active' CONSTRAINT chk_employees_status CHECK (status IN (N'active', N'inactive')),
  last_login_at  DATETIME2(0) NULL,
  created_by     INT NULL,
  created_at     DATETIME2(0) NOT NULL DEFAULT DATEADD(MINUTE, 330, SYSUTCDATETIME()),
  updated_at     DATETIME2(0) NOT NULL DEFAULT DATEADD(MINUTE, 330, SYSUTCDATETIME()),
  CONSTRAINT chk_employees_scope CHECK (
    (role IN (N'super_admin', N'admin') AND clinic_id IS NULL AND unit_type = N'main')
    OR (role NOT IN (N'super_admin', N'admin') AND clinic_id IS NOT NULL AND unit_type <> N'main')
  ),
  CONSTRAINT chk_employees_unit CHECK (
    (unit_type = N'pharmacy' AND pharmacy_id IS NOT NULL) OR
    (unit_type = N'lab' AND lab_id IS NOT NULL) OR
    (unit_type IN (N'main', N'clinic'))
  )
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'uq_employees_username' AND object_id = OBJECT_ID(N'dbo.employees'))
  CREATE UNIQUE INDEX uq_employees_username ON dbo.employees(username) WHERE username IS NOT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_employees_clinic_role' AND object_id = OBJECT_ID(N'dbo.employees'))
  CREATE INDEX ix_employees_clinic_role ON dbo.employees(clinic_id, role);
GO

/* User-wise access (Main Clinic → Menu Permission): only the differences from the
   employee's role defaults are stored. granted = 1 adds a permission, 0 removes it. */
IF OBJECT_ID(N'dbo.employee_permissions', N'U') IS NULL
CREATE TABLE dbo.employee_permissions (
  employee_id  INT NOT NULL CONSTRAINT fk_emp_perm_employee REFERENCES dbo.employees(id),
  permission   NVARCHAR(40) NOT NULL,
  granted      BIT NOT NULL,
  updated_by   INT NULL CONSTRAINT fk_emp_perm_by REFERENCES dbo.employees(id),
  updated_at   DATETIME2(0) NOT NULL DEFAULT DATEADD(MINUTE, 330, SYSUTCDATETIME()),
  CONSTRAINT pk_employee_permissions PRIMARY KEY (employee_id, permission)
);
GO

/* Doctor time slots: several rows per doctor, each with an optional break inside start–end.
   Saved together with the employee (the whole list is replaced on every save). */
IF OBJECT_ID(N'dbo.doctor_time_slots', N'U') IS NULL
CREATE TABLE dbo.doctor_time_slots (
  id            INT IDENTITY(1,1) PRIMARY KEY,
  clinic_id     INT NOT NULL CONSTRAINT fk_slots_clinic REFERENCES dbo.clinics(id),
  employee_id   INT NOT NULL CONSTRAINT fk_slots_employee REFERENCES dbo.employees(id),
  start_time    TIME(0) NOT NULL,
  end_time      TIME(0) NOT NULL,
  slot_minutes  SMALLINT NOT NULL CONSTRAINT chk_slots_minutes CHECK (slot_minutes BETWEEN 5 AND 480),   -- one appointment
  break_start   TIME(0) NULL,
  break_end     TIME(0) NULL,
  created_at    DATETIME2(0) NOT NULL DEFAULT DATEADD(MINUTE, 330, SYSUTCDATETIME()),
  CONSTRAINT chk_slots_order CHECK (end_time > start_time),
  CONSTRAINT chk_slots_break CHECK (
    (break_start IS NULL AND break_end IS NULL)
    OR (break_start >= start_time AND break_end > break_start AND break_end <= end_time)
  )
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_slots_employee' AND object_id = OBJECT_ID(N'dbo.doctor_time_slots'))
  CREATE INDEX ix_slots_employee ON dbo.doctor_time_slots(employee_id, start_time);
GO

/* ---------- 3. PER-CLINIC NUMBER SEQUENCES ----------
   seq_key: 'patient', 'bill', 'employee', 'token:2026-10-16'; clinic_id 0 = global */
IF OBJECT_ID(N'dbo.code_sequences', N'U') IS NULL
CREATE TABLE dbo.code_sequences (
  clinic_id   INT NOT NULL,
  seq_key     NVARCHAR(30) NOT NULL,
  last_value  INT NOT NULL DEFAULT 0,
  updated_at  DATETIME2(0) NOT NULL DEFAULT DATEADD(MINUTE, 330, SYSUTCDATETIME()),
  CONSTRAINT pk_code_sequences PRIMARY KEY (clinic_id, seq_key)
);
GO

/* ---------- 4. PATIENTS ---------- */
IF OBJECT_ID(N'dbo.patients', N'U') IS NULL
CREATE TABLE dbo.patients (
  id            INT IDENTITY(1,1) PRIMARY KEY,
  clinic_id     INT NOT NULL CONSTRAINT fk_patients_clinic REFERENCES dbo.clinics(id),
  patient_code  NVARCHAR(20)  NOT NULL,                                       -- CLA-0001 (unique per clinic)
  name          NVARCHAR(150) NOT NULL,
  gender        NCHAR(1)      NULL CONSTRAINT chk_patients_gender CHECK (gender IN (N'M', N'F', N'O')),
  dob           DATE NULL,
  age_years     TINYINT NULL,
  mobile        NVARCHAR(20)  NOT NULL,
  alt_mobile    NVARCHAR(20)  NULL,
  email         NVARCHAR(150) NULL,
  address       NVARCHAR(500) NULL,
  city          NVARCHAR(100) NULL,
  blood_group   NVARCHAR(5)   NULL,
  occupation    NVARCHAR(100) NULL,
  notes         NVARCHAR(MAX) NULL,
  status        NVARCHAR(10)  NOT NULL DEFAULT N'active' CONSTRAINT chk_patients_status CHECK (status IN (N'active', N'inactive')),
  created_by    INT NULL CONSTRAINT fk_patients_creator REFERENCES dbo.employees(id),
  created_at    DATETIME2(0) NOT NULL DEFAULT DATEADD(MINUTE, 330, SYSUTCDATETIME()),
  updated_at    DATETIME2(0) NOT NULL DEFAULT DATEADD(MINUTE, 330, SYSUTCDATETIME()),
  CONSTRAINT uq_patients_clinic_code UNIQUE (clinic_id, patient_code)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_patients_clinic_mobile' AND object_id = OBJECT_ID(N'dbo.patients'))
  CREATE INDEX ix_patients_clinic_mobile ON dbo.patients(clinic_id, mobile);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_patients_clinic_name' AND object_id = OBJECT_ID(N'dbo.patients'))
  CREATE INDEX ix_patients_clinic_name ON dbo.patients(clinic_id, name);
GO

/* ---------- 5. DAILY QUEUE (Confirm & Search → Confirm List) ---------- */
IF OBJECT_ID(N'dbo.queue_entries', N'U') IS NULL
CREATE TABLE dbo.queue_entries (
  id            INT IDENTITY(1,1) PRIMARY KEY,
  clinic_id     INT NOT NULL CONSTRAINT fk_queue_clinic REFERENCES dbo.clinics(id),
  patient_id    INT NOT NULL CONSTRAINT fk_queue_patient REFERENCES dbo.patients(id),
  queue_date    DATE NOT NULL,
  token_no      SMALLINT NOT NULL,
  visit_type    NVARCHAR(10) NOT NULL DEFAULT N'new' CONSTRAINT chk_queue_visit_type CHECK (visit_type IN (N'new', N'follow_up')),
  status        NVARCHAR(12) NOT NULL DEFAULT N'waiting' CONSTRAINT chk_queue_status CHECK (status IN (N'waiting', N'with_doctor', N'done', N'cancelled')),
  doctor_id     INT NULL CONSTRAINT fk_queue_doctor REFERENCES dbo.employees(id),
  confirmed_by  INT NULL CONSTRAINT fk_queue_by REFERENCES dbo.employees(id),
  confirmed_at  DATETIME2(0) NOT NULL DEFAULT DATEADD(MINUTE, 330, SYSUTCDATETIME()),
  called_at     DATETIME2(0) NULL,
  completed_at  DATETIME2(0) NULL,
  CONSTRAINT uq_queue_token UNIQUE (clinic_id, queue_date, token_no)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_queue_patient' AND object_id = OBJECT_ID(N'dbo.queue_entries'))
  CREATE INDEX ix_queue_patient ON dbo.queue_entries(clinic_id, patient_id, queue_date);
GO
/* Tokens: a queue entry booked into one of the doctor's time slots (start time of the slot). */
IF COL_LENGTH(N'dbo.queue_entries', N'slot_time') IS NULL
  ALTER TABLE dbo.queue_entries ADD slot_time TIME(0) NULL;
GO
-- one patient per doctor per slot per day (a cancelled entry frees its slot)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'uq_queue_doctor_slot' AND object_id = OBJECT_ID(N'dbo.queue_entries'))
  CREATE UNIQUE INDEX uq_queue_doctor_slot ON dbo.queue_entries(clinic_id, queue_date, doctor_id, slot_time)
    WHERE slot_time IS NOT NULL AND status <> N'cancelled';
GO
/* Token confirm: a patient booked from Tokens is confirmed at reception when they arrive (arrived_at);
   only then can vital signs be recorded. Walk-ins from Confirm & Search are present already, so they
   arrive when confirmed (existing walk-in rows are filled in once, when the column is added). */
IF COL_LENGTH(N'dbo.queue_entries', N'arrived_at') IS NULL
BEGIN
  ALTER TABLE dbo.queue_entries ADD
    arrived_at DATETIME2(0) NULL,
    arrived_by INT NULL CONSTRAINT fk_queue_arrived_by REFERENCES dbo.employees(id);
  EXEC(N'UPDATE dbo.queue_entries SET arrived_at = confirmed_at, arrived_by = confirmed_by WHERE slot_time IS NULL');
END
GO

/* Vital signs: the next step after a patient is confirmed into the queue (one record per queue entry).
   Recorded at reception, can be edited later (also by the doctor in Examine). */
IF OBJECT_ID(N'dbo.patient_vitals', N'U') IS NULL
CREATE TABLE dbo.patient_vitals (
  id             INT IDENTITY(1,1) PRIMARY KEY,
  clinic_id      INT NOT NULL CONSTRAINT fk_vitals_clinic REFERENCES dbo.clinics(id),
  queue_id       INT NOT NULL CONSTRAINT fk_vitals_queue REFERENCES dbo.queue_entries(id)
                     CONSTRAINT uq_vitals_queue UNIQUE,
  patient_id     INT NOT NULL CONSTRAINT fk_vitals_patient REFERENCES dbo.patients(id),
  height_cm      DECIMAL(4,1) NULL CONSTRAINT chk_vitals_height CHECK (height_cm BETWEEN 30 AND 250),
  weight_kg      DECIMAL(4,1) NULL CONSTRAINT chk_vitals_weight CHECK (weight_kg BETWEEN 0.5 AND 300),
  bp_systolic    SMALLINT NULL CONSTRAINT chk_vitals_sys CHECK (bp_systolic BETWEEN 50 AND 260),
  bp_diastolic   SMALLINT NULL CONSTRAINT chk_vitals_dia CHECK (bp_diastolic BETWEEN 30 AND 160),
  pulse_bpm      SMALLINT NULL CONSTRAINT chk_vitals_pulse CHECK (pulse_bpm BETWEEN 30 AND 220),
  temperature_f  DECIMAL(4,1) NULL CONSTRAINT chk_vitals_temp_f CHECK (temperature_f BETWEEN 86 AND 113),
  comments       NVARCHAR(500) NULL,
  recorded_by    INT NULL CONSTRAINT fk_vitals_by REFERENCES dbo.employees(id),
  recorded_at    DATETIME2(0) NOT NULL DEFAULT DATEADD(MINUTE, 330, SYSUTCDATETIME()),
  updated_by     INT NULL CONSTRAINT fk_vitals_updated_by REFERENCES dbo.employees(id),
  updated_at     DATETIME2(0) NULL,
  CONSTRAINT chk_vitals_bp CHECK ((bp_systolic IS NULL AND bp_diastolic IS NULL) OR (bp_diastolic < bp_systolic))
);
GO
/* Temperature is recorded in °F: an older table with temperature_c is converted once
   (°C × 9/5 + 32, one decimal) and the °C column is removed. */
IF COL_LENGTH(N'dbo.patient_vitals', N'temperature_f') IS NULL
BEGIN
  ALTER TABLE dbo.patient_vitals ADD
    temperature_f DECIMAL(4,1) NULL CONSTRAINT chk_vitals_temp_f CHECK (temperature_f BETWEEN 86 AND 113);
  IF COL_LENGTH(N'dbo.patient_vitals', N'temperature_c') IS NOT NULL
  BEGIN
    EXEC(N'UPDATE dbo.patient_vitals SET temperature_f = ROUND(temperature_c * 9.0 / 5 + 32, 1) WHERE temperature_c IS NOT NULL');
    IF OBJECT_ID(N'dbo.chk_vitals_temp', N'C') IS NOT NULL ALTER TABLE dbo.patient_vitals DROP CONSTRAINT chk_vitals_temp;
    ALTER TABLE dbo.patient_vitals DROP COLUMN temperature_c;
  END
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_vitals_patient' AND object_id = OBJECT_ID(N'dbo.patient_vitals'))
  CREATE INDEX ix_vitals_patient ON dbo.patient_vitals(clinic_id, patient_id);
GO
/* Lab reports & scans uploaded with the vital signs (Photo or PDF, max 5 MB – rules in shared/attachments.js).
   Kept per patient and queue entry (that day's visit); the file itself is stored in `data`. */
IF OBJECT_ID(N'dbo.patient_attachments', N'U') IS NULL
CREATE TABLE dbo.patient_attachments (
  id           INT IDENTITY(1,1) PRIMARY KEY,
  clinic_id    INT NOT NULL CONSTRAINT fk_attach_clinic REFERENCES dbo.clinics(id),
  patient_id   INT NOT NULL CONSTRAINT fk_attach_patient REFERENCES dbo.patients(id),
  queue_id     INT NULL CONSTRAINT fk_attach_queue REFERENCES dbo.queue_entries(id),
  file_type    NVARCHAR(10) NOT NULL CONSTRAINT chk_attach_type CHECK (file_type IN (N'photo', N'pdf')),
  category     NVARCHAR(60) NULL,
  file_name    NVARCHAR(200) NOT NULL,
  mime_type    NVARCHAR(100) NOT NULL,
  size_bytes   INT NOT NULL CONSTRAINT chk_attach_size CHECK (size_bytes BETWEEN 1 AND 5242880),
  data         VARBINARY(MAX) NOT NULL,
  uploaded_by  INT NULL CONSTRAINT fk_attach_by REFERENCES dbo.employees(id),
  uploaded_at  DATETIME2(0) NOT NULL DEFAULT DATEADD(MINUTE, 330, SYSUTCDATETIME())
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_attach_patient' AND object_id = OBJECT_ID(N'dbo.patient_attachments'))
  CREATE INDEX ix_attach_patient ON dbo.patient_attachments(clinic_id, patient_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_attach_queue' AND object_id = OBJECT_ID(N'dbo.patient_attachments'))
  CREATE INDEX ix_attach_queue ON dbo.patient_attachments(queue_id);
GO

/* ---------- 6. DOCTOR: visits ---------- */
IF OBJECT_ID(N'dbo.visits', N'U') IS NULL
CREATE TABLE dbo.visits (
  id                INT IDENTITY(1,1) PRIMARY KEY,
  clinic_id         INT NOT NULL CONSTRAINT fk_visits_clinic REFERENCES dbo.clinics(id),
  patient_id        INT NOT NULL CONSTRAINT fk_visits_patient REFERENCES dbo.patients(id),
  queue_id          INT NULL CONSTRAINT fk_visits_queue REFERENCES dbo.queue_entries(id),   -- unique when set (index below)
  doctor_id         INT NULL CONSTRAINT fk_visits_doctor REFERENCES dbo.employees(id),
  visit_date        DATETIME2(0) NOT NULL DEFAULT DATEADD(MINUTE, 330, SYSUTCDATETIME()),
  complaints        NVARCHAR(MAX) NULL,
  examination_notes NVARCHAR(MAX) NULL,
  diagnosis         NVARCHAR(MAX) NULL,
  vitals            NVARCHAR(MAX) NULL,                                       -- JSON: {"bp":"120/80","pulse":72,...}
  advice            NVARCHAR(MAX) NULL,
  follow_up_date    DATE NULL,
  consultation_fee  DECIMAL(10,2) NOT NULL DEFAULT 0,
  status            NVARCHAR(10) NOT NULL DEFAULT N'open' CONSTRAINT chk_visits_status CHECK (status IN (N'open', N'completed')),
  created_at        DATETIME2(0) NOT NULL DEFAULT DATEADD(MINUTE, 330, SYSUTCDATETIME()),
  updated_at        DATETIME2(0) NOT NULL DEFAULT DATEADD(MINUTE, 330, SYSUTCDATETIME())
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'uq_visits_queue' AND object_id = OBJECT_ID(N'dbo.visits'))
  CREATE UNIQUE INDEX uq_visits_queue ON dbo.visits(queue_id) WHERE queue_id IS NOT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_visits_patient' AND object_id = OBJECT_ID(N'dbo.visits'))
  CREATE INDEX ix_visits_patient ON dbo.visits(clinic_id, patient_id, visit_date);
GO

/* ---------- 7. PHARMACY: items ---------- */
IF OBJECT_ID(N'dbo.items', N'U') IS NULL
CREATE TABLE dbo.items (
  id             INT IDENTITY(1,1) PRIMARY KEY,
  clinic_id      INT NOT NULL CONSTRAINT fk_items_clinic REFERENCES dbo.clinics(id),
  pharmacy_id    INT NULL CONSTRAINT fk_items_pharmacy REFERENCES dbo.pharmacies(id),
  name           NVARCHAR(200) NOT NULL,
  category       NVARCHAR(100) NULL,                                          -- Dilution / Mother tincture / Tablet ...
  unit           NVARCHAR(30)  NOT NULL DEFAULT N'nos',
  price          DECIMAL(10,2) NOT NULL DEFAULT 0,
  gst_percent    DECIMAL(5,2)  NOT NULL DEFAULT 0,
  stock_qty      DECIMAL(12,2) NOT NULL DEFAULT 0 CONSTRAINT chk_items_stock CHECK (stock_qty >= 0),
  reorder_level  DECIMAL(12,2) NOT NULL DEFAULT 0,
  status         NVARCHAR(10)  NOT NULL DEFAULT N'active' CONSTRAINT chk_items_status CHECK (status IN (N'active', N'inactive')),
  created_by     INT NULL,
  created_at     DATETIME2(0) NOT NULL DEFAULT DATEADD(MINUTE, 330, SYSUTCDATETIME()),
  updated_at     DATETIME2(0) NOT NULL DEFAULT DATEADD(MINUTE, 330, SYSUTCDATETIME()),
  CONSTRAINT uq_items_clinic_name_unit UNIQUE (clinic_id, name, unit)
);
GO
/* Item details (Pharmacy → Item): type, HSN, manufacturer, supplier, generic / brand name,
   purchase rate, MRP, discount, Schedule H / H1. Price = sell price. */
IF COL_LENGTH(N'dbo.items', N'item_type') IS NULL
  ALTER TABLE dbo.items ADD item_type NVARCHAR(50) NULL;
GO
IF COL_LENGTH(N'dbo.items', N'hsn_code') IS NULL
  ALTER TABLE dbo.items ADD hsn_code NVARCHAR(20) NULL;
GO
IF COL_LENGTH(N'dbo.items', N'manufacturer') IS NULL
  ALTER TABLE dbo.items ADD manufacturer NVARCHAR(150) NULL;
GO
IF COL_LENGTH(N'dbo.items', N'supplier_id') IS NULL
  ALTER TABLE dbo.items ADD supplier_id INT NULL CONSTRAINT fk_items_supplier REFERENCES dbo.suppliers(id);
GO
IF COL_LENGTH(N'dbo.items', N'generic_name') IS NULL
  ALTER TABLE dbo.items ADD generic_name NVARCHAR(150) NULL;
GO
IF COL_LENGTH(N'dbo.items', N'brand_name') IS NULL
  ALTER TABLE dbo.items ADD brand_name NVARCHAR(150) NULL;
GO
IF COL_LENGTH(N'dbo.items', N'purchase_rate') IS NULL
  ALTER TABLE dbo.items ADD purchase_rate DECIMAL(10,2) NOT NULL CONSTRAINT df_items_purchase_rate DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.items', N'mrp') IS NULL
  ALTER TABLE dbo.items ADD mrp DECIMAL(10,2) NOT NULL CONSTRAINT df_items_mrp DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.items', N'discount_percent') IS NULL
  ALTER TABLE dbo.items ADD discount_percent DECIMAL(5,2) NOT NULL CONSTRAINT df_items_discount DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.items', N'schedule_h') IS NULL
  ALTER TABLE dbo.items ADD schedule_h BIT NOT NULL CONSTRAINT df_items_schedule_h DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.items', N'schedule_h1') IS NULL
  ALTER TABLE dbo.items ADD schedule_h1 BIT NOT NULL CONSTRAINT df_items_schedule_h1 DEFAULT 0;
GO

/* Item Code (CLA-I0001, same per-clinic sequence as patients/bills), storage location
   (Rack / Box), Pack description, and GST split into CGST / SGST (gst_percent stays the
   sum of the two, so billing / dispense keep reading one number as before). */
IF COL_LENGTH(N'dbo.items', N'item_code') IS NULL
  ALTER TABLE dbo.items ADD item_code NVARCHAR(20) NULL;
GO
IF COL_LENGTH(N'dbo.items', N'pack') IS NULL
  ALTER TABLE dbo.items ADD pack NVARCHAR(50) NULL;
GO
IF COL_LENGTH(N'dbo.items', N'rack') IS NULL
  ALTER TABLE dbo.items ADD rack NVARCHAR(50) NULL;
GO
IF COL_LENGTH(N'dbo.items', N'box') IS NULL
  ALTER TABLE dbo.items ADD box NVARCHAR(50) NULL;
GO
IF COL_LENGTH(N'dbo.items', N'cgst_percent') IS NULL
  ALTER TABLE dbo.items ADD cgst_percent DECIMAL(5,2) NOT NULL CONSTRAINT df_items_cgst DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.items', N'sgst_percent') IS NULL
  ALTER TABLE dbo.items ADD sgst_percent DECIMAL(5,2) NOT NULL CONSTRAINT df_items_sgst DEFAULT 0;
GO

-- One-time: split any pre-existing single GST % evenly into CGST / SGST, so re-saving an
-- old item (which now always sends both) does not silently zero its tax out.
UPDATE dbo.items SET cgst_percent = gst_percent / 2, sgst_percent = gst_percent / 2
  WHERE cgst_percent = 0 AND sgst_percent = 0 AND gst_percent > 0;
GO

-- One-time: give pre-existing items (added before Item Code existed) a code, numbered by id
-- within their clinic, then move each clinic's "item" sequence past what was just assigned
-- so the next new item continues cleanly from there. Only touches rows with no code yet.
IF EXISTS (SELECT 1 FROM dbo.items WHERE item_code IS NULL)
BEGIN
  ;WITH numbered AS (
    SELECT i.id, c.code AS clinic_code, ROW_NUMBER() OVER (PARTITION BY i.clinic_id ORDER BY i.id) AS rn
      FROM dbo.items i JOIN dbo.clinics c ON c.id = i.clinic_id
     WHERE i.item_code IS NULL
  )
  UPDATE i SET i.item_code = n.clinic_code + N'-I' + RIGHT(N'0000' + CAST(n.rn AS NVARCHAR(4)), 4)
    FROM dbo.items i JOIN numbered n ON n.id = i.id;

  MERGE dbo.code_sequences AS tgt
  USING (SELECT clinic_id, COUNT(*) AS n FROM dbo.items WHERE item_code IS NOT NULL GROUP BY clinic_id) AS src
    ON tgt.clinic_id = src.clinic_id AND tgt.seq_key = N'item'
  WHEN MATCHED AND tgt.last_value < src.n THEN UPDATE SET last_value = src.n
  WHEN NOT MATCHED THEN INSERT (clinic_id, seq_key, last_value) VALUES (src.clinic_id, N'item', src.n);
END
GO

/* ---------- 6b. DOCTOR: prescription lines ---------- */
IF OBJECT_ID(N'dbo.prescriptions', N'U') IS NULL
CREATE TABLE dbo.prescriptions (
  id             INT IDENTITY(1,1) PRIMARY KEY,
  clinic_id      INT NOT NULL CONSTRAINT fk_rx_clinic REFERENCES dbo.clinics(id),
  visit_id       INT NOT NULL CONSTRAINT fk_rx_visit REFERENCES dbo.visits(id),
  item_id        INT NULL CONSTRAINT fk_rx_item REFERENCES dbo.items(id),      -- NULL = free-text medicine not in stock
  medicine_name  NVARCHAR(200) NOT NULL,
  dosage         NVARCHAR(100) NULL,                                           -- "4 pills"
  frequency      NVARCHAR(100) NULL,                                           -- "1-0-1"
  duration       NVARCHAR(100) NULL,                                           -- "7 days"
  quantity       DECIMAL(10,2) NOT NULL DEFAULT 1,
  instructions   NVARCHAR(300) NULL,
  issued_qty     DECIMAL(10,2) NOT NULL DEFAULT 0,
  sort_order     SMALLINT NOT NULL DEFAULT 0
);
GO

/* Dosage master (Examine → Prescription → Dosage → "+ Add"): extra dosages a clinic adds to the
   built-in list (1 Tablet, 2 Tablet, 4 Tablet). */
IF OBJECT_ID(N'dbo.dosage_master', N'U') IS NULL
CREATE TABLE dbo.dosage_master (
  id          INT IDENTITY(1,1) PRIMARY KEY,
  clinic_id   INT NOT NULL CONSTRAINT fk_dosage_clinic REFERENCES dbo.clinics(id),
  value       NVARCHAR(100) NOT NULL,
  created_by  INT NULL CONSTRAINT fk_dosage_by REFERENCES dbo.employees(id),
  created_at  DATETIME2(0) NOT NULL DEFAULT DATEADD(MINUTE, 330, SYSUTCDATETIME()),
  CONSTRAINT uq_dosage_clinic_value UNIQUE (clinic_id, value)
);
GO
-- Order in the dropdown (built-ins are 1, 2, 3); dosages added before this column existed go after them
IF COL_LENGTH(N'dbo.dosage_master', N'sort_order') IS NULL
  ALTER TABLE dbo.dosage_master ADD sort_order INT NOT NULL CONSTRAINT df_dosage_order DEFAULT 100;
GO
-- 1 = one of the defaults (1 Tablet, 2 Tablet, 4 Tablet) the clinic started with; editable like any other row
IF COL_LENGTH(N'dbo.dosage_master', N'is_default') IS NULL
  ALTER TABLE dbo.dosage_master ADD is_default BIT NOT NULL CONSTRAINT df_dosage_default DEFAULT 0;
GO

/* Potency list (Examine → Prescription → Potency): same behaviour as the dosage list. */
IF OBJECT_ID(N'dbo.potency_master', N'U') IS NULL
CREATE TABLE dbo.potency_master (
  id          INT IDENTITY(1,1) PRIMARY KEY,
  clinic_id   INT NOT NULL CONSTRAINT fk_potency_clinic REFERENCES dbo.clinics(id),
  value       NVARCHAR(100) NOT NULL,
  sort_order  INT NOT NULL CONSTRAINT df_potency_order DEFAULT 100,
  is_default  BIT NOT NULL CONSTRAINT df_potency_default DEFAULT 0,
  created_by  INT NULL CONSTRAINT fk_potency_by REFERENCES dbo.employees(id),
  created_at  DATETIME2(0) NOT NULL DEFAULT DATEADD(MINUTE, 330, SYSUTCDATETIME()),
  CONSTRAINT uq_potency_clinic_value UNIQUE (clinic_id, value)
);
GO
-- potency written on each prescription line (shown before the dosage)
IF COL_LENGTH(N'dbo.prescriptions', N'potency') IS NULL
  ALTER TABLE dbo.prescriptions ADD potency NVARCHAR(100) NULL;
GO
-- Delete in the Potency / Dosage lists hides the row (is_deleted = 1) so deleted defaults don't come back;
-- adding the same value again un-hides it.
IF COL_LENGTH(N'dbo.dosage_master', N'is_deleted') IS NULL
  ALTER TABLE dbo.dosage_master ADD is_deleted BIT NOT NULL CONSTRAINT df_dosage_deleted DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.potency_master', N'is_deleted') IS NULL
  ALTER TABLE dbo.potency_master ADD is_deleted BIT NOT NULL CONSTRAINT df_potency_deleted DEFAULT 0;
GO

/* Repetition list (Examine → Prescription → Repetition, e.g. TDS, QDS, OD, HS): same behaviour as the
   dosage list. The chosen value is saved in prescriptions.frequency. */
IF OBJECT_ID(N'dbo.repetition_master', N'U') IS NULL
CREATE TABLE dbo.repetition_master (
  id          INT IDENTITY(1,1) PRIMARY KEY,
  clinic_id   INT NOT NULL CONSTRAINT fk_repetition_clinic REFERENCES dbo.clinics(id),
  value       NVARCHAR(100) NOT NULL,
  sort_order  INT NOT NULL CONSTRAINT df_repetition_order DEFAULT 100,
  is_default  BIT NOT NULL CONSTRAINT df_repetition_default DEFAULT 0,
  is_deleted  BIT NOT NULL CONSTRAINT df_repetition_deleted DEFAULT 0,
  created_by  INT NULL CONSTRAINT fk_repetition_by REFERENCES dbo.employees(id),
  created_at  DATETIME2(0) NOT NULL DEFAULT DATEADD(MINUTE, 330, SYSUTCDATETIME()),
  CONSTRAINT uq_repetition_clinic_value UNIQUE (clinic_id, value)
);
GO
/* Do's and Don'ts list (Examine → Advice, e.g. Smoking, Alcohol): same behaviour as the dosage list.
   What the doctor marks for a visit is saved in visits.dos_donts. */
IF OBJECT_ID(N'dbo.dosdont_master', N'U') IS NULL
CREATE TABLE dbo.dosdont_master (
  id          INT IDENTITY(1,1) PRIMARY KEY,
  clinic_id   INT NOT NULL CONSTRAINT fk_dosdont_clinic REFERENCES dbo.clinics(id),
  value       NVARCHAR(100) NOT NULL,
  sort_order  INT NOT NULL CONSTRAINT df_dosdont_order DEFAULT 100,
  is_default  BIT NOT NULL CONSTRAINT df_dosdont_default DEFAULT 0,
  is_deleted  BIT NOT NULL CONSTRAINT df_dosdont_deleted DEFAULT 0,
  created_by  INT NULL CONSTRAINT fk_dosdont_by REFERENCES dbo.employees(id),
  created_at  DATETIME2(0) NOT NULL DEFAULT DATEADD(MINUTE, 330, SYSUTCDATETIME()),
  CONSTRAINT uq_dosdont_clinic_value UNIQUE (clinic_id, value)
);
GO
/* Past History list (Examine → Complaints & diagnosis, e.g. ENT, Ortho, Dental): same behaviour as the
   dosage list. What is ticked belongs to the patient (patients.past_history), so it carries to the next visit. */
IF OBJECT_ID(N'dbo.pasthistory_master', N'U') IS NULL
CREATE TABLE dbo.pasthistory_master (
  id          INT IDENTITY(1,1) PRIMARY KEY,
  clinic_id   INT NOT NULL CONSTRAINT fk_pasthistory_clinic REFERENCES dbo.clinics(id),
  value       NVARCHAR(100) NOT NULL,
  sort_order  INT NOT NULL CONSTRAINT df_pasthistory_order DEFAULT 100,
  is_default  BIT NOT NULL CONSTRAINT df_pasthistory_default DEFAULT 0,
  is_deleted  BIT NOT NULL CONSTRAINT df_pasthistory_deleted DEFAULT 0,
  created_by  INT NULL CONSTRAINT fk_pasthistory_by REFERENCES dbo.employees(id),
  created_at  DATETIME2(0) NOT NULL DEFAULT DATEADD(MINUTE, 330, SYSUTCDATETIME()),
  CONSTRAINT uq_pasthistory_clinic_value UNIQUE (clinic_id, value)
);
GO
/* Questions asked when a Past History item is ticked (e.g. ENT → Symptom Character, Triggers, Duration …).
   One list per item, same behaviour as the dosage list (defaults once, rename / reorder / hide, + New). */
IF OBJECT_ID(N'dbo.pasthistory_question', N'U') IS NULL
CREATE TABLE dbo.pasthistory_question (
  id          INT IDENTITY(1,1) PRIMARY KEY,
  clinic_id   INT NOT NULL CONSTRAINT fk_phq_clinic REFERENCES dbo.clinics(id),
  item_id     INT NOT NULL CONSTRAINT fk_phq_item REFERENCES dbo.pasthistory_master(id),
  value       NVARCHAR(100) NOT NULL,
  sort_order  INT NOT NULL CONSTRAINT df_phq_order DEFAULT 100,
  is_default  BIT NOT NULL CONSTRAINT df_phq_default DEFAULT 0,
  is_deleted  BIT NOT NULL CONSTRAINT df_phq_deleted DEFAULT 0,
  created_by  INT NULL CONSTRAINT fk_phq_by REFERENCES dbo.employees(id),
  created_at  DATETIME2(0) NOT NULL DEFAULT DATEADD(MINUTE, 330, SYSUTCDATETIME()),
  CONSTRAINT uq_phq_item_value UNIQUE (item_id, value)
);
GO
/* patients.past_history: where Past History was first kept (one record per patient). No longer used –
   it is now saved per visit (visits.past_history); the step below moves what was saved here. */
IF COL_LENGTH(N'dbo.patients', N'past_history') IS NULL
  ALTER TABLE dbo.patients ADD past_history NVARCHAR(4000) NULL;
GO
/* Past History of a visit, as JSON:
   [{"item":"ENT","note":"Tonsillectomy 2019","answers":[{"q":"Duration","a":"2 years"}]}, …]
   NULL = never saved for this visit (the screen then starts from the patient's previous visit);
   '[]' = saved with nothing ticked. */
IF COL_LENGTH(N'dbo.visits', N'past_history') IS NULL
  ALTER TABLE dbo.visits ADD past_history NVARCHAR(4000) NULL;
GO
/* Medical History list (Examine → Complaints & diagnosis, e.g. Smoking, Alcohol, Tobacco): same behaviour
   as the dosage list. What is ticked for a visit (with a note each) is saved in visits.medical_history,
   like Past History: JSON [{"item":"Smoking","note":"10 a day"}, …], NULL = never saved, '[]' = none ticked. */
IF OBJECT_ID(N'dbo.medhistory_master', N'U') IS NULL
CREATE TABLE dbo.medhistory_master (
  id          INT IDENTITY(1,1) PRIMARY KEY,
  clinic_id   INT NOT NULL CONSTRAINT fk_medhistory_clinic REFERENCES dbo.clinics(id),
  value       NVARCHAR(100) NOT NULL,
  sort_order  INT NOT NULL CONSTRAINT df_medhistory_order DEFAULT 100,
  is_default  BIT NOT NULL CONSTRAINT df_medhistory_default DEFAULT 0,
  is_deleted  BIT NOT NULL CONSTRAINT df_medhistory_deleted DEFAULT 0,
  created_by  INT NULL CONSTRAINT fk_medhistory_by REFERENCES dbo.employees(id),
  created_at  DATETIME2(0) NOT NULL DEFAULT DATEADD(MINUTE, 330, SYSUTCDATETIME()),
  CONSTRAINT uq_medhistory_clinic_value UNIQUE (clinic_id, value)
);
GO
IF COL_LENGTH(N'dbo.visits', N'medical_history') IS NULL
  ALTER TABLE dbo.visits ADD medical_history NVARCHAR(4000) NULL;
GO
/* Comparative Study (Examine → Complaints & diagnosis → 5): one running table per patient, each row a
   reading on its own date with Tine, Rt.H and Lt.H as short text, so readings can be compared over time.
   visit_id = the visit it was added from (for reference only). */
IF OBJECT_ID(N'dbo.comparative_study', N'U') IS NULL
CREATE TABLE dbo.comparative_study (
  id          INT IDENTITY(1,1) PRIMARY KEY,
  clinic_id   INT NOT NULL CONSTRAINT fk_cs_clinic REFERENCES dbo.clinics(id),
  patient_id  INT NOT NULL CONSTRAINT fk_cs_patient REFERENCES dbo.patients(id),
  visit_id    INT NULL CONSTRAINT fk_cs_visit REFERENCES dbo.visits(id),
  study_date  DATE NOT NULL,
  study_time  NVARCHAR(20) NULL,              -- the Tine column, as typed
  rt_h        NVARCHAR(100) NULL,
  lt_h        NVARCHAR(100) NULL,
  created_by  INT NULL CONSTRAINT fk_cs_by REFERENCES dbo.employees(id),
  created_at  DATETIME2(0) NOT NULL DEFAULT DATEADD(MINUTE, 330, SYSUTCDATETIME()),
  updated_by  INT NULL CONSTRAINT fk_cs_upd REFERENCES dbo.employees(id),
  updated_at  DATETIME2(0) NULL
);
GO
IF COL_LENGTH(N'dbo.comparative_study', N'study_time') < 40      -- bytes: NVARCHAR(20) = 40
  ALTER TABLE dbo.comparative_study ALTER COLUMN study_time NVARCHAR(20) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_cs_patient' AND object_id = OBJECT_ID(N'dbo.comparative_study'))
  CREATE INDEX ix_cs_patient ON dbo.comparative_study(clinic_id, patient_id, study_date);
GO
/* one-time move: a patient's Past History goes onto the patient's latest visit */
UPDATE v SET past_history = p.past_history
  FROM dbo.visits v JOIN dbo.patients p ON p.id = v.patient_id
 WHERE p.past_history IS NOT NULL AND v.past_history IS NULL
   AND v.id = (SELECT TOP 1 v2.id FROM dbo.visits v2 WHERE v2.patient_id = p.id ORDER BY v2.visit_date DESC, v2.id DESC);
UPDATE dbo.patients SET past_history = NULL WHERE past_history IS NOT NULL;
GO
/* Do's and Don'ts marked for a visit, as JSON: [{"item":"Smoking","rule":"dont"}, …] */
IF COL_LENGTH(N'dbo.visits', N'dos_donts') IS NULL
  ALTER TABLE dbo.visits ADD dos_donts NVARCHAR(4000) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_rx_visit' AND object_id = OBJECT_ID(N'dbo.prescriptions'))
  CREATE INDEX ix_rx_visit ON dbo.prescriptions(visit_id);
GO

/* ---------- 7b. PHARMACY: suppliers, stock ledger ---------- */
IF OBJECT_ID(N'dbo.suppliers', N'U') IS NULL
CREATE TABLE dbo.suppliers (
  id              INT IDENTITY(1,1) PRIMARY KEY,
  clinic_id       INT NOT NULL CONSTRAINT fk_suppliers_clinic REFERENCES dbo.clinics(id),
  name            NVARCHAR(150) NOT NULL,
  contact_person  NVARCHAR(150) NULL,
  mobile          NVARCHAR(20)  NULL,
  email           NVARCHAR(150) NULL,
  address         NVARCHAR(500) NULL,
  gstin           NVARCHAR(20)  NULL,
  status          NVARCHAR(10)  NOT NULL DEFAULT N'active' CONSTRAINT chk_suppliers_status CHECK (status IN (N'active', N'inactive')),
  created_by      INT NULL,
  created_at      DATETIME2(0) NOT NULL DEFAULT DATEADD(MINUTE, 330, SYSUTCDATETIME()),
  updated_at      DATETIME2(0) NOT NULL DEFAULT DATEADD(MINUTE, 330, SYSUTCDATETIME())
);
GO

-- Every stock change is logged here (opening, purchase, issue, adjustment, return)
IF OBJECT_ID(N'dbo.stock_movements', N'U') IS NULL
CREATE TABLE dbo.stock_movements (
  id             INT IDENTITY(1,1) PRIMARY KEY,
  clinic_id      INT NOT NULL CONSTRAINT fk_stock_clinic REFERENCES dbo.clinics(id),
  item_id        INT NOT NULL CONSTRAINT fk_stock_item REFERENCES dbo.items(id),
  qty_change     DECIMAL(12,2) NOT NULL,                                        -- +in / -out
  balance_after  DECIMAL(12,2) NOT NULL,
  reason         NVARCHAR(12) NOT NULL CONSTRAINT chk_stock_reason CHECK (reason IN (N'opening', N'purchase', N'issue', N'adjustment', N'return')),
  ref_type       NVARCHAR(30) NULL,
  ref_id         INT NULL,
  supplier_id    INT NULL CONSTRAINT fk_stock_supplier REFERENCES dbo.suppliers(id),
  note           NVARCHAR(300) NULL,
  created_by     INT NULL,
  created_at     DATETIME2(0) NOT NULL DEFAULT DATEADD(MINUTE, 330, SYSUTCDATETIME())
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_stock_item' AND object_id = OBJECT_ID(N'dbo.stock_movements'))
  CREATE INDEX ix_stock_item ON dbo.stock_movements(clinic_id, item_id, created_at);
GO

/* ---------- 8. BILLING ---------- */
IF OBJECT_ID(N'dbo.bills', N'U') IS NULL
CREATE TABLE dbo.bills (
  id                INT IDENTITY(1,1) PRIMARY KEY,
  clinic_id         INT NOT NULL CONSTRAINT fk_bills_clinic REFERENCES dbo.clinics(id),
  bill_no           NVARCHAR(25) NOT NULL,                                     -- CLA-B0001 (unique per clinic)
  patient_id        INT NOT NULL CONSTRAINT fk_bills_patient REFERENCES dbo.patients(id),
  visit_id          INT NULL CONSTRAINT fk_bills_visit REFERENCES dbo.visits(id),
  bill_date         DATETIME2(0) NOT NULL DEFAULT DATEADD(MINUTE, 330, SYSUTCDATETIME()),
  consultation_fee  DECIMAL(10,2) NOT NULL DEFAULT 0,
  items_total       DECIMAL(12,2) NOT NULL DEFAULT 0,
  other_total       DECIMAL(12,2) NOT NULL DEFAULT 0,
  discount          DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_total         DECIMAL(12,2) NOT NULL DEFAULT 0,
  net_amount        DECIMAL(12,2) NOT NULL DEFAULT 0,
  paid_amount       DECIMAL(12,2) NOT NULL DEFAULT 0,
  payment_mode      NVARCHAR(10) NOT NULL DEFAULT N'cash' CONSTRAINT chk_bills_mode CHECK (payment_mode IN (N'cash', N'card', N'upi', N'other')),
  status            NVARCHAR(10) NOT NULL DEFAULT N'paid' CONSTRAINT chk_bills_status CHECK (status IN (N'paid', N'partial', N'unpaid', N'cancelled')),
  notes             NVARCHAR(300) NULL,
  created_by        INT NULL,
  created_at        DATETIME2(0) NOT NULL DEFAULT DATEADD(MINUTE, 330, SYSUTCDATETIME()),
  updated_at        DATETIME2(0) NOT NULL DEFAULT DATEADD(MINUTE, 330, SYSUTCDATETIME()),
  CONSTRAINT uq_bills_clinic_no UNIQUE (clinic_id, bill_no)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_bills_date' AND object_id = OBJECT_ID(N'dbo.bills'))
  CREATE INDEX ix_bills_date ON dbo.bills(clinic_id, bill_date);
GO

-- Medicines handed over against a visit (reduces stock); billed once
IF OBJECT_ID(N'dbo.pharmacy_issues', N'U') IS NULL
CREATE TABLE dbo.pharmacy_issues (
  id           INT IDENTITY(1,1) PRIMARY KEY,
  clinic_id    INT NOT NULL CONSTRAINT fk_issue_clinic REFERENCES dbo.clinics(id),
  visit_id     INT NOT NULL CONSTRAINT fk_issue_visit REFERENCES dbo.visits(id),
  patient_id   INT NOT NULL CONSTRAINT fk_issue_patient REFERENCES dbo.patients(id),
  items_total  DECIMAL(12,2) NOT NULL DEFAULT 0,
  status       NVARCHAR(10) NOT NULL DEFAULT N'issued' CONSTRAINT chk_issue_status CHECK (status IN (N'issued', N'billed')),
  bill_id      INT NULL CONSTRAINT fk_issue_bill REFERENCES dbo.bills(id),
  issued_by    INT NULL,
  issued_at    DATETIME2(0) NOT NULL DEFAULT DATEADD(MINUTE, 330, SYSUTCDATETIME())
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_issue_visit' AND object_id = OBJECT_ID(N'dbo.pharmacy_issues'))
  CREATE INDEX ix_issue_visit ON dbo.pharmacy_issues(clinic_id, visit_id);
GO

IF OBJECT_ID(N'dbo.pharmacy_issue_items', N'U') IS NULL
CREATE TABLE dbo.pharmacy_issue_items (
  id               INT IDENTITY(1,1) PRIMARY KEY,
  clinic_id        INT NOT NULL CONSTRAINT fk_issue_items_clinic REFERENCES dbo.clinics(id),
  issue_id         INT NOT NULL CONSTRAINT fk_issue_items_issue REFERENCES dbo.pharmacy_issues(id),
  prescription_id  INT NULL CONSTRAINT fk_issue_items_rx REFERENCES dbo.prescriptions(id),
  item_id          INT NOT NULL CONSTRAINT fk_issue_items_item REFERENCES dbo.items(id),
  qty              DECIMAL(10,2) NOT NULL,
  rate             DECIMAL(10,2) NOT NULL,
  gst_percent      DECIMAL(5,2)  NOT NULL DEFAULT 0,
  amount           DECIMAL(12,2) NOT NULL
);
GO

IF OBJECT_ID(N'dbo.bill_items', N'U') IS NULL
CREATE TABLE dbo.bill_items (
  id           INT IDENTITY(1,1) PRIMARY KEY,
  clinic_id    INT NOT NULL CONSTRAINT fk_bill_items_clinic REFERENCES dbo.clinics(id),
  bill_id      INT NOT NULL CONSTRAINT fk_bill_items_bill REFERENCES dbo.bills(id),
  line_type    NVARCHAR(15) NOT NULL CONSTRAINT chk_bill_items_type CHECK (line_type IN (N'consultation', N'medicine', N'other')),
  item_id      INT NULL CONSTRAINT fk_bill_items_item REFERENCES dbo.items(id),
  description  NVARCHAR(200) NOT NULL,
  qty          DECIMAL(10,2) NOT NULL DEFAULT 1,
  rate         DECIMAL(10,2) NOT NULL DEFAULT 0,
  gst_percent  DECIMAL(5,2)  NOT NULL DEFAULT 0,
  amount       DECIMAL(12,2) NOT NULL DEFAULT 0
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_bill_items_bill' AND object_id = OBJECT_ID(N'dbo.bill_items'))
  CREATE INDEX ix_bill_items_bill ON dbo.bill_items(bill_id);
GO
