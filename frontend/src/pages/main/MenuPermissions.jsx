// Main Clinic → Menu Permission: pick an employee, tick the menus / actions they may use.
// Starts from the role's defaults; only the differences are saved (see shared/permissions.js).
import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useT } from '../../lib/i18n.jsx';
import { PERMISSION_GROUPS } from '../../../../shared/permissions.js';
import { Badge, Button, Card, Empty, ErrorBox, Loading, PageHeader, SearchBox, useAsync, useDebounced, useToast } from '../../components/ui.jsx';

function EmployeePicker({ selectedId, onSelect }) {
  const { t } = useT();
  const auth = useAuth();
  const [q, setQ] = useState('');
  const [clinic, setClinic] = useState('all');
  const dq = useDebounced(q);
  const list = useAsync(() => api('/employees', { query: { q: dq, clinic_id: clinic, status: 'active', limit: 100 }, clinic: null }), [dq, clinic]);

  return (
    <Card title={t('perms.employees')} className="perm-picker">
      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder={t('employees.searchHint')} />
        <select value={clinic} onChange={(e) => setClinic(e.target.value)} aria-label={t('field.clinic')}>
          <option value="all">{t('topbar.allClinics')}</option>
          <option value="main">{t('unit.main')}</option>
          {auth.clinics.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
        </select>
      </div>
      {list.loading && !list.data ? <Loading /> : <ErrorBox error={list.error} onRetry={list.reload} />}
      {list.data && !list.data.rows.length && <Empty>{t('common.noRecords')}</Empty>}
      <ul className="perm-people">
        {list.data?.rows.map((e) => (
          <li key={e.id}>
            <button type="button" className={String(e.id) === String(selectedId) ? 'on' : ''} onClick={() => onSelect(e.id)}>
              <span><b>{e.name}</b><small className="muted">{e.emp_code} · {e.clinic_name || t('unit.main')}</small></span>
              <Badge>{t(`role.${e.role}`)}</Badge>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function PermissionEditor({ employeeId }) {
  const { t } = useT();
  const toast = useToast();
  const info = useAsync(() => api(`/permissions/${employeeId}`, { clinic: null }), [employeeId]);
  const [checked, setChecked] = useState(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (info.data) setChecked(new Set(info.data.permissions)); }, [info.data]);

  if (info.loading && !info.data) return <Card><Loading /></Card>;
  if (info.error) return <Card><ErrorBox error={info.error} onRetry={info.reload} /></Card>;
  const d = info.data;
  const roleSet = new Set(d.role_permissions);
  const grantable = new Set(d.grantable);
  const locked = d.locked;
  const dirty = d.permissions.length !== checked.size || d.permissions.some((p) => !checked.has(p));
  const custom = [...checked].some((p) => !roleSet.has(p)) || [...roleSet].some((p) => grantable.has(p) && !checked.has(p));

  const toggle = (p, on) => setChecked((s) => { const n = new Set(s); if (on) n.add(p); else n.delete(p); return n; });
  const toggleGroup = (perms, on) => setChecked((s) => {
    const n = new Set(s);
    for (const p of perms) if (grantable.has(p)) { if (on) n.add(p); else n.delete(p); }
    return n;
  });

  async function save() {
    setSaving(true);
    try {
      await api(`/permissions/${employeeId}`, { method: 'PUT', body: { permissions: [...checked] }, clinic: null });
      toast(t('perms.saved', { name: d.employee.name }));
      info.reload();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      title={<>{d.employee.name} <span className="muted small">{d.employee.emp_code} · {t(`role.${d.employee.role}`)} · {d.employee.clinic_name || t('unit.main')}</span></>}
      actions={custom ? <Badge tone="info">{t('perms.custom')}</Badge> : <Badge>{t('perms.roleDefault')}</Badge>}
    >
      {locked && <div className="alert alert-warning">{locked}</div>}
      <div className="perm-groups">
        {PERMISSION_GROUPS.map((g) => {
          const usable = g.perms.filter((p) => grantable.has(p));
          const allOn = usable.length > 0 && usable.every((p) => checked.has(p));
          return (
            <section key={g.id} className="perm-group">
              <header>
                <label className="check">
                  <input type="checkbox" checked={allOn} disabled={!!locked || !usable.length}
                    onChange={(e) => toggleGroup(g.perms, e.target.checked)} />
                  <b>{t(g.label)}</b>
                </label>
              </header>
              {g.perms.map((p) => {
                const can = grantable.has(p);
                const on = checked.has(p);
                const changed = can && on !== roleSet.has(p);
                return (
                  <label key={p} className={`check perm-item ${changed ? 'changed' : ''} ${!can ? 'disabled' : ''}`}>
                    <input type="checkbox" checked={on} disabled={!!locked || !can} onChange={(e) => toggle(p, e.target.checked)} />
                    <span>{t(`perm.${p}`)}</span>
                    {!can && d.employee.role !== 'super_admin' && <small className="muted">{t('perms.mainOnly')}</small>}
                    {changed && <Badge tone={on ? 'success' : 'danger'}>{on ? t('perms.added') : t('perms.removed')}</Badge>}
                  </label>
                );
              })}
            </section>
          );
        })}
      </div>
      <p className="muted small">{t('perms.hint')}</p>
      {!locked && (
        <div className="form-actions">
          <Button type="button" variant="ghost" disabled={!custom}
            onClick={() => setChecked(new Set(d.role_permissions.filter((p) => grantable.has(p) || roleSet.has(p))))}>
            {t('perms.reset')}
          </Button>
          <Button type="button" onClick={save} loading={saving} disabled={!dirty}>{t('common.save')}</Button>
        </div>
      )}
    </Card>
  );
}

export default function MenuPermissions() {
  const { t } = useT();
  const [employeeId, setEmployeeId] = useState(null);
  const editorRef = useRef(null);
  const pick = (id) => {
    setEmployeeId(id);
    // one-column layout (phones / small tablets): the editor is below the list
    if (window.matchMedia('(max-width: 640px)').matches) setTimeout(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };
  return (
    <>
      <PageHeader title={t('menu.menuPermission')} subtitle={t('perms.subtitle')} />
      <div className="perm-layout">
        <EmployeePicker selectedId={employeeId} onSelect={pick} />
        <div ref={editorRef} className="perm-editor">
          {employeeId ? <PermissionEditor employeeId={employeeId} /> : <Card><Empty>{t('perms.pick')}</Empty></Card>}
        </div>
      </div>
    </>
  );
}
