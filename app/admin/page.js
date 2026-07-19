'use client';

import { useEffect, useState } from 'react';
import { api } from './api';

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try { setStats(await api('/api/admin/stats')); }
    catch (e) { setMsg({ type: 'err', text: e.message }); }
  }
  useEffect(() => { load(); }, []);

  async function refreshArtwork(retryNone = false) {
    setBusy(true); setMsg(null);
    try {
      const r = await api('/api/admin/artwork', { method: 'POST', body: { limit: 25, retryNone } });
      setMsg({
        type: 'ok',
        text: `Đã xử lý ${r.processed}: ok ${r.ok}, không có ${r.none}, lỗi ${r.failed}. Còn pending: ${r.remaining}.`,
      });
      await load();
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
    } finally {
      setBusy(false);
    }
  }

  if (!stats) return <div className="muted">{msg ? msg.text : 'Đang tải…'}</div>;

  return (
    <>
      <div className="panel">
        <h2>Tổng quan</h2>
        <div className="grid-cards">
          <div className="card"><div className="num">{stats.tracks}</div><div className="lbl">Bài hát</div></div>
          <div className="card"><div className="num">{stats.entries}</div><div className="lbl">Bản ghi tuần (entries)</div></div>
          <div className="card"><div className="num">{stats.years.join(', ') || '—'}</div><div className="lbl">Năm có dữ liệu</div></div>
          <div className="card"><div className="num">{stats.artwork.ok}</div><div className="lbl">Có ảnh bìa</div></div>
        </div>
      </div>

      <div className="panel">
        <h2>Ảnh bìa (iTunes)</h2>
        {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}
        <div className="row">
          <span className="pill ok">ok {stats.artwork.ok}</span>
          <span className="pill pending">pending {stats.artwork.pending}</span>
          <span className="pill none">không có {stats.artwork.none}</span>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <button onClick={() => refreshArtwork(false)} disabled={busy || stats.artwork.pending === 0}>
            {busy ? 'Đang tra…' : `Tra ảnh cho ${stats.artwork.pending} bài pending (25/lần)`}
          </button>
          <button className="ghost" onClick={() => refreshArtwork(true)} disabled={busy}>
            Thử lại cả những bài “không có”
          </button>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          Ảnh được tra phía server bằng nghệ sĩ chính (artists[0]) nên xử lý được cả bài collab có dấu phẩy.
        </p>
      </div>
    </>
  );
}