// Lab Reports & Scans: Photo / PDF files uploaded with the vital signs of one queue entry.
// Rules (types, 5 MB limit) live in shared/attachments.js so the API checks exactly the same thing.
import { useEffect, useRef, useState } from 'react';
import { api, apiBlob, apiUpload } from '../lib/api.js';
import { useT } from '../lib/i18n.jsx';
import { fmtDate } from '../lib/format.js';
import { ATTACHMENT_TYPES, CATEGORY_MAX, checkAttachment, fileSize } from '../../../shared/attachments.js';
import { Button, Empty, ErrorBox, Input, Loading, Select, useAsync, useToast } from './ui.jsx';
import Icon from './Icon.jsx';

// showHead = false: just the files, without the "Lab Reports & Scans" heading (Examine → Vital signs)
export default function Attachments({ entry, canEdit = true, showHead = true }) {
  const { t } = useT();
  const toast = useToast();
  const fileInput = useRef(null);
  const cameraInput = useRef(null);
  const videoRef = useRef(null);
  const [stream, setStream] = useState(null);
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

  function pickFile(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) upload(f);
  }

  async function openCamera() {
    if (!navigator.mediaDevices?.getUserMedia) { cameraInput.current?.click(); return; }
    try {
      setStream(await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }));
    } catch {
      toast(t('attach.err.camera'), 'error');
    }
  }

  function closeCamera() {
    stream?.getTracks().forEach((tr) => tr.stop());
    setStream(null);
  }

  function capture() {
    const v = videoRef.current;
    if (!v?.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext('2d').drawImage(v, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
      closeCamera();
      upload(new File([blob], `photo-${stamp}.jpg`, { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.9);
  }

  // show the live camera in the <video>, and always release the camera when it closes or the pop-up goes away
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
    return () => stream?.getTracks().forEach((tr) => tr.stop());
  }, [stream]);

  // leaving Photo (or the pop-up) turns the camera off
  useEffect(() => { if (type !== 'photo') setStream(null); }, [type]);

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
      {showHead && (
        <header className="attach-head">
          <span className="attach-icon"><Icon name="folder" size={16} /></span>
          <div>
            <h3>{t('attach.title')}</h3>
            <p className="muted small">{t('attach.subtitle', { name: entry.patient_name })}</p>
          </div>
        </header>
      )}

      {canEdit && (
        <div className="attach-form">
          <Select label={t('attach.type')} required value={type} onChange={(e) => setType(e.target.value)}
            placeholder={t('attach.selectType')}
            options={Object.keys(ATTACHMENT_TYPES).map((k) => ({ value: k, label: t(`attach.type.${k}`) }))} />
          <Input label={t('attach.category')} value={category} maxLength={CATEGORY_MAX}
            placeholder={t('attach.categoryHint')} onChange={(e) => setCategory(e.target.value)} />
          {type === 'photo' ? (
            <div className="attach-btns">
              <Button type="button" variant="ghost" disabled={uploading || !!stream} onClick={openCamera}>
                <Icon name="camera" size={16} /> {t('attach.takePhoto')}
              </Button>
              <Button type="button" variant="ghost" loading={uploading} onClick={() => fileInput.current?.click()}>
                <Icon name="imagePlus" size={16} /> {t('attach.gallery')}
              </Button>
            </div>
          ) : (
            <Button type="button" disabled={!type} loading={uploading} title={!type ? t('attach.chooseTypeFirst') : undefined}
              onClick={() => fileInput.current?.click()}>
              <Icon name="upload" size={16} /> {t('attach.upload')}
            </Button>
          )}
          <input ref={fileInput} type="file" hidden accept={type ? ATTACHMENT_TYPES[type].accept : undefined} onChange={pickFile} />
          {/* fallback when the browser has no live camera access (e.g. plain http on a LAN address): phones open their camera app */}
          <input ref={cameraInput} type="file" hidden accept="image/*" capture="environment" onChange={pickFile} />
        </div>
      )}
      {canEdit && stream && (
        <div className="attach-camera">
          <video ref={videoRef} autoPlay playsInline muted />
          <div className="attach-btns">
            <Button type="button" loading={uploading} onClick={capture}>
              <Icon name="camera" size={16} /> {t('attach.capture')}
            </Button>
            <Button type="button" variant="ghost" onClick={closeCamera}>{t('common.cancel')}</Button>
          </div>
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
