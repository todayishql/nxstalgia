'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../api';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [needBootstrap, setNeedBootstrap] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  // Nếu đã đăng nhập -> vào admin luôn.
  useEffect(() => {
    api('/api/auth/me').then((d) => { if (d.user) router.replace('/admin'); }).catch(() => {});
  }, [router]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const path = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
      await api(path, { method: 'POST', body: { email, password } });
      router.replace('/admin');
    } catch (err) {
      // Chưa có user nào -> gợi ý đăng ký admin đầu tiên.
      if (mode === 'login' && err.status === 401) {
        setMsg({ type: 'err', text: err.message + ' (nếu chưa có tài khoản, chuyển sang Đăng ký).' });
      } else {
        setMsg({ type: 'err', text: err.message });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="panel">
        <h2>{mode === 'register' ? 'Đăng ký admin' : 'Đăng nhập'}</h2>
        {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}
        <form onSubmit={submit}>
          <label>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          <label>Mật khẩu</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <div className="row" style={{ marginTop: 16 }}>
            <button type="submit" disabled={busy}>
              {busy ? '...' : mode === 'register' ? 'Tạo tài khoản' : 'Đăng nhập'}
            </button>
            <button type="button" className="ghost" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setMsg(null); }}>
              {mode === 'login' ? 'Đăng ký admin đầu tiên' : 'Quay lại đăng nhập'}
            </button>
          </div>
        </form>
        <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>
          Lần đầu chưa có tài khoản: dùng “Đăng ký admin đầu tiên”, hoặc chạy <code>npm run create-admin</code>.
        </p>
      </div>
    </div>
  );
}
