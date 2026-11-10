// Registration → Patient Registration: CSV template, bulk import and download (export).
// Columns follow the Patient Registration screen. The same rules run in the UI (preview) and the API.
import { decodeFile, rowsFromCsv as rowsFromCsvWith } from './itemImport.js';

export { decodeFile };

// Patient ID and Create Date are optional: blank = a new ID (CLA-0001 …) and today's date.
export const PATIENT_COLUMNS = [
  { key: 'patient_code', header: 'Patient ID' },
  { key: 'name', header: 'Name', required: true },
  { key: 'age_years', header: 'Age (years)' },
  { key: 'gender', header: 'Gender' },
  { key: 'dob', header: 'Date of birth' },
  { key: 'blood_group', header: 'Blood group' },
  { key: 'address', header: 'Address' },
  { key: 'mobile', header: 'Mobile', required: true },
  { key: 'alt_mobile', header: 'Alternate mobile' },
  { key: 'email', header: 'Email' },
  { key: 'notes', header: 'Notes' },
  { key: 'created_at', header: 'Create Date' },
];
export const MAX_PATIENT_IMPORT = 1000;
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

// English messages; the UI shows its own translation of each code (patientImport.err.<code>).
export const PATIENT_IMPORT_ERRORS = {
  name: 'Name is required',
  mobile: 'Mobile is required (6–20 digits)',
  altMobile: 'Alternate mobile is not a valid number',
  age: 'Age must be a whole number 0–130',
  gender: 'Gender: use Male, Female or Other',
  dob: 'Date of birth: use dd-mm-yyyy',
  blood: 'Blood group: A+, A-, B+, B-, AB+, AB-, O+ or O-',
  email: 'Email is not valid',
  long: 'A value is too long',
  duplicate: 'Same Name and Mobile appears earlier in the file',
  code: 'Patient ID: letters, digits and - only (max 20)',
  codeDuplicate: 'Same Patient ID appears earlier in the file',
  createdAt: 'Create Date: use dd-mm-yyyy (not in the future)',
};
const MAX_LEN = { name: 150, address: 500, mobile: 20, alt_mobile: 20, email: 150, notes: 1000 };
const PHONE = /^[0-9+\-\s]{6,20}$/;

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (table) => '﻿' + table.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

/** Template: header row + one example row (delete it before importing). Excel opens it directly. */
export function patientTemplateCsv() {
  const example = ['', 'Ravi Kumar', '35', 'Male', '15-08-1990', 'O+', '12, Main Road, Somanur', '9876543210', '', 'ravi@example.com', 'Example row – delete it. Leave Patient ID / Create Date blank for a new ID / today', '10-11-2026'];
  return toCsv([PATIENT_COLUMNS.map((c) => c.header), example]);
}

const GENDER_LABEL = { M: 'Male', F: 'Female', O: 'Other' };
const ddmmyyyy = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ? String(iso) : '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
};

/** Download: Patient ID + the template columns + City / Status / Registered, so the file can be re-imported elsewhere. */
export function patientsCsv(rows) {
  const head = [...PATIENT_COLUMNS.map((c) => c.header), 'City', 'Status'];
  const body = rows.map((p) => [
    p.patient_code, p.name, p.age_years ?? '', GENDER_LABEL[p.gender] || '', ddmmyyyy(p.dob), p.blood_group || '',
    p.address || '', p.mobile || '', p.alt_mobile || '', p.email || '', p.notes || '', ddmmyyyy(p.created_at), p.city || '', p.status || '',
  ]);
  return toCsv([head, ...body]);
}

/** CSV text → { rows: [{ line, data }], missing, unknown, found } (columns matched by heading). */
export const patientRowsFromCsv = (text) => rowsFromCsvWith(text, PATIENT_COLUMNS);

/** dd-mm-yyyy, dd/mm/yyyy, dd.mm.yyyy or yyyy-mm-dd → yyyy-mm-dd (or null if invalid). */
export function parseDate(v) {
  let y; let m; let d;
  let r = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(v);
  if (r) [, y, m, d] = r;
  else if ((r = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(v))) [, d, m, y] = r;
  else return null;
  const dt = new Date(Date.UTC(+y, +m - 1, +d));
  if (dt.getUTCFullYear() !== +y || dt.getUTCMonth() !== +m - 1 || dt.getUTCDate() !== +d) return null;
  if (+y < 1890 || dt > new Date()) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Checks one row → { data (ready to save), errors: [{ field, code }] }.
 * Only Patient ID, Name and Mobile can stop an import. Any other cell that can't be read (age, gender,
 * dates, blood group, alternate mobile, email) is simply left blank, and long text is cut to fit.
 */
export function checkPatientRow(input) {
  const errors = [];
  const v = (k) => (input[k] == null ? '' : String(input[k]).trim());
  const data = {};
  for (const k of ['name', 'address', 'mobile', 'alt_mobile', 'email', 'notes']) {
    const s = v(k);
    if (s.length > MAX_LEN[k] && (k === 'name' || k === 'mobile')) errors.push({ field: k, code: 'long' });
    data[k] = s === '' ? null : s.slice(0, MAX_LEN[k]);
  }
  if (!data.name) errors.push({ field: 'name', code: 'name' });

  const code = v('patient_code').toUpperCase();
  data.patient_code = null;
  if (code) {
    if (!/^[A-Z0-9][A-Z0-9-]{0,19}$/.test(code)) errors.push({ field: 'patient_code', code: 'code' });
    else data.patient_code = code;
  }
  const created = v('created_at');
  data.created_at = null;
  if (created) data.created_at = parseDate(created);                           // unreadable → today
  if (!data.mobile || !PHONE.test(data.mobile)) errors.push({ field: 'mobile', code: 'mobile' });
  if (data.alt_mobile && !PHONE.test(data.alt_mobile)) data.alt_mobile = null;
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) data.email = null;

  // "76", "76 Y", "76 yrs" → 76; anything else → blank
  const age = /^(\d{1,3})(\s*(y|yr|yrs|year|years))?\.?$/i.exec(v('age_years'));
  data.age_years = age && Number(age[1]) <= 130 ? Number(age[1]) : null;

  const g = v('gender').toLowerCase().replace(/\.$/, '');
  data.gender = ['m', 'male'].includes(g) ? 'M' : ['f', 'female'].includes(g) ? 'F' : ['o', 'other', 'others'].includes(g) ? 'O' : null;

  data.dob = v('dob') ? parseDate(v('dob')) : null;

  const bg = v('blood_group').toUpperCase().replace(/\s+/g, '')
    .replace(/(POSITIVE|POS)$/, '+').replace(/(NEGATIVE|NEG)$/, '-').replace(/([+-])VE$/, '$1');   // "B positive", "AB-ve"
  data.blood_group = BLOOD_GROUPS.includes(bg) ? bg : null;
  return { data, errors };
}

/**
 * Checks every row, including the same Patient ID twice in the file. (A repeat of the same Name + Mobile
 * is not an error: the server registers the first and skips the rest.)
 */
export function checkPatientRows(rows) {
  const codes = new Set();
  return rows.map((r) => {
    const { data, errors } = checkPatientRow(r.data);
    if (data.patient_code && codes.has(data.patient_code)) errors.push({ field: 'patient_code', code: 'codeDuplicate' });
    if (data.patient_code) codes.add(data.patient_code);
    return { line: r.line, data, errors };
  });
}
