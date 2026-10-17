import { useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useT } from '../lib/i18n.jsx';
import { Button, Input } from '../components/ui.jsx';
import { LangToggle } from '../components/Layout.jsx';

export default function Login() {
  const { login } = useAuth();
  const { t } = useT();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(username.trim(), password);
      window.location.hash = '/';
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-panel">
        <LangToggle className="login-lang" />
        <div className="brand brand-lg">
          <div className="brand-mark"><img src="/logo-128.png" alt="" /></div>
          <div>
            <strong>Ayush Pro</strong>
            <small>SmartClinic</small>
          </div>
        </div>
        <h1>{t('login.title')}</h1>
        <p className="muted">{t('login.subtitle')}</p>
        <form onSubmit={submit} className="stack">
          <Input label={t('login.username')} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required autoFocus />
          <Input label={t('login.password')} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          {error && <div className="alert alert-error">{error}</div>}
          <Button type="submit" loading={busy} className="btn-block">{t('login.submit')}</Button>
        </form>
      </div>
      <div className="login-art" aria-hidden>
        <div>
          <h2>{t('login.tagline')}</h2>
          <p>{t('login.taglineSub')}</p>
        </div>
      </div>
    </div>
  );
}
