// SQL Server query layer: placeholders, IN lists, NOW(), insert/update builders
import test from 'node:test';
import assert from 'node:assert/strict';
import { compileSql, insertRow, updateRow, NOW_SQL, pageSql } from '../src/config/db.js';

test('? placeholders become @p0, @p1 …; arrays expand for IN', () => {
  const { text, values } = compileSql('SELECT * FROM items WHERE clinic_id = ? AND id IN (?)', [3, [7, 8, 9]]);
  assert.equal(text, 'SELECT * FROM items WHERE clinic_id = @p0 AND id IN (@p1, @p2, @p3)');
  assert.deepEqual(values, [3, 7, 8, 9]);
});

test('question marks inside quotes are left alone; empty list becomes NULL', () => {
  const { text, values } = compileSql("SELECT 'a?b', '' AS e FROM t WHERE x = ? AND y IN (?)", [1, []]);
  assert.equal(text, "SELECT 'a?b', '' AS e FROM t WHERE x = @p0 AND y IN (NULL)");
  assert.deepEqual(values, [1]);
});

test('NOW() means clinic time; missing values are an error', () => {
  assert.equal(compileSql('UPDATE t SET a = NOW()').text, `UPDATE t SET a = ${NOW_SQL}`);
  assert.match(NOW_SQL, /DATEADD\(MINUTE, 330, SYSUTCDATETIME\(\)\)/);
  assert.throws(() => compileSql('SELECT ? , ?', [1]));
});

test('insertRow builds INSERT … OUTPUT INSERTED.id and returns the id', async () => {
  let seen;
  const q = async (sql, params) => { seen = { sql, params }; return [{ id: 42 }]; };
  const id = await insertRow(q, 'patients', { clinic_id: 1, name: 'அனிதா', notes: undefined, dob: null });
  assert.equal(id, 42);
  assert.equal(seen.sql, 'INSERT INTO [patients] ([clinic_id], [name], [dob]) OUTPUT INSERTED.id VALUES (?, ?, ?)');
  assert.deepEqual(seen.params, [1, 'அனிதா', null]);
});

test('updateRow adds updated_at for tables that have it', async () => {
  let seen;
  const q = async (sql, params) => { seen = { sql, params }; return Object.assign([], { affectedRows: 1 }); };
  assert.equal(await updateRow(q, 'employees', { status: 'inactive' }, 'id = ?', [5]), 1);
  assert.equal(seen.sql, 'UPDATE [employees] SET [status] = ?, [updated_at] = NOW() WHERE id = ?');
  assert.deepEqual(seen.params, ['inactive', 5]);
  await updateRow(q, 'queue_entries', { status: 'done' }, 'id = ?', [1]);
  assert.equal(seen.sql, 'UPDATE [queue_entries] SET [status] = ? WHERE id = ?');
  await assert.rejects(insertRow(q, 'x; DROP', { a: 1 }), /Bad column/);
});

test('paging uses OFFSET … FETCH', () => {
  assert.equal(pageSql, 'OFFSET ? ROWS FETCH NEXT ? ROWS ONLY');
});
