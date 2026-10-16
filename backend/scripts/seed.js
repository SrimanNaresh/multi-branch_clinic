// Creates the first Super Admin (and optional demo data). Safe to run twice.
//   npm run seed
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { pool, query, tx } from '../src/config/db.js';
import { nextSequence, formatAdminCode, formatEmployeeCode, GLOBAL_SEQ_CLINIC } from '../src/utils/codes.js';

const username = process.env.SEED_ADMIN_USERNAME || 'superadmin';
const password = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe@123';
const name = process.env.SEED_ADMIN_NAME || 'Super Admin';

async function ensureAdmin() {
  const [existing] = await query('SELECT id FROM employees WHERE username = ?', [username]);
  if (existing) return console.log(`Super Admin "${username}" already exists.`);
  await tx(async (q) => {
    const code = formatAdminCode(await nextSequence(q, GLOBAL_SEQ_CLINIC, 'employee'));
    await q('INSERT INTO employees SET ?', [{
      emp_code: code, name, role: 'super_admin', unit_type: 'main', clinic_id: null,
      username, password_hash: await bcrypt.hash(password, 10), can_login: 1, status: 'active',
    }]);
  });
  console.log(`Created Super Admin  username: ${username}  password: ${password}  (change it after first login)`);
}

async function ensureClinic(clinic) {
  const [row] = await query('SELECT id FROM clinics WHERE code = ?', [clinic.code]);
  if (row) return row.id;
  const r = await query('INSERT INTO clinics SET ?', [clinic]);
  return r.insertId;
}

async function ensureUnit(table, unit) {
  const [row] = await query(`SELECT id FROM ${table} WHERE code = ?`, [unit.code]);
  if (row) return row.id;
  return (await query(`INSERT INTO ${table} SET ?`, [unit])).insertId;
}

async function ensureStaff(clinicId, clinicCode, staff) {
  const [row] = await query('SELECT id FROM employees WHERE username = ?', [staff.username]);
  if (row) return;
  await tx(async (q) => {
    const code = formatEmployeeCode(clinicCode, await nextSequence(q, clinicId, 'employee'));
    await q('INSERT INTO employees SET ?', [{
      ...staff, emp_code: code, clinic_id: clinicId,
      password_hash: await bcrypt.hash('Demo@123', 10), can_login: 1, status: 'active',
    }]);
  });
}

async function seedDemo() {
  const a = await ensureClinic({ name: 'Clinic A', code: 'CLA', city: 'Coimbatore', phone: '0422-0000001', consultation_fee: 200 });
  const b = await ensureClinic({ name: 'Clinic B', code: 'CLB', city: 'Tiruppur', phone: '0421-0000002', consultation_fee: 150 });
  const phA = await ensureUnit('pharmacies', { clinic_id: a, name: 'Clinic A Pharmacy', code: 'PHA' });
  await ensureUnit('pharmacies', { clinic_id: b, name: 'Clinic B Pharmacy', code: 'PHB' });
  await ensureUnit('labs', { clinic_id: a, name: 'Clinic A Lab', code: 'LBA' });

  await ensureStaff(a, 'CLA', { name: 'Reception A', role: 'receptionist', unit_type: 'clinic', username: 'cla.reception' });
  await ensureStaff(a, 'CLA', { name: 'Dr. Doctor A', role: 'doctor', unit_type: 'clinic', username: 'cla.doctor', designation: 'Homoeopathy Physician' });
  await ensureStaff(a, 'CLA', { name: 'Pharmacist A', role: 'pharmacist', unit_type: 'pharmacy', pharmacy_id: phA, username: 'cla.pharmacy' });
  await ensureStaff(a, 'CLA', { name: 'Billing A', role: 'billing', unit_type: 'clinic', username: 'cla.billing' });
  console.log('Demo data ready: Clinic A (CLA), Clinic B (CLB). Clinic A staff logins use password Demo@123:');
  console.log('  cla.reception, cla.doctor, cla.pharmacy, cla.billing');
}

try {
  await ensureAdmin();
  if (process.env.SEED_DEMO === '1') await seedDemo();
} finally {
  await pool.end();
}
