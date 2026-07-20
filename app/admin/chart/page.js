'use client';

import { useEffect, useState } from 'react';
import { api } from '../api';

export default function ChartEditor() {
  const [year, setYear] = useState(2026);
  const [week, setWeek] = useState(1);
  const [rows, setRows] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  // thêm dòng
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);

  useEffect(() => {
    api('/api/admin/stats').then((s) => {
      if (s.settings?.currentYear) setYear(s.settings.currentYear);
    }).catch(() => {});
  }, []);

  async function load() {
    setBusy(true); setMsg(null);
    try {
      const d = await api(`/api/admin/chart/${year}/${week}`);
      setRows(d.rows.map((r) => ({ ...r })));
      setLoaded(true);
      if (!d.rows.length) setMsg({ type: 'ok', text: 'No data for this week yet — add songs then Save.' });
    } catch (e) { setMsg({ type: 'err', text: e.message }); }
    finally { setBusy(false); }
  }

  async function doSearch(v) {
    setSearch(v);
    if (v.trim().length < 2) { setResults([]); return; }
    try {
      const d = await api('/api/admin/tracks?limit=8&q=' + encodeURIComponent(v));
      const have = new Set(rows.map((r) => r.trackId));
      setResults(d.items.filter((t) => !have.has(t.id)));
    } catch { setResults([]); }
  }

  function addRow(t) {
    setRows([...rows, { trackId: t.id, name: t.name, artist: t.artist, rank: null, stream: 0 }]);
    setSearch(''); setResults([]);
  }
  function updateRow(i, key, val) {
    const next = [...rows]; next[i] = { ...next[i], [key]: val }; setRows(next);
  }
  function removeRow(i) { setRows(rows.filter((_, j) => j !== i)); }

  function sortByRank() {
    setRows([...rows].sort((a, b) => {
      const ra = a.rank == null ? 9999 : Number(a.rank);
      const rb = b.rank == null ? 9999 : Number(b.rank);
      return ra - rb;
    }));
  }

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const payload = rows.map((r) => ({
        trackId: r.trackId,
        rank: r.rank === '' || r.rank == null ? null : Number(r.rank),
        stream: Number(r.stream) || 0,
      }));
      const r = await api(`/api/admin/chart/${year}/${week}`, { method: 'PUT', body: { rows: payload } });
      setMsg({ type: 'ok', text: `Saved ${r.count} rows for week ${week}/${year}.` });
    } catch (e) { setMsg({ type: 'err', text: e.message }); }
    finally { setBusy(false); }
  }

  return (
    <>
      <div className="panel">
        <h2>Select week</h2>
        <div className="row">
          <div style={{ flex: '0 0 120px' }}>
            <label>Year</label>
            <input type="number" value={year} onChange={(e) => setYear(+e.target.value)} />
          </div>
          <div style={{ flex: '0 0 120px' }}>
            <label>Week</label>
            <input type="number" min="1" value={week} onChange={(e) => setWeek(+e.target.value)} />
          </div>
          <div style={{ alignSelf: 'flex-end' }}>
            <button onClick={load} disabled={busy}>Load week</button>
          </div>
        </div>
      </div>

      {loaded && (
        <div className="panel">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}>Week {week}/{year} — {rows.length} songs</h2>
            <div className="row">
              <button className="ghost sm" onClick={sortByRank}>Sort by rank</button>
              <button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save week'}</button>
            </div>
          </div>
          {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}

          <table>
            <thead>
              <tr><th style={{ width: 70 }}>Rank</th><th>Song</th><th>Artist</th><th style={{ width: 130 }}>Streams</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.trackId}>
                  <td><input type="number" value={r.rank ?? ''} placeholder="—"
                    onChange={(e) => updateRow(i, 'rank', e.target.value)} /></td>
                  <td>{r.name} <span className="muted" style={{ fontSize: 11 }}>{r.trackId}</span></td>
                  <td className="muted">{r.artist}</td>
                  <td><input type="number" value={r.stream}
                    onChange={(e) => updateRow(i, 'stream', e.target.value)} /></td>
                  <td><button className="danger sm" onClick={() => removeRow(i)}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ marginTop: 16, position: 'relative', maxWidth: 420 }}>
            <label>Add song to week</label>
            <input value={search} onChange={(e) => doSearch(e.target.value)} placeholder="Type name / artist / id…" />
            {results.length > 0 && (
              <div className="panel" style={{ position: 'absolute', zIndex: 5, width: '100%', marginTop: 4, padding: 6 }}>
                {results.map((t) => (
                  <div key={t.id} className="row" style={{ justifyContent: 'space-between', padding: '4px 6px' }}>
                    <span>{t.name} <span className="muted">— {t.artist}</span></span>
                    <button className="sm" onClick={() => addRow(t)}>Add</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            Note: the “Save week” button will <strong>replace all</strong> data for this week with the list above. Empty rank = has streams but not on the chart.
          </p>
        </div>
      )}
    </>
  );
}