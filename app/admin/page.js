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
        text: `Processed ${r.processed}: ok ${r.ok}, none ${r.none}, errors ${r.failed}. Still pending: ${r.remaining}.`,
      });
      await load();
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
    } finally {
      setBusy(false);
    }
  }

  if (!stats) return <div className="muted">{msg ? msg.text : 'Loading…'}</div>;

  return (
    <>
      <div className="panel">
        <h2>Overview</h2>
        <div className="grid-cards">
          <div className="card"><div className="num">{stats.tracks}</div><div className="lbl">Songs</div></div>
          <div className="card"><div className="num">{stats.entries}</div><div className="lbl">Weekly entries</div></div>
          <div className="card"><div className="num">{stats.years.join(', ') || '—'}</div><div className="lbl">Years with data</div></div>
          <div className="card"><div className="num">{stats.artwork.ok}</div><div className="lbl">Has cover art</div></div>
          <div className="card"><div className="num">{stats.genre?.filled ?? 0}</div><div className="lbl">Has genre</div></div>
        </div>
      </div>

      <div className="panel">
        <h2>Cover art (iTunes)</h2>
        {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}
        <div className="row">
          <span className="pill ok">ok {stats.artwork.ok}</span>
          <span className="pill pending">pending {stats.artwork.pending}</span>
          <span className="pill none">none {stats.artwork.none}</span>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <button onClick={() => refreshArtwork(false)} disabled={busy || stats.artwork.pending === 0}>
            {busy ? 'Fetching…' : `Fetch artwork for ${stats.artwork.pending} pending songs (25/run)`}
          </button>
          <button className="ghost" onClick={() => refreshArtwork(true)} disabled={busy}>
            Retry the “none” songs too
          </button>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          Artwork is fetched server-side using the primary artist (artists[0]), so collab songs with commas are handled too.
          The same iTunes lookup also <strong>auto-fills the genre</strong> for songs that don’t have one yet
          ({stats.genre?.missing ?? 0} still missing) — no extra requests.
        </p>
      </div>
    </>
  );
}