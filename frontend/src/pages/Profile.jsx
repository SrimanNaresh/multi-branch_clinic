import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useT } from '../lib/i18n.jsx';
import { Button, Card, Input, PageHeader, useToast } from '../components/ui.jsx';

export default function Profile() {
  const { user } = useAuth();
  const { t } = useT();
  const toast = useToast();
  const [f, setF] = useState({ current_password: '', new_password: '', confirm: '' });
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (f.new_password !== f.confirm) return toast(t('profile.mismatch'), 'error');
    setBusy(true);
    try {
      await api('/auth/change-password', { method: 'POST', body: { current_password: f.current_password, new_password: f.new_password } });
      toast(t('profile.changed'));
      setF({ current_password: '', new_password: '', confirm: '' });
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title={user.name} subtitle={`${user.emp_code} · ${t(`role.${user.role}`)}${user.clinic_name ? ' · ' + user.clinic_name : ''}`} />
      <Card title={t('profile.changePassword')} className="narrow">
        <form onSubmit={submit} className="stack">
          <Input type="password" label={t('profile.current')} value={f.current_password} onChange={(e) => setF({ ...f, current_password: e.target.value })} required />
          <Input type="password" label={t('profile.new')} value={f.new_password} minLength={6} onChange={(e) => setF({ ...f, new_password: e.target.value })} required />
          <Input type="password" label={t('profile.confirm')} value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} required />
          <div><Button type="submit" loading={busy}>{t('common.save')}</Button></div>
        </form>
      </Card>
    </>
  );
}
