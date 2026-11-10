import { Router } from '../../lib/mini-express.js';
import { query, tx, insertRow, pageSql } from '../../config/db.js';
import { clinicScope, requirePermission } from '../../middleware/access.js';
import { formatPatientCode } from '../../utils/codes.js';
import { badRequest, conflict, forbidden, notFound, oneOf, paging, pick, requireFields, setClause, toId, like } from '../../utils/http.js';
import { isISODate } from '../../utils/dates.js';
import { lockStock, r4 } from '../../utils/stock.js';
import { checkPatientRows, MAX_PATIENT_IMPORT, PATIENT_IMPORT_ERRORS } from '../../../../shared/patientImport.js';

const router = Router();
router.use(clinicScope());   // every route below is scoped to req.clinicId

/** Bulk Template / Import / Download and Delete are Super Admin only. */
function superAdminOnly(req, _res, next) {
  if (req.user.role === 'super_admin') return next();
  throw forbidden('Only Super Admin can do this');
}

const FIELDS = ['name', 'gender', 'dob', 'age_years', 'mobile', 'alt_mobile', 'email', 'address', 'city',
  'blood_group', 'occupation', 'notes', 'status'];

function clean(body) {
  const data = pick(body, FIELDS);
  oneOf(data.gender, ['M', 'F', 'O'], 'gender');
  oneOf(data.status, ['active', 'inactive'], 'status');
  if (data.dob && !isISODate(data.dob)) throw badRequest('Invalid date of birth', 'VALIDATION');
  if (data.age_years !== undefined && data.age_years !== null) {
    const age = Number(data.age_years);
    if (!Number.isInteger(age) || age < 0 || age > 130) throw badRequest('Invalid age', 'VALIDATION');
    data.age_years = age;
  }
  if (data.mobile && !/^[0-9+\-\s]{6,20}$/.test(data.mobile)) throw badRequest('Invalid mobile number', 'VALIDATION');
  return data;
}

async function getPatient(clinicId, id) {
  const [row] = await query(
    `SELECT p.*,
            (SELECT COUNT(*) FROM visits v WHERE v.patient_id = p.id AND v.clinic_id = p.clinic_id) AS visit_count,
            (SELECT MAX(v.visit_date) FROM visits v WHERE v.patient_id = p.id AND v.clinic_id = p.clinic_id) AS last_visit
       FROM patients p WHERE p.id = ? AND p.clinic_id = ?`,
    [id, clinicId],
  );
  return row;
}

// GET /api/patients?q=&page=&limit=&status=
router.get('/', requirePermission('patient.view'), async (req, res) => {
  const { limit, offset, page } = paging(req.query);
  const where = ['p.clinic_id = ?'];
  const params = [req.clinicId];
  if (req.query.q) {
    where.push('(p.name LIKE ? OR p.mobile LIKE ? OR p.patient_code LIKE ? OR p.alt_mobile LIKE ?)');
    params.push(...Array(4).fill(like(req.query.q)));
  }
  if (req.query.status) {
    where.push('p.status = ?');
    params.push(req.query.status);
  }
  const w = where.join(' AND ');
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM patients p WHERE ${w}`, params);
  const rows = await query(
    `SELECT p.id, p.patient_code, p.name, p.gender, p.age_years, p.dob, p.mobile, p.address, p.city, p.status, p.created_at
       FROM patients p WHERE ${w} ORDER BY p.id DESC ${pageSql}`,
    [...params, offset, limit],
  );
  res.json({ rows, total, page, limit });
});

// GET /api/patients/clinic-info – the clinic's name, address and phone for printed forms (Patient Consent Form)
router.get('/clinic-info', requirePermission('patient.view'), async (req, res) => {
  const [clinic] = await query('SELECT name, address, city, phone FROM clinics WHERE id = ?', [req.clinicId]);
  if (!clinic) throw notFound('Clinic');
  res.json(clinic);
});

// GET /api/patients/export – every patient of the clinic with all registration fields (Patient List → Download)
router.get('/export', superAdminOnly, async (req, res) => {
  const rows = await query(
    `SELECT patient_code, name, age_years, gender, dob, blood_group, address, mobile, alt_mobile, email, notes, city, status, created_at
       FROM patients WHERE clinic_id = ? ORDER BY id`,
    [req.clinicId],
  );
  res.json({ rows });
});

/**
 * New Patient ID = the clinic's last Patient ID + 1 (CLA-0120 → CLA-0121), counting only IDs in the
 * clinic's own format. `floor` lets an import skip past IDs that are still to come in its file.
 * Must run inside the transaction `q`: the app lock makes two registrations wait for each other,
 * so they can never get the same ID.
 */
async function nextPatientCode(q, clinicId, clinicCode, floor = 0) {
  await q(`EXEC sp_getapplock @Resource = ?, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 15000`,
    [`patient-code-${clinicId}`]);
  const [{ n }] = await q(
    `SELECT MAX(TRY_CAST(SUBSTRING(patient_code, LEN(?) + 2, 20) AS INT)) AS n
       FROM patients WHERE clinic_id = ? AND patient_code LIKE ?`,
    [clinicCode, clinicId, `${clinicCode}-%`],
  );
  return formatPatientCode(clinicCode, Math.max(Number(n) || 0, floor) + 1);
}

// GET /api/patients/next-id – the Patient ID the next registration will get (shown on Patient Registration)
router.get('/next-id', requirePermission('patient.create'), async (req, res) => {
  const code = await tx(async (q) => {
    const [clinic] = await q('SELECT code FROM clinics WHERE id = ?', [req.clinicId]);
    return nextPatientCode(q, req.clinicId, clinic.code);
  });
  res.json({ patient_code: code });
});

// POST /api/patients/import { rows: [{ line, data }] } – from the CSV template (Patient Registration → Import).
// Every row is checked first; if any row is wrong nothing is saved and the problems come back per line.
// A row whose Name + Mobile is already registered in this clinic is skipped (not added twice).
router.post('/import', superAdminOnly, async (req, res) => {
  const input = req.body?.rows;
  if (!Array.isArray(input) || !input.length) throw badRequest('The file has no patient rows', 'VALIDATION');
  if (input.length > MAX_PATIENT_IMPORT) throw badRequest(`At most ${MAX_PATIENT_IMPORT} rows per file`, 'VALIDATION');
  const rows = input.map((r, i) => ({ line: Number(r?.line) || i + 2, data: r?.data && typeof r.data === 'object' ? r.data : {} }));
  const checked = checkPatientRows(rows);
  const bad = checked.filter((r) => r.errors.length);
  if (bad.length) {
    const err = badRequest(`${bad.length} row(s) need fixing – nothing was imported`, 'IMPORT_INVALID');
    err.details = bad.map((r) => ({ line: r.line, errors: r.errors.map((e) => ({ ...e, message: PATIENT_IMPORT_ERRORS[e.code] })) }));
    throw err;
  }

  const result = await tx(async (q) => {
    const [clinic] = await q('SELECT code FROM clinics WHERE id = ?', [req.clinicId]);
    // Blank-ID rows get last ID + 1, counted past any CLA-0120 style IDs in the file, so they never take one
    // that a later row of the file brings.
    const own = new RegExp(`^${clinic.code.replace(/[^A-Za-z0-9]/g, '\\$&')}-(\\d+)$`, 'i');
    const maxInFile = Math.max(0, ...checked.map((r) => Number(own.exec(r.data.patient_code || '')?.[1] || 0)));

    const created = [];
    const skipped = [];
    for (const { line, data } of checked) {
      const [dupe] = await q('SELECT TOP 1 patient_code FROM patients WITH (UPDLOCK, HOLDLOCK) WHERE clinic_id = ? AND mobile = ? AND name = ?',
        [req.clinicId, data.mobile, data.name]);
      if (dupe) { skipped.push({ line, name: data.name, patient_code: dupe.patient_code, reason: 'same' }); continue; }
      let code = data.patient_code;
      if (code) {
        const [taken] = await q('SELECT TOP 1 name FROM patients WITH (UPDLOCK, HOLDLOCK) WHERE clinic_id = ? AND patient_code = ?', [req.clinicId, code]);
        if (taken) { skipped.push({ line, name: data.name, patient_code: code, reason: 'idUsed', other: taken.name }); continue; }
      } else {
        code = await nextPatientCode(q, req.clinicId, clinic.code, maxInFile);   // last ID + 1
      }
      const { created_at: createdAt, ...fields } = data;
      await insertRow(q, 'patients', {
        ...fields, clinic_id: req.clinicId, patient_code: code, created_by: req.user.id,
        ...(createdAt ? { created_at: createdAt } : {}),
      });
      created.push(code);
    }
    return { created: created.length, first: created[0] || null, last: created[created.length - 1] || null, skipped };
  });
  res.json(result);
});

router.get('/:id', requirePermission('patient.view'), async (req, res) => {
  const row = await getPatient(req.clinicId, toId(req.params.id));
  if (!row) throw notFound('Patient');
  res.json(row);
});

// Only Admin / Super Admin (patient.create) can register patients.
// Body may include force: true to register despite a same name + mobile match.
router.post('/', requirePermission('patient.create'), async (req, res) => {
  const data = clean(req.body);
  requireFields(data, ['name', 'mobile']);

  if (!req.body.force) {
    const dupes = await query(
      'SELECT TOP 5 id, patient_code, name, mobile FROM patients WHERE clinic_id = ? AND mobile = ? AND name = ?',
      [req.clinicId, data.mobile, data.name],
    );
    if (dupes.length) {
      const err = conflict(`Patient already registered as ${dupes[0].patient_code}`, 'POSSIBLE_DUPLICATE');
      err.details = dupes;
      throw err;
    }
  }

  const id = await tx(async (q) => {
    const [clinic] = await q('SELECT code FROM clinics WHERE id = ?', [req.clinicId]);
    const code = await nextPatientCode(q, req.clinicId, clinic.code);   // last Patient ID + 1
    return insertRow(q, 'patients', {
      ...data, clinic_id: req.clinicId, patient_code: code, created_by: req.user.id,
    });
  });
  res.status(201).json(await getPatient(req.clinicId, id));
});

router.put('/:id', requirePermission('patient.edit'), async (req, res) => {
  const id = toId(req.params.id);
  const { sql, params } = setClause(clean(req.body));
  const r = await query(`UPDATE patients SET ${sql}, updated_at = NOW() WHERE id = ? AND clinic_id = ?`, [...params, id, req.clinicId]);
  if (!r.affectedRows) throw notFound('Patient');
  res.json(await getPatient(req.clinicId, id));
});

// DELETE /api/patients/:id – Super Admin only. Removes the patient and everything linked to them, in one
// transaction: queue tokens, vitals, attachments, visits, prescriptions, comparative study, bills (+ lines)
// and pharmacy issues (+ lines). Medicines issued to the patient are put back into stock (logged as a return).
router.delete('/:id', async (req, res) => {
  if (req.user.role !== 'super_admin') throw forbidden('Only Super Admin can delete patients');
  const id = toId(req.params.id);
  const clinicId = req.clinicId;
  const result = await tx(async (q) => {
    const [p] = await q('SELECT id, patient_code FROM patients WITH (UPDLOCK, ROWLOCK) WHERE id = ? AND clinic_id = ?', [id, clinicId]);
    if (!p) throw notFound('Patient');

    const ids = async (sql, params) => (await q(sql, params)).map((r) => r.id);
    const visitIds = await ids('SELECT id FROM visits WHERE patient_id = ? AND clinic_id = ?', [id, clinicId]);
    const queueIds = await ids('SELECT id FROM queue_entries WHERE patient_id = ? AND clinic_id = ?', [id, clinicId]);
    const issueIds = await ids(
      `SELECT id FROM pharmacy_issues WHERE clinic_id = ? AND (patient_id = ?${visitIds.length ? ' OR visit_id IN (?)' : ''})`,
      visitIds.length ? [clinicId, id, visitIds] : [clinicId, id],
    );
    const billIds = await ids(
      `SELECT id FROM bills WHERE clinic_id = ? AND (patient_id = ?${visitIds.length ? ' OR visit_id IN (?)' : ''})`,
      visitIds.length ? [clinicId, id, visitIds] : [clinicId, id],
    );

    // Put issued medicines back into stock (items locked in id order, same as dispensing)
    let restored = 0;
    if (issueIds.length) {
      const lines = await q(
        'SELECT item_id, SUM(qty) AS qty FROM pharmacy_issue_items WHERE issue_id IN (?) GROUP BY item_id ORDER BY item_id', [issueIds],
      );
      if (lines.length) {
        await lockStock(q, clinicId);
        for (const l of lines) {
          const [it] = await q('SELECT id, stock_qty FROM items WITH (UPDLOCK, ROWLOCK) WHERE id = ?', [l.item_id]);
          if (!it) continue;
          const balance = r4(Number(it.stock_qty) + Number(l.qty));
          await q('UPDATE items SET stock_qty = ?, updated_at = NOW() WHERE id = ?', [balance, it.id]);
          await insertRow(q, 'stock_movements', {
            clinic_id: clinicId, item_id: it.id, qty_change: l.qty, balance_after: balance,
            reason: 'return', ref_type: 'patient_delete', ref_id: id,
            note: `Patient ${p.patient_code} deleted`, created_by: req.user.id,
          });
          restored += 1;
        }
      }
      await q('DELETE FROM pharmacy_issue_items WHERE issue_id IN (?)', [issueIds]);
      await q('DELETE FROM pharmacy_issues WHERE id IN (?)', [issueIds]);
    }
    if (billIds.length) {
      await q('DELETE FROM bill_items WHERE bill_id IN (?)', [billIds]);
      await q('DELETE FROM bills WHERE id IN (?)', [billIds]);
    }
    if (visitIds.length) {
      await q('DELETE FROM prescriptions WHERE visit_id IN (?)', [visitIds]);
      await q('DELETE FROM comparative_study WHERE visit_id IN (?)', [visitIds]);
    }
    await q('DELETE FROM comparative_study WHERE patient_id = ? AND clinic_id = ?', [id, clinicId]);
    await q(`DELETE FROM patient_vitals WHERE patient_id = ?${queueIds.length ? ' OR queue_id IN (?)' : ''}`, queueIds.length ? [id, queueIds] : [id]);
    await q(`DELETE FROM patient_attachments WHERE patient_id = ?${queueIds.length ? ' OR queue_id IN (?)' : ''}`, queueIds.length ? [id, queueIds] : [id]);
    if (visitIds.length) await q('DELETE FROM visits WHERE id IN (?)', [visitIds]);
    if (queueIds.length) await q('DELETE FROM queue_entries WHERE id IN (?)', [queueIds]);
    await q('DELETE FROM patients WHERE id = ? AND clinic_id = ?', [id, clinicId]);

    return {
      patient_code: p.patient_code, visits: visitIds.length, queue: queueIds.length,
      bills: billIds.length, pharmacy_issues: issueIds.length, stock_items_restored: restored,
    };
  });
  res.json({ ok: true, ...result });
});

export default router;
