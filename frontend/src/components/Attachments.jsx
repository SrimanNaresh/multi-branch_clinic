// Lab Reports & Scans: Photo / PDF files uploaded with the vital signs of one queue entry.
// Rules (types, 5 MB limit) live in shared/attachments.js so the API checks exactly the same thing.
import { useRef, useState } from 'react';
import { api, apiBlob, apiUpload } from '../lib/api.js';
import { useT } from '../lib/i18n.jsx';
import { fmtDate } from '../lib/format.js';
import { ATTACHMENT_TYPES, CATEGORY_MAX, checkAttachment, fileSize } from '../../../shared/attachments.js';
import { Button, Empty, ErrorBox, Input, Loading, Select, useAsync, useToast } from './ui.jsx';
import Icon from './Icon.jsx';

export default function Attachments({ entry, canEdit = true }) {
  const { t } = useT();
  const toast = useToast();
  const fileInput = useRef(null);
  const [type, setType] = useState('');
  const [category, setCategory] = useState('');
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const list = useAsync(() => api(`/queue/${entry.id}/attachments`), [entry.id]);

  async function upload(file) {
    const err = checkAttachment({ type, mime: file.type, size: file.size, category });
    if (err) { toast(t(`attach.err.${err}`), 'error'); return; }
    setUploading(true);
    try {
      await apiUpload(`/queue/${entry.id}/attachments`, file, { query: { type, category: category.trim(), name: file.name } });
      toast(t('attach.uploaded', { name: file.name }));
      setCategory('');
      list.reload();
    } catch (ex) {
      toast(ex.message, 'error');
    } finally {
      setUploading(false);
    }
  }

  async function view(a) {
    // open the tab right away (inside the click) so the browser does not block it, then load the file into it
    const win = window.open('', '_blank');
    setBusyId(a.id);
    try {
      const blob = await apiBlob(`/queue/attachments/${a.id}/file`);
      const url = URL.createObjectURL(blob);
      if (win) win.location.href = url; else window.location.assign(url);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (ex) {
      win?.close();
      toast(ex.message, 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(a) {
    if (!window.confirm(t('attach.deleteConfirm', { name: a.file_name }))) return;
    setBusyId(a.id);
    try {
      await api(`/queue/attachments/${a.id}`, { method: 'DELETE' });
      list.reload();
    } catch (ex) {
      toast(ex.message, 'error');
    } finally {
      setBusyId(null);
    }
  }

  const rows = list.data?.rows || [];
  return (
    <section className="attach">
      <header className="attach-head">
        <span className="attach-icon"><Icon name="folder" size={16} /></span>
        <div>
          <h3>{t('attach.title')}</h3>
          <p className="muted small">{t('attach.subtitle', { name: entry.patient_name })}</p>
        </div>
      </header>

      {canEdit && (
        <div className="attach-form">
          <Select label={t('attach.type')} required value={type} onChange={(e) => setType(e.target.value)}
            placeholder={t('attach.selectType')}
            options={Object.keys(ATTACHMENT_TYPES).map((k) => ({ value: k, label: t(`attach.type.${k}`) }))} />
          <Input label={t('attach.category')} value={category} maxLength={CATEGORY_MAX}
            placeholder={t('attach.categoryHint')} onChange={(e) => setCategory(e.target.value)} />
          <Button type="button" disabled={!type} loading={uploading} title={!type ? t('attach.chooseTypeFirst') : undefined}
            onClick={() => fileInput.current?.click()}>
            <Icon name="upload" size={16} /> {t('attach.upload')}
          </Button>
          <input ref={fileInput} type="file" hidden accept={type ? ATTACHMENT_TYPES[type].accept : undefined}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f); }} />
        </div>
      )}
      {canEdit && <p className="muted small attach-hint">{t('attach.limits')}</p>}

      <div className="attach-list">
        {list.loading && !list.data ? <Loading /> : <ErrorBox error={list.error} onRetry={list.reload} />}
        {list.data && !rows.length && <Empty>{t('attach.none')}</Empty>}
        {rows.length > 0 && (
          <ul>
            {rows.map((a) => (
              <li key={a.id}>
                <span className={`attach-kind kind-${a.file_type}`}><Icon name={a.file_type === 'pdf' ? 'file' : 'image'} size={16} /></span>
                <span className="attach-main">
                  <b title={a.file_name}>{a.file_name}</b>
                  <span className="muted small">
                    {[a.category, t(`attach.type.${a.file_type}`), fileSize(a.size_bytes), fmtDate(a.uploaded_at, true), a.uploaded_by_name].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="attach-actions">
                  <Button type="button" size="sm" variant="ghost" loading={busyId === a.id} onClick={() => view(a)}>
                    <Icon name="eye" size={14} /> {t('common.view')}
                  </Button>
                  {canEdit && (
                    <button type="button" className="icon-btn" title={t('attach.delete')} aria-label={t('attach.delete')}
                      disabled={busyId === a.id} onClick={() => remove(a)}>
                      <Icon name="trash" size={15} />
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
