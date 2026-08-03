'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { api } from '../api';
import { AWARD_CATEGORIES, AWARD_TYPES, categoryType } from '@/lib/awards';

export default function AwardsPage() {
  const [items, setItems] = useState([]);
  const [years, setYears] = useState([]);
  const [year, setYear] = useState(null); // null = đang chờ năm mặc định
  const [tracks, setTracks] = useState([]);
  const [artists, setArtists] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  // form thêm đề cử
  const [category, setCategory] = useState('');
  const [type, setType] = useState('track');
  const [subject, setSubject] = useState(''); // label bài hát / tên nghệ sĩ
  const [won, setWon] = useState(false);
  const [note, setNote] = useState('');

  function flash(type, text) { setMsg({ type, text }); }

  // năm mặc định lấy từ settings (Overview dùng chung endpoint stats)
  useEffect(() => {
    (async () => {
      try {
        const [s, t, a] = await Promise.all([
          api('/api/admin/stats'),
          api('/api/admin/tracks?all=1'),
          api('/api/admin/artists?limit=500'),
        ]);
        setYear((y) => y ?? (s.settings?.currentYear || new Date().getFullYear()));
        setTracks(t.items || []);
        setArtists(a.items || []);
      } catch (e) { flash('err', e.message); }
    })();
  }, []);

  const load = useCallback(async () => {
    if (year == null) return;
    try {
      const d = await api('/api/admin/awards?year=' + year);
      setItems(d.items || []);
      setYears(d.years || []);
    } catch (e) { flash('err', e.message); }
  }, [year]);
  useEffect(() => { load(); }, [load]);

  // gợi ý hạng mục: gộp danh sách chuẩn + hạng mục đã dùng trong DB
  const categoryOptions = useMemo(() => {
    const used = new Set(items.map((i) => i.category));
    const known = AWARD_CATEGORIES.map((c) => c.name);
    return [...new Set([...known, ...used])];
  }, [items]);

  // nhóm theo hạng mục, winner lên đầu
  const groups = useMemo(() => {
    const m = new Map();
    for (const i of items) {
      if (!m.has(i.category)) m.set(i.category, []);
      m.get(i.category).push(i);
    }
    for (const rows of m.values()) rows.sort((a, b) => (b.won ? 1 : 0) - (a.won ? 1 : 0) || a.name.localeCompare(b.name));
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [items]);

  const trackLabel = (t) => `${t.name} — ${t.artist}`;

  function onCategory(v) {
    setCategory(v);
    const guess = categoryType(v);   // hạng mục đã biết -> tự chọn đúng loại đối tượng
    if (guess && guess !== type) { setType(guess); setSubject(''); }
  }

  async function add(e) {
    e?.preventDefault();
    if (!category.trim()) return flash('err', 'Pick a category first.');
    if (!subject.trim()) return flash('err', type === 'track' ? 'Pick a song.' : 'Type an artist name.');

    let body = { year, category: category.trim(), type, won, note };
    if (type === 'track') {
      const t = tracks.find((x) => trackLabel(x) === subject.trim()) ||
                tracks.find((x) => x.name.toLowerCase() === subject.trim().toLowerCase());
      if (!t) return flash('err', `No song matches "${subject}". Pick one from the list.`);
      body.subject = t.id;
    } else {
      body.subject = subject.trim();
      body.name = subject.trim();
    }

    setBusy(true);
    try {
      const r = await api('/api/admin/awards', { method: 'POST', body });
      flash('ok', `${r.award.won ? '🏆 Winner' : 'Nominee'} added: ${r.award.name} — ${r.award.category} ${r.award.year}`);
      setSubject(''); setWon(false); setNote('');
      load();
    } catch (e) { flash('err', e.message); }
    finally { setBusy(false); }
  }

  async function setWinner(row) {
    try {
      await api('/api/admin/awards/' + row.id, { method: 'PATCH', body: { won: !row.won } });
      load();
    } catch (e) { flash('err', e.message); }
  }

  async function remove(row) {
    if (!confirm(`Remove "${row.name}" from ${row.category} ${row.year}?`)) return;
    try {
      await api('/api/admin/awards/' + row.id, { method: 'DELETE' });
      flash('ok', `Removed ${row.name} from ${row.category}.`);
      load();
    } catch (e) { flash('err', e.message); }
  }

  async function removeCategory(cat) {
    if (!confirm(`Delete the whole "${cat}" category for ${year}? All its nominees go too.`)) return;
    try {
      const r = await api('/api/admin/awards', { method: 'DELETE', body: { year, category: cat } });
      flash('ok', `Deleted ${cat} ${year} (${r.deleted} entr${r.deleted === 1 ? 'y' : 'ies'}).`);
      load();
    } catch (e) { flash('err', e.message); }
  }

  const yearOptions = useMemo(() => {
    const set = new Set(years);
    if (year != null) set.add(year);
    const now = new Date().getFullYear();
    for (let y = now + 1; y >= now - 3; y--) set.add(y);
    return [...set].sort((a, b) => b - a);
  }, [years, year]);

  const winners = items.filter((i) => i.won).length;

  if (year == null) return <div className="muted">Loading…</div>;

  return (
    <>
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0 }}>Awards {year}</h2>
            <span className="muted" style={{ fontSize: 12 }}>
              Grammy-style titles per year. Each category holds one 🏆 winner plus any number of nominees — marking a new
              winner automatically demotes the previous one. Shows up on the viewer’s <strong>Awards</strong> tab.
            </span>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <select value={year} onChange={(e) => setYear(+e.target.value)}>
              {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>

        {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}

        <form onSubmit={add} className="row" style={{ gap: 8, marginTop: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 220px' }}>
            <span className="muted" style={{ fontSize: 11 }}>Category</span>
            <input list="awardCategories" value={category} onChange={(e) => onCategory(e.target.value)} placeholder="Song of the Year" />
            <datalist id="awardCategories">
              {categoryOptions.map((c) => <option key={c} value={c} />)}
            </datalist>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="muted" style={{ fontSize: 11 }}>Awarded to</span>
            <select value={type} onChange={(e) => { setType(e.target.value); setSubject(''); }}>
              {AWARD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '2 1 280px' }}>
            <span className="muted" style={{ fontSize: 11 }}>{type === 'track' ? 'Song' : 'Artist'}</span>
            <input list={type === 'track' ? 'awardTracks' : 'awardArtists'} value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={type === 'track' ? 'Search song — artist…' : 'Artist name…'} />
            <datalist id="awardTracks">
              {tracks.slice(0, 1500).map((t) => <option key={t.id} value={trackLabel(t)} />)}
            </datalist>
            <datalist id="awardArtists">
              {artists.map((a) => <option key={a.key} value={a.name} />)}
            </datalist>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 160px' }}>
            <span className="muted" style={{ fontSize: 11 }}>Note (optional)</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. 12 weeks at No.1" />
          </label>
          <label className="row" style={{ gap: 6, paddingBottom: 8 }}>
            <input type="checkbox" checked={won} onChange={(e) => setWon(e.target.checked)} />
            <span style={{ fontSize: 13 }}>🏆 Winner</span>
          </label>
          <button type="submit" disabled={busy} style={{ marginBottom: 1 }}>{busy ? 'Adding…' : 'Add'}</button>
        </form>
      </div>

      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>{groups.length} categor{groups.length === 1 ? 'y' : 'ies'} · {items.length} entries · {winners} winner{winners === 1 ? '' : 's'}</h2>
        </div>

        {!groups.length && <div className="muted" style={{ padding: 16 }}>No awards recorded for {year} yet — add one above.</div>}

        {groups.map(([cat, rows]) => (
          <div key={cat} style={{ marginTop: 16 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: 14 }}>{cat}</strong>
              <span className="row" style={{ gap: 8 }}>
                <span className="muted" style={{ fontSize: 12 }}>
                  {rows.length} entr{rows.length === 1 ? 'y' : 'ies'}{rows.some((r) => r.won) ? '' : ' · no winner yet'}
                </span>
                <button className="ghost sm" onClick={() => removeCategory(cat)}>Delete category</button>
              </span>
            </div>
            <table>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ width: 44 }}>
                      <button className="ghost sm" title={r.won ? 'Demote to nominee' : 'Mark as winner'}
                        onClick={() => setWinner(r)} style={{ opacity: r.won ? 1 : 0.35 }}>🏆</button>
                    </td>
                    <td>
                      <div style={{ fontWeight: r.won ? 700 : 500 }}>
                        {r.name}
                        {r.missing && <span className="pill none" style={{ marginLeft: 8 }}>song deleted</span>}
                      </div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {r.type === 'track' ? r.artist : 'Artist'}{r.note ? ` · ${r.note}` : ''}
                      </div>
                    </td>
                    <td style={{ width: 90 }}>
                      <span className={`pill ${r.won ? 'ok' : 'pending'}`}>{r.won ? 'winner' : 'nominee'}</span>
                    </td>
                    <td style={{ width: 80 }}>
                      <button className="danger sm" onClick={() => remove(r)}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        <p className="muted" style={{ fontSize: 12, marginTop: 16 }}>
          Categories are free text — the box suggests the standard set from <code>lib/awards.js</code> plus anything already used
          this year, but you can type your own. Picking a known category auto-selects whether it goes to a song or an artist.
          Songs are linked by id, so renaming a song later keeps the award pointing at it.
        </p>
      </div>
    </>
  );
}
