'use client';

import { useEffect, useState } from 'react';
import { api } from '../api';
import { groupInt, onlyDigits } from '../format';

// Tính rank từ stream: xếp giảm dần -> stream>0 nhận #1..N; stream 0/rỗng = off-chart (null).
function withRanks(list) {
  const ordered = list
    .map((r, idx) => ({ id: r.trackId, s: Number(r.stream) || 0, idx }))
    .sort((a, b) => b.s - a.s || a.idx - b.idx);
  const rankById = {};
  let rank = 0;
  for (const it of ordered) rankById[it.id] = it.s > 0 ? ++rank : null;
  return list.map((r) => ({ ...r, rank: rankById[r.trackId] }));
}

export default function ChartEditor() {
  const [year, setYear] = useState(2026);
  const [week, setWeek] = useState(1);
  const [rows, setRows] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [decay, setDecay] = useState(15); // % giảm stream khi kéo bài từ tuần trước sang

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
      setRows(withRanks(d.rows.map((r) => ({ ...r }))));
      setLoaded(true);
      if (!d.rows.length) setMsg({ type: 'ok', text: 'No data for this week yet — add songs or init from the previous week, then Save.' });
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
    setRows(withRanks([...rows, { trackId: t.id, name: t.name, artist: t.artist, rank: null, stream: 0 }]));
    setSearch(''); setResults([]);
  }
  function updateRow(i, key, val) {
    const next = [...rows]; next[i] = { ...next[i], [key]: val };
    // stream đổi -> rank tự tính lại (không đổi thứ tự hàng để giữ con trỏ đang gõ)
    setRows(key === 'stream' ? withRanks(next) : next);
  }
  function removeRow(i) { setRows(withRanks(rows.filter((_, j) => j !== i))); }

  // Kéo toàn bộ bài của tuần liền trước sang, giảm stream đồng bộ theo % (decay).
  async function carryPrev() {
    const pw = week > 1 ? { y: year, w: week - 1 } : { y: year - 1, w: 52 };
    const pct = Math.min(100, Math.max(0, Number(decay) || 0));
    const factor = 1 - pct / 100;
    setBusy(true); setMsg(null);
    try {
      const d = await api(`/api/admin/chart/${pw.y}/${pw.w}`);
      if (!d.rows.length) { setMsg({ type: 'err', text: `Week ${pw.w}/${pw.y} has no data to carry over.` }); return; }
      const carried = d.rows.map((r) => ({
        trackId: r.trackId, name: r.name, artist: r.artist,
        rank: null, stream: Math.max(0, Math.round((r.stream || 0) * factor)),
      }));
      setRows(withRanks(carried)); setLoaded(true);
      setMsg({ type: 'ok', text: `Carried ${carried.length} songs from week ${pw.w}/${pw.y}, streams −${pct}%. Review, then Save.` });
    } catch (e) { setMsg({ type: 'err', text: e.message }); }
    finally { setBusy(false); }
  }

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
        <div className="row" style={{ marginTop: 12, alignItems: 'flex-end' }}>
          <div style={{ flex: '0 0 150px' }}>
            <label>Carry-over decay %</label>
            <input type="number" min="0" max="100" value={decay} onChange={(e) => setDecay(e.target.value)} />
          </div>
          <div>
            <button className="ghost" onClick={carryPrev} disabled={busy}>Init from previous week (−{Math.min(100, Math.max(0, Number(decay) || 0))}%)</button>
          </div>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          Starting a fresh week? Pull every song from the previous week with all streams cut by the % above, then fine-tune. Ranks recompute from streams automatically.
        </p>
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
                  <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }} className={r.rank == null ? 'muted' : ''}>{r.rank ?? '—'}</td>
                  <td>{r.name} <span className="muted" style={{ fontSize: 11 }}>{r.trackId}</span></td>
                  <td className="muted">{r.artist}</td>
                  <td><input inputMode="numeric" value={groupInt(r.stream)}
                    onChange={(e) => updateRow(i, 'stream', onlyDigits(e.target.value))} /></td>
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
            Note: the “Save week” button will <strong>replace all</strong> data for this week with the list above. Rank is auto-calculated from streams (highest = #1); songs with blank/0 streams are off-chart.
          </p>
        </div>
      )}
    </>
  );
}