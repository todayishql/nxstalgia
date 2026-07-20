'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '../api';

const EMPTY = { id: '', name: '', artist: '', aid: '', baseline: 0, artworkUrl: '' };

export default function TracksPage() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null); // id đang sửa
  const [edit, setEdit] = useState({});

  const load = useCallback(async (query = '') => {
    try {
      const d = await api('/api/admin/tracks?limit=200&q=' + encodeURIComponent(query));
      setItems(d.items); setTotal(d.total);
    } catch (e) { setMsg({ type: 'err', text: e.message }); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function flash(type, text) { setMsg({ type, text }); }

  async function create(e) {
    e.preventDefault();
    try {
      await api('/api/admin/tracks', { method: 'POST', body: form });
      setForm(EMPTY); flash('ok', 'Added song: ' + form.id); load(q);
    } catch (err) { flash('err', err.message); }
  }

  async function saveEdit(id) {
    try {
      // gửi kèm artworkUrl + refetchArtwork:false -> sửa metadata KHÔNG làm mất ảnh bìa
      await api('/api/admin/tracks/' + encodeURIComponent(id), {
        method: 'PUT',
        body: { ...edit, refetchArtwork: false },
      });
      setEditing(null); flash('ok', 'Saved: ' + id); load(q);
    } catch (err) { flash('err', err.message); }
  }

  async function remove(id) {
    if (!confirm(`Delete song "${id}" and all its entries?`)) return;
    try {
      const r = await api('/api/admin/tracks/' + encodeURIComponent(id), { method: 'DELETE' });
      flash('ok', `Deleted ${id} (${r.deletedEntries} entries).`); load(q);
    } catch (err) { flash('err', err.message); }
  }

  async function refetchArt(id) {
    try {
      const r = await api('/api/admin/artwork/' + encodeURIComponent(id), { method: 'POST' });
      flash('ok', `${id}: ${r.artworkStatus}`); load(q);
    } catch (err) { flash('err', err.message); }
  }

  return (
    <>
      <div className="panel">
        <h2>Add song</h2>
        <form onSubmit={create}>
          <div className="row">
            <div style={{ flex: '0 0 120px' }}>
              <label>ID</label>
              <input value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} placeholder="S999" required />
            </div>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label>Song name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label>Artist (separate with commas if collab)</label>
              <input value={form.artist} onChange={(e) => setForm({ ...form, artist: e.target.value })} required />
            </div>
            <div style={{ flex: '0 0 110px' }}>
              <label>Baseline</label>
              <input type="number" value={form.baseline} onChange={(e) => setForm({ ...form, baseline: e.target.value })} />
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
          </div>
        </form>
      </div>

      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Songs ({total})</h2>
          <form onSubmit={(e) => { e.preventDefault(); load(q); }} style={{ flex: '0 0 320px' }}>
            <div className="row">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name / artist / id" />
              <button className="ghost sm" type="submit">Search</button>
            </div>
          </form>
        </div>
        {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}

        <table>
          <thead>
            <tr>
              <th>Image</th><th>ID</th><th>Name</th><th>Artist</th><th>Baseline</th><th>Cover art</th><th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((t) => (
              <tr key={t.id}>
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
                    <td><input type="number" value={edit.baseline} onChange={(e) => setEdit({ ...edit, baseline: e.target.value })} /></td>
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
                    <td>{t.baseline}</td>
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
      </div>
    </>
  );
}