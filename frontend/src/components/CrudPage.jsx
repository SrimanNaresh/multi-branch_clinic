// Generic "list + add/edit in a dialog" page, used for Clinics, Pharmacies, Labs and Suppliers.
import { useState } from 'react';
import { api } from '../lib/api.js';
import { useT } from '../lib/i18n.jsx';
import { navigate } from '../lib/router.jsx';
import {
  Button, Card, DataTable, ErrorBox, Input, Loading, Modal, PageHeader, SearchBox, Select, TextArea,
  StatusBadge, useAsync, useDebounced, useToast,
} from './ui.jsx';
import Icon from './Icon.jsx';

/**
 * fields: [{ name, label, type?, required?, options?, upper?, full?, hint? }]
 * columns: DataTable columns (an "edit" column is added automatically when canEdit)
 * filters: optional element rendered next to the search box
 * extraQuery: extra list query params (e.g. { clinic_id })
 */
export default function CrudPage({
  title, subtitle, endpoint, fields, columns, defaults = {}, canEdit = true, filters, extraQuery = {}, clinic, addLabel, onSaved,
  compact = false,    // tighter header, toolbar and rows (Pharmacy → Vendor → List)
  addPath, editPath,  // add / edit on a page of its own (Pharmacy → Vendor) instead of the dialog: '/x/new', (row) => '/x/1/edit'
}) {
  const { t } = useT();
  const toast = useToast();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [editing, setEditing] = useState(null);   // null | {} (new) | row
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const list = useAsync(() => api(endpoint, { query: { q: dq, ...extraQuery }, clinic }), [endpoint, dq, JSON.stringify(extraQuery), clinic]);

  function open(row) {
    setEditing(row || {});
    setFormError('');
    const v = { status: 'active', ...defaults };
    for (const f of fields) if (row && row[f.name] !== undefined) v[f.name] = row[f.name] ?? '';
    setValues(v);
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      const body = { ...values };
      for (const f of fields) if (f.upper && body[f.name]) body[f.name] = String(body[f.name]).toUpperCase();
      if (editing.id) await api(`${endpoint}/${editing.id}`, { method: 'PUT', body, clinic });
      else await api(endpoint, { method: 'POST', body, clinic });
      toast(t('common.saved'));
      setEditing(null);
      list.reload();
      onSaved?.();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const set = (name) => (e) => setValues((v) => ({ ...v, [name]: e.target.value }));
  const renderField = (f) => {
    const common = { label: f.label, required: f.required, value: values[f.name] ?? '', onChange: set(f.name), hint: f.hint, full: f.full };
    if (f.type === 'select') return <Select key={f.name} {...common} options={f.options} placeholder={f.required ? undefined : '—'} />;
    if (f.type === 'textarea') return <TextArea key={f.name} {...common} rows={2} />;
    return <Input key={f.name} {...common} type={f.type || 'text'} step={f.type === 'number' ? '0.01' : undefined}
      style={f.upper ? { textTransform: 'uppercase' } : undefined} maxLength={f.maxLength} />;
  };

  const cols = canEdit
    ? [...columns, {
      key: '_edit', label: '', className: 'col-actions',
      render: (r) => <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); if (editPath) navigate(editPath(r)); else open(r); }}><Icon name="edit" size={15} /> {t('common.edit')}</Button>,
    }]
    : columns;

  return (
    <>
      <PageHeader title={title} subtitle={subtitle} compact={compact}
        actions={canEdit && <Button size={compact ? 'sm' : undefined} onClick={() => (addPath ? navigate(addPath) : open(null))}><Icon name="plus" size={16} /> {addLabel || t('common.add')}</Button>} />
      <Card className={compact ? 'crud-compact' : undefined}>
        <div className="toolbar">
          <SearchBox value={q} onChange={setQ} placeholder={t('common.search')} />
          {filters}
        </div>
        {list.loading && !list.data ? <Loading /> : <ErrorBox error={list.error} onRetry={list.reload} />}
        {list.data && <DataTable columns={cols} rows={list.data.rows} />}
      </Card>

      {editing && (
        <Modal title={editing.id ? `${t('common.edit')} – ${editing.name}` : addLabel || t('common.add')} onClose={() => setEditing(null)}>
          <form onSubmit={save} className="form-grid">
            {fields.map(renderField)}
            <Select label={t('field.status')} value={values.status || 'active'} onChange={set('status')}
              options={[{ value: 'active', label: t('status.active') }, { value: 'inactive', label: t('status.inactive') }]} />
            {formError && <div className="alert alert-error field-full">{formError}</div>}
            <div className="form-actions field-full">
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
              <Button type="submit" loading={saving}>{t('common.save')}</Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

export const statusColumn = (t) => ({ key: 'status', label: t('field.status'), render: (r) => <StatusBadge status={r.status} /> });
