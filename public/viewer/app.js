/* ───────── state ───────── */
// Dữ liệu lấy từ backend MongoDB qua /api/bootstrap (không còn SEED/localStorage)
let DATA = { settings:{}, tracks:[], entries:[], artists:[], awards:[] };
let ARTMETA = new Map(); // artistKey -> { gender, region, genres }
let SEED_YEAR = 2026;
let model = null;
let charts = {};
let currentYear = SEED_YEAR;
let selectedWeek = null;

const $ = id => document.getElementById(id);
const fmt = n => (n==null ? '—' : n.toLocaleString('en-US'));
// Rút gọn số lớn: 4200000 -> "4.2M".
const abbr = n => { n=Number(n)||0; if(n>=1e9) return +(n/1e9).toFixed(1)+'B'; if(n>=1e6) return +(n/1e6).toFixed(1)+'M'; if(n>=1e3) return +(n/1e3).toFixed(1)+'K'; return String(n); };
// Tách nghệ sĩ collab (khớp lib/artists.js) — credit stream cho TỪNG nghệ sĩ, không gom theo chuỗi.
const ART_SPLIT_RE=/\s*(?:,|&|\bx\b|\bfeat\.?\b|\bft\.?\b|\bwith\b|\bvà\b|;|\/)\s*/i;
const splitArtists = a => (a ? String(a).split(ART_SPLIT_RE).map(s=>s.trim()).filter(Boolean) : []);
// Khoá nghệ sĩ chuẩn hoá (khớp lib/artists.js) -> join metadata gender/region.
const artistKey = a => String(a||'').trim().toLowerCase().replace(/\s+/g,' ');

function toast(msg){ const t=$('toast'); t.textContent=msg; t.style.display='block'; clearTimeout(t._h); t._h=setTimeout(()=>t.style.display='none', 3200); }

/* ───────── theme + màu chart ─────────
   Màu chart đọc từ CSS custom property nên tự đổi theo theme sáng/tối. */
const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function isDark(){ return document.documentElement.getAttribute('data-theme')==='dark'; }
// bảng màu categorical cho line/doughnut nhiều series (khớp bản thiết kế Blue)
const PALETTE=['#4C93FF','#38D39A','#FFB454','#FF6F6F','#A78BFA','#22D3EE','#F472B6','#7DA0C4'];
function TH(){
  const dark=isDark();
  return {
    ink:cssv('--ink')||'#0C1420', red:cssv('--red')||'#1D5BD6',
    mid:cssv('--muted')||'#4E5B6A', faint:cssv('--faint')||'#5A6673',
    onInk:cssv('--paper')||'#F4F8FD',
    grid: dark?'rgba(237,243,250,.10)':'rgba(12,20,32,.08)',
    fill: dark?'rgba(76,147,255,.28)':'rgba(29,91,214,.18)'
  };
}
function applyChartDefaults(){
  if(typeof Chart==='undefined') return;
  const t=TH();
  Chart.defaults.color=t.mid;
  Chart.defaults.borderColor=t.grid;
  Chart.defaults.font.family='"Nunito Sans", system-ui, sans-serif';
  Chart.defaults.font.size=11;
  Chart.defaults.elements.bar.borderRadius=6;
  Object.assign(Chart.defaults.plugins.tooltip,{
    backgroundColor:t.ink, titleColor:t.onInk, bodyColor:t.onInk,
    cornerRadius:8, displayColors:false, padding:10,
    titleFont:{family:'"JetBrains Mono", monospace', size:10},
    bodyFont:{family:'"JetBrains Mono", monospace', size:11}
  });
  Object.assign(Chart.defaults.plugins.legend.labels,{
    color:t.ink, boxWidth:10, boxHeight:10,
    font:{family:'"JetBrains Mono", monospace', size:10}
  });
  Chart.defaults.scale.ticks.font={family:'"JetBrains Mono", monospace', size:10};
}
applyChartDefaults();
function themeLabel(){ const el=$('themeLabel'); if(el) el.textContent = isDark()?'Light':'Dark'; }
function setTheme(t){
  document.documentElement.setAttribute('data-theme', t);
  try{ localStorage.setItem('n26-theme', t); }catch(e){}
  themeLabel();
  applyChartDefaults();
  if(model) refreshAll();   // vẽ lại chart bằng màu của theme mới
}

/* ───────── data (backend API) ───────── */
async function loadData(){
  const res = await fetch('/api/bootstrap');
  if(!res.ok) throw new Error('Failed to load data (/api/bootstrap): HTTP '+res.status);
  DATA = await res.json();
  DATA.settings = DATA.settings || {};
  DATA.tracks = DATA.tracks || [];
  DATA.entries = DATA.entries || [];
  DATA.artists = DATA.artists || [];
  DATA.awards = DATA.awards || [];
  ARTMETA = new Map(DATA.artists.map(a => [a.key, { gender:a.gender||'', region:a.region||'', genres:a.genres||[] }]));
  REGION_CACHE.clear(); // metadata nghệ sĩ đổi -> vùng của bài phải tính lại
  SEED_YEAR = DATA.settings.currentYear || DATA.entries[0]?.year || 2026;
  currentYear = SEED_YEAR;
}

/* ───────── model ───────── */
function buildModel(){
  const tracks = new Map();
  for(const t of DATA.tracks){
    tracks.set(t.id, { id:t.id, name:t.name, artist:t.artist, artists:(Array.isArray(t.artists)&&t.artists.length)?t.artists:splitArtists(t.artist), genre:(t.genre||'').trim(), artworkUrl:t.artworkUrl||'', baseline:t.baseline||0, years:new Map(), user:false });
  }
  for(const e of DATA.entries){
    const t = tracks.get(e.trackId); if(!t) continue;
    const y = +e.year, w = +e.week;
    if(!t.years.has(y)) t.years.set(y, new Map());
    t.years.get(y).set(w, { rank: e.rank ?? null, stream: e.stream ?? 0 });
  }
  // derive stats per năm
  const years = new Map();
  for(const t of tracks.values()){
    t._stats = {}; t.allTotal = 0;
    for(const [y, wm] of t.years){
      let total=0, woc=0, peak=null, best=0, streak=0, cur=0, prevW=null, maxW=0;
      const ws=[...wm.keys()].sort((a,b)=>a-b);
      for(const w of ws){
        const e=wm.get(w); total+=e.stream||0; if((e.stream||0)>best) best=e.stream;
        if(e.rank!=null){
          woc++; if(peak==null||e.rank<peak) peak=e.rank;
          if(e.rank===1){ cur=(prevW===w-1&&cur>0)?cur+1:1; if(cur>streak) streak=cur; prevW=w; }
          else { cur=0; prevW=null; }
          if(w>maxW) maxW=w;
        } else { cur=0; prevW=null; }
      }
      t._stats[y]={ total, woc, peak, best, streak };
      t.allTotal+=total;
      if(!years.has(y)) years.set(y,{maxWeek:0});
      if(maxW>years.get(y).maxWeek) years.get(y).maxWeek=maxW;
    }
    t.trackedTotal = t.allTotal;
    t.baseline = t.baseline || 0; // baseline lấy từ track trong DB
    t.allTotal += t.baseline;
    t.allPeak = null; t.allWoc = 0;
    for(const y of Object.keys(t._stats)){ const s=t._stats[y]; if(s.peak!=null&&(t.allPeak==null||s.peak<t.allPeak)) t.allPeak=s.peak; t.allWoc+=s.woc; }
  }
  const yearList=[...years.keys()].sort((a,b)=>a-b);
  model = { tracks, years, yearList };
  ARTCHART=null; // model dựng lại -> bỏ cache bảng xếp hạng nghệ sĩ
  if(!years.has(currentYear)) currentYear = yearList[yearList.length-1] || SEED_YEAR;
  fillTrackOptions();
}
function statsFor(t,y){ return (t._stats&&t._stats[y]) || {total:0,woc:0,peak:null,best:0,streak:0}; }
function maxWeekOf(y){ return model.years.has(y)?model.years.get(y).maxWeek:0; }

function weekChart(y, w){
  const rows=[];
  for(const t of model.tracks.values()){
    const e=t.years.get(y)?.get(w);
    if(e && e.rank!=null) rows.push({ t, rank:e.rank, stream:e.stream||0, user:!!e.user });
  }
  rows.sort((a,b)=>a.rank-b.rank || b.stream-a.stream);
  return rows;
}
function entryAt(t,y,w){ return t.years.get(y)?.get(w) || null; }
function movement(t, y, w){
  const cur=entryAt(t,y,w); if(!cur||cur.rank==null) return null;
  const prev=entryAt(t,y,w-1);
  if(prev && prev.rank!=null){
    const d=prev.rank-cur.rank;
    if(d===0) return {cls:'eq', txt:'='};
    return d>0 ? {cls:'up', txt:'▲'+d} : {cls:'down', txt:'▼'+(-d)};
  }
  const wm=t.years.get(y);
  if(wm){ for(const [pw,e] of wm) if(pw<w && e.rank!=null) return {cls:'re', txt:'RE'}; }
  for(const [py,pm] of t.years){ if(py<y){ for(const e of pm.values()) if(e.rank!=null) return {cls:'re', txt:'RE'}; } }
  return {cls:'new', txt:'NEW'};
}
function wocUpTo(t,y,w){ const wm=t.years.get(y); if(!wm) return 0; let c=0; for(const [pw,e] of wm) if(pw<=w&&e.rank!=null) c++; return c; }
function peakUpTo(t,y,w){ const wm=t.years.get(y); if(!wm) return null; let p=null; for(const [pw,e] of wm) if(pw<=w&&e.rank!=null&&(p==null||e.rank<p)) p=e.rank; return p; }
function weekDates(y,w){
  // Mùa Y dài 52 tuần, đặt tên theo năm KẾT THÚC: bắt đầu ~T9 năm (Y-1) -> kết thúc cuối T8 năm Y.
  // Neo: Tuần 1/2026 = 29/08/2025 -> Tuần 52/2026 = 21–27/08/2026 (Tuần 1/2027 = 28/08/2026).
  const start = new Date(Date.UTC(2025,7,29) + ((w-1) + (y-2026)*52)*7*86400000);
  const end = new Date(start.getTime()+6*86400000);
  const f = d => d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
  return f(start)+' – '+f(end);
}
function yy(y){ return String(y).slice(2); }

/* ───────── artwork (ảnh bìa lấy sẵn từ DB, server đã tra iTunes) ───────── */
let artCache={};
// Dựng map id -> artworkUrl từ dữ liệu đã tải; không gọi iTunes ở client nữa.
function buildArtCache(){
  artCache={};
  for(const t of DATA.tracks){ if(t.artworkUrl) artCache[t.id]=t.artworkUrl; }
}
function scheduleArtSave(){ /* no-op: ảnh bìa quản lý ở /admin */ }
const artObserver=('IntersectionObserver' in window)?new IntersectionObserver(ents=>{
  for(const en of ents){ if(en.isIntersecting){ artObserver.unobserve(en.target); enqueueArt(en.target); } }
},{rootMargin:'120px'}):null;
function thumbHTML(t, cls=''){
  const u=artCache[t.id];
  if(u) return `<span class="thumb ${cls}" style="background-image:url('${u}')" aria-hidden="true"></span>`;
  return `<span class="thumb ${cls}" data-tid="${t.id}" aria-hidden="true">♪</span>`;
}
function hydrateThumbs(){
  document.querySelectorAll('.thumb[data-tid]').forEach(el=>{
    const id=el.getAttribute('data-tid'); const u=artCache[id];
    if(u!==undefined){ el.removeAttribute('data-tid'); if(u) applyArt(el,u); return; }
    if(artObserver) artObserver.observe(el); else enqueueArt(el);
  });
}
function applyArt(el,url){ el.style.backgroundImage=`url("${url}")`; el.textContent=''; }
// Không tra iTunes ở client nữa: ảnh bìa đã có sẵn từ DB. Bài thiếu ảnh giữ placeholder ♪.
function enqueueArt(el){ el.removeAttribute('data-tid'); }
function pumpArt(){ /* no-op */ }

/* ───────── Chart Beat ───────── */
function generateBeat(y,w){
  const rows=weekChart(y,w); if(!rows.length) return null;
  const L=[];
  const n1=rows[0];
  let run=0, ww=w; while(true){ const e=entryAt(n1.t,y,ww); if(e&&e.rank===1){run++;ww--;} else break; }
  const prev=entryAt(n1.t,y,w-1);
  const pct=(prev&&prev.stream)?Math.round((n1.stream-prev.stream)/prev.stream*100):null;
  const mv1=movement(n1.t,y,w);
  let head;
  if(mv1&&mv1.cls==='new') head=`"${n1.t.name}" (${n1.t.artist}) debuts straight at No.1`;
  else if(run>1) head=`"${n1.t.name}" (${n1.t.artist}) holds No.1 for week ${run}`;
  else head=`"${n1.t.name}" (${n1.t.artist}) rises to No.1`;
  head+=` with ${fmt(n1.stream)} streams`+(pct!=null?` (${pct>0?'+':''}${pct}%)`:'')+'.';
  L.push('🏆 '+head);
  let bg=null, bd=null;
  for(const r of rows){
    const p=entryAt(r.t,y,w-1);
    if(p&&p.rank!=null){ const d=p.rank-r.rank; if(d>0&&(!bg||d>bg.d)) bg={r,d}; if(d<0&&(!bd||d<bd.d)) bd={r,d}; }
  }
  if(bg) L.push(`📈 Biggest jump: "${bg.r.t.name}" — ${bg.r.t.artist} climbs ${bg.d} spots to #${bg.r.rank}.`);
  if(bd) L.push(`📉 Biggest drop: "${bd.r.t.name}" — ${bd.r.t.artist} falls ${-bd.d} spots to #${bd.r.rank}.`);
  const news=rows.filter(r=>{const m=movement(r.t,y,w); return m&&m.cls==='new';}).slice(0,4);
  if(news.length) L.push('✨ Debut: '+news.map(r=>`"${r.t.name}" — ${r.t.artist} (#${r.rank})`).join(', ')+'.');
  const res=rows.filter(r=>{const m=movement(r.t,y,w); return m&&m.cls==='re';}).slice(0,4);
  if(res.length) L.push('🔁 Re-entry: '+res.map(r=>`"${r.t.name}" (#${r.rank})`).join(', ')+'.');
  const ms=[];
  for(const r of rows){
    const woc=wocUpTo(r.t,y,w);
    if([10,15,20,25,30,40,50].includes(woc)) ms.push(`"${r.t.name}" reaches ${woc} weeks on chart`);
  }
  let recStreak=0; for(const t of model.tracks.values()){ const s=statsFor(t,y).streak; if(s>recStreak) recStreak=s; }
  if(run>1 && run>=recStreak) ms.push(`the ${run}-week No.1 streak of "${n1.t.name}" is the longest of the year`);
  if(ms.length) L.push('🎖️ Milestones: '+ms.slice(0,4).join('; ')+'.');
  return { title:`CHART BEAT — Week ${w}/${y} (${weekDates(y,w)})`, lines:L };
}
function renderBeat(){
  const w=maxWeekOf(currentYear);
  const beat=w?generateBeat(currentYear,w):null;
  // mỗi dòng bắt đầu bằng 1 emoji -> tách thành cột icon riêng cho đúng nhịp bản Blue
  const beatLine=l=>{
    const sp=l.indexOf(' ');
    const ic=sp>0?l.slice(0,sp):'·', tx=sp>0?l.slice(sp+1):l;
    return `<p><span class="bic">${esc(ic)}</span><span>${esc(tx)}</span></p>`;
  };
  $('beatBody').innerHTML = beat
    ? `<div class="bt">${esc(beat.title)}</div>`+beat.lines.map(beatLine).join('')
    : '<div class="empty" style="padding:16px 0">No data yet for this year.</div>';
  $('copyBeatBtn').onclick=()=>{
    if(!beat) return;
    const txt=beat.title+'\n'+beat.lines.join('\n');
    (navigator.clipboard?navigator.clipboard.writeText(txt):Promise.reject()).then(()=>toast('Bulletin copied'),
      ()=>{ const ta=document.createElement('textarea'); ta.value=txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast('Bulletin copied'); });
  };
}

/* ───────── render: overview ───────── */
function renderOverview(){
  const y=currentYear, w=maxWeekOf(y);
  $('headerWeek').textContent = w? ('WEEK '+w+' / '+y) : ('YEAR '+y);
  const rows=w?weekChart(y,w):[];
  const charted=[...model.tracks.values()].filter(t=>statsFor(t,y).woc>0);
  const artists=new Set(charted.flatMap(t=>t.artists));
  const no1=rows[0];
  $('kpis').innerHTML = `
    <div class="kpi"><div class="lbl">Current week</div><div class="val">${w?('W'+w):'—'}</div><div class="note">${rows.length} songs on chart</div></div>
    <div class="kpi"><div class="lbl">No.1 this week</div><div class="val name">${no1?esc(no1.t.name):'—'}</div><div class="note">${no1?esc(no1.t.artist):''}</div></div>
    <div class="kpi"><div class="lbl">Songs charted</div><div class="val">${charted.length}</div><div class="note">of ${model.tracks.size} songs in catalog</div></div>
    <div class="kpi"><div class="lbl">Artists</div><div class="val">${artists.size}</div><div class="note">appeared in ${y}</div></div>`;

  const pod=$('podium'); pod.innerHTML='';
  const order=[1,0,2], cls=['p2','p1','p3'], label=['NO.2','NO.1','NO.3'];
  order.forEach((idx,i)=>{
    const r=rows[idx]; if(!r){ pod.innerHTML+='<div></div>'; return; }
    const mv=movement(r.t,y,w);
    let run=0; if(idx===0){ let ww=w; while(true){ const e=entryAt(r.t,y,ww); if(e&&e.rank===1){run++;ww--;} else break; } }
    pod.innerHTML += `
    <div class="pod ${cls[i]} clickable" onclick="openTrack('${r.t.id}')">
      ${idx===0&&run>1?`<div class="crown">👑 ${run} weeks in a row</div>`:''}
      <div class="place">${label[i]} ${idx===0?'<span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>':''}</div>
      <div class="song">
        ${thumbHTML(r.t, idx===0?'big':'med')}
        <div>
          <div class="tname">${esc(r.t.name)}</div>
          <div class="taname">${esc(r.t.artist)}</div>
        </div>
      </div>
      <div class="meta"><span>Stream <b>${fmt(r.stream)}</b></span><span>Peak <b>#${peakUpTo(r.t,y,w)}</b></span><span>WOC <b>${wocUpTo(r.t,y,w)}</b></span>${mv&&mv.cls!=='eq'?`<span class="mv ${mv.cls}">${mv.txt}</span>`:''}</div>
    </div>`;
  });

  $('top10').innerHTML = rows.slice(0,10).map(r=>{
    const mv=movement(r.t,y,w);
    return `<tr class="clickable" onclick="openTrack('${r.t.id}')">
      <td class="rank r${r.rank<=3?r.rank:''}">${r.rank}</td>
      <td>${mv&&mv.cls!=='eq'?`<span class="mv ${mv.cls}">${mv.txt}</span>`:''}</td>
      <td class="thumbcell">${thumbHTML(r.t)}</td>
      <td><div class="t-name">${esc(r.t.name)}</div><div class="t-artist">${esc(r.t.artist)}</div></td>
      <td class="num">${fmt(r.stream)}</td>
    </tr>`;
  }).join('') || '<tr><td><div class="empty">No data yet for this year — edit data at /admin.</div></td></tr>';

  const labels=[], data=[], names=[];
  for(let ww=1; ww<=maxWeekOf(y); ww++){
    const top=weekChart(y,ww)[0];
    labels.push('W'+ww); data.push(top?top.stream:null); names.push(top?top.t.name+' — '+top.t.artist:'');
  }
  const t=TH();
  // fill gradient dưới đường No.1 — nhạt dần xuống đáy, đúng chất bản Blue
  let fill=t.fill;
  const cv=$('chartNo1');
  if(cv){ const g=cv.getContext('2d').createLinearGradient(0,0,0,290); g.addColorStop(0,t.fill); g.addColorStop(1,'rgba(0,0,0,0)'); fill=g; }
  drawChart('chartNo1','line',{
    labels, datasets:[{ data, borderColor:t.red, borderWidth:2.5, backgroundColor:fill, fill:true, tension:.35,
      pointRadius:3, pointBackgroundColor:t.red, pointBorderWidth:0, pointHoverRadius:6, spanGaps:true }]
  },{ plugins:{ legend:{display:false}, tooltip:{ callbacks:{ title:(items)=>items[0]?names[items[0].dataIndex]:'', label:(c)=>c.label+': '+fmt(c.parsed.y)+' streams' } } },
     scales:{ x:{ ticks:{ maxTicksLimit:12 }, grid:{ display:false } },
              y:{ beginAtZero:true, ticks:{ callback:v=>abbr(v) }, grid:{ color:t.grid } } } });
  renderBeat();
  hydrateThumbs();
}

/* ───────── render: chart sheet ───────── */
const SONG_HINT="TW/LW = this week's rank / last week's rank · ● = streams up from last week · ±% = stream change. Click a song to see its trajectory.";
const ARTIST_HINT="Artists ranked by their on-chart streams that week — a song credits its full stream count to every artist on it, so a collab feeds both. TW/LW = this week's rank / last week's rank · ● = streams up from last week · Wks = weeks on the artist chart. Click an artist for their profile.";
let chartMode='songs'; // 'songs' | 'artists' — cùng sheet, cùng week-nav
window.setChartMode=function(m){ chartMode = m==='artists' ? 'artists' : 'songs'; renderChartView(); };

function renderChartView(){
  const y=currentYear;
  const mw=maxWeekOf(y);
  const w = selectedWeek ?? (mw||1);
  selectedWeek = w;
  $('wLabel').textContent='Week '+w;
  const sel=$('wSelect');
  sel.innerHTML='';
  for(let i=1;i<=Math.max(mw+1,1);i++){ const o=document.createElement('option'); o.value=i; o.textContent='Week '+i+(i>mw?' (empty)':''); sel.appendChild(o); }
  sel.value=w;
  $('sheetTitle').innerHTML='THE&nbsp;N<em>['+yy(y)+']</em>stalgia';
  $('sheetWeekNo').textContent=w;
  $('sheetDates').textContent=weekDates(y,w);

  for(const b of document.querySelectorAll('#chartMode .pill')) b.classList.toggle('on', b.dataset.mode===chartMode);
  $('colSubject').textContent = chartMode==='artists' ? 'Artist' : 'Song';
  $('chartHint').textContent = chartMode==='artists' ? ARTIST_HINT : SONG_HINT;
  if(chartMode==='artists'){ renderArtistSheet(y,w); return; }

  const rows=weekChart(y,w);
  // Callout kiểu Billboard: Hot Shot Debut = bài NEW hạng cao nhất; Greatest Gainer = vọt hạng mạnh nhất
  let hotShotId=null, gainerId=null, bestNew=Infinity, bestJump=0;
  for(const r of rows){
    const mv=movement(r.t,y,w)||{cls:'eq'};
    if(mv.cls==='new' && r.rank<bestNew){ bestNew=r.rank; hotShotId=r.t.id; }
    const prev=entryAt(r.t,y,w-1);
    if(prev&&prev.rank!=null){ const jump=prev.rank-r.rank; if(jump>bestJump){ bestJump=jump; gainerId=r.t.id; } }
  }
  $('chartTable').innerHTML = rows.length ? rows.map(r=>{
    const mv=movement(r.t,y,w)||{cls:'eq',txt:'='};
    const prev=entryAt(r.t,y,w-1);
    // bullet ● (quy ước Billboard): stream tăng so với tuần trước
    const bullet = prev && prev.stream>0 && r.stream>prev.stream;
    let lw='—';
    if(mv.cls==='new') lw='<span class="lw-new">NEW</span>';
    else if(mv.cls==='re') lw='<span class="lw-re">RE</span>';
    else if(prev&&prev.rank!=null) lw=prev.rank;
    let pctTxt='', pctCls='';
    if(prev && prev.stream>0){
      const p=Math.round((r.stream-prev.stream)/prev.stream*100);
      // cap hiển thị: chênh quá 999% (dữ liệu khác thang đo) -> in ">999%" thay vì số 7 chữ số
      pctTxt=p>999?'>999%':(p>0?'+':'')+p+'%'; pctCls=p>0?' pos':(p<0?' neg':'');
    }
    const pk=peakUpTo(r.t,y,w);
    const woc=wocUpTo(r.t,y,w);
    const callout = r.t.id===hotShotId ? '<span class="callout hotshot">Hot Shot Debut</span>'
                  : (r.t.id===gainerId && bestJump>=3) ? '<span class="callout gainer">Greatest Gainer</span>' : '';
    // chỉ dấu lên/xuống hạng: cột riêng sau LW — ▲3 / ▼2 / = (NEW/RE để trống)
    const hasMv = mv.cls==='up'||mv.cls==='down'||mv.cls==='eq';
    // up/down: ▲n / ▼n; không đổi hạng (eq) hoặc không có mv -> để trống cho gọn
    const mvInner = (mv.cls==='up'||mv.cls==='down') ? mv.txt : '';
    return `<tr class="clickable" onclick="openTrack('${r.t.id}')">
      <td class="rk-tw${r.rank===1?' no1':''}"><span class="rk-num">${r.rank}${bullet?'<span class="blt">●</span>':''}</span></td>
      <td class="rk-lw">${lw}</td>
      <td class="rk-mv ${hasMv?mv.cls:'none'}"><span class="mv-in">${mvInner}</span></td>
      <td><div class="songcell">${thumbHTML(r.t)}<div class="songmeta"><div class="s-name">${esc(r.t.name)}${r.user?'<span class="badge-user">YOUR ENTRY</span>':''}${callout}</div><div class="s-artist">${esc(r.t.artist)}</div></div></div></td>
      <td class="pts">${fmt(r.stream)}</td>
      <td class="pct${pctCls}">${pctTxt}</td>
      <td class="peakc${pk===1?' no1':''}">${pk}</td>
      <td class="wocc">${woc}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="8"><div class="empty">No data yet for this week — edit data at /admin.</div></td></tr>';
  hydrateThumbs();
}
/* ── Bảng xếp hạng NGHỆ SĨ theo tuần ──
   Gộp on-chart stream của mọi bài trong tuần; mỗi nghệ sĩ trên 1 bài nhận trọn stream của bài đó
   (khớp cách gộp "Top artists" ở All-time). Dựng 1 lần cho cả catalog rồi cache. */
let ARTCHART=null;
function buildArtistChart(){
  if(ARTCHART) return ARTCHART;
  const byYear=new Map();      // year -> week -> Map(key -> {key,name,streams,songs})
  const firstOf=new Map();     // key -> year*100+week lần đầu có stream (phân biệt NEW vs RE)
  for(const t of model.tracks.values()){
    for(const [y,wm] of t.years){
      let ym=byYear.get(y); if(!ym){ ym=new Map(); byYear.set(y,ym); }
      for(const [w,e] of wm){
        const s=e.stream||0; if(s<=0) continue;
        let wk=ym.get(w); if(!wk){ wk=new Map(); ym.set(w,wk); }
        const yw=y*100+w;
        for(const a of t.artists){
          const k=artistKey(a);
          let r=wk.get(k); if(!r){ r={ key:k, name:a, streams:0, songs:0 }; wk.set(k,r); }
          r.streams+=s; r.songs++;
          if(!firstOf.has(k) || yw<firstOf.get(k)) firstOf.set(k,yw);
        }
      }
    }
  }
  const out=new Map();
  for(const [y,ym] of byYear){
    const weeks=new Map();
    for(const [w,wk] of ym){
      const rows=[...wk.values()].sort((a,b)=>b.streams-a.streams || a.name.localeCompare(b.name));
      const rankOf=new Map(), byKey=new Map();
      rows.forEach((r,i)=>{ rankOf.set(r.key,i+1); byKey.set(r.key,r); });
      weeks.set(w,{ rows, rankOf, byKey });
    }
    out.set(y,weeks);
  }
  ARTCHART={ byYear:out, firstOf };
  return ARTCHART;
}
// peak + số tuần có mặt tính tới tuần w (trong năm y)
function artistRunUpTo(weeks, key, w){
  let peak=null, woc=0;
  for(let i=1;i<=w;i++){
    const r=weeks.get(i)?.rankOf.get(key);
    if(r==null) continue;
    woc++; if(peak==null||r<peak) peak=r;
  }
  return { peak, woc };
}

function renderArtistSheet(y,w){
  const ac=buildArtistChart();
  const weeks=ac.byYear.get(y)||new Map();
  const rows=weeks.get(w)?.rows||[];
  const prev=weeks.get(w-1)||null;

  // Callout: Hot Shot Debut = nghệ sĩ mới hạng cao nhất; Greatest Gainer = vọt hạng mạnh nhất
  let hotShot=null, gainer=null, bestNew=Infinity, bestJump=0;
  rows.forEach((r,i)=>{
    const pos=i+1, pr=prev?prev.rankOf.get(r.key):null;
    if(pr==null){ if(ac.firstOf.get(r.key)===y*100+w && pos<bestNew){ bestNew=pos; hotShot=r.key; } }
    else { const jump=pr-pos; if(jump>bestJump){ bestJump=jump; gainer=r.key; } }
  });

  $('chartTable').innerHTML = rows.length ? rows.map((r,i)=>{
    const pos=i+1;
    const pr=prev?prev.rankOf.get(r.key):null;
    const prow=prev?prev.byKey.get(r.key):null;
    let lw='—', mvCls='none', mvTxt='';
    if(pr!=null){
      const d=pr-pos; lw=pr;
      if(d>0){ mvCls='up'; mvTxt='▲'+d; } else if(d<0){ mvCls='down'; mvTxt='▼'+(-d); } else mvCls='eq';
    } else {
      lw = ac.firstOf.get(r.key)===y*100+w ? '<span class="lw-new">NEW</span>' : '<span class="lw-re">RE</span>';
    }
    let pctTxt='', pctCls='';
    if(prow && prow.streams>0){
      const p=Math.round((r.streams-prow.streams)/prow.streams*100);
      pctTxt = p>999?'>999%':(p>0?'+':'')+p+'%'; pctCls = p>0?' pos':(p<0?' neg':'');
    }
    const bullet = prow && prow.streams>0 && r.streams>prow.streams;
    const run=artistRunUpTo(weeks,r.key,w);
    const callout = r.key===hotShot ? '<span class="callout hotshot">Hot Shot Debut</span>'
                  : (r.key===gainer && bestJump>=3) ? '<span class="callout gainer">Greatest Gainer</span>' : '';
    return `<tr class="clickable" onclick="openArtist('${jsStr(r.name)}')">
      <td class="rk-tw${pos===1?' no1':''}"><span class="rk-num">${pos}${bullet?'<span class="blt">●</span>':''}</span></td>
      <td class="rk-lw">${lw}</td>
      <td class="rk-mv ${mvCls}"><span class="mv-in">${mvTxt}</span></td>
      <td><div class="songcell"><div class="songmeta"><div class="s-name">${esc(r.name)}${callout}</div><div class="s-artist">${r.songs} song${r.songs>1?'s':''} on chart</div></div></div></td>
      <td class="pts">${fmt(r.streams)}</td>
      <td class="pct${pctCls}">${pctTxt}</td>
      <td class="peakc${run.peak===1?' no1':''}">${run.peak??'—'}</td>
      <td class="wocc">${run.woc}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="8"><div class="empty">No artist data for this week — edit data at /admin.</div></td></tr>';
}

async function exportPNG(){
  if(typeof html2canvas==='undefined'){ toast('Image rendering library not loaded — open the file in a browser and try again'); return; }
  toast('Rendering image…');
  try{
    const canvas=await html2canvas($('sheetEl'),{ scale:2, useCORS:true, backgroundColor:cssv('--sheet')||'#FFFFFF' });
    const a=document.createElement('a');
    a.href=canvas.toDataURL('image/png');
    a.download='n'+yy(currentYear)+'stalgia-w'+selectedWeek+(chartMode==='artists'?'-artists':'')+'.png';
    a.click();
    toast('PNG image downloaded');
  }catch(e){ toast('Could not render image (artwork may be blocked by CORS)'); }
}

/* ───────── render: analytics ───────── */
const RACE_COLORS=PALETTE;
/* nét liền — các line đã khác màu nên không cần nét đứt phân biệt */
const RACE_DASHES=[[],[],[],[],[],[],[],[]];
/* Champions: line được chọn tô màu để phân biệt; state giữ qua các lần render */
const CHAMP_COLORS=PALETTE;
let raceState={ year:null, sort:'weeks', selected:new Set(), upTo:null, champs:[], colorOf:{}, statSize:5, statPage:0, carExpanded:false };
/* Vẽ tên bài ở điểm cuối của các line champion đang chọn */
const raceLabelPlugin={ id:'raceLabels', afterDatasetsDraw(chart){
  const ctx=chart.ctx; ctx.save(); ctx.font='700 11px "Nunito Sans", system-ui, sans-serif'; ctx.textBaseline='middle';
  chart.data.datasets.forEach((ds,i)=>{
    if(!ds._champ) return;
    const meta=chart.getDatasetMeta(i); let pt=null;
    for(let k=meta.data.length-1;k>=0;k--){ if(ds.data[k]!=null){ pt=meta.data[k]; break; } }
    if(!pt) return;
    ctx.fillStyle=ds.borderColor; ctx.fillText(ds.label, pt.x+7, pt.y);
  });
  ctx.restore();
} };
function renderAnalytics(){
  const y=currentYear;
  $('recYear').textContent=y;
  const charted=[...model.tracks.values()].filter(t=>statsFor(t,y).woc>0);
  if(!charted.length){
    $('records').innerHTML='<div class="empty">No data yet for this year.</div>';
    ['chartBump','chartArtists','chartWoc','chartPeaks','chartScatter'].forEach(id=>{ if(charts[id]){charts[id].destroy(); delete charts[id];} });
    if($('champStats')) $('champStats').innerHTML='<div class="empty">No #1 songs yet.</div>';
    if($('champCarousel')) $('champCarousel').innerHTML='';
    $('predBody').innerHTML='<div class="empty" style="padding:16px 0">No data yet.</div>';
    return;
  }
  const S=t=>statsFor(t,y);

  const byStreak=[...charted].sort((a,b)=>S(b).streak-S(a).streak)[0];
  const byBest=[...charted].sort((a,b)=>S(b).best-S(a).best)[0];
  const byWoc=[...charted].sort((a,b)=>S(b).woc-S(a).woc)[0];
  const no1s={}; for(const t of charted) if(S(t).peak===1) for(const a of t.artists) no1s[a]=(no1s[a]||0)+1;
  const topNo1=Object.entries(no1s).sort((a,b)=>b[1]-a[1])[0];
  let nDebut1=0;
  for(const t of charted){
    const wm=t.years.get(y);
    const first=[...wm.entries()].filter(([w,e])=>e.rank!=null).sort((a,b)=>a[0]-b[0])[0];
    if(first&&first[1].rank===1) nDebut1++;
  }
  $('records').innerHTML = `
    <div class="record"><div class="rl">Longest #1 streak</div><div class="rv">${esc(byStreak.name)} — ${esc(byStreak.artist)}</div><div class="rd">${S(byStreak).streak} weeks in a row</div></div>
    <div class="record"><div class="rl">Highest weekly streams</div><div class="rv">${esc(byBest.name)} — ${esc(byBest.artist)}</div><div class="rd">${fmt(S(byBest).best)} streams</div></div>
    <div class="record"><div class="rl">Longest-charting</div><div class="rv">${esc(byWoc.name)} — ${esc(byWoc.artist)}</div><div class="rd">${S(byWoc).woc} weeks on chart</div></div>
    <div class="record"><div class="rl">Most No.1 songs</div><div class="rv">${topNo1?esc(topNo1[0]):'—'}</div><div class="rd">${topNo1?topNo1[1]+' songs reached #1':''}</div></div>
    <div class="record"><div class="rl">Debut straight at No.1</div><div class="rv">${nDebut1} songs</div><div class="rd">debuted at #1</div></div>`;

  renderRace(y); // "The #1 Race" — module Champions (bảng + carousel + slider)

  const TC=TH();
  const byArtist={}; for(const t of charted) for(const a of t.artists) byArtist[a]=(byArtist[a]||0)+S(t).total;
  const topA=Object.entries(byArtist).sort((a,b)=>b[1]-a[1]).slice(0,10);
  drawChart('chartArtists','bar',{
    labels: topA.map(x=>x[0]),
    datasets:[{ data: topA.map(x=>x[1]), backgroundColor: topA.map((_,i)=>i===0?TC.red:TC.mid), barPercentage:.8 }]
  },{ indexAxis:'y', plugins:{legend:{display:false}, tooltip:{callbacks:{label:c=>fmt(c.parsed.x)+' streams'}}},
     scales:{ x:{ beginAtZero:true, ticks:{callback:v=>abbr(v)}, grid:{color:TC.grid} }, y:{ grid:{display:false} } },
     onClick:(ev,els)=>{ if(els.length) openArtist(topA[els[0].index][0]); } });

  const topW=[...charted].sort((a,b)=>S(b).woc-S(a).woc).slice(0,10);
  drawChart('chartWoc','bar',{
    labels: topW.map(t=>t.name),
    datasets:[{ data: topW.map(t=>S(t).woc), backgroundColor:TC.red, barPercentage:.8 }]
  },{ indexAxis:'y', plugins:{legend:{display:false}, tooltip:{callbacks:{label:c=>c.parsed.x+' weeks · '+topW[c.dataIndex].artist}}},
     scales:{ x:{ beginAtZero:true, ticks:{precision:0}, grid:{color:TC.grid} }, y:{ grid:{display:false} } } });

  const buckets={'#1':0,'Top 3':0,'Top 10':0,'Top 20':0,'Top 51':0,'Outside Top 51':0};
  for(const t of charted){
    const p=S(t).peak;
    if(p===1) buckets['#1']++; else if(p<=3) buckets['Top 3']++;
    else if(p<=10) buckets['Top 10']++; else if(p<=20) buckets['Top 20']++;
    else if(p<=51) buckets['Top 51']++; else buckets['Outside Top 51']++;
  }
  drawChart('chartPeaks','doughnut',{
    labels:Object.keys(buckets),
    datasets:[{ data:Object.values(buckets),
      backgroundColor:[TC.red, PALETTE[1], PALETTE[2], PALETTE[4], PALETTE[5], TC.grid], borderWidth:0, spacing:2 }]
  },{ cutout:'62%', plugins:{ legend:{ position:'right' },
       tooltip:{ callbacks:{ label:c=>c.label+' · '+c.parsed+' song'+(c.parsed===1?'':'s') } } } });

  const pts=charted.filter(t=>S(t).woc>=2).map(t=>({x:S(t).woc, y:Math.round(S(t).total/S(t).woc), t, one:S(t).peak===1}));
  drawChart('chartScatter','scatter',{
    datasets:[{ data:pts, backgroundColor:pts.map(p=>p.one?TC.red:TC.mid), pointRadius:5, pointHoverRadius:7 }]
  },{ plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:c=>{const p=c.raw; return [p.t.name+' — '+p.t.artist, p.x+' wks · '+fmt(p.y)+'/wk'];} } } },
     scales:{ x:{ ticks:{precision:0}, grid:{color:TC.grid},
                  title:{display:true, text:'WEEKS ON CHART', color:TC.mid, font:{family:'"JetBrains Mono", monospace', size:9}} },
              y:{ beginAtZero:true, ticks:{callback:v=>abbr(v)}, grid:{color:TC.grid},
                  title:{display:true, text:'AVG STREAMS / WEEK', color:TC.mid, font:{family:'"JetBrains Mono", monospace', size:9}} } },
     onClick:(ev,els)=>{ if(els.length) openTrack(pts[els[0].index].t.id); } });

  renderPrediction(y);
}

/* ───────── The #1 Race — Champions ───────── */
function computeChampions(y){
  const champs=[];
  for(const t of model.tracks.values()){
    const wm=t.years.get(y); if(!wm) continue;
    let weeksAt1=0, first1=Infinity, best=0, bestWeek=null;
    for(const [w,e] of wm){
      if(e.rank===1){ weeksAt1++; if(w<first1) first1=w; }
      if((e.stream||0)>best){ best=e.stream||0; bestWeek=w; }
    }
    if(weeksAt1>0) champs.push({ id:t.id, t, weeksAt1, first1, peakStream:best, peakWeek:bestWeek });
  }
  return champs;
}
function sortChamps(champs, mode){
  const a=[...champs];
  if(mode==='peakStream') a.sort((x,z)=>z.peakStream-x.peakStream);
  else if(mode==='peakWeek') a.sort((x,z)=>(x.peakWeek||999)-(z.peakWeek||999));
  else if(mode==='first') a.sort((x,z)=>x.first1-z.first1);
  else a.sort((x,z)=>z.weeksAt1-x.weeksAt1 || z.peakStream-x.peakStream);
  return a;
}
function renderRace(y){
  const champs=computeChampions(y);
  if(raceState.year!==y){ // đổi năm -> khởi tạo lại lựa chọn + slider + phân trang
    raceState.year=y;
    raceState.selected=new Set(sortChamps(champs,raceState.sort).slice(0,4).map(c=>c.id));
    raceState.upTo=maxWeekOf(y)||1;
    raceState.statPage=0; raceState.carExpanded=false;
  }
  raceState.champs=champs;
  const sl=$('raceWeek'); const mw=maxWeekOf(y)||1;
  if(sl){ sl.min=1; sl.max=mw; if(raceState.upTo>mw) raceState.upTo=mw; sl.value=raceState.upTo; }
  const sll=$('raceWeekLabel'); if(sll) sll.textContent='W1–W'+raceState.upTo;
  const ss=$('raceSort'); if(ss) ss.value=raceState.sort;
  renderRaceMeta(y);
  renderRaceChart(y);
}
// Phần bên phải (bảng + carousel) — tách riêng để phân trang/expand không phải vẽ lại chart.
function renderRaceMeta(y){
  const CAR_MIN=5;
  const sorted=sortChamps(raceState.champs||[], raceState.sort);
  // màu cho bài đang chọn (theo thứ tự sort) -> dùng chung bảng + chart
  const colorOf={}; let ci=0;
  for(const c of sorted){ if(raceState.selected.has(c.id)){ colorOf[c.id]=CHAMP_COLORS[ci%CHAMP_COLORS.length]; ci++; } }
  raceState.colorOf=colorOf;

  // ── Bảng so sánh: phân trang 5/10 ──
  const size=raceState.statSize||5, total=sorted.length, pages=Math.max(1,Math.ceil(total/size));
  if(raceState.statPage>=pages) raceState.statPage=pages-1;
  if(raceState.statPage<0) raceState.statPage=0;
  const p=raceState.statPage;
  const pageItems=sorted.slice(p*size, p*size+size);
  const statsEl=$('champStats');
  if(statsEl){
    statsEl.innerHTML = total ? `<table class="champ-table">
      <thead><tr><th>Song &amp; Artist</th><th>Wks #1</th><th>Peak streams</th><th>Peak wk</th></tr></thead>
      <tbody>${pageItems.map(c=>{ const on=raceState.selected.has(c.id); return `<tr class="${on?'on':''} clickable" onclick="raceToggle('${c.id}')">
        <td><div class="champ-song"><span class="cs-dot" style="background:${on?colorOf[c.id]:'transparent'}"></span>${thumbHTML(c.t)}<div><div class="cs-name">${esc(c.t.name)}</div><div class="cs-art">${esc(c.t.artist)}</div></div></div></td>
        <td class="num">${c.weeksAt1}</td>
        <td class="num">${abbr(c.peakStream)}</td>
        <td class="num">W${c.peakWeek||'—'}</td>
      </tr>`; }).join('')}</tbody></table>
      <div class="race-pager">
        <button class="pg" onclick="raceStatPage(-1)" ${p<=0?'disabled':''}>‹</button>
        <span>${p*size+1}–${Math.min(total,p*size+size)} of ${total}</span>
        <button class="pg" onclick="raceStatPage(1)" ${p>=pages-1?'disabled':''}>›</button>
        <span class="sizes">Per page
          <button class="${size===5?'on':''}" onclick="raceStatSize(5)">5</button>
          <button class="${size===10?'on':''}" onclick="raceStatSize(10)">10</button>
        </span>
      </div>` : '<div class="empty">No #1 songs yet.</div>';
  }
  // ── Carousel: expand (mặc định 5 bài) ──
  const carEl=$('champCarousel');
  if(carEl){
    const shown = raceState.carExpanded ? sorted : sorted.slice(0, CAR_MIN);
    let html = shown.map(c=>{ const on=raceState.selected.has(c.id); return `<span class="chip ${on?'on':''}" onclick="raceToggle('${c.id}')">
      <span class="ck">${on?'✓':'○'}</span>${thumbHTML(c.t)}<span>${esc(c.t.name)}</span></span>`; }).join('');
    if(total>CAR_MIN) html += `<button class="chip chip-more" onclick="raceCarToggle()">${raceState.carExpanded?'▲ Show less':'▾ +'+(total-CAR_MIN)+' more'}</button>`;
    carEl.innerHTML = html || '<span class="hint">No champions.</span>';
  }
  hydrateThumbs();
}
function renderRaceChart(y){
  const champs=raceState.champs||[];
  const sorted=sortChamps(champs, raceState.sort);
  const upTo=raceState.upTo||maxWeekOf(y)||1;
  const labels=[]; for(let w=1;w<=upTo;w++) labels.push('W'+w);
  const series=c=>labels.map((_,ix)=>{ const e=entryAt(c.t,y,ix+1); return (e&&e.rank!=null)?e.rank:null; });
  const t=TH();
  const ds=[];
  // line nền (không chọn) — mờ, chỉ làm ngữ cảnh
  sorted.filter(c=>!raceState.selected.has(c.id)).forEach(c=>ds.push({
    label:c.t.name, data:series(c), borderColor:t.grid, backgroundColor:'transparent',
    borderWidth:1, pointRadius:0, tension:.35, spanGaps:false, order:2 }));
  // line champion đang chọn — tô màu, dày, có nhãn
  sorted.filter(c=>raceState.selected.has(c.id)).forEach(c=>ds.push({
    label:c.t.name, _champ:true, data:series(c),
    borderColor:raceState.colorOf[c.id]||t.red, backgroundColor:raceState.colorOf[c.id]||t.red,
    borderWidth:2.5, pointRadius:0, pointHoverRadius:5, tension:.35, spanGaps:false, order:1 }));
  const ranks=sorted.flatMap(c=>{ const wm=c.t.years.get(y)||new Map(); return [...wm.entries()].filter(([w,e])=>w<=upTo&&e.rank!=null).map(([,e])=>e.rank); });
  const rankMax=Math.max(10, ...ranks);
  drawChart('chartBump','line',{ labels, datasets:ds },
    { layout:{ padding:{ right:96 } },
      interaction:{ mode:'nearest', intersect:false },
      plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ label:c=>c.dataset.label+' · #'+c.parsed.y } } },
      scales:{ y:{ reverse:true, min:1, max:rankMax, grid:{color:t.grid}, ticks:{ ...(rankMax<=15?{stepSize:1}:{}), callback:v=>'#'+v } },
               x:{ grid:{display:false}, ticks:{ maxTicksLimit:14 } } } },
    [raceLabelPlugin]);
}
window.raceToggle=function(id){ if(raceState.selected.has(id)) raceState.selected.delete(id); else raceState.selected.add(id); renderRaceMeta(currentYear); renderRaceChart(currentYear); };
window.raceSetSort=function(v){ raceState.sort=v; raceState.statPage=0; renderRace(currentYear); };
window.raceSetWeek=function(v){ raceState.upTo=Math.max(1,+v||1); const l=$('raceWeekLabel'); if(l) l.textContent='W1–W'+raceState.upTo; renderRaceChart(currentYear); };
window.raceStatSize=function(n){ raceState.statSize=+n; raceState.statPage=0; renderRaceMeta(currentYear); };
window.raceStatPage=function(d){ raceState.statPage=(raceState.statPage||0)+d; renderRaceMeta(currentYear); };
window.raceCarToggle=function(){ raceState.carExpanded=!raceState.carExpanded; renderRaceMeta(currentYear); };

/* ───────── Dự đoán tuần tới ───────── */
function renderPrediction(y){
  const w=maxWeekOf(y);
  if(!w){ $('predBody').innerHTML='<div class="empty" style="padding:16px 0">No data yet.</div>'; return; }
  const cur=weekChart(y,w);
  const proj=[];
  for(const r of cur){
    const s=[];
    for(let k=w-2;k<=w;k++){ const e=entryAt(r.t,y,k); if(e&&e.stream>0) s.push(e.stream); }
    let g=0,n=0;
    for(let i=1;i<s.length;i++){ g+=(s[i]-s[i-1])/s[i-1]; n++; }
    g=n?g/n:0; g=Math.max(-0.6,Math.min(0.6,g));
    proj.push({ t:r.t, cur:r.rank, g, p:Math.round(r.stream*(1+g)) });
  }
  proj.sort((a,b)=>b.p-a.p);
  proj.forEach((x,i)=>x.rank=i+1);
  const risks=proj.filter(x=>x.g<=-0.25 && x.cur<=25).slice(0,3);
  const contend=proj[0]&&proj[0].cur!==1?proj[0]:null;
  let html='<div class="bt" style="font-family:var(--mono);font-size:12px;color:var(--muted);letter-spacing:.08em;margin-bottom:10px">PROJECTION FOR WEEK '+(w+1)+'/'+y+'</div>';
  html+='<table><tbody>'+proj.slice(0,10).map(x=>{
    const d=x.cur-x.rank;
    const mv=d===0?'<span class="mv eq">=</span>':(d>0?'<span class="mv up">+'+d+'</span>':'<span class="mv down">-'+(-d)+'</span>');
    let flag='';
    if(x.rank===1&&x.cur!==1) flag='<span class="pred-flag hot">#1 CONTENDER</span>';
    return `<tr class="clickable" onclick="openTrack('${x.t.id}')">
      <td class="rank">${x.rank}</td><td>${mv}</td>
      <td><div class="t-name">${esc(x.t.name)}${flag}</div><div class="t-artist">${esc(x.t.artist)}</div></td>
      <td class="num">~${fmt(x.p)}</td></tr>`;
  }).join('')+'</tbody></table>';
  if(contend) html+=`<p style="margin-top:10px;font-size:13.5px">⚡ "${esc(contend.t.name)}" has momentum to take No.1 next week.</p>`;
  if(risks.length) html+=`<p style="margin-top:6px;font-size:13.5px">⚠️ At risk of dropping: ${risks.map(x=>'"'+esc(x.t.name)+'" ('+Math.round(x.g*100)+'%/week)').join(', ')}.</p>`;
  $('predBody').innerHTML=html;
}

/* ───────── So sánh 1-vs-1 ───────── */
function runCompare(){
  const y=currentYear;
  const a=findTrackByLabel($('cmpA').value), b=findTrackByLabel($('cmpB').value);
  if(!a||!b){ toast('Could not recognize one of the two songs'); return; }
  const sa=statsFor(a,y), sb=statsFor(b,y);
  const row=(lbl,va,vb,fmtF,lowerWins)=>{
    const fa=fmtF?fmtF(va):va, fb=fmtF?fmtF(vb):vb;
    let wa='', wb='';
    if(va!=null&&vb!=null&&va!==vb){ const aw=lowerWins?va<vb:va>vb; wa=aw?' win':''; wb=aw?'':' win'; }
    return `<div class="c-a${wa}">${fa??'—'}</div><div class="c-lbl">${lbl}</div><div class="c-b${wb}">${fb??'—'}</div>`;
  };
  $('cmpOut').innerHTML=`
    <div style="display:flex;justify-content:space-between;gap:10px;font-weight:700;font-size:14px">
      <div style="display:flex;gap:8px;align-items:center">${thumbHTML(a)}<div>${esc(a.name)}<div class="t-artist">${esc(a.artist)}</div></div></div>
      <div style="display:flex;gap:8px;align-items:center;text-align:right">${thumbHTML(b)}<div>${esc(b.name)}<div class="t-artist">${esc(b.artist)}</div></div></div>
    </div>
    <div class="cmp-grid">
      ${row('Peak', sa.peak, sb.peak, v=>v?'#'+v:null, true)}
      ${row('Weeks on chart', sa.woc, sb.woc)}
      ${row('Total streams (year)', sa.total, sb.total, fmt)}
      ${row('Best weekly streams', sa.best, sb.best, fmt)}
      ${row('#1 streak', sa.streak, sb.streak)}
      ${row('All-time streams', a.allTotal, b.allTotal, fmt)}
    </div>
    <div class="chartbox" style="height:260px"><canvas id="chartCmp"></canvas></div>`;
  const mw=maxWeekOf(y);
  const labels=[]; for(let w=1;w<=mw;w++) labels.push('W'+w);
  const mk=(t,color)=>({ label:t.name, data:labels.map((_,ix)=>{const e=entryAt(t,y,ix+1); return e&&e.rank!=null?e.rank:null;}),
    borderColor:color, backgroundColor:color, tension:.25, pointRadius:2, spanGaps:false });
  const maxR=Math.max(20, ...[a,b].flatMap(t=>{const wm=t.years.get(y)||new Map(); return [...wm.values()].filter(e=>e.rank!=null).map(e=>e.rank);}));
  const tc=TH();
  drawChart('chartCmp','line',{ labels, datasets:[mk(a,tc.red), mk(b,PALETTE[1])] },
    { plugins:{ legend:{position:'bottom', labels:{font:{family:'"Nunito Sans", sans-serif', size:11}}}, tooltip:{callbacks:{label:c=>c.dataset.label+' · #'+c.parsed.y}} },
      scales:{ y:{ reverse:true, min:1, max:maxR, grid:{color:tc.grid}, ticks:{callback:v=>'#'+v} },
               x:{ grid:{display:false}, ticks:{maxTicksLimit:12} } } });
  hydrateThumbs();
}

/* ───────── render: tracks & artist ───────── */
function renderTrackList(){
  const y=currentYear;
  const q=$('trackSearch').value.trim().toLowerCase();
  let list=[...model.tracks.values()].filter(t=>t.allTotal>0 || t.user);
  if(q) list=list.filter(t=>t.name.toLowerCase().includes(q)||t.artist.toLowerCase().includes(q));
  list.sort((a,b)=>b.allTotal-a.allTotal);
  $('trackList').innerHTML = list.slice(0,60).map(t=>{
    const s=statsFor(t,y);
    return `<tr class="clickable" onclick="openTrack('${t.id}')">
      <td class="thumbcell">${thumbHTML(t)}</td>
      <td><div class="t-name">${esc(t.name)}${t.user?'<span class="badge-user">ADDED BY YOU</span>':''}</div><div class="t-artist">${esc(t.artist)}</div></td>
      <td class="num">${s.peak?'#'+s.peak:'—'}</td>
      <td class="num">${s.woc}</td>
      <td class="num">${fmt(s.total)}</td>
      <td class="num">${fmt(t.allTotal)}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="6"><div class="empty">No songs found.</div></td></tr>';
  hydrateThumbs();
}
window.openTrack = function(id, yPick){
  switchView('tracks');
  const t=model.tracks.get(id); if(!t) return;
  const yearsOf=[...t.years.keys()].sort((a,b)=>a-b);
  const y = yPick!=null ? yPick : (t.years.has(currentYear)?currentYear:(yearsOf[yearsOf.length-1]||currentYear));
  const s=statsFor(t,y);
  const chips = yearsOf.length>1 ? `<div class="pill-row" style="margin:10px 0 0">${yearsOf.map(yr=>`<span class="pill ${yr===y?'on':''}" onclick="event.stopPropagation();openTrack('${t.id}',${yr})">${yr}</span>`).join('')}</div>` : '';
  $('trackDetail').innerHTML = `
    <div class="panel">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px">
        <div style="display:flex;gap:14px;align-items:center">
          ${thumbHTML(t,'big')}
          <div>
            <h2 style="font-size:22px;margin-bottom:2px">${esc(t.name)}</h2>
            <div class="t-artist" style="font-size:14px">${t.artists.map(a=>`<span class="alink" onclick="openArtist('${escAttr(a)}')">${esc(a)}</span>`).join(', ')}</div>
            ${chips}
          </div>
        </div>
        <div style="display:flex;gap:18px;font-family:var(--mono);font-size:13px;color:var(--muted);flex-wrap:wrap">
          <span>Peak ${y} <b style="color:var(--gold)">${s.peak?'#'+s.peak:'—'}</b></span>
          <span>WOC <b style="color:var(--text)">${s.woc}</b></span>
          <span>Streams ${y} <b style="color:var(--text)">${fmt(s.total)}</b></span>
          ${t.baseline?`<span>Pre-chart <b style="color:var(--text)">${fmt(t.baseline)}</b></span>`:''}
          <span>All-time <b style="color:var(--text)">${fmt(t.allTotal)}</b></span>
          <span>#1 streak <b style="color:var(--text)">${s.streak||0}</b></span>
        </div>
      </div>
      <div class="chartbox" style="margin-top:14px"><canvas id="chartTraj"></canvas></div>
    </div>`;
  const wm=t.years.get(y)||new Map();
  const ws=[...wm.entries()].filter(([w,e])=>e.rank!=null).sort((a,b)=>a[0]-b[0]);
  const maxRank=Math.max(51,...ws.map(([w,e])=>e.rank));
  const tt=TH();
  drawChart('chartTraj','line',{
    labels: ws.map(([w])=>'W'+w),
    datasets:[{ data: ws.map(([w,e])=>e.rank), borderColor:tt.ink, borderWidth:2,
      pointBackgroundColor: ws.map(([w,e])=>e.rank===1?tt.red:'transparent'),
      pointBorderColor: ws.map(([w,e])=>e.rank===1?tt.red:tt.ink), pointBorderWidth:1.5,
      pointRadius: ws.map(([w,e])=>e.rank===1?6:3), tension:.25, fill:false }]
  },{ plugins:{ legend:{display:false}, tooltip:{callbacks:{label:c=>'#'+c.parsed.y}} },
     scales:{ y:{ reverse:true, min:1, max:maxRank, grid:{color:tt.grid}, ticks:{ callback:v=>'#'+v } },
              x:{ grid:{display:false}, ticks:{ maxTicksLimit:14 } } } });
  hydrateThumbs();
  document.querySelector('#view-tracks').scrollIntoView({behavior:'smooth'});
}
window.openArtist = function(name){
  switchView('tracks');
  const y=currentYear;
  const list=[...model.tracks.values()].filter(t=>t.artists.includes(name) && (t.allTotal>0||t.user));
  if(!list.length){ toast('No data yet for this artist'); return; }
  list.sort((a,b)=>statsFor(b,y).total-statsFor(a,y).total || b.allTotal-a.allTotal);
  const yTotal=list.reduce((s,t)=>s+statsFor(t,y).total,0);
  const allTotal=list.reduce((s,t)=>s+t.allTotal,0);
  const no1s=list.filter(t=>statsFor(t,y).peak===1).length;
  const bestPeak=Math.min(...list.map(t=>statsFor(t,y).peak||999));
  const top6=list.filter(t=>statsFor(t,y).woc>0).slice(0,6);
  $('trackDetail').innerHTML = `
    <div class="panel">
      <h2 style="font-size:24px">${esc(name)}</h2>
      <div style="display:flex;gap:20px;font-family:var(--mono);font-size:13px;color:var(--muted);flex-wrap:wrap;margin-top:6px">
        <span>Songs on chart <b style="color:var(--text)">${list.length}</b></span>
        <span>No.1 in ${y} <b style="color:var(--gold)">${no1s}</b></span>
        <span>Best peak <b style="color:var(--text)">${bestPeak<999?'#'+bestPeak:'—'}</b></span>
        <span>Streams ${y} <b style="color:var(--text)">${fmt(yTotal)}</b></span>
        <span>All-time streams <b style="color:var(--text)">${fmt(allTotal)}</b></span>
      </div>
      ${top6.length?'<div class="chartbox tall" style="margin-top:14px"><canvas id="chartArtistTraj"></canvas></div><div class="hint">Trajectories of '+esc(name)+"'s songs in "+y+'.</div>':''}
      <table style="margin-top:14px"><tbody>
        ${list.map(t=>{const s=statsFor(t,y);return `<tr class="clickable" onclick="openTrack('${t.id}')">
          <td class="thumbcell">${thumbHTML(t)}</td>
          <td><div class="t-name">${esc(t.name)}</div></td>
          <td class="num">${s.peak?'Peak #'+s.peak:'—'}</td>
          <td class="num">${s.woc} weeks</td>
          <td class="num">${fmt(s.total)} streams</td>
        </tr>`;}).join('')}
      </tbody></table>
    </div>`;
  if(top6.length){
    const mw=maxWeekOf(y);
    const labels=[]; for(let w=1;w<=mw;w++) labels.push('W'+w);
    drawChart('chartArtistTraj','line',{
      labels,
      datasets: top6.map((t,i)=>({ label:t.name,
        data: labels.map((_,ix)=>{const e=entryAt(t,y,ix+1); return e&&e.rank!=null?e.rank:null;}),
        borderColor:RACE_COLORS[i%RACE_COLORS.length], backgroundColor:RACE_COLORS[i%RACE_COLORS.length], borderWidth:2.5, tension:.35, pointRadius:0, pointHoverRadius:5, spanGaps:false }))
    },{ plugins:{ legend:{position:'bottom', labels:{font:{family:'"Nunito Sans", sans-serif', size:11}}}, tooltip:{callbacks:{label:c=>c.dataset.label+' · #'+c.parsed.y}} },
       scales:{ y:{ reverse:true, min:1, grid:{color:TH().grid}, ticks:{callback:v=>'#'+v} },
                x:{ grid:{display:false}, ticks:{maxTicksLimit:14} } } });
  }
  hydrateThumbs();
  document.querySelector('#view-tracks').scrollIntoView({behavior:'smooth'});
}

/* ───────── All-time ───────── */
const AT_SIZE=100;       // Hall of Fame chốt ở top 100 all-time
// Sort Hall of Fame theo 1 trong 3 cột stream (mặc định All-time ↓); bấm lại cột đang sort -> đổi chiều.
let atSort='all', atSortDir='desc';

/* ── Lọc Hall of Fame theo vùng của NGHỆ SĨ (Artist.region, tag ở /admin/artists) ──
   Bài feat nhiều nghệ sĩ khác vùng -> thuộc TẤT CẢ các vùng đó (khớp cách credit stream
   cho từng nghệ sĩ ở "Top artists"). Không nghệ sĩ nào có region -> 'none' (Untagged). */
const AT_REGIONS=[{ v:'ASIA', label:'Asia' },{ v:'US-UK', label:'US-UK' },{ v:'OTHER', label:'Other' },{ v:'none', label:'Untagged' }];
const AT_REGION_LABEL=Object.fromEntries(AT_REGIONS.map(r=>[r.v,r.label]));
let atRegion='';                       // '' = tất cả các vùng
const REGION_CACHE=new Map();          // trackId -> Set(region)
function trackRegions(t){
  let s=REGION_CACHE.get(t.id);
  if(s) return s;
  s=new Set();
  for(const a of t.artists){ const r=ARTMETA.get(artistKey(a))?.region; if(r) s.add(r); }
  if(!s.size) s.add('none');
  REGION_CACHE.set(t.id,s);
  return s;
}
window.setAtRegion=function(v){ atRegion=v||''; renderAllTime(); };

// Vẽ hàng pill vùng + trả về số bài mỗi vùng; vùng đang chọn mà rỗng thì tự về "All".
function renderAtRegions(list){
  const n={};
  for(const t of list) for(const r of trackRegions(t)) n[r]=(n[r]||0)+1;
  if(atRegion && !n[atRegion]) atRegion='';
  const box=$('atRegions');
  if(box){
    const pill=(v,label,disabled)=>`<button type="button" class="pill${atRegion===v?' on':''}"${disabled?' disabled':''} onclick="setAtRegion('${v}')">${label}</button>`;
    box.innerHTML = pill('', `All · ${list.length}`) + AT_REGIONS.map(r=>pill(r.v, `${r.label} · ${n[r.v]||0}`, !n[r.v])).join('');
  }
  return n;
}
const AT_SORT_KEY={ pre:t=>t.baseline, on:t=>t.trackedTotal, all:t=>t.allTotal };
window.setAtSort=function(k){
  if(!AT_SORT_KEY[k]) return;
  if(atSort===k) atSortDir = atSortDir==='desc' ? 'asc' : 'desc';
  else { atSort=k; atSortDir='desc'; }
  renderAllTime();
};
// competition rank trên mảng ĐÃ sắp theo key (giá trị bằng nhau -> cùng hạng)
function rankMap(arr, key){
  const m=new Map(); let r=0, prev=null, seen=0;
  for(const t of arr){ seen++; const v=key(t); if(v!==prev){ r=seen; prev=v; } m.set(t.id,r); }
  return m;
}
function renderAllTime(){
  const list=[...model.tracks.values()].filter(t=>t.allTotal>0);
  list.sort((a,b)=>b.allTotal-a.allTotal);
  const artists={}; for(const t of list) for(const a of t.artists) artists[a]=(artists[a]||0)+t.allTotal;
  const grand=list.reduce((s,t)=>s+t.allTotal,0);
  const grandBase=list.reduce((s,t)=>s+t.baseline,0);
  const n1=list[0];
  $('atKpis').innerHTML=`
    <div class="kpi"><div class="lbl">Total streams all-time</div><div class="val">${fmt(grand)}</div><div class="note">${fmt(grandBase)} from pre-chart</div></div>
    <div class="kpi"><div class="lbl">No.1 song all-time</div><div class="val name">${n1?esc(n1.name):'—'}</div><div class="note">${n1?fmt(n1.allTotal)+' streams':''}</div></div>
    <div class="kpi"><div class="lbl">Songs with data</div><div class="val">${list.length}</div><div class="note">of ${model.tracks.size} songs in catalog</div></div>
    <div class="kpi"><div class="lbl">Artists</div><div class="val">${Object.keys(artists).length}</div><div class="note">years tracked: ${model.yearList.join(', ')}</div></div>`;

  // ── Phân bố stream theo bài (chọn On-chart / All-time) ──
  renderAllTimeDist(list);
  // ── Breakdown ở cuối trang: genre streams / artist theo genre / artist theo gender ──
  renderAllTimeBreakdown(list, grand);

  // ── Hall of Fame: lọc theo vùng trước, mọi thứ bên dưới tính TRONG vùng đang chọn ──
  renderAtRegions(list);
  const pool = atRegion ? list.filter(t=>trackRegions(t).has(atRegion)) : list; // vẫn giữ thứ tự all-time ↓
  // ── hạng gốc = bảng xếp hạng pre-chart, hạng hiện tại = all-time; cả hai tính trên toàn bộ pool ──
  const allRankOf=rankMap(pool, AT_SORT_KEY.all);                                  // pool đã sắp all-time ↓
  const preRankOf=rankMap([...pool].sort((a,b)=>b.baseline-a.baseline), AT_SORT_KEY.pre);
  // Hall of Fame chỉ gồm 100 bài all-time cao nhất; sort các cột chỉ đảo thứ tự trong đúng 100 bài này.
  const roster=pool.slice(0, AT_SIZE);
  const key=AT_SORT_KEY[atSort], sgn=atSortDir==='asc'?-1:1;
  const sorted=[...roster].sort((a,b)=> sgn*(key(b)-key(a)) || b.allTotal-a.allTotal);
  const rankOf=rankMap(sorted, key);
  for(const [k,id] of [['pre','atThPre'],['on','atThOn'],['all','atThAll']]){
    const th=$(id); if(!th) continue;
    th.classList.toggle('on', atSort===k);
    const ar=th.querySelector('.sar'); if(ar) ar.textContent = atSort===k ? (atSortDir==='desc'?'▼':'▲') : '';
  }

  const q=($('atSearch').value||'').trim().toLowerCase();
  const shown = q ? sorted.filter(t=>t.name.toLowerCase().includes(q)||t.artist.toLowerCase().includes(q)) : sorted;
  $('atTable').innerHTML = shown.map((t)=>{
    // cột đang sort không có số liệu (vd bài chưa có pre-chart) -> "—" thay vì cả dải cùng hạng
    const pos=key(t)>0 ? rankOf.get(t.id) : null;
    const allPos=allRankOf.get(t.id);
    const prePos=t.baseline>0 ? preRankOf.get(t.id) : null;
    // "+/-" = dịch chuyển hạng pre-chart -> hạng all-time; ngoài top 100 pre-chart mà lọt vào đây -> NEW
    const isNew = prePos==null || prePos>AT_SIZE;
    const delta = isNew ? 0 : prePos-allPos;
    const mv = isNew ? '<span class="mv new">NEW</span>'
      : delta>0 ? `<span class="mv up">+${delta}</span>`
      : delta<0 ? `<span class="mv down">-${-delta}</span>`
      : '<span class="mv eq">=</span>';
    return `<tr>
      <td class="rank r${pos&&pos<=3?pos:''}" style="text-align:center">${pos ?? '<span style="font-size:15px;color:var(--faint)">—</span>'}</td>
      <td style="text-align:center">${mv}</td>
      <td class="thumbcell clickable" onclick="openTrack('${t.id}')">${thumbHTML(t)}</td>
      <td class="clickable" onclick="openTrack('${t.id}')"><div class="t-name">${esc(t.name)}${t.user?'<span class="badge-user">ADDED BY YOU</span>':''}</div><div class="t-artist">${esc(t.artist)}${t.genre?`<span class="gtag">${esc(t.genre)}</span>`:''}</div></td>
      <td class="num">${t.baseline?fmt(t.baseline):'—'}</td>
      <td class="num">${fmt(t.trackedTotal)}</td>
      <td class="num" style="color:var(--gold);font-weight:700">${fmt(t.allTotal)}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="7"><div class="empty">No songs found.</div></td></tr>';
  const pg=$('atPager');
  if(pg){
    const scope = atRegion ? ` · ${AT_REGION_LABEL[atRegion]} only (${pool.length} song${pool.length===1?'':'s'} with data)` : '';
    pg.innerHTML = q ? `<span>${shown.length} of ${roster.length} songs match${scope}</span>`
                     : scope ? `<span>Top ${roster.length}${scope}</span>` : '';
  }

  const topA=Object.entries(artists).sort((a,b)=>b[1]-a[1]).slice(0,10);
  const ta=TH();
  drawChart('chartAtArtists','bar',{
    labels: topA.map(x=>x[0]),
    datasets:[{ data: topA.map(x=>x[1]), backgroundColor: topA.map((_,i)=>i===0?ta.red:ta.mid), barPercentage:.8 }]
  },{ indexAxis:'y', plugins:{legend:{display:false}, tooltip:{callbacks:{label:c=>fmt(c.parsed.x)+' streams'}}},
     scales:{ x:{ beginAtZero:true, ticks:{callback:v=>abbr(v)}, grid:{color:ta.grid} }, y:{ grid:{display:false} } },
     onClick:(ev,els)=>{ if(els.length) openArtist(topA[els[0].index][0]); } });
  hydrateThumbs();
}
/* ───────── All-time · Phân bố stream ─────────
   Histogram: mỗi cột = số BÀI trong 1 bin rộng 100.000.000 stream, bin i = [i·100M, (i+1)·100M).
   Số bin chạy tới bài cao nhất của chế độ đang chọn. */
const AT_DIST_BIN=1e8;
const AT_DIST_MODES={ on:{ label:'On-chart', key:t=>t.trackedTotal }, all:{ label:'All-time', key:t=>t.allTotal } };
let atDistMode='all', atDistList=null;
window.setAtDist=function(m){ if(!AT_DIST_MODES[m]) return; atDistMode=m; drawAtDist(); };

function renderAllTimeDist(list){ atDistList=list; drawAtDist(); }

function drawAtDist(){
  if(!atDistList || !$('chartAtDist')) return;
  const mode=AT_DIST_MODES[atDistMode], key=mode.key;
  const vals=atDistList.map(key).sort((a,b)=>a-b);
  const max=vals[vals.length-1]||0;
  const nBins=Math.max(1, Math.floor(max/AT_DIST_BIN)+1);
  const counts=new Array(nBins).fill(0);
  for(const v of vals) counts[Math.min(nBins-1, Math.floor(v/AT_DIST_BIN))]++;
  const tabs=$('atDistTabs');
  if(tabs) tabs.innerHTML=Object.entries(AT_DIST_MODES).map(([k,m])=>
    `<button type="button" class="pill${k===atDistMode?' on':''}" onclick="setAtDist('${k}')">${m.label}</button>`).join('');
  const sub=$('atDistSub');
  if(sub){
    const n=vals.length, med=n?vals[n>>1]:0;
    let zero=0; while(zero<n && vals[zero]===0) zero++; // vals đã sắp tăng dần
    sub.textContent=`${n} songs · ${nBins} bins of ${abbr(AT_DIST_BIN)} · median ${abbr(med)} · max ${abbr(max)}${zero?` · ${zero} at zero`:''}`;
  }
  const total=vals.length||1;
  const edge=i=>i*AT_DIST_BIN;
  const td=TH();
  drawChart('chartAtDist','bar',{
    labels: counts.map((_,i)=>abbr(edge(i))),
    datasets:[{ data: counts, backgroundColor:td.red }]
  },{ plugins:{ legend:{display:false},
        tooltip:{ callbacks:{
          title:c=>`${abbr(edge(c[0].dataIndex))} – ${abbr(edge(c[0].dataIndex+1))} streams`,
          label:c=>`${c.parsed.y} song${c.parsed.y===1?'':'s'} · ${(c.parsed.y/total*100).toFixed(1)}% (${mode.label})` } } },
      scales:{ y:{ beginAtZero:true, grid:{color:td.grid}, ticks:{precision:0},
                   title:{display:true, text:'SONGS', color:td.mid, font:{family:'"JetBrains Mono", monospace', size:9}} },
               x:{ grid:{display:false}, ticks:{ autoSkip:true, maxTicksLimit:16, maxRotation:0 },
                   title:{display:true, text:`STREAMS — BIN ${abbr(AT_DIST_BIN)}`, color:td.mid, font:{family:'"JetBrains Mono", monospace', size:9}} } },
      datasets:{ bar:{ categoryPercentage:1, barPercentage:.92 } } });
}

/* ───────── All-time · Breakdown (gộp 3 bảng vào 1 panel, chọn type để show) ─────────
   type: genre        -> tổng stream + số bài theo thể loại (thanh tỉ lệ, Unknown xếp cuối)
         artistGenre  -> xếp hạng nghệ sĩ TRONG 1 thể loại (filter chọn thể loại)
         artistGender -> xếp hạng nghệ sĩ theo Male / Female / Group
   Mọi bảng phân trang 10 dòng/trang. */
const AT_BREAK_SIZE=10;
let atBreakType='genre';   // type đang chọn
let atBreakGenre=null;     // thể loại đang chọn (artistGenre)
let atGender=null;         // nhóm giới tính đang chọn (artistGender)
let atBreakPage=0;
let atBreakData=null;      // số liệu đã gộp sẵn — đổi filter/trang thì chỉ vẽ lại, không tính lại
// chuỗi an toàn khi nhét vào onclick="fn('…')" — escape cho JS trước, cho HTML sau
const jsStr=s=>esc(String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'"));

window.setAtBreakType=function(v){ atBreakType=v; atBreakPage=0; drawAtBreakdown(); };
window.setAtBreakGenre=function(i){ const g=atBreakData?.genres[i]; if(g) atBreakGenre=g[0]; atBreakPage=0; drawAtBreakdown(); };
window.setAtGender=function(g){ atGender=g; atBreakPage=0; drawAtBreakdown(); };
window.atBreakGoPage=function(d){ atBreakPage+=d; drawAtBreakdown(); };

// Gộp số liệu 1 lượt: stream/bài theo genre, nghệ sĩ theo genre, nghệ sĩ theo gender.
// allTotal của mỗi bài được credit cho TỪNG nghệ sĩ (khớp cách gộp "Top artists").
function renderAllTimeBreakdown(list, grand){
  const box=$('atBreakdown'); if(!box) return;
  const GK={ male:'Male', female:'Female', group:'Group' };
  const byGenre={};                 // genre -> { streams, songs }
  const artistsIn=new Map();        // genre -> Map(key -> { name, streams, songs:Set })
  const byArtist=new Map();         // key   -> { name, gender, streams, songs:Set }
  const untagged=new Set();
  for(const t of list){
    const g=(t.genre||'').trim()||'Unknown';
    if(!byGenre[g]) byGenre[g]={ streams:0, songs:0 };
    byGenre[g].streams+=t.allTotal; byGenre[g].songs++;
    let m=artistsIn.get(g); if(!m){ m=new Map(); artistsIn.set(g,m); }
    for(const a of t.artists){
      const key=artistKey(a);
      let e=m.get(key); if(!e){ e={ name:a, streams:0, songs:new Set() }; m.set(key,e); }
      e.streams+=t.allTotal; e.songs.add(t.id);
      const label=GK[ARTMETA.get(key)?.gender];
      if(!label){ untagged.add(key); continue; }
      let x=byArtist.get(key); if(!x){ x={ name:a, gender:label, streams:0, songs:new Set() }; byArtist.set(key,x); }
      x.streams+=t.allTotal; x.songs.add(t.id);
    }
  }
  const unknown=byGenre['Unknown'];
  const known=Object.entries(byGenre).filter(([g])=>g!=='Unknown').sort((a,b)=>b[1].streams-a[1].streams);
  const genres=unknown?[...known,['Unknown',unknown]]:known;
  const gender={ Male:[], Female:[], Group:[] };
  for(const e of byArtist.values()) gender[e.gender].push(e);
  for(const k of ['Male','Female','Group']) gender[k].sort((a,b)=>b.streams-a.streams);
  const artistByGenre=new Map();
  for(const [g,m] of artistsIn) artistByGenre.set(g, [...m.values()].sort((a,b)=>b.streams-a.streams));

  atBreakData={ genres, genreCount:known.length, grand,
    songs:list.length, taggedSongs:list.length-(unknown?unknown.songs:0),
    artistByGenre, gender, taggedArtists:byArtist.size, untagged:untagged.size };

  // mặc định: thể loại nhiều stream nhất / nhóm đông nghệ sĩ nhất
  const gKeys=genres.map(([g])=>g);
  if(!atBreakGenre || !gKeys.includes(atBreakGenre)) atBreakGenre=gKeys[0]||null;
  if(!atGender || !gender[atGender].length) atGender=['Male','Female','Group'].sort((a,b)=>gender[b].length-gender[a].length)[0];

  const sel=$('atBreakType');
  if(sel && !sel.dataset.bound){ sel.dataset.bound='1'; sel.onchange=()=>window.setAtBreakType(sel.value); }
  drawAtBreakdown();
}

// Vẽ filter + bảng của type đang chọn (không tính lại số liệu).
function drawAtBreakdown(){
  const box=$('atBreakdown'), sub=$('atBreakSub'); if(!box||!atBreakData) return;
  const d=atBreakData;
  const sel=$('atBreakType'); if(sel && sel.value!==atBreakType) sel.value=atBreakType;

  const pill=(label,on,call,disabled)=>`<button type="button" class="pill${on?' on':''}" ${disabled?'disabled':''} onclick="${call}">${label}</button>`;
  let filter='', total=0, note='', body='', hint='';

  if(atBreakType==='genre'){
    note=`${d.genreCount} genre${d.genreCount>1?'s':''} · ${d.taggedSongs} of ${d.songs} songs tagged`;
    if(!d.genreCount){
      body='<div class="hint" style="margin:0">No genre data yet — songs get a genre in /admin (auto-filled from iTunes when cover art is fetched).</div>';
    }else{
      total=d.genres.length;
      const gMax=Math.max(1,...d.genres.map(([,s])=>s.streams));
      body='<div class="gstats">'+slice(d.genres,total).map(([g,s])=>{
        const isU=g==='Unknown';
        const pct=d.grand?Math.round(s.streams/d.grand*100):0;
        const w=Math.max(2,Math.round(s.streams/gMax*100));
        return `<div class="gstat">
          <span class="gname"${isU?' style="color:var(--faint);font-weight:600"':''}>${esc(g)}</span>
          <span class="gbar"><i style="width:${w}%${isU?';background:var(--faint)':''}"></i></span>
          <span class="gval">${s.songs} song${s.songs>1?'s':''} · ${abbr(s.streams)} · ${pct}%</span>
        </div>`;
      }).join('')+'</div>';
      hint='Share of all-time streams by genre. "Unknown" = songs with no genre tagged yet.';
    }
  }else if(atBreakType==='artistGenre'){
    const rows=(atBreakGenre && d.artistByGenre.get(atBreakGenre))||[];
    note=atBreakGenre?`${atBreakGenre} · ${rows.length} artist${rows.length>1?'s':''}`:'';
    if(!d.genres.length){
      body='<div class="hint" style="margin:0">No songs with streams yet.</div>';
    }else{
      filter=`<div class="pill-row">${d.genres.map(([g,s],i)=>pill(`${esc(g)} · ${s.songs}`, g===atBreakGenre, `setAtBreakGenre(${i})`)).join('')}</div>`;
      total=rows.length;
      body=artistTable(slice(rows,total), 'No artists in this genre.');
      hint='Artists ranked by all-time streams inside the selected genre — every artist on a song gets its full stream count.';
    }
  }else{
    note=`${d.taggedArtists} artist${d.taggedArtists>1?'s':''} tagged${d.untagged?` · ${d.untagged} untagged`:''}`;
    if(!d.taggedArtists){
      body='<div class="hint" style="margin:0">No artist gender data yet — tag artists in <strong>/admin/artists</strong> (Male / Female / Group).</div>';
      note='';
    }else{
      const rows=d.gender[atGender]||[];
      filter=`<div class="pill-row">${['Male','Female','Group'].map(k=>pill(`${k} · ${d.gender[k].length}`, k===atGender, `setAtGender('${k}')`, !d.gender[k].length)).join('')}</div>`;
      total=rows.length;
      body=artistTable(slice(rows,total), 'No tagged artists in this group.');
      hint='Artists ranked by all-time streams within the selected group.';
    }
  }

  if(sub) sub.textContent=note;
  box.innerHTML=filter+body+pager(total)+(hint?`<div class="hint">${hint}</div>`:'');

  // ── helpers dùng chung state phân trang ──
  function pages(total){ return Math.max(1,Math.ceil(total/AT_BREAK_SIZE)); }
  function slice(arr,total){
    const p=pages(total);
    if(atBreakPage>=p) atBreakPage=p-1;
    if(atBreakPage<0) atBreakPage=0;
    return arr.slice(atBreakPage*AT_BREAK_SIZE, atBreakPage*AT_BREAK_SIZE+AT_BREAK_SIZE);
  }
  function pager(total){
    if(total<=AT_BREAK_SIZE) return '';
    const p=pages(total);
    return `<div class="race-pager" style="margin-top:12px">
      <button class="pg" onclick="atBreakGoPage(-1)" ${atBreakPage<=0?'disabled':''}>‹</button>
      <span>${atBreakPage*AT_BREAK_SIZE+1}–${Math.min(total,atBreakPage*AT_BREAK_SIZE+AT_BREAK_SIZE)} of ${total}</span>
      <button class="pg" onclick="atBreakGoPage(1)" ${atBreakPage>=p-1?'disabled':''}>›</button>
    </div>`;
  }
  function artistTable(rows, emptyMsg){
    const off=atBreakPage*AT_BREAK_SIZE;
    const body=rows.length ? rows.map((r,i)=>{
      const pos=off+i+1;
      return `<tr>
        <td class="rank r${pos<=3?pos:''}" style="text-align:center">${pos}</td>
        <td class="clickable" onclick="openArtist('${jsStr(r.name)}')">${esc(r.name)}</td>
        <td class="num">${r.songs.size}</td>
        <td class="num" style="color:var(--gold);font-weight:700">${fmt(r.streams)}</td>
      </tr>`;
    }).join('') : `<tr><td colspan="4"><div class="empty">${emptyMsg}</div></td></tr>`;
    return `<table>
      <thead><tr><th style="text-align:center">#</th><th>Artist</th><th style="text-align:right">Songs</th><th style="text-align:right">Total streams</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
  }
}
/* ───────── Awards ─────────
   Mỗi bản ghi = 1 đề cử (won=true -> thắng) trong 1 hạng mục của 1 năm.
   subject: type='track' -> trackId (tên tra từ model), type='artist' -> artistKey (tên dùng name đã lưu). */
let awYear=null;
window.setAwYear=function(y){ awYear=+y; renderAwards(); };

function awardSubject(a){
  if(a.type==='track'){
    const t=model.tracks.get(a.subject);
    return { label:t?t.name:(a.name||a.subject), sub:t?t.artist:'', track:t||null, gone:!t };
  }
  return { label:a.name||a.subject, sub:'Artist', track:null, gone:false };
}
// mở bài hát / nghệ sĩ tương ứng khi bấm 1 dòng award
window.openAward=function(type, subject, name){
  if(type==='track'){ if(model.tracks.has(subject)) openTrack(subject); else toast('This song is no longer in the catalog'); return; }
  openArtist(name);
};

function renderAwards(){
  const all=DATA.awards||[];
  const years=[...new Set(all.map(a=>+a.year))].sort((a,b)=>b-a);
  if(!years.length){
    $('awKpis').innerHTML='';
    $('awYears').innerHTML='';
    $('awSub').textContent='';
    $('awList').innerHTML='<div class="empty">No awards recorded yet — add them in <strong>/admin/awards</strong>.</div>';
    $('awHonoursPanel').style.display='none';
    return;
  }
  $('awHonoursPanel').style.display='';
  if(awYear==null || !years.includes(awYear)) awYear = years.includes(currentYear) ? currentYear : years[0];

  const ofYear=all.filter(a=>+a.year===awYear);
  const cats=new Map();
  for(const a of ofYear){ if(!cats.has(a.category)) cats.set(a.category,[]); cats.get(a.category).push(a); }
  for(const rows of cats.values()) rows.sort((x,y)=>(y.won?1:0)-(x.won?1:0) || String(x.name).localeCompare(String(y.name)));
  const ordered=[...cats.entries()].sort((a,b)=>a[0].localeCompare(b[0]));
  const wins=ofYear.filter(a=>a.won);

  // ── KPI ──
  const topWinner=(()=>{ const m=new Map();
    for(const a of wins){ const k=a.type+':'+a.subject; m.set(k,(m.get(k)||0)+1); }
    let best=null; for(const [k,n] of m) if(!best||n>best.n) best={k,n};
    if(!best) return null;
    const a=wins.find(x=>x.type+':'+x.subject===best.k);
    return { name:awardSubject(a).label, n:best.n };
  })();
  $('awKpis').innerHTML=`
    <div class="kpi"><div class="lbl">Categories in ${awYear}</div><div class="val">${ordered.length}</div><div class="note">${ofYear.length} nomination${ofYear.length===1?'':'s'} total</div></div>
    <div class="kpi"><div class="lbl">Titles awarded</div><div class="val">${wins.length}</div><div class="note">${ordered.length-wins.length} still undecided</div></div>
    <div class="kpi"><div class="lbl">Most titles in ${awYear}</div><div class="val name">${topWinner?esc(topWinner.name):'—'}</div><div class="note">${topWinner?topWinner.n+' win'+(topWinner.n===1?'':'s'):''}</div></div>
    <div class="kpi"><div class="lbl">Years on record</div><div class="val">${years.length}</div><div class="note">${years.join(', ')}</div></div>`;

  $('awYears').innerHTML=years.map(y=>`<button type="button" class="pill${y===awYear?' on':''}" onclick="setAwYear(${y})">${y}</button>`).join('');
  $('awSub').textContent=`${ordered.length} categor${ordered.length===1?'y':'ies'} · ${wins.length} winner${wins.length===1?'':'s'}`;

  $('awList').innerHTML = ordered.map(([cat,rows])=>{
    const body=rows.map(a=>{
      const s=awardSubject(a);
      const cls=a.won?'aw-row win':'aw-row';
      return `<div class="${cls}" onclick="openAward('${a.type}','${jsStr(a.subject)}','${jsStr(s.label)}')">
        <span class="aw-mark">${a.won?'🏆':'·'}</span>
        ${a.type==='track'&&s.track?`<span class="aw-thumb">${thumbHTML(s.track)}</span>`:''}
        <span class="aw-name">${esc(s.label)}${s.gone?'<span class="gtag">removed</span>':''}
          ${s.sub?`<span class="aw-sub">${esc(s.sub)}</span>`:''}</span>
        ${a.note?`<span class="aw-note">${esc(a.note)}</span>`:''}
        <span class="aw-tag">${a.won?'winner':'nominee'}</span>
      </div>`;
    }).join('');
    return `<div class="aw-cat">
      <div class="aw-cat-head">${esc(cat)}${rows.some(r=>r.won)?'':'<span class="aw-pending">no winner yet</span>'}</div>
      ${body}
    </div>`;
  }).join('');

  renderAwardHonours(all);
  hydrateThumbs();
}

// Bảng "most decorated" trên TẤT CẢ các năm: đếm win + tổng đề cử cho mỗi đối tượng.
function renderAwardHonours(all){
  const box=$('awHonours'); if(!box) return;
  const m=new Map(); // type:subject -> { label, sub, type, subject, wins, noms, years:Set }
  for(const a of all){
    const k=a.type+':'+a.subject;
    let e=m.get(k);
    if(!e){ const s=awardSubject(a); e={ label:s.label, sub:s.sub, type:a.type, subject:a.subject, wins:0, noms:0, years:new Set() }; m.set(k,e); }
    e.noms++; if(a.won) e.wins++; e.years.add(+a.year);
  }
  const rows=[...m.values()].sort((x,y)=>y.wins-x.wins || y.noms-x.noms || x.label.localeCompare(y.label)).slice(0,15);
  const sub=$('awHonoursSub');
  if(sub) sub.textContent=`${m.size} song${m.size===1?'':'s'} & artists nominated`;
  box.innerHTML=`<table>
    <thead><tr><th style="text-align:center">#</th><th>Song / artist</th><th>Years</th><th style="text-align:right">Wins</th><th style="text-align:right">Noms</th></tr></thead>
    <tbody>${rows.map((r,i)=>`<tr class="clickable" onclick="openAward('${r.type}','${jsStr(r.subject)}','${jsStr(r.label)}')">
      <td class="rank r${i<3?i+1:''}" style="text-align:center">${i+1}</td>
      <td><div class="t-name">${esc(r.label)}</div>${r.sub?`<div class="t-artist">${esc(r.sub)}</div>`:''}</td>
      <td class="muted" style="font-family:var(--mono);font-size:11.5px">${[...r.years].sort((a,b)=>a-b).join(', ')}</td>
      <td class="num" style="color:var(--gold);font-weight:700">${r.wins}</td>
      <td class="num">${r.noms}</td>
    </tr>`).join('')}</tbody></table>`;
}

/* ───────── tiện ích danh mục (gợi ý cho ô So sánh 1-vs-1) ───────── */
function fillTrackOptions(){
  const dl=$('trackOptions'); if(!dl) return;
  dl.innerHTML='';
  const opts=[...model.tracks.values()].sort((a,b)=>b.allTotal-a.allTotal);
  for(const t of opts){ const o=document.createElement('option'); o.value=t.name+' — '+t.artist; dl.appendChild(o); }
}
function findTrackByLabel(label){
  const s=(label||'').trim().toLowerCase(); if(!s) return null;
  for(const t of model.tracks.values()){
    if((t.name+' — '+t.artist).toLowerCase()===s) return t;
  }
  let best=null;
  for(const t of model.tracks.values()){
    const n=t.name.toLowerCase();
    if(n===s) return t;
    if(!best && (n.includes(s)||s.includes(n))) best=t;
  }
  return best;
}

/* ───────── chart helper ───────── */
function drawChart(id,type,data,options,plugins){
  if(charts[id]){ charts[id].destroy(); delete charts[id]; }
  const ctx=$(id); if(!ctx) return;
  charts[id]=new Chart(ctx,{ type, data, options:Object.assign({responsive:true, maintainAspectRatio:false}, options), plugins:plugins||[] });
}

/* ───────── utils / nav ───────── */
function esc(s){ return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escAttr(s){ return esc(s); }
/* masthead: hiệu ứng máy đánh chữ cho [26] — gõ "__", lướt qua các năm, dừng 3s ở năm hiện tại */
let mastTimer=null;
function renderMasthead(){
  clearTimeout(mastTimer);
  const cur=yy(currentYear);
  const reduce=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduce){ $('brandTitle').innerHTML='THE N<em>['+cur+']</em>stalgia'; return; }
  $('brandTitle').innerHTML='THE N<em>[<span class="yrslot"><span id="yrText"></span><span class="type-caret"></span></span>]</em>stalgia';
  // các "năm" lướt qua: mọi năm có dữ liệu, kết thúc ở năm đang xem
  let labels=(model&&model.yearList&&model.yearList.length>1)?model.yearList.map(yy):[yy(currentYear-1),cur];
  labels=labels.filter(l=>l!==cur); labels.push(cur);
  // dựng khung hình: [text, giữ bao lâu(ms)]
  const fr=[]; const push=(t,d)=>fr.push([t,d]);
  push('',350); push('_',150); push('__',700); push('_',80); push('',260); // gõ __ mở màn rồi xoá
  let prev='';
  for(const lb of labels){
    let c=0; while(c<prev.length&&c<lb.length&&prev[c]===lb[c]) c++;      // prefix chung
    for(let i=prev.length;i>c;i--) push(prev.slice(0,i-1),90);            // backspace
    for(let i=c+1;i<=lb.length;i++) push(lb.slice(0,i),175);              // gõ từng ký tự
    push(lb, lb===cur?3000:700);                                          // năm hiện tại nghỉ 3s
    prev=lb;
  }
  for(let i=prev.length;i>0;i--) push(prev.slice(0,i-1),90);              // xoá hết, lặp lại
  push('',300);
  let idx=0;
  (function step(){
    const el=document.getElementById('yrText'); if(!el) return;           // masthead đã bị vẽ lại -> dừng
    const [t,d]=fr[idx];
    el.textContent=t;
    idx=(idx+1)%fr.length;
    mastTimer=setTimeout(step,d);
  })();
}
function fillYearSelect(){
  const sel=$('yearSelect');
  sel.innerHTML='';
  for(const y of model.yearList){ const o=document.createElement('option'); o.value=y; o.textContent=y; sel.appendChild(o); }
  sel.value=currentYear;
  renderMasthead();
}
function switchView(v){
  document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active', b.dataset.view===v));
  document.querySelectorAll('.view').forEach(s=>s.classList.toggle('active', s.id==='view-'+v));
  if(v==='chart') renderChartView();
  if(v==='analytics') renderAnalytics();
  if(v==='alltime') renderAllTime();
  if(v==='awards') renderAwards();
  if(v==='tracks') renderTrackList();
}
function refreshAll(){
  renderOverview();
  const active=document.querySelector('nav button.active').dataset.view;
  if(active==='chart') renderChartView();
  if(active==='analytics') renderAnalytics();
  if(active==='alltime') renderAllTime();
  if(active==='awards') renderAwards();
  if(active==='tracks') renderTrackList();
}

/* ───────── boot ───────── */
document.getElementById('tabs').addEventListener('click', e=>{ if(e.target.dataset.view) switchView(e.target.dataset.view); });
$('yearSelect').onchange=e=>{ currentYear=+e.target.value; selectedWeek=null; fillYearSelect(); refreshAll(); };
$('wPrev').onclick=()=>{ if(selectedWeek>1){selectedWeek--; renderChartView();} };
$('wNext').onclick=()=>{ if(selectedWeek<maxWeekOf(currentYear)+1){selectedWeek++; renderChartView();} };
$('wSelect').onchange=e=>{ selectedWeek=+e.target.value; renderChartView(); };
$('pngBtn').onclick=exportPNG;
$('trackSearch').oninput=()=>renderTrackList();
$('cmpBtn').onclick=runCompare;
$('atSearch').oninput=()=>renderAllTime();
$('themeBtn').onclick=()=>setTheme(isDark()?'light':'dark');

(async function init(){
  themeLabel();
  try{
    await loadData();
    buildArtCache();
    buildModel();
    fillYearSelect();
    $('loading').style.display='none';
    document.getElementById('view-overview').classList.add('active');
    renderOverview();
  }catch(e){
    const el=$('loading');
    if(el){ el.style.display='block'; el.textContent='Data load error: '+(e.message||e); }
    console.error(e);
  }
})();
