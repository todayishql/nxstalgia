'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '../api';
import { GENDERS, REGIONS } from '@/lib/artists';

export default function ArtistsPage() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [missing, setMissing] = useState(''); // '' | 'gender' | 'region'
  const [sortField, setSortField] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const [page, setPage] = useState(0);
  const [pageSize] = useState(100);
  const [selected, setSelected] = useState(new Set());
  const [bulkGender, setBulkGender] = useState('');
  const [bulkRegion, setBulkRegion] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        limit: String(pageSize), skip: String(page * pageSize),
        sort: sortField, dir: sortDir, q: query, missing,
      });
      const d = await api('/api/admin/artists?' + params.toString());
      setItems(d.items); setTotal(d.total);
    } catch (e) { setMsg({ type: 'err', text: e.message }); }
  }, [pageSize, page, sortField, sortDir, query, missing]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setTimeout(() => { setQuery(q.trim()); setPage(0); }, 300);
    return () => clearTimeout(id);
  }, [q]);

  const pages = Math.max(1, Math.ceil(total / pageSize));
  function flash(type, text) { setMsg({ type, text }); }
  function sortBy(field) {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir(field === 'tracks' ? 'desc' : 'asc'); }
    setPage(0);
  }
  const arrow = (f) => (sortField === f ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');

  // Sửa 1 field (gender/region) 1 nghệ sĩ, lưu ngay -> điền nhanh.
  async function setField(row, field, value) {
    setItems((prev) => prev.map((r) => (r.key === row.key ? { ...r, [field]: value, saved: true } : r)));
    try {
      await api('/api/admin/artists', { method: 'PATCH', body: { items: [{ key: row.key, name: row.name }], [field]: value } });
    } catch (e) { flash('err', e.message); load(); }
  }

  async function applyBulk(field, value) {
    const rows = items.filter((r) => selected.has(r.key));
    if (!rows.length) return;
    setBusy(true);
    try {
      const r = await api('/api/admin/artists', { method: 'PATCH', body: { items: rows.map((x) => ({ key: x.key, name: x.name })), [field]: value } });
      flash('ok', `Set ${field} "${value || '(cleared)'}" on ${r.matched + r.upserted} artist(s).`);
      setSelected(new Set()); setBulkGender(''); setBulkRegion(''); load();
    } catch (e) { flash('err', e.message); }
    finally { setBusy(false); }
  }

  async function sync() {
    setBusy(true);
    try {
      const r = await api('/api/admin/artists/sync', { method: 'POST' });
      flash('ok', `Synced. ${r.created} new artist(s) added · ${r.totalArtists} total.`);
      load();
    } catch (e) { flash('err', e.message); }
    finally { setBusy(false); }
  }

  async function remove(row) {
    if (!row.saved) return;
    if (!confirm(`Delete saved metadata for "${row.name}"? (songs are not affected)`)) return;
    try {
      await api('/api/admin/artists', { method: 'DELETE', body: { keys: [row.key] } });
      flash('ok', `Cleared metadata: ${row.name}`); load();
    } catch (e) { flash('err', e.message); }
  }

  function toggle(key) {
    setSelected((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }
  function toggleAll() {
    setSelected((prev) => {
      const keys = items.map((r) => r.key);
      const allOn = keys.length > 0 && keys.every((k) => prev.has(k));
      return allOn ? new Set() : new Set(keys);
    });
  }
  const allOn = items.length > 0 && items.every((r) => selected.has(r.key));

  // đếm nhanh còn thiếu (trên trang hiện tại)
  const missingGender = items.filter((r) => !r.gender).length;

  return (
    <>
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0 }}>Artists ({total})</h2>
            <span className="muted" style={{ fontSize: 12 }}>
              Tag gender &amp; region for each artist — powers the viewer’s Male/Female/Group chart and region filters. Data is filled in manually here.
            </span>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ position: 'relative' }}>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search artist…" style={{ minWidth: 200, paddingRight: q ? 26 : undefined }} />
              {q && (
                <button type="button" className="ghost sm" onClick={() => setQ('')} aria-label="Clear search"
                  style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', padding: '0 6px', border: 'none', background: 'none' }}>×</button>
              )}
            </div>
            <select value={missing} onChange={(e) => { setMissing(e.target.value); setPage(0); }}>
              <option value="">All artists</option>
              <option value="gender">Missing gender</option>
              <option value="region">Missing region</option>
            </select>
            <button className="ghost sm" onClick={sync} disabled={busy}>{busy ? 'Syncing…' : 'Sync from songs'}</button>
          </div>
        </div>

        {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}

        {selected.size > 0 && (
          <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center', margin: '8px 0' }}>
            <strong style={{ fontSize: 13 }}>{selected.size} selected:</strong>
            <span className="row" style={{ gap: 4 }}>
              <select value={bulkGender} onChange={(e) => setBulkGender(e.target.value)}>
                <option value="">Gender…</option>
                {GENDERS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
              </select>
              <button className="sm" onClick={() => applyBulk('gender', bulkGender)} disabled={busy}>Set</button>
            </span>
            <span className="row" style={{ gap: 4 }}>
              <select value={bulkRegion} onChange={(e) => setBulkRegion(e.target.value)}>
                <option value="">Region…</option>
                {REGIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
              <button className="sm" onClick={() => applyBulk('region', bulkRegion)} disabled={busy}>Set</button>
            </span>
          </div>
        )}

        <div className="row" style={{ gap: 6, margin: '8px 0 4px' }}>
          <button className="ghost sm" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page <= 0}>‹ Prev</button>
          <span className="muted" style={{ fontSize: 12 }}>Page {page + 1} / {pages} · {items.length} of {total} · {missingGender} missing gender on page</span>
          <button className="ghost sm" onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1}>Next ›</button>
        </div>

        <table>
          <thead>
            <tr>
              <th style={{ width: 28 }}><input type="checkbox" checked={allOn} onChange={toggleAll} aria-label="Select all" /></th>
              <th className="sortable" onClick={() => sortBy('name')}>Artist{arrow('name')}</th>
              <th className="sortable" onClick={() => sortBy('tracks')}>Songs{arrow('tracks')}</th>
              <th>Gender</th>
              <th>Region</th>
              <th>Song genres</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.key} className={selected.has(r.key) ? 'sel' : ''}>
                <td><input type="checkbox" checked={selected.has(r.key)} onChange={() => toggle(r.key)} aria-label={`Select ${r.name}`} /></td>
                <td>{r.name}{!r.saved && <span className="muted" style={{ fontSize: 11 }}> · unsaved</span>}</td>
                <td className="muted">{r.trackCount}</td>
                <td>
                  <select value={r.gender} onChange={(e) => setField(r, 'gender', e.target.value)}>
                    <option value="">—</option>
                    {GENDERS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                  </select>
                </td>
                <td>
                  <select value={r.region} onChange={(e) => setField(r, 'region', e.target.value)}>
                    <option value="">—</option>
                    {REGIONS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
                  </select>
                </td>
                <td className="muted" style={{ fontSize: 12 }}>{r.trackGenres.length ? r.trackGenres.join(', ') : '—'}</td>
                <td>{r.saved && <button className="danger sm" onClick={() => remove(r)}>Clear</button>}</td>
              </tr>
            ))}
            {!items.length && <tr><td colSpan={7}><div className="muted" style={{ padding: 12 }}>No artists. Click “Sync from songs”.</div></td></tr>}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          <strong>Sync from songs</strong> scans every song’s artist list and adds any new artist (metadata blank). Existing tags are kept.
          Set <strong>gender</strong> (Male / Female / Group) and <strong>region</strong> (ASIA / US-UK) inline, or tick several and use the bulk bar.
          “Clear” only removes the saved tags — it never deletes songs.
        </p>
      </div>
    </>
  );
}
