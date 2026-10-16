-- =====================================================================
--  SmartClinic (Ayush Pro) – Multi-branch database schema
--  MySQL 8.0.16+  (uses CHECK constraints, JSON, utf8mb4 for Tamil text)
--
--  Rule of the schema: every operational record carries clinic_id.
--  Branch users are always filtered to their own clinic_id by the API;
--  Super Admin / Admin have clinic_id = NULL on their employee row and
--  may work in any clinic (selected via the clinic switcher).
-- =====================================================================

CREATE DATABASE IF NOT EXISTS smartclinic
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE smartclinic;

SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------
-- 1. MAIN CLINIC LEVEL: branches, pharmacies, labs
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS clinics (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(150) NOT NULL,
  code          VARCHAR(10)  NOT NULL,             -- e.g. CLA → patient IDs CLA-0001
  address       VARCHAR(500) NULL,
  city          VARCHAR(100) NULL,
  phone         VARCHAR(20)  NULL,
  email         VARCHAR(150) NULL,
  consultation_fee DECIMAL(10,2) NOT NULL DEFAULT 0, -- default fee pre-filled in Examine
  status        ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_by    INT UNSIGNED NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_clinics_code (code)          -- format (2–10 A-Z/0-9) is validated by the API
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS pharmacies (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  clinic_id     INT UNSIGNED NOT NULL,
  name          VARCHAR(150) NOT NULL,
  code          VARCHAR(10)  NOT NULL,
  address       VARCHAR(500) NULL,
  phone         VARCHAR(20)  NULL,
  license_no    VARCHAR(60)  NULL,
  status        ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_by    INT UNSIGNED NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pharmacies_code (code),
  KEY ix_pharmacies_clinic (clinic_id),
  CONSTRAINT fk_pharmacies_clinic FOREIGN KEY (clinic_id) REFERENCES clinics(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS labs (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  clinic_id     INT UNSIGNED NOT NULL,
  name          VARCHAR(150) NOT NULL,
  code          VARCHAR(10)  NOT NULL,
  address       VARCHAR(500) NULL,
  phone         VARCHAR(20)  NULL,
  status        ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_by    INT UNSIGNED NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_labs_code (code),
  KEY ix_labs_clinic (clinic_id),
  CONSTRAINT fk_labs_clinic FOREIGN KEY (clinic_id) REFERENCES clinics(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 2. EMPLOYEES  (also the login table)
--    super_admin / admin  → clinic_id NULL, unit_type 'main'
--    everyone else        → clinic_id required; unit = clinic/pharmacy/lab
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS employees (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  clinic_id      INT UNSIGNED NULL,
  unit_type      ENUM('main','clinic','pharmacy','lab') NOT NULL DEFAULT 'clinic',
  pharmacy_id    INT UNSIGNED NULL,
  lab_id         INT UNSIGNED NULL,
  emp_code       VARCHAR(20)  NOT NULL,           -- ADM-0001 / CLA-E0001
  name           VARCHAR(150) NOT NULL,
  gender         ENUM('M','F','O') NULL,
  dob            DATE NULL,
  mobile         VARCHAR(20)  NULL,
  email          VARCHAR(150) NULL,
  designation    VARCHAR(100) NULL,
  qualification  VARCHAR(150) NULL,
  address        VARCHAR(500) NULL,
  join_date      DATE NULL,
  role           ENUM('super_admin','admin','receptionist','doctor','pharmacist','billing') NOT NULL,
  username       VARCHAR(60)  NULL,
  password_hash  VARCHAR(100) NULL,
  can_login      TINYINT(1) NOT NULL DEFAULT 1,
  status         ENUM('active','inactive') NOT NULL DEFAULT 'active',
  last_login_at  DATETIME NULL,
  created_by     INT UNSIGNED NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_employees_code (emp_code),
  UNIQUE KEY uq_employees_username (username),
  KEY ix_employees_clinic_role (clinic_id, role),
  CONSTRAINT fk_employees_clinic   FOREIGN KEY (clinic_id)   REFERENCES clinics(id),
  CONSTRAINT fk_employees_pharmacy FOREIGN KEY (pharmacy_id) REFERENCES pharmacies(id),
  CONSTRAINT fk_employees_lab      FOREIGN KEY (lab_id)      REFERENCES labs(id),
  CONSTRAINT chk_employees_scope CHECK (
    (role IN ('super_admin','admin') AND clinic_id IS NULL AND unit_type = 'main')
    OR (role NOT IN ('super_admin','admin') AND clinic_id IS NOT NULL AND unit_type <> 'main')
  ),
  CONSTRAINT chk_employees_unit CHECK (
    (unit_type = 'pharmacy' AND pharmacy_id IS NOT NULL) OR
    (unit_type = 'lab'      AND lab_id      IS NOT NULL) OR
    (unit_type IN ('main','clinic'))
  )
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 3. PER-CLINIC NUMBER SEQUENCES
--    seq_key: 'patient', 'bill', 'employee', 'token:2026-10-16'
--    clinic_id 0 = global (admin employee codes)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS code_sequences (
  clinic_id   INT UNSIGNED NOT NULL,
  seq_key     VARCHAR(30)  NOT NULL,
  last_value  INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (clinic_id, seq_key)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 4. PATIENTS
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS patients (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  clinic_id     INT UNSIGNED NOT NULL,
  patient_code  VARCHAR(20)  NOT NULL,            -- CLA-0001 (unique per clinic)
  name          VARCHAR(150) NOT NULL,
  gender        ENUM('M','F','O') NULL,
  dob           DATE NULL,
  age_years     TINYINT UNSIGNED NULL,
  mobile        VARCHAR(20)  NOT NULL,
  alt_mobile    VARCHAR(20)  NULL,
  email         VARCHAR(150) NULL,
  address       VARCHAR(500) NULL,
  city          VARCHAR(100) NULL,
  blood_group   VARCHAR(5)   NULL,
  occupation    VARCHAR(100) NULL,
  notes         TEXT NULL,
  status        ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_by    INT UNSIGNED NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_patients_clinic_code (clinic_id, patient_code),
  KEY ix_patients_clinic_mobile (clinic_id, mobile),
  KEY ix_patients_clinic_name (clinic_id, name),
  CONSTRAINT fk_patients_clinic  FOREIGN KEY (clinic_id)  REFERENCES clinics(id),
  CONSTRAINT fk_patients_creator FOREIGN KEY (created_by) REFERENCES employees(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 5. DAILY QUEUE (Confirm & Search → Confirm List)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS queue_entries (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  clinic_id     INT UNSIGNED NOT NULL,
  patient_id    INT UNSIGNED NOT NULL,
  queue_date    DATE NOT NULL,
  token_no      SMALLINT UNSIGNED NOT NULL,
  visit_type    ENUM('new','follow_up') NOT NULL DEFAULT 'new',
  status        ENUM('waiting','with_doctor','done','cancelled') NOT NULL DEFAULT 'waiting',
  doctor_id     INT UNSIGNED NULL,
  confirmed_by  INT UNSIGNED NULL,
  confirmed_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  called_at     DATETIME NULL,
  completed_at  DATETIME NULL,
  UNIQUE KEY uq_queue_token (clinic_id, queue_date, token_no),
  KEY ix_queue_patient (clinic_id, patient_id, queue_date),
  KEY ix_queue_status (clinic_id, queue_date, status),
  CONSTRAINT fk_queue_clinic  FOREIGN KEY (clinic_id)    REFERENCES clinics(id),
  CONSTRAINT fk_queue_patient FOREIGN KEY (patient_id)   REFERENCES patients(id),
  CONSTRAINT fk_queue_doctor  FOREIGN KEY (doctor_id)    REFERENCES employees(id),
  CONSTRAINT fk_queue_by      FOREIGN KEY (confirmed_by) REFERENCES employees(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 6. DOCTOR: visits + prescriptions
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS visits (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  clinic_id         INT UNSIGNED NOT NULL,
  patient_id        INT UNSIGNED NOT NULL,
  queue_id          INT UNSIGNED NULL,
  doctor_id         INT UNSIGNED NULL,
  visit_date        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  complaints        TEXT NULL,
  examination_notes TEXT NULL,
  diagnosis         TEXT NULL,
  vitals            JSON NULL,                    -- {"bp":"120/80","pulse":72,"temp":98.6,"weight":64}
  advice            TEXT NULL,
  follow_up_date    DATE NULL,
  consultation_fee  DECIMAL(10,2) NOT NULL DEFAULT 0,
  status            ENUM('open','completed') NOT NULL DEFAULT 'open',
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_visits_queue (queue_id),
  KEY ix_visits_patient (clinic_id, patient_id, visit_date),
  CONSTRAINT fk_visits_clinic  FOREIGN KEY (clinic_id)  REFERENCES clinics(id),
  CONSTRAINT fk_visits_patient FOREIGN KEY (patient_id) REFERENCES patients(id),
  CONSTRAINT fk_visits_queue   FOREIGN KEY (queue_id)   REFERENCES queue_entries(id),
  CONSTRAINT fk_visits_doctor  FOREIGN KEY (doctor_id)  REFERENCES employees(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS prescriptions (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  clinic_id      INT UNSIGNED NOT NULL,
  visit_id       INT UNSIGNED NOT NULL,
  item_id        INT UNSIGNED NULL,               -- NULL = free-text medicine not in stock
  medicine_name  VARCHAR(200) NOT NULL,
  dosage         VARCHAR(100) NULL,               -- "4 pills" / "5 ml"
  frequency      VARCHAR(100) NULL,               -- "1-0-1"
  duration       VARCHAR(100) NULL,               -- "7 days"
  quantity       DECIMAL(10,2) NOT NULL DEFAULT 1,
  instructions   VARCHAR(300) NULL,
  issued_qty     DECIMAL(10,2) NOT NULL DEFAULT 0,
  sort_order     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  KEY ix_rx_visit (visit_id),
  KEY ix_rx_clinic (clinic_id),
  CONSTRAINT fk_rx_clinic FOREIGN KEY (clinic_id) REFERENCES clinics(id),
  CONSTRAINT fk_rx_visit  FOREIGN KEY (visit_id)  REFERENCES visits(id) ON DELETE CASCADE,
  CONSTRAINT fk_rx_item   FOREIGN KEY (item_id)   REFERENCES items(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 7. PHARMACY: items, suppliers, stock ledger, dispensing
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS items (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  clinic_id      INT UNSIGNED NOT NULL,
  pharmacy_id    INT UNSIGNED NULL,
  name           VARCHAR(200) NOT NULL,
  category       VARCHAR(100) NULL,               -- Dilution / Mother tincture / Tablet / Syrup ...
  unit           VARCHAR(30)  NOT NULL DEFAULT 'nos',
  price          DECIMAL(10,2) NOT NULL DEFAULT 0,
  gst_percent    DECIMAL(5,2)  NOT NULL DEFAULT 0,
  stock_qty      DECIMAL(12,2) NOT NULL DEFAULT 0,
  reorder_level  DECIMAL(12,2) NOT NULL DEFAULT 0,
  status         ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_by     INT UNSIGNED NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_items_clinic_name_unit (clinic_id, name, unit),
  CONSTRAINT fk_items_clinic   FOREIGN KEY (clinic_id)   REFERENCES clinics(id),
  CONSTRAINT fk_items_pharmacy FOREIGN KEY (pharmacy_id) REFERENCES pharmacies(id),
  CONSTRAINT chk_items_stock CHECK (stock_qty >= 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS suppliers (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  clinic_id       INT UNSIGNED NOT NULL,
  name            VARCHAR(150) NOT NULL,
  contact_person  VARCHAR(150) NULL,
  mobile          VARCHAR(20)  NULL,
  email           VARCHAR(150) NULL,
  address         VARCHAR(500) NULL,
  gstin           VARCHAR(20)  NULL,
  status          ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_by      INT UNSIGNED NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY ix_suppliers_clinic (clinic_id),
  CONSTRAINT fk_suppliers_clinic FOREIGN KEY (clinic_id) REFERENCES clinics(id)
) ENGINE=InnoDB;

-- Every stock change is logged here (opening, purchase, issue, adjustment)
CREATE TABLE IF NOT EXISTS stock_movements (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  clinic_id      INT UNSIGNED NOT NULL,
  item_id        INT UNSIGNED NOT NULL,
  qty_change     DECIMAL(12,2) NOT NULL,          -- +in / -out
  balance_after  DECIMAL(12,2) NOT NULL,
  reason         ENUM('opening','purchase','issue','adjustment','return') NOT NULL,
  ref_type       VARCHAR(30) NULL,                -- 'pharmacy_issue' ...
  ref_id         INT UNSIGNED NULL,
  supplier_id    INT UNSIGNED NULL,
  note           VARCHAR(300) NULL,
  created_by     INT UNSIGNED NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_stock_item (clinic_id, item_id, created_at),
  CONSTRAINT fk_stock_clinic   FOREIGN KEY (clinic_id)   REFERENCES clinics(id),
  CONSTRAINT fk_stock_item     FOREIGN KEY (item_id)     REFERENCES items(id),
  CONSTRAINT fk_stock_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
) ENGINE=InnoDB;

-- Medicines handed over to the patient against a visit (reduces stock)
CREATE TABLE IF NOT EXISTS pharmacy_issues (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  clinic_id    INT UNSIGNED NOT NULL,
  visit_id     INT UNSIGNED NOT NULL,
  patient_id   INT UNSIGNED NOT NULL,
  items_total  DECIMAL(12,2) NOT NULL DEFAULT 0,
  status       ENUM('issued','billed') NOT NULL DEFAULT 'issued',
  bill_id      INT UNSIGNED NULL,                 -- set when the issue is billed
  issued_by    INT UNSIGNED NULL,
  issued_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_issue_visit (clinic_id, visit_id),
  CONSTRAINT fk_issue_clinic  FOREIGN KEY (clinic_id)  REFERENCES clinics(id),
  CONSTRAINT fk_issue_visit   FOREIGN KEY (visit_id)   REFERENCES visits(id),
  CONSTRAINT fk_issue_patient FOREIGN KEY (patient_id) REFERENCES patients(id),
  CONSTRAINT fk_issue_bill    FOREIGN KEY (bill_id)    REFERENCES bills(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS pharmacy_issue_items (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  clinic_id        INT UNSIGNED NOT NULL,
  issue_id         INT UNSIGNED NOT NULL,
  prescription_id  INT UNSIGNED NULL,
  item_id          INT UNSIGNED NOT NULL,
  qty              DECIMAL(10,2) NOT NULL,
  rate             DECIMAL(10,2) NOT NULL,
  gst_percent      DECIMAL(5,2)  NOT NULL DEFAULT 0,
  amount           DECIMAL(12,2) NOT NULL,
  KEY ix_issue_items_issue (issue_id),
  CONSTRAINT fk_issue_items_clinic FOREIGN KEY (clinic_id)       REFERENCES clinics(id),
  CONSTRAINT fk_issue_items_issue  FOREIGN KEY (issue_id)        REFERENCES pharmacy_issues(id) ON DELETE CASCADE,
  CONSTRAINT fk_issue_items_rx     FOREIGN KEY (prescription_id) REFERENCES prescriptions(id),
  CONSTRAINT fk_issue_items_item   FOREIGN KEY (item_id)         REFERENCES items(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 8. BILLING
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS bills (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  clinic_id         INT UNSIGNED NOT NULL,
  bill_no           VARCHAR(25)  NOT NULL,        -- CLA-B0001 (unique per clinic)
  patient_id        INT UNSIGNED NOT NULL,
  visit_id          INT UNSIGNED NULL,
  bill_date         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  consultation_fee  DECIMAL(10,2) NOT NULL DEFAULT 0,
  items_total       DECIMAL(12,2) NOT NULL DEFAULT 0,
  other_total       DECIMAL(12,2) NOT NULL DEFAULT 0,
  discount          DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_total         DECIMAL(12,2) NOT NULL DEFAULT 0,
  net_amount        DECIMAL(12,2) NOT NULL DEFAULT 0,
  paid_amount       DECIMAL(12,2) NOT NULL DEFAULT 0,
  payment_mode      ENUM('cash','card','upi','other') NOT NULL DEFAULT 'cash',
  status            ENUM('paid','partial','unpaid','cancelled') NOT NULL DEFAULT 'paid',
  notes             VARCHAR(300) NULL,
  created_by        INT UNSIGNED NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_bills_clinic_no (clinic_id, bill_no),
  KEY ix_bills_date (clinic_id, bill_date),
  KEY ix_bills_patient (clinic_id, patient_id),
  CONSTRAINT fk_bills_clinic  FOREIGN KEY (clinic_id)  REFERENCES clinics(id),
  CONSTRAINT fk_bills_patient FOREIGN KEY (patient_id) REFERENCES patients(id),
  CONSTRAINT fk_bills_visit   FOREIGN KEY (visit_id)   REFERENCES visits(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS bill_items (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  clinic_id    INT UNSIGNED NOT NULL,
  bill_id      INT UNSIGNED NOT NULL,
  line_type    ENUM('consultation','medicine','other') NOT NULL,
  item_id      INT UNSIGNED NULL,
  description  VARCHAR(200) NOT NULL,
  qty          DECIMAL(10,2) NOT NULL DEFAULT 1,
  rate         DECIMAL(10,2) NOT NULL DEFAULT 0,
  gst_percent  DECIMAL(5,2)  NOT NULL DEFAULT 0,
  amount       DECIMAL(12,2) NOT NULL DEFAULT 0,
  KEY ix_bill_items_bill (bill_id),
  CONSTRAINT fk_bill_items_clinic FOREIGN KEY (clinic_id) REFERENCES clinics(id),
  CONSTRAINT fk_bill_items_bill   FOREIGN KEY (bill_id)   REFERENCES bills(id) ON DELETE CASCADE,
  CONSTRAINT fk_bill_items_item   FOREIGN KEY (item_id)   REFERENCES items(id)
) ENGINE=InnoDB;

SET FOREIGN_KEY_CHECKS = 1;
