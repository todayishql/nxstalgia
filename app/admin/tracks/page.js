'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '../api';

const EMPTY = { id: '', name: '', artist: '', aid: '', baseline: 0 };

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
      setForm(EMPTY); flash('ok', 'Đã thêm bài: ' + form.id); load(q);
    } catch (err) { flash('err', err.message); }
  }

  async function saveEdit(id) {
    try {
      await api('/api/admin/tracks/' + encodeURIComponent(id), { method: 'PUT', body: edit });
      setEditing(null); flash('ok', 'Đã lưu: ' + id); load(q);
    } catch (err) { flash('err', err.message); }
  }

  async function remove(id) {
    if (!confirm(`Xoá bài "${id}" và toàn bộ entries của nó?`)) return;
    try {
      const r = await api('/api/admin/tracks/' + encodeURIComponent(id), { method: 'DELETE' });
      flash('ok', `Đã xoá ${id} (${r.deletedEntries} entries).`); load(q);
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
        <h2>Thêm bài hát</h2>
        <form onSubmit={create}>
          <div className="row">
            <div style={{ flex: '0 0 120px' }}>
              <label>ID</label>
              <input value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} placeholder="S999" required />
            </div>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label>Tên bài</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label>Nghệ sĩ (phân cách bằng dấu phẩy nếu collab)</label>
              <input value={form.artist} onChange={(e) => setForm({ ...form, artist: e.target.value })} required />
            </div>
            <div style={{ flex: '0 0 110px' }}>
              <label>Baseline</label>
              <input type="number" value={form.baseline} onChange={(e) => setForm({ ...form, baseline: e.target.value })} />
            </div>
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <button type="submit">Thêm</button>
          </div>
        </form>
      </div>

      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Bài hát ({total})</h2>
          <form onSubmit={(e) => { e.preventDefault(); load(q); }} style={{ flex: '0 0 320px' }}>
            <div className="row">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo tên / nghệ sĩ / id" />
              <button className="ghost sm" type="submit">Tìm</button>
            </div>
          </form>
        </div>
        {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}

        <table>
          <thead>
            <tr>
              <th>Ảnh</th><th>ID</th><th>Tên</th><th>Nghệ sĩ</th><th>Baseline</th><th>Ảnh bìa</th><th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((t) => (
              <tr key={t.id}>
                <td>
                  <span className="thumb" style={t.artworkUrl ? { backgroundImage: `url(${t.artworkUrl})` } : {}} />
                </td>
                <td className="muted">{t.id}</td>
                {editing === t.id ? (
                  <>
                    <td><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></td>
                    <td><input value={edit.artist} onChange={(e) => setEdit({ ...edit, artist: e.target.value })} /></td>
                    <td><input type="number" value={edit.baseline} onChange={(e) => setEdit({ ...edit, baseline: e.target.value })} /></td>
                    <td><span className={`pill ${t.artworkStatus}`}>{t.artworkStatus}</span></td>
                    <td className="row">
                      <button className="sm" onClick={() => saveEdit(t.id)}>Lưu</button>
                      <button className="ghost sm" onClick={() => setEditing(null)}>Huỷ</button>
                    </td>
                  </>
                ) : (
                  <>
                    <td>{t.name}</td>
                    <td>{t.artist}</td>
                    <td>{t.baseline}</td>
                    <td><span className={`pill ${t.artworkStatus}`}>{t.artworkStatus}</span></td>
                    <td className="row">
                      <button className="ghost sm" onClick={() => { setEditing(t.id); setEdit({ name: t.name, artist: t.artist, baseline: t.baseline }); }}>Sửa</button>
                      <button className="ghost sm" onClick={() => refetchArt(t.id)}>Ảnh</button>
                      <button className="danger sm" onClick={() => remove(t.id)}>Xoá</button>
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