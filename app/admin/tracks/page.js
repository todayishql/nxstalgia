'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../api';
import { groupInt, onlyDigits } from '../format';
import { parseCsv, toCsv } from '../csv';

const EMPTY = { name: '', artist: '', baseline: '', artworkUrl: '' };

export default function TracksPage() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState(''); // truy vấn đã áp dụng (khác ô nhập q)
  const [msg, setMsg] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null); // id đang sửa
  const [edit, setEdit] = useState({});
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  // phân trang + sort
  const [pageSize, setPageSize] = useState(100);
  const [sizeInput, setSizeInput] = useState('100');
  const [page, setPage] = useState(0);
  const [sortField, setSortField] = useState('name');
  const [sortDir, setSortDir] = useState('asc');

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        limit: String(pageSize), skip: String(page * pageSize),
        sort: sortField, dir: sortDir, q: query,
      });
      const d = await api('/api/admin/tracks?' + params.toString());
      setItems(d.items); setTotal(d.total);
    } catch (e) { setMsg({ type: 'err', text: e.message }); }
  }, [pageSize, page, sortField, sortDir, query]);

  useEffect(() => { load(); }, [load]);

  const pages = Math.max(1, Math.ceil(total / pageSize));
  function sortBy(field) {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('asc'); }
    setPage(0);
  }
  function applySize() {
    const n = Math.max(1, Math.min(500, parseInt(sizeInput, 10) || 100));
    setSizeInput(String(n)); setPageSize(n); setPage(0);
  }
  function runSearch() { setQuery(q.trim()); setPage(0); }
  const arrow = (f) => (sortField === f ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');

  function flash(type, text) { setMsg({ type, text }); }

  async function create(e) {
    e.preventDefault();
    try {
      const r = await api('/api/admin/tracks', {
        method: 'POST',
        body: { name: form.name, artist: form.artist, baseline: form.baseline, artworkUrl: form.artworkUrl },
      });
      setForm(EMPTY); flash('ok', `Added song: ${r.track.name} (${r.track.id})`); load();
    } catch (err) { flash('err', err.message); }
  }

  async function saveEdit(id) {
    try {
      // gửi kèm artworkUrl + refetchArtwork:false -> sửa metadata KHÔNG làm mất ảnh bìa
      await api('/api/admin/tracks/' + encodeURIComponent(id), {
        method: 'PUT',
        body: { ...edit, refetchArtwork: false },
      });
      setEditing(null); flash('ok', 'Saved: ' + id); load();
    } catch (err) { flash('err', err.message); }
  }

  async function remove(id) {
    if (!confirm(`Delete song "${id}" and all its entries?`)) return;
    try {
      const r = await api('/api/admin/tracks/' + encodeURIComponent(id), { method: 'DELETE' });
      flash('ok', `Deleted ${id} (${r.deletedEntries} entries).`); load();
    } catch (err) { flash('err', err.message); }
  }

  async function refetchArt(id) {
    try {
      const r = await api('/api/admin/artwork/' + encodeURIComponent(id), { method: 'POST' });
      flash('ok', `${id}: ${r.artworkStatus}`); load();
    } catch (err) { flash('err', err.message); }
  }

  // ─── chọn nhiều ───────────────────────────────────────────
  function toggle(id) {
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function toggleAll() {
    setSelected((prev) => {
      const ids = items.map((t) => t.id);
      const allOn = ids.length > 0 && ids.every((id) => prev.has(id));
      return allOn ? new Set() : new Set(ids);
    });
  }

  async function deleteSelected() {
    const ids = [...selected];
    if (!ids.length) return;
    if (!confirm(`Delete ${ids.length} selected song(s) and all their entries?`)) return;
    setBusy(true);
    try {
      const r = await api('/api/admin/tracks', { method: 'DELETE', body: { ids } });
      flash('ok', `Deleted ${r.deletedTracks} songs (${r.deletedEntries} entries).`);
      setSelected(new Set()); load();
    } catch (err) { flash('err', err.message); }
    finally { setBusy(false); }
  }

  // ─── export CSV ───────────────────────────────────────────
  async function exportCsv() {
    setBusy(true);
    try {
      const d = await api('/api/admin/tracks?all=1');
      const rows = d.items.map((t) => [t.id, t.name, t.artist, t.baseline || 0, t.artworkUrl || '']);
      const csv = toCsv(['track_id', 'track_name', 'artist', 'baseline', 'artwork_url'], rows);
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'nxstalgia-songs.csv'; a.click();
      URL.revokeObjectURL(a.href);
      flash('ok', `Exported ${rows.length} songs to CSV.`);
    } catch (e) { flash('err', e.message); }
    finally { setBusy(false); }
  }

  // ─── import CSV ───────────────────────────────────────────
  async function onImportFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // reset để chọn lại cùng file vẫn kích hoạt
    if (!file) return;
    setBusy(true);
    try {
      const rows = parseCsv(await file.text()).filter((r) => r.some((c) => (c || '').trim() !== ''));
      if (rows.length < 2) { flash('err', 'CSV has no data rows.'); return; }
      const H = rows[0].map((h) => h.trim().toLowerCase());
      const find = (aliases) => H.findIndex((h) => aliases.includes(h));
      const iName = find(['track_name', 'name', 'song', 'title']);
      const iArtist = find(['artist', 'full_artists', 'artists', 'artist_name']);
      const iBase = find(['baseline', 'past_streams', 'past streams', 'baseline_streams']);
      const iArt = find(['artwork_url', 'track_img', 'image', 'cover', 'cover_art']);
      if (iName < 0 || iArtist < 0) { flash('err', 'CSV must have "track_name" and "artist" columns.'); return; }
      const payload = rows.slice(1).map((r) => ({
        name: r[iName], artist: r[iArtist],
        baseline: iBase >= 0 ? r[iBase] : '',
        artworkUrl: iArt >= 0 ? r[iArt] : '',
      })).filter((x) => (x.name || '').trim() && (x.artist || '').trim());
      if (!payload.length) { flash('err', 'No valid rows found in CSV.'); return; }
      const res = await api('/api/admin/tracks/import', { method: 'POST', body: { rows: payload } });
      flash('ok', `Imported ${res.added} new songs · ${res.skippedDuplicate} duplicates skipped${res.skippedInvalid ? ` · ${res.skippedInvalid} invalid` : ''}.`);
      setSelected(new Set()); load();
    } catch (err) { flash('err', err.message); }
    finally { setBusy(false); }
  }

  const allOn = items.length > 0 && items.every((t) => selected.has(t.id));

  return (
    <>
      <div className="panel">
        <h2>Add song</h2>
        <form onSubmit={create}>
          <div className="row">
            <div style={{ flex: 1, minWidth: 160 }}>
              <label>Song name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label>Artist (separate with commas if collab)</label>
              <input value={form.artist} onChange={(e) => setForm({ ...form, artist: e.target.value })} required />
            </div>
            <div style={{ flex: '0 0 130px' }}>
              <label>Baseline</label>
              <input inputMode="numeric" value={groupInt(form.baseline)} onChange={(e) => setForm({ ...form, baseline: onlyDigits(e.target.value) })} />
            </div>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <div style={{ flex: 1 }}>
              <label>Cover art URL (optional)</label>
              <input value={form.artworkUrl} onChange={(e) => setForm({ ...form, artworkUrl: e.target.value })} placeholder="https://..." />
            </div>
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <button type="submit">Add</button>
            <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>
              ID is auto-generated. Duplicate songs (same name + artist) are rejected.
            </span>
          </div>
        </form>
      </div>

      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <h2 style={{ margin: 0 }}>Songs ({total})</h2>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="danger sm" onClick={deleteSelected} disabled={busy || !selected.size}>
              Delete selected ({selected.size})
            </button>
            <button className="ghost sm" onClick={exportCsv} disabled={busy}>Export CSV</button>
            <button className="ghost sm" onClick={() => fileRef.current?.click()} disabled={busy}>Import CSV</button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={onImportFile} />
            <form onSubmit={(e) => { e.preventDefault(); runSearch(); }}>
              <div className="row">
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name / artist / id" />
                <button className="ghost sm" type="submit">Search</button>
              </div>
            </form>
          </div>
        </div>
        {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}

        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, margin: '8px 0 4px' }}>
          <div className="row" style={{ gap: 6 }}>
            <button className="ghost sm" onClick={() => setPage(0)} disabled={page <= 0}>« First</button>
            <button className="ghost sm" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page <= 0}>‹ Prev</button>
            <span className="muted" style={{ fontSize: 12 }}>Page {page + 1} / {pages} · showing {items.length} of {total}</span>
            <button className="ghost sm" onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1}>Next ›</button>
            <button className="ghost sm" onClick={() => setPage(pages - 1)} disabled={page >= pages - 1}>Last »</button>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <label className="muted" style={{ fontSize: 12 }}>Per page</label>
            <input inputMode="numeric" value={sizeInput} style={{ width: 72 }}
              onChange={(e) => setSizeInput(e.target.value)} onBlur={applySize}
              onKeyDown={(e) => { if (e.key === 'Enter') applySize(); }} />
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th style={{ width: 28 }}><input type="checkbox" checked={allOn} onChange={toggleAll} aria-label="Select all" /></th>
              <th>Image</th>
              <th className="sortable" onClick={() => sortBy('id')}>ID{arrow('id')}</th>
              <th className="sortable" onClick={() => sortBy('name')}>Name{arrow('name')}</th>
              <th className="sortable" onClick={() => sortBy('artist')}>Artist{arrow('artist')}</th>
              <th className="sortable" onClick={() => sortBy('baseline')}>Baseline{arrow('baseline')}</th>
              <th className="sortable" onClick={() => sortBy('status')}>Cover art{arrow('status')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((t) => (
              <tr key={t.id} className={selected.has(t.id) ? 'sel' : ''}>
                <td><input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} aria-label={`Select ${t.id}`} /></td>
                <td>
                  {(() => {
                    const url = editing === t.id ? edit.artworkUrl : t.artworkUrl;
                    return <span className="thumb" style={url ? { backgroundImage: `url(${url})` } : {}} />;
                  })()}
                </td>
                <td className="muted">{t.id}</td>
                {editing === t.id ? (
                  <>
                    <td><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></td>
                    <td><input value={edit.artist} onChange={(e) => setEdit({ ...edit, artist: e.target.value })} /></td>
                    <td><input inputMode="numeric" value={groupInt(edit.baseline)} onChange={(e) => setEdit({ ...edit, baseline: onlyDigits(e.target.value) })} /></td>
                    <td><input value={edit.artworkUrl} placeholder="Cover art URL" onChange={(e) => setEdit({ ...edit, artworkUrl: e.target.value })} /></td>
                    <td className="row">
                      <button className="sm" onClick={() => saveEdit(t.id)}>Save</button>
                      <button className="ghost sm" onClick={() => setEditing(null)}>Cancel</button>
                    </td>
                  </>
                ) : (
                  <>
                    <td>{t.name}</td>
                    <td>{t.artist}</td>
                    <td>{groupInt(t.baseline)}</td>
                    <td><span className={`pill ${t.artworkStatus}`}>{t.artworkStatus}</span></td>
                    <td className="row">
                      <button className="ghost sm" onClick={() => { setEditing(t.id); setEdit({ name: t.name, artist: t.artist, baseline: t.baseline, artworkUrl: t.artworkUrl || '' }); }}>Edit</button>
                      <button className="ghost sm" onClick={() => refetchArt(t.id)}>Image</button>
                      <button className="danger sm" onClick={() => remove(t.id)}>Delete</button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          Import CSV columns: <code>track_name</code>, <code>artist</code> (required), <code>baseline</code>, <code>artwork_url</code> (optional).
          New songs get an auto-generated ID; rows matching an existing song (same name + artist) are skipped.
        </p>
      </div>
    </>
  );
}
