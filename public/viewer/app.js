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
const PALETTE=['#4F46E5','#10B981','#F59E0B','#EF4444','#8B5CF6','#06B6D4','#EC4899','#64748B'];
function TH(){
  const dark=isDark();
  return {
    ink:cssv('--ink')||'#0C1420', red:cssv('--red')||'#1D5BD6',
    mid:cssv('--muted')||'#4E5B6A', faint:cssv('--faint')||'#5A6673',
    onInk:cssv('--paper')||'#F4F8FD',
    grid: dark?'rgba(226,232,240,.10)':'rgba(15,23,42,.07)',
    fill: dark?'rgba(129,140,248,.28)':'rgba(79,70,229,.16)'
  };
}
function applyChartDefaults(){
  if(typeof Chart==='undefined') return;
  const t=TH();
  Chart.defaults.color=t.mid;
  Chart.defaults.borderColor=t.grid;
  Chart.defaults.font.family='"Inter", system-ui, sans-serif';
  Chart.defaults.font.size=11;
  Chart.defaults.elements.bar.borderRadius=6;
  Chart.defaults.elements.line.borderWidth=2;
  Object.assign(Chart.defaults.plugins.tooltip,{
    backgroundColor:t.ink, titleColor:t.onInk, bodyColor:t.onInk,
    cornerRadius:8, displayColors:false, padding:10,
    titleFont:{family:'"Inter", system-ui, sans-serif', size:10},
    bodyFont:{family:'"Inter", system-ui, sans-serif', size:11}
  });
  Object.assign(Chart.defaults.plugins.legend.labels,{
    color:t.ink, boxWidth:10, boxHeight:10,
    font:{family:'"Inter", system-ui, sans-serif', size:10}
  });
  Chart.defaults.scale.ticks.font={family:'"Inter", system-ui, sans-serif', size:10};
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
    tracks.set(t.id, { id:t.id, name:t.name, artist:t.artist, artists:(Array.isArray(t.artists)&&t.artists.length)?t.artists:splitArtists(t.artist), genre:(t.genre||'').trim(), region:t.region||'', artworkUrl:t.artworkUrl||'', baseline:t.baseline||0, years:new Map(), user:false });
  }
  for(const e of DATA.entries){
    const t = tracks.get(e.trackId); if(!t) continue;
    const y = +e.year, w = +e.week;
    if(!t.years.has(y)) t.years.set(y, new Map());
    t.years.get(y).set(w, { rank: e.rank ?? null, stream: e.stream ?? 0 });
  }
  // derive stats per năm — total/woc/peak/best gộp riêng theo năm, nhưng streak #1 tính LIÊN TỤC
  // xuyên năm (không tách "season"): tuần 1/2027 nối ngay sau tuần 52/2026 khi đếm streak.
  const years = new Map();
  for(const t of tracks.values()){
    t._stats = {}; t.allTotal = 0;
    const allWeeks=[];
    for(const [y, wm] of t.years) for(const w of wm.keys()) allWeeks.push([y,w]);
    allWeeks.sort((a,b)=>gwOf(a[0],a[1])-gwOf(b[0],b[1]));
    let cur=0, prevGw=null;
    for(const [y,w] of allWeeks){
      const e=t.years.get(y).get(w);
      if(!t._stats[y]) t._stats[y]={ total:0, woc:0, peak:null, best:0, streak:0 };
      const s=t._stats[y];
      s.total+=e.stream||0; if((e.stream||0)>s.best) s.best=e.stream;
      if(!years.has(y)) years.set(y,{maxWeek:0});
      const gw=gwOf(y,w);
      if(e.rank!=null){
        s.woc++; if(s.peak==null||e.rank<s.peak) s.peak=e.rank;
        if(e.rank===1){ cur=(prevGw===gw-1&&cur>0)?cur+1:1; prevGw=gw; if(cur>s.streak) s.streak=cur; }
        else { cur=0; prevGw=null; }
        if(w>years.get(y).maxWeek) years.get(y).maxWeek=w;
      } else { cur=0; prevGw=null; }
    }
    for(const y of Object.keys(t._stats)) t.allTotal+=t._stats[y].total;
    t.trackedTotal = t.allTotal;
    t.baseline = t.baseline || 0; // baseline lấy từ track trong DB
    t.allTotal += t.baseline;
    t.allPeak = null; t.allWoc = 0;
    for(const y of Object.keys(t._stats)){ const s=t._stats[y]; if(s.peak!=null&&(t.allPeak==null||s.peak<t.allPeak)) t.allPeak=s.peak; t.allWoc+=s.woc; }
  }
  const yearList=[...years.keys()].sort((a,b)=>a-b);
  CHART_SIZE = Math.max(10, ...DATA.entries.map(e=>e.rank||0));
  model = { tracks, years, yearList };
  ARTCHART=null; // model dựng lại -> bỏ cache bảng xếp hạng nghệ sĩ
  // Năm/tuần "mới nhất" luôn lấy từ dữ liệu thực tế (liên tục kể từ 2026, không tách theo "season"/năm) —
  // KHÔNG phụ thuộc Settings.currentYear (dễ bị cũ nếu admin đã nhập dữ liệu năm mới hơn nhưng chưa cập nhật settings).
  currentYear = yearList.length ? yearList[yearList.length-1] : SEED_YEAR;
  fillTrackOptions();
}
function statsFor(t,y){ return (t._stats&&t._stats[y]) || {total:0,woc:0,peak:null,best:0,streak:0}; }
function maxWeekOf(y){ return model.years.has(y)?model.years.get(y).maxWeek:0; }

// Tuần liên tục kể từ Tuần 1/2026 (gw=1) — 52 tuần/năm, không tách theo "season": Tuần 1/2027 nối liền ngay sau Tuần 52/2026.
function gwOf(y,w){ return (y-2026)*52 + w; }
function ywOfGw(gw){ return { y: 2026 + Math.floor((gw-1)/52), w: ((gw-1)%52)+1 }; }

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
// Tra theo tuần liên tục (gw) — cho phép so sánh xuyên năm, vd Tuần 1/2027 so với Tuần 52/2026.
function entryAtGw(t, gw){ const {y,w}=ywOfGw(gw); return entryAt(t,y,w); }
function movement(t, y, w){
  const cur=entryAt(t,y,w); if(!cur||cur.rank==null) return null;
  const prev=entryAtGw(t, gwOf(y,w)-1);
  if(prev && prev.rank!=null){
    const d=prev.rank-cur.rank;
    if(d===0) return {cls:'eq', txt:'='};
    return d>0 ? {cls:'up', txt:'▲'+d} : {cls:'down', txt:'▼'+(-d)};
  }
  // RE-entry: từng lên chart ở bất kỳ tuần liên tục nào trước đó (không tách theo năm)
  const gw=gwOf(y,w);
  for(const [py,pm] of t.years){ for(const [pw,e] of pm){ if(gwOf(py,pw)<gw && e.rank!=null) return {cls:'re', txt:'RE'}; } }
  return {cls:'new', txt:'NEW'};
}
// WOC/peak "tính đến tuần này" — cộng dồn LIÊN TỤC qua các năm (không reset mỗi khi sang năm mới).
function wocUpTo(t,y,w){ const target=gwOf(y,w); let c=0; for(const [py,pm] of t.years) for(const [pw,e] of pm) if(gwOf(py,pw)<=target && e.rank!=null) c++; return c; }
function peakUpTo(t,y,w){ const target=gwOf(y,w); let p=null; for(const [py,pm] of t.years) for(const [pw,e] of pm) if(gwOf(py,pw)<=target && e.rank!=null && (p==null||e.rank<p)) p=e.rank; return p; }
function weekDates(y,w){
  // Tuần liên tục kể từ Tuần 1/2026 (52 tuần/năm, không tách theo năm/season).
  // Neo: Tuần 1/2026 = 29/08/2025 -> Tuần 52/2026 = 21–27/08/2026 -> Tuần 1/2027 = 28/08/2026 (nối liền).
  const start = new Date(Date.UTC(2025,7,29) + (gwOf(y,w)-1)*7*86400000);
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
  let run=0, gww=gwOf(y,w); while(true){ const e=entryAtGw(n1.t,gww); if(e&&e.rank===1){run++;gww--;} else break; }
  const prev=entryAtGw(n1.t, gwOf(y,w)-1);
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
    const p=entryAtGw(r.t, gwOf(y,w)-1);
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
    let run=0; if(idx===0){ let gww=gwOf(y,w); while(true){ const e=entryAtGw(r.t,gww); if(e&&e.rank===1){run++;gww--;} else break; } }
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
const SONG_HINT="+/- = rank change from last week · % = stream change from last week · Peak is highlighted when a song reaches a new peak · WoC = weeks on chart · Share = share of this week's chart streams. Click a song to see its trajectory.";
const ARTIST_HINT="Artists ranked by their on-chart streams that week — a song credits its full stream count to every artist on it, so a collab feeds both. +/- = rank change · % = stream change · WoC = weeks on the artist chart · Share = share of all artist streams that week. Click an artist for their profile.";
// Ô +/- và tông màu hàng (kiểu talkofthecharts): lên = xanh lá, xuống = hồng, NEW = xanh dương, RE = tím
function mvCell(cls, d){
  if(cls==='new') return 'NEW';
  if(cls==='re') return 'RE';
  if(cls==='up') return '+'+d;
  if(cls==='down') return '-'+d;
  return '=';
}
// % stream so với tuần trước -> {txt, cls}; |%|>=10 tô đậm hơn
function pctCell(cur, prev){
  if(!(prev>0)) return { txt:'—', cls:'' };
  const p=Math.round((cur-prev)/prev*100);
  const txt=p>999?'>999%':(p>0?'+':'')+p+'%';
  const cls=p>0?(p>=10?' pos hi':' pos'):(p<0?(p<=-10?' neg hi':' neg'):' zero');
  return { txt, cls };
}
// bậc màu heatmap theo hạng: #1 / 2–5 / 6–10 / 11–20 / 21–50 / 51+
const rankTier = r => r===1?'q1':r<=5?'q2':r<=10?'q3':r<=20?'q4':r<=50?'q5':'q6';
// số lớn trong thẻ: rút gọn (798.6M), giữ số đầy đủ ở tooltip
const bigNum = n => (n||0)>=1e7 ? `<span title="${fmt(n)}">${abbr(n)}</span>` : fmt(n||0);
const shareTxt = (v,total) => total>0 ? (v/total*100).toFixed(1)+'%' : '—';
// peak trước tuần (y,w) — để biết tuần này có lập peak mới không
function peakBefore(t,y,w){ const target=gwOf(y,w); let p=null; for(const [py,pm] of t.years) for(const [pw,e] of pm) if(gwOf(py,pw)<target && e.rank!=null && (p==null||e.rank<p)) p=e.rank; return p; }
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
    const prev=entryAtGw(r.t, gwOf(y,w)-1);
    if(prev&&prev.rank!=null){ const jump=prev.rank-r.rank; if(jump>bestJump){ bestJump=jump; gainerId=r.t.id; } }
  }
  const total=rows.reduce((a,r)=>a+r.stream,0);
  $('chartTable').innerHTML = rows.length ? rows.map(r=>{
    const mv=movement(r.t,y,w)||{cls:'eq'};
    const prev=entryAtGw(r.t, gwOf(y,w)-1);
    const d=(prev&&prev.rank!=null)?Math.abs(prev.rank-r.rank):0;
    const pc=pctCell(r.stream, prev?prev.stream:0);
    const pk=peakUpTo(r.t,y,w);
    const pb=peakBefore(r.t,y,w);
    const newPeak = mv.cls!=='new' && pb!=null && r.rank<pb;
    const woc=wocUpTo(r.t,y,w);
    const callout = r.t.id===hotShotId ? '<span class="callout hotshot">Hot Shot Debut</span>'
                  : (r.t.id===gainerId && bestJump>=3) ? '<span class="callout gainer">Greatest Gainer</span>' : '';
    // nhảy >=10 bậc (hoặc Greatest Gainer) -> tông xanh đậm
    const tone = mv.cls==='up' && (d>=10 || (r.t.id===gainerId && bestJump>=3)) ? 'hot' : mv.cls;
    return `<tr class="clickable row-${tone}" onclick="openTrack('${r.t.id}')">
      <td class="c-rk${r.rank===1?' no1':''}">${r.rank}</td>
      <td class="c-mv mv-${mv.cls}">${mvCell(mv.cls,d)}</td>
      <td class="c-song"><div class="songcell">${thumbHTML(r.t)}<div class="songmeta"><div class="s-name">${esc(r.t.name)}${r.user?'<span class="badge-user">YOUR ENTRY</span>':''}${callout}</div><div class="s-artist">${esc(r.t.artist)}</div></div></div></td>
      <td class="c-st">${fmt(r.stream)}</td>
      <td class="c-pct${pc.cls}">${pc.txt}</td>
      <td class="c-pk${newPeak?' newpk':''}${pk===1?' no1':''}">${pk}</td>
      <td class="c-woc">${woc}</td>
      <td class="c-sh">${shareTxt(r.stream,total)}</td>
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

  const total=rows.reduce((a,r)=>a+r.streams,0);
  $('chartTable').innerHTML = rows.length ? rows.map((r,i)=>{
    const pos=i+1;
    const pr=prev?prev.rankOf.get(r.key):null;
    const prow=prev?prev.byKey.get(r.key):null;
    let cls, d=0;
    if(pr!=null){ d=Math.abs(pr-pos); cls = pr>pos?'up':(pr<pos?'down':'eq'); }
    else cls = ac.firstOf.get(r.key)===y*100+w ? 'new' : 're';
    const pc=pctCell(r.streams, prow?prow.streams:0);
    const run=artistRunUpTo(weeks,r.key,w);
    const pb=w>1?artistRunUpTo(weeks,r.key,w-1).peak:null;
    const newPeak = cls!=='new' && pb!=null && pos<pb;
    const callout = r.key===hotShot ? '<span class="callout hotshot">Hot Shot Debut</span>'
                  : (r.key===gainer && bestJump>=3) ? '<span class="callout gainer">Greatest Gainer</span>' : '';
    const tone = cls==='up' && (d>=10 || (r.key===gainer && bestJump>=3)) ? 'hot' : cls;
    return `<tr class="clickable row-${tone}" onclick="openArtist('${jsStr(r.name)}')">
      <td class="c-rk${pos===1?' no1':''}">${pos}</td>
      <td class="c-mv mv-${cls}">${mvCell(cls,d)}</td>
      <td class="c-song"><div class="songcell"><div class="songmeta"><div class="s-name">${esc(r.name)}${callout}</div><div class="s-artist">${r.songs} song${r.songs>1?'s':''} on chart</div></div></div></td>
      <td class="c-st">${fmt(r.streams)}</td>
      <td class="c-pct${pc.cls}">${pc.txt}</td>
      <td class="c-pk${newPeak?' newpk':''}${run.peak===1?' no1':''}">${run.peak??'—'}</td>
      <td class="c-woc">${run.woc}</td>
      <td class="c-sh">${shareTxt(r.streams,total)}</td>
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
  const ctx=chart.ctx; ctx.save(); ctx.font='700 11px "Inter", system-ui, sans-serif'; ctx.textBaseline='middle';
  chart.data.datasets.forEach((ds,i)=>{
    if(!ds._champ) return;
    const meta=chart.getDatasetMeta(i); let pt=null;
    for(let k=meta.data.length-1;k>=0;k--){ if(ds.data[k]!=null){ pt=meta.data[k]; break; } }
    if(!pt) return;
    ctx.fillStyle=ds.borderColor; ctx.fillText(ds.label.length>16?ds.label.slice(0,15)+'…':ds.label, pt.x+7, pt.y);
  });
  ctx.restore();
} };
/* Kích thước chart đổi theo tuần (Top 20 … Top 100): bài có hạng = đang trong chart, không có hạng = ngoài chart.
   CHART_SIZE = hạng lớn nhất từng có trong dữ liệu — dùng làm đáy trục hạng của các biểu đồ (tính lại ở buildModel). */
let CHART_SIZE=100;
const onChartRank = e => (e && e.rank!=null) ? e.rank : null;
// Làm mờ 1 màu hex (#RRGGBB) cho line nền khi đang focus line khác
const fadeHex = (c,a='33') => /^#[0-9a-f]{6}$/i.test(c) ? c+a : c;
// Hover 1 line -> line đó dày + rõ, các line khác mờ đi (dùng chung cho race / debut / compare)
function focusLineOnHover(ev, els, chart){
  const i = els.length ? els[0].datasetIndex : null;
  if(chart._hl===i) return;
  chart._hl=i;
  chart.data.datasets.forEach((d,k)=>{
    if(d._c==null){ d._c=d.borderColor; d._w=d.borderWidth; }
    const bg = d._bg===true;
    d.borderColor = (i==null || k===i || bg) ? d._c : fadeHex(d._c);
    d.borderWidth = (i!=null && k===i && !bg) ? d._w+1.5 : d._w;
  });
  chart.update('none');
}
let anPane='season';
function setAnPane(p){
  anPane=p;
  document.querySelectorAll('#anTabs button').forEach(b=>b.classList.toggle('on', b.dataset.pane===p));
  document.querySelectorAll('.anpane').forEach(el=>el.classList.toggle('on', el.dataset.pane===p));
  renderAnalytics();
}
function renderAnalytics(){
  const y=currentYear;
  // All-time / Artists(all-time) không phụ thuộc season có dữ liệu hay không
  if(anPane==='alltime'){ renderAllTime(); return; }
  if(anPane==='artists' && artistScope==='all'){ renderArtistBoard(y, null); return; }
  $('recYear').textContent=y;
  const charted=[...model.tracks.values()].filter(t=>statsFor(t,y).woc>0);
  if(!charted.length){
    $('records').innerHTML='<div class="empty">No data yet for this year.</div>';
    ['chartBump','chartMovers','chartShare','chartScatter','chartDebut'].forEach(id=>{ if(charts[id]){charts[id].destroy(); delete charts[id];} });
    ['champStats','champCarousel','debutChips','peakBars','runGrid','artistBoard'].forEach(id=>{ if($(id)) $(id).innerHTML=''; });
    $('predBody').innerHTML='<div class="empty" style="padding:16px 0">No data yet.</div>';
    if(anPane==='season') renderTop100();
    return;
  }
  // chỉ vẽ tab con đang mở — chart trong khung ẩn sẽ có kích thước 0
  if(anPane==='season') renderAnSeason(y, charted);
  else if(anPane==='race') renderRace(y);
  else if(anPane==='songs'){ renderRuns(y, charted); renderDebutRace(); renderScatter(y, charted); renderCompareEmpty(); }
  else if(anPane==='artists') renderArtistBoard(y, charted);
}

/* ── Season: records + movers + peak + top streams + share + forecast ── */
function renderAnSeason(y, charted){
  const S=t=>statsFor(t,y);
  const byStreak=[...charted].sort((a,b)=>S(b).streak-S(a).streak)[0];
  const byBest=[...charted].sort((a,b)=>S(b).best-S(a).best)[0];
  const byWoc=[...charted].sort((a,b)=>S(b).woc-S(a).woc)[0];
  const no1s={}; for(const t of charted) if(S(t).peak===1) for(const a of t.artists) no1s[a]=(no1s[a]||0)+1;
  const topNo1=Object.entries(no1s).sort((a,b)=>b[1]-a[1])[0];
  const debut1=[];
  for(const t of charted){
    const first=[...t.years.get(y).entries()].filter(([,e])=>e.rank!=null).sort((a,b)=>a[0]-b[0])[0];
    if(first&&first[1].rank===1) debut1.push(t);
  }
  const rec=(lbl,val,unit,t,sub,click)=>`<div class="record${click?' clickable':''}"${click?` onclick="${click}"`:''}>
    <div class="rl">${lbl}</div>
    <div class="rbig">${val}<span class="ru">${unit}</span></div>
    <div class="rwho">${t?thumbHTML(t):'<span class="thumb">★</span>'}<div class="rwho-t"><div class="rv">${esc(sub[0])}</div><div class="rsub">${esc(sub[1]||'')}</div></div></div>
  </div>`;
  $('records').innerHTML =
    rec('Longest #1 streak', S(byStreak).streak, 'wks', byStreak, [byStreak.name, byStreak.artist], `openTrack('${byStreak.id}')`)+
    rec('Highest weekly streams', fmt(S(byBest).best), '', byBest, [byBest.name, byBest.artist], `openTrack('${byBest.id}')`)+
    rec('Longest-charting', S(byWoc).woc, 'wks', byWoc, [byWoc.name, byWoc.artist], `openTrack('${byWoc.id}')`)+
    rec('Most No.1 songs', topNo1?topNo1[1]:0, 'songs', null, [topNo1?topNo1[0]:'—', 'reached #1'], topNo1?`openArtist('${jsStr(topNo1[0])}')`:'')+
    rec('Debuted at No.1', debut1.length, debut1.length===1?'song':'songs', debut1[0]||null,
        debut1.length?[debut1[0].name, debut1.length>1?'+ '+(debut1.length-1)+' more':debut1[0].artist]:['None yet',''], debut1[0]?`openTrack('${debut1[0].id}')`:'');

  renderMovers(y);
  renderPeakBars(y, charted);
  renderTop100();
  renderShare(y);
  renderPrediction(y);
  hydrateThumbs();
}

function renderMovers(y){
  const w=maxWeekOf(y);
  $('moversSub').textContent = w ? 'W'+(w-1)+' → W'+w : '';
  const moves=[];
  if(w) for(const r of weekChart(y,w)){
    const p=entryAtGw(r.t, gwOf(y,w)-1);
    const pr=onChartRank(p), cr=onChartRank({rank:r.rank});
    if(pr!=null && cr!=null && pr!==cr) moves.push({ t:r.t, d:pr-cr, from:pr, to:cr });
  }
  const up=moves.filter(m=>m.d>0).sort((a,b)=>b.d-a.d).slice(0,6);
  const down=moves.filter(m=>m.d<0).sort((a,b)=>a.d-b.d).slice(0,6).reverse();
  const list=[...up, ...down];
  const tc=TH(), upC=cssv('--up')||'#15803D', dnC=cssv('--down')||'#BE123C';
  drawChart('chartMovers','bar',{
    labels:list.map(m=>m.t.name.length>26?m.t.name.slice(0,25)+'…':m.t.name),
    datasets:[{ data:list.map(m=>m.d), backgroundColor:list.map(m=>m.d>0?upC:dnC), borderRadius:4, barPercentage:.75 }]
  },{ indexAxis:'y',
     plugins:{ legend:{display:false}, tooltip:{ callbacks:{ title:i=>list[i[0].dataIndex].t.name+' — '+list[i[0].dataIndex].t.artist,
       label:c=>{ const m=list[c.dataIndex]; return '#'+m.from+' → #'+m.to+' ('+(m.d>0?'+':'')+m.d+')'; } } } },
     scales:{ x:{ grid:{color:tc.grid}, ticks:{ precision:0, callback:v=>(v>0?'+':'')+v } }, y:{ grid:{display:false} } },
     onClick:(ev,els)=>{ if(els.length) openTrack(list[els[0].index].t.id); } });
}

function renderPeakBars(y, charted){
  const B=[['#1',p=>p===1],['#2–3',p=>p<=3],['#4–10',p=>p<=10],['#11–20',p=>p<=20],['#21–50',p=>p<=50]];
  if(CHART_SIZE>50) B.push([`#51–${CHART_SIZE}`,()=>true]);
  const cnt=B.map(()=>0);
  for(const t of charted){ const p=statsFor(t,y).peak; const i=B.findIndex(([,f])=>f(p)); cnt[i]++; }
  const max=Math.max(1,...cnt), tot=charted.length;
  $('peakBars').innerHTML=B.map(([lbl],i)=>`<div class="gstat"><span class="gname">${lbl}</span>
    <span class="gbar"><i style="width:${(cnt[i]/max*100).toFixed(1)}%;${i>=4?'background:var(--faint)':''}"></i></span>
    <span class="gval"><b>${cnt[i]}</b> · ${tot?Math.round(cnt[i]/tot*100):0}%</span></div>`).join('');
}

/* ── Share of streams theo region / genre ── */
let shareMode='region';
window.setShareMode=function(m){ shareMode=m; renderShare(currentYear); };
function renderShare(y){
  document.querySelectorAll('#shareMode .pill').forEach(b=>b.classList.toggle('on', b.dataset.mode===shareMode));
  const mw=maxWeekOf(y);
  const groupsOf = shareMode==='region'
    ? t=>[...trackRegions(t)].map(r=>AT_REGION_LABEL[r]||r)
    : t=>[t.genre||'Untagged'];
  const perWeek=[]; const tot=new Map();
  for(let w=1; w<=mw; w++){
    const m=new Map();
    for(const r of weekChart(y,w)){ for(const g of groupsOf(r.t)){ m.set(g,(m.get(g)||0)+r.stream); tot.set(g,(tot.get(g)||0)+r.stream); } }
    perWeek.push(m);
  }
  // giữ 5 nhóm lớn nhất, còn lại gộp "Other"
  let keys=[...tot.entries()].sort((a,b)=>b[1]-a[1]).map(e=>e[0]);
  const top=keys.slice(0,5), rest=new Set(keys.slice(5));
  if(rest.size) top.push('Other');
  const labels=[]; for(let w=1;w<=mw;w++) labels.push('W'+w);
  const ds=top.map((g,i)=>{
    const col = g==='Untagged' ? (cssv('--faint')||'#7A8496') : PALETTE[i%PALETTE.length];
    return { label:g, fill:true, tension:.3, pointRadius:0, borderWidth:1.5, borderColor:col, backgroundColor:fadeHex(col,'B3'),
      data:perWeek.map(m=>{ const s=[...m.values()].reduce((a,b)=>a+b,0); if(!s) return null;
        const v = g==='Other' ? [...m.entries()].filter(([k])=>rest.has(k)).reduce((a,[,v])=>a+v,0) : (m.get(g)||0);
        return +(v/s*100).toFixed(1); }) };
  });
  // chưa gắn tag nào -> 1 khối xám vô nghĩa: ẩn chart, chỉ hiện gợi ý
  const onlyUntagged = top.length<=1 && (top[0]||'Untagged')==='Untagged';
  $('chartShare').parentElement.style.display = onlyUntagged ? 'none' : '';
  if(onlyUntagged){ if(charts.chartShare){ charts.chartShare.destroy(); delete charts.chartShare; } }
  else {
    const tc=TH();
    drawChart('chartShare','line',{ labels, datasets:ds },
      { interaction:{ mode:'index', intersect:false },
        plugins:{ legend:{ position:'bottom' }, tooltip:{ displayColors:true, callbacks:{ label:c=>c.dataset.label+' · '+c.parsed.y+'%' } } },
        scales:{ y:{ stacked:true, min:0, max:100, grid:{color:tc.grid}, ticks:{ callback:v=>v+'%' } },
                 x:{ grid:{display:false}, ticks:{ maxTicksLimit:14 } } } });
  }
  $('shareHint').textContent = onlyUntagged
    ? (shareMode==='region' ? 'No artist has a region yet — tag artists in /admin/artists to see the split.' : 'No song has a genre yet — set genres in /admin to see the split.')
    : 'Top 5 '+(shareMode==='region'?'regions':'genres')+(rest.size?' + Other':'')+'. Shares are normalised so each week sums to 100%.';
}

/* ── Songs: chart run heatmap ── */
let runState={ sort:'woc', more:false };
window.setRunSort=function(v){ runState.sort=v; renderRuns(currentYear); };
window.toggleRunMore=function(){ runState.more=!runState.more; renderRuns(currentYear); };
function renderRuns(y, charted){
  charted = charted || [...model.tracks.values()].filter(t=>statsFor(t,y).woc>0);
  const S=t=>statsFor(t,y), mw=maxWeekOf(y);
  const live=t=>{ let n=0; for(const e of (t.years.get(y)||new Map()).values()) if(onChartRank(e)!=null) n++; return n; };
  const list=charted.map(t=>({ t, woc:live(t), total:S(t).total, peak:S(t).peak })).filter(r=>r.woc>0);
  if(runState.sort==='total') list.sort((a,b)=>b.total-a.total);
  else if(runState.sort==='peak') list.sort((a,b)=>a.peak-b.peak || b.woc-a.woc);
  else list.sort((a,b)=>b.woc-a.woc || a.peak-b.peak);
  const n=runState.more?50:20, rows=list.slice(0,n);
  const q=rankTier;
  const head=`<div class="run-row run-head"><div class="run-name"></div><div class="run-cells">${
    Array.from({length:mw},(_,i)=>`<span>${(i+1)%5===0||i===0?i+1:''}</span>`).join('')}</div><div class="run-stat">WoC</div><div class="run-stat">Peak</div></div>`;
  $('runGrid').style.setProperty('--n', mw);
  $('runGrid').innerHTML = head + rows.map((r,i)=>{
    const wm=r.t.years.get(y)||new Map();
    const cells=Array.from({length:mw},(_,k)=>{ const rk=onChartRank(wm.get(k+1)); return rk==null?'<i></i>':`<i class="${q(rk)}" title="W${k+1} · #${rk}"></i>`; }).join('');
    return `<div class="run-row clickable" onclick="openTrack('${r.t.id}')">
      <div class="run-name"><span class="run-i">${i+1}</span>${thumbHTML(r.t)}<div><div class="t-name">${esc(r.t.name)}</div><div class="t-artist">${esc(r.t.artist)}</div></div></div>
      <div class="run-cells">${cells}</div>
      <div class="run-stat"><b>${r.woc}</b></div><div class="run-stat${r.peak===1?' no1':''}"><b>#${r.peak}</b></div>
    </div>`;
  }).join('');
  const btn=$('runMore');
  btn.style.display = list.length>20 ? '' : 'none';
  btn.textContent = runState.more ? 'Show top 20' : 'Show top 50';
  hydrateThumbs();
}

/* ── Songs: scatter consistency vs explosiveness ── */
// jitter cố định theo id để các chấm cùng số tuần không đè lên nhau
const jitterOf = id => { let h=0; for(const c of String(id)) h=(h*31+c.charCodeAt(0))|0; return ((Math.abs(h)%1000)/1000-.5)*.6; };
function renderScatter(y, charted){
  const S=t=>statsFor(t,y);
  const pts=charted.filter(t=>S(t).woc>=2).map(t=>({ x:S(t).woc+jitterOf(t.id), y:Math.round(S(t).total/S(t).woc), t, woc:S(t).woc, peak:S(t).peak }));
  if(!pts.length){ if(charts.chartScatter){ charts.chartScatter.destroy(); delete charts.chartScatter; } return; }
  const med=a=>{ const s=[...a].sort((p,q)=>p-q); const m=s.length>>1; return s.length%2?s[m]:(s[m-1]+s[m])/2; };
  const mx=med(pts.map(p=>p.woc)), my=med(pts.map(p=>p.y));
  const tc=TH(), red=tc.red, grn='#10B981', gry=cssv('--faint')||'#7A8496';
  const col=p=>p.peak===1?red:(p.peak<=10?grn:gry);
  const labelled=new Set([...pts].sort((a,b)=>b.y-a.y).slice(0,4).concat([...pts].sort((a,b)=>b.woc-a.woc).slice(0,2)));
  const quad={ id:'quad', beforeDatasetsDraw(ch){
    const {ctx, chartArea:a, scales:{x,y:yy}}=ch; const px=x.getPixelForValue(mx), py=yy.getPixelForValue(my);
    ctx.save(); ctx.strokeStyle=tc.grid; ctx.setLineDash([4,4]); ctx.lineWidth=1.2;
    ctx.beginPath(); ctx.moveTo(px,a.top); ctx.lineTo(px,a.bottom); ctx.moveTo(a.left,py); ctx.lineTo(a.right,py); ctx.stroke();
    ctx.setLineDash([]); ctx.fillStyle=tc.faint; ctx.font='600 10px "Inter", system-ui, sans-serif';
    ctx.textAlign='left';  ctx.fillText('FLASH HITS', a.left+6, a.top+12); ctx.fillText('DEEP CUTS', a.left+6, a.bottom-6);
    ctx.textAlign='right'; ctx.fillText('STAPLES', a.right-6, a.top+12); ctx.fillText('SLOW BURNERS', a.right-6, a.bottom-6);
    ctx.restore(); },
    afterDatasetsDraw(ch){
      const {ctx}=ch, meta=ch.getDatasetMeta(0); ctx.save(); ctx.font='600 10.5px "Inter", system-ui, sans-serif'; ctx.fillStyle=tc.ink; ctx.textBaseline='middle';
      pts.forEach((p,i)=>{ if(!labelled.has(p)) return; const el=meta.data[i]; const nm=p.t.name.length>18?p.t.name.slice(0,17)+'…':p.t.name;
        const right=el.x>ch.chartArea.right-110; ctx.textAlign=right?'right':'left'; ctx.fillText(nm, el.x+(right?-8:8), el.y); });
      ctx.restore(); } };
  drawChart('chartScatter','scatter',{
    datasets:[{ data:pts, backgroundColor:pts.map(p=>fadeHex(col(p),'B3')), borderColor:pts.map(col), borderWidth:1, pointRadius:4.5, pointHoverRadius:7 }]
  },{ plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:c=>{const p=c.raw; return [p.t.name+' — '+p.t.artist, p.woc+' wks · '+fmt(p.y)+'/wk · peak #'+p.peak];} } } },
     scales:{ x:{ ticks:{precision:0}, grid:{color:tc.grid}, title:{display:true, text:'Weeks on chart', color:tc.mid} },
              y:{ beginAtZero:true, ticks:{callback:v=>abbr(v)}, grid:{color:tc.grid}, title:{display:true, text:'Avg streams / week', color:tc.mid} } },
     onClick:(ev,els)=>{ if(els.length) openTrack(pts[els[0].index].t.id); } }, [quad]);
}

/* ── Songs: head to head — trạng thái trống gọn + cặp gợi ý ── */
function renderCompareEmpty(){
  const el=$('cmpOut'); if(!el || el.dataset.filled) return;
  const y=currentYear, w=maxWeekOf(y), rows=w?weekChart(y,w):[];
  const pairs=[];
  if(rows[1]) pairs.push([rows[0].t, rows[1].t, '#1 vs #2']);
  if(rows[2]) pairs.push([rows[1].t, rows[2].t, '#2 vs #3']);
  el.innerHTML=`<div class="cmp-empty"><div>Pick two titles to compare peak, weeks on chart, streams and rank trajectory.</div>
    ${pairs.length?`<div class="chip-row" style="justify-content:center">${pairs.map(([a,b,l])=>`<button type="button" class="chip" onclick="comparePair('${a.id}','${b.id}')"><span class="ck">${l}</span><span>${esc(a.name)} vs ${esc(b.name)}</span></button>`).join('')}</div>`:''}</div>`;
}
window.comparePair=function(a,b){
  const A=model.tracks.get(a), B=model.tracks.get(b); if(!A||!B) return;
  $('cmpA').value=A.name+' — '+A.artist; $('cmpB').value=B.name+' — '+B.artist; runCompare();
};

/* ── Artists: bảng xếp hạng nghệ sĩ mùa giải ── */
let artistScope='season';
window.setArtistScope=function(v){ artistScope=v; renderAnalytics(); };
function renderArtistBoard(y, charted){
  const all = artistScope==='all';
  document.querySelectorAll('#artistScope .pill').forEach(b=>b.classList.toggle('on', b.dataset.scope===artistScope));
  $('artistBoardTitle').textContent = all ? 'Top artists all-time' : 'Top artists this season';
  if(all) charted=[...model.tracks.values()].filter(t=>t.allTotal>0);
  // all-time: streams = allTotal (gồm pre-chart), peak/No.1 tính trên mọi season
  const S = all ? (t=>({ total:t.allTotal, peak:t.allPeak??999 })) : (t=>statsFor(t,y));
  const m=new Map();
  for(const t of charted) for(const a of t.artists){
    const k=artistKey(a); let r=m.get(k); if(!r){ r={ name:a, streams:0, songs:0, no1:0, peak:null, top:null }; m.set(k,r); }
    const s=S(t); r.streams+=s.total; r.songs++; if(s.peak===1) r.no1++; if(r.peak==null||s.peak<r.peak) r.peak=s.peak;
    if(!r.top||s.total>S(r.top).total) r.top=t;
  }
  const list=[...m.values()].sort((a,b)=>b.streams-a.streams).slice(0,15);
  const grand=charted.reduce((a,t)=>a+S(t).total,0), max=list[0]?.streams||1;
  $('artistBoard').innerHTML=`<table class="aboard"><thead><tr><th style="width:40px;text-align:center">#</th><th>Artist</th><th class="ab-bar-h">${all?'All-time':'Season'} streams</th>
    <th style="text-align:right">Share</th><th style="text-align:right">Songs</th><th style="text-align:right">No.1s</th><th style="text-align:right">Best peak</th></tr></thead><tbody>${
    list.map((r,i)=>`<tr class="clickable" onclick="openArtist('${jsStr(r.name)}')">
      <td class="rank${i===0?' r1':''}">${i+1}</td>
      <td><div class="champ-song">${thumbHTML(r.top)}<div><div class="t-name">${esc(r.name)}</div><div class="t-artist">Top song: ${esc(r.top.name)}</div></div></div></td>
      <td class="ab-bar"><div class="ab-in"><span class="gbar"><i style="width:${(r.streams/max*100).toFixed(1)}%"></i></span><span class="num">${fmt(r.streams)}</span></div></td>
      <td class="num">${grand?(r.streams/grand*100).toFixed(1):0}%</td>
      <td class="num">${r.songs}</td>
      <td class="num">${r.no1||'—'}</td>
      <td class="num">${r.peak&&r.peak<999?'#'+r.peak:'—'}</td></tr>`).join('')}</tbody></table>`;
  hydrateThumbs();
}

/* Top streams (tab Season) — top 100 bài theo streams của season đang chọn, mặc định thu gọn Top 10.
   Bảng all-time (Pre-chart / từng năm / Total) nằm ở Hall of Fame (tab All-time) — không lặp lại ở đây.
   Cột "#" = hạng theo streams season — gắn với bài, không đổi khi sort theo cột khác.
   Ô search lọc theo tên bài/nghệ sĩ TRÊN top 100 — số hạng vẫn giữ nguyên. */
let top100State={ sortKey:'season', sortDir:'desc', q:'', expanded:false };
const TOP_COLLAPSED=10;
const TOP_COLS=[{key:'name', label:'Song', type:'str'}, {key:'artist', label:'Artist', type:'str'}, {key:'season', label:'Streams', type:'num'}];
window.toggleTop100=function(){ top100State.expanded=!top100State.expanded; renderTop100(); };
// Sparkline hạng theo tuần của 1 bài trong năm y (SVG inline, #1 ở trên, ngoài chart = khoảng trống)
function rankSpark(t, y, W=96, H=24){
  const mw=maxWeekOf(y); if(!mw) return '';
  const wm=t.years.get(y)||new Map();
  const X=w=>mw>1?((w-1)/(mw-1))*W:W/2, Y=r=>2+((r-1)/(CHART_SIZE-1))*(H-4);
  let d='', pen=false, best=null;
  for(let w=1; w<=mw; w++){ const r=onChartRank(wm.get(w)); if(r==null){ pen=false; continue; }
    d+=(pen?'L':'M')+X(w).toFixed(1)+' '+Y(r).toFixed(1); pen=true; if(!best||r<best.r) best={w,r}; }
  return `<svg class="spark" viewBox="-2 0 ${W+4} ${H}" width="${W}" height="${H}" aria-hidden="true"><path d="${d}"/>${best?`<circle cx="${X(best.w)}" cy="${Y(best.r)}" r="2.4"/>`:''}</svg>`;
}
window.setTop100Sort=function(key){
  const st=top100State;
  if(st.sortKey===key) st.sortDir = st.sortDir==='asc' ? 'desc' : 'asc';
  else { st.sortKey=key; st.sortDir = (key==='name'||key==='artist'||key==='rank') ? 'asc' : 'desc'; }
  renderTop100();
};
function renderTop100(){
  const y=currentYear, st=top100State;
  const val=(t,k)=> k==='name'?t.name : k==='artist'?t.artist : statsFor(t,y).total;
  const base=[...model.tracks.values()].filter(t=>statsFor(t,y).total>0);
  if(!base.length){
    $('top100Thead').innerHTML='';
    $('top100Table').innerHTML='<tr><td colspan="6"><div class="empty">No data yet for this year.</div></td></tr>';
    $('top100Hint').textContent=''; $('top100More').innerHTML='';
    return;
  }
  // hạng kiểu thi đấu (1,2,2,4…) theo streams season
  const byS=[...base].sort((a,b)=>val(b,'season')-val(a,'season'));
  const ranks=new Map(); byS.forEach((t,i)=>ranks.set(t.id, i>0 && val(t,'season')===val(byS[i-1],'season') ? ranks.get(byS[i-1].id) : i+1));
  const roster=byS.slice(0,100);
  const q=st.q.trim().toLowerCase();
  const shown = q ? roster.filter(t=>(t.name+' '+t.artist).toLowerCase().includes(q)) : roster;
  const isStr = st.sortKey==='name'||st.sortKey==='artist';
  const vf = st.sortKey==='rank' ? (t=>ranks.get(t.id)) : (t=>val(t,st.sortKey));
  const cmpAsc=(a,b)=> (isStr ? String(vf(a)).localeCompare(String(vf(b))) : vf(a)-vf(b)) || ranks.get(a.id)-ranks.get(b.id);
  const sortedAll=[...shown].sort((a,b)=> st.sortDir==='asc' ? cmpAsc(a,b) : -cmpAsc(a,b));
  // mặc định chỉ hiện Top 10; đang lọc theo tên thì hiện hết kết quả
  const sorted = (st.expanded || q) ? sortedAll : sortedAll.slice(0, TOP_COLLAPSED);
  const barMax = Math.max(1, val(roster[0],'season'));

  const arrow=k=>`<i class="sar">${st.sortKey===k?(st.sortDir==='desc'?'▼':'▲'):''}</i>`;
  $('top100Thead').innerHTML = `<tr>
    <th class="sortable${st.sortKey==='rank'?' on':''}" style="text-align:center;width:52px" onclick="setTop100Sort('rank')">#${arrow('rank')}</th>
    <th style="width:52px"></th>${TOP_COLS.map(c=>
    `<th class="sortable${st.sortKey===c.key?' on':''}"${c.type==='num'?' style="text-align:right"':''} onclick="setTop100Sort('${c.key}')">${esc(c.label)}${arrow(c.key)}</th>`
  ).join('')}<th style="text-align:center">Run</th></tr>`;

  $('top100Table').innerHTML = sorted.length ? sorted.map(t=>{ const r=ranks.get(t.id), v=val(t,'season'); return `<tr class="clickable" onclick="openTrack('${t.id}')">
    <td class="rank r${r<=3?r:''}">${r}</td>
    <td class="thumbcell">${thumbHTML(t)}</td>
    <td><div class="t-name">${esc(t.name)}</div></td>
    <td><div class="t-artist">${esc(t.artist)}</div></td>
    <td class="num barcell" style="--bar:${(v/barMax*100).toFixed(1)}%">${fmt(v)}</td>
    <td class="sparkcell">${rankSpark(t,y)}</td>
  </tr>`; }).join('')
    : `<tr><td colspan="6"><div class="empty">No song or artist matches “${esc(st.q.trim())}”.</div></td></tr>`;
  hydrateThumbs();

  // gọn (Top 10) thì bỏ giới hạn chiều cao khung cuộn để không cắt mất hàng cuối
  $('top100Table').closest('.table-scroll')?.classList.toggle('open', !(st.expanded||q));
  $('top100More').innerHTML = (!q && sortedAll.length>TOP_COLLAPSED)
    ? `<button type="button" class="btn ghost small" onclick="toggleTop100()">${st.expanded?'Show top '+TOP_COLLAPSED:'Show all '+sortedAll.length}</button>` : '';
  const cnt = q ? `${sorted.length} of top ${roster.length}` : `Top ${roster.length}`;
  $('top100Hint').textContent = `${cnt} song${roster.length===1?'':'s'} by streams in ${y}. Run = weekly rank this season. Click a column to sort — click again to flip direction.`;
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
      <thead><tr><th>Song</th><th title="Weeks at #1">#1 wks</th><th title="Peak weekly streams">Peak</th><th title="Week of peak streams">Week</th></tr></thead>
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
  // tuần không có hạng -> null: đường ngắt thay vì cắm xuống đáy
  const series=c=>labels.map((_,ix)=>onChartRank(entryAt(c.t,y,ix+1)));
  const t=TH();
  const ds=[];
  // line nền (không chọn) — mờ, chỉ làm ngữ cảnh
  sorted.filter(c=>!raceState.selected.has(c.id)).forEach(c=>ds.push({
    label:c.t.name, _bg:true, data:series(c), borderColor:t.grid, backgroundColor:'transparent',
    borderWidth:1, pointRadius:0, pointHoverRadius:0, tension:0, spanGaps:false, order:2 }));
  // line champion đang chọn — tô màu, dày, có nhãn
  sorted.filter(c=>raceState.selected.has(c.id)).forEach(c=>ds.push({
    label:c.t.name, _champ:true, data:series(c),
    borderColor:raceState.colorOf[c.id]||t.red, backgroundColor:raceState.colorOf[c.id]||t.red,
    borderWidth:2.5, pointRadius:0, pointHoverRadius:5, tension:0, spanGaps:false, order:1 }));
  const ranks=ds.flatMap(d=>d.data).filter(r=>r!=null);
  const rankMax=Math.min(CHART_SIZE, Math.max(10, ...ranks));
  drawChart('chartBump','line',{ labels, datasets:ds },
    { layout:{ padding:{ right:110 } },
      interaction:{ mode:'nearest', intersect:false },
      onHover:focusLineOnHover,
      plugins:{ legend:{ display:false }, tooltip:{ filter:i=>!i.dataset._bg, callbacks:{ label:c=>c.dataset.label+' · #'+c.parsed.y } } },
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

/* ───────── Ranking Since On-Chart — hạng tính từ tuần ĐẦU TIÊN on-chart của mỗi bài (liên tục xuyên năm) ───────── */
let debutState = { selected:new Set(), initialized:false };
// Chuỗi hạng của 1 bài kể từ tuần đầu tiên on-chart -> tuần cuối cùng on-chart (liên tục theo lịch thật,
// có khoảng trống nếu bài rớt hạng rồi re-entry) — không tách theo năm nhờ gwOf/entryAtGw.
function onChartSeries(t){
  let first=null, last=null;
  for(const [y,wm] of t.years) for(const [w,e] of wm){ if(e.rank!=null){ const gw=gwOf(y,w); if(first==null||gw<first) first=gw; if(last==null||gw>last) last=gw; } }
  if(first==null) return [];
  const arr=[];
  for(let gw=first; gw<=last; gw++) arr.push(onChartRank(entryAtGw(t,gw)));
  return arr;
}
function renderDebutRace(){
  if(!$('chartDebut')) return;
  const charted=[...model.tracks.values()].filter(t=>t.allWoc>0);
  if(!debutState.initialized){
    // mặc định: top bài đang on-chart ở tuần mới nhất đang xem
    const w=maxWeekOf(currentYear);
    const cur=w?weekChart(currentYear,w).slice(0,6).map(r=>r.t):[];
    debutState.selected=new Set(cur.map(t=>t.id));
    debutState.initialized=true;
  }
  renderDebutChips();
  renderDebutChart();
}
function renderDebutChips(){
  const el=$('debutChips'); if(!el) return;
  const list=[...debutState.selected].map(id=>model.tracks.get(id)).filter(Boolean);
  el.innerHTML = list.length ? list.map((t,i)=>`<span class="chip" onclick="debutRemove('${t.id}')" title="Remove"><span class="cs-dot" style="background:${RACE_COLORS[i%RACE_COLORS.length]}"></span>${thumbHTML(t)}<span>${esc(t.name)}</span><span class="ck">✕</span></span>`).join('')
    : '<span class="hint">No songs selected — search above to add one.</span>';
  hydrateThumbs();
}
function renderDebutChart(){
  const list=[...debutState.selected].map(id=>model.tracks.get(id)).filter(Boolean);
  const series=list.map(t=>onChartSeries(t));
  const maxLen=Math.max(0, ...series.map(s=>s.length));
  const labels=[]; for(let i=1;i<=maxLen;i++) labels.push('W'+i);
  const ds=list.map((t,i)=>({
    label:t.name, data:labels.map((_,ix)=>series[i][ix]??null),
    borderColor:RACE_COLORS[i%RACE_COLORS.length], backgroundColor:RACE_COLORS[i%RACE_COLORS.length],
    borderDash:RACE_DASHES[i%RACE_DASHES.length], borderWidth:2.5, tension:0, pointRadius:0, pointHoverRadius:5, spanGaps:false
  }));
  const ranks=series.flat().filter(r=>r!=null);
  const rankMax=Math.min(CHART_SIZE, Math.max(10, ...ranks, 1));
  const t=TH();
  drawChart('chartDebut','line',{ labels, datasets:ds },
    { interaction:{ mode:'nearest', intersect:false }, onHover:focusLineOnHover,
      plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ label:c=>c.dataset.label+' · #'+c.parsed.y } } },
      scales:{ y:{ reverse:true, min:1, max:rankMax, grid:{color:t.grid}, ticks:{ ...(rankMax<=15?{stepSize:1}:{}), callback:v=>'#'+v } },
               x:{ grid:{display:false}, title:{ display:true, text:'Weeks since debut', color:t.mid }, ticks:{ maxTicksLimit:14 } } } });
}
window.debutRemove=function(id){ debutState.selected.delete(id); renderDebutChips(); renderDebutChart(); };
function addDebutSong(){
  const t=findTrackByLabel($('debutAdd').value);
  if(!t){ toast('Could not recognize that song'); return; }
  if(!t.allWoc){ toast('This song has never charted'); return; }
  debutState.selected.add(t.id);
  $('debutAdd').value='';
  renderDebutChips(); renderDebutChart();
}

/* ───────── Dự đoán tuần tới ───────── */
function renderPrediction(y){
  const w=maxWeekOf(y);
  if(!w){ $('predBody').innerHTML='<div class="empty" style="padding:16px 0">No data yet.</div>'; return; }
  const cur=weekChart(y,w);
  const proj=[];
  for(const r of cur){
    const s=[]; const gwCur=gwOf(y,w);
    for(let k=gwCur-2;k<=gwCur;k++){ const e=entryAtGw(r.t,k); if(e&&e.stream>0) s.push(e.stream); }
    let g=0,n=0;
    for(let i=1;i<s.length;i++){ g+=(s[i]-s[i-1])/s[i-1]; n++; }
    g=n?g/n:0; g=Math.max(-0.6,Math.min(0.6,g));
    proj.push({ t:r.t, cur:r.rank, g, p:Math.round(r.stream*(1+g)) });
  }
  proj.sort((a,b)=>b.p-a.p);
  proj.forEach((x,i)=>x.rank=i+1);
  const risks=proj.filter(x=>x.g<=-0.25 && x.cur<=25).slice(0,3);
  const contend=proj[0]&&proj[0].cur!==1?proj[0]:null;
  $('predSub').textContent='Projection for W'+(w+1);
  let html='';
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
  $('cmpOut').dataset.filled='1';
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
  const mk=(t,color)=>({ label:t.name, data:labels.map((_,ix)=>onChartRank(entryAt(t,y,ix+1))),
    borderColor:color, backgroundColor:color, borderWidth:2.5, tension:0, pointRadius:0, pointHoverRadius:5, spanGaps:false });
  const maxR=Math.min(CHART_SIZE, Math.max(20, ...[a,b].flatMap(t=>{const wm=t.years.get(y)||new Map(); return [...wm.values()].map(onChartRank).filter(r=>r!=null);})));
  const tc=TH();
  drawChart('chartCmp','line',{ labels, datasets:[mk(a,tc.red), mk(b,PALETTE[1])] },
    { plugins:{ legend:{position:'bottom', labels:{font:{family:'"Inter", system-ui, sans-serif', size:11}}}, tooltip:{callbacks:{label:c=>c.dataset.label+' · #'+c.parsed.y}} },
      scales:{ y:{ reverse:true, min:1, max:maxR, grid:{color:tc.grid}, ticks:{callback:v=>'#'+v} },
               x:{ grid:{display:false}, ticks:{maxTicksLimit:12} } } });
  hydrateThumbs();
}

/* ───────── render: tracks & artist ───────── */
/* ───────── Songs: danh sách (trái) + chi tiết bài / nghệ sĩ (phải) ─────────
   Link chia sẻ được: #song/<id>, #artist/<tên> — nút Back của trình duyệt quay lại mục trước. */
let sbState={ f:'all', sort:'all', limit:120, sel:null };   // sel = 'song:<id>' | 'artist:<key>'
const SB_PAGE=120;
function sbList(){
  const y=currentYear, w=maxWeekOf(y);
  const q=$('trackSearch').value.trim().toLowerCase();
  let list=[...model.tracks.values()].filter(t=>t.allTotal>0 || t.user);
  if(sbState.f==='now') list=list.filter(t=>onChartRank(entryAt(t,y,w))!=null);
  else if(sbState.f==='no1') list=list.filter(t=>t.allPeak===1);
  if(q) list=list.filter(t=>(t.name+' '+t.artist).toLowerCase().includes(q));
  const S=t=>statsFor(t,y);
  const by={
    all:(a,b)=>b.allTotal-a.allTotal,
    season:(a,b)=>S(b).total-S(a).total || b.allTotal-a.allTotal,
    peak:(a,b)=>(a.allPeak??999)-(b.allPeak??999) || b.allTotal-a.allTotal,
    woc:(a,b)=>b.allWoc-a.allWoc || b.allTotal-a.allTotal,
    name:(a,b)=>a.name.localeCompare(b.name),
  }[sbState.sort];
  return list.sort(by);
}
function renderTrackList(){
  const y=currentYear, w=maxWeekOf(y);
  const list=sbList();
  document.querySelectorAll('#sbFilter button').forEach(b=>b.classList.toggle('on', b.dataset.f===sbState.f));
  $('sbCount').textContent = list.length+' song'+(list.length===1?'':'s');
  const metric=t=>{
    if(sbState.sort==='season') return fmt(statsFor(t,y).total);
    if(sbState.sort==='peak') return t.allPeak?'#'+t.allPeak:'—';
    if(sbState.sort==='woc') return t.allWoc+' wks';
    return abbr(t.allTotal);
  };
  const shown=list.slice(0, sbState.limit);
  $('trackList').innerHTML = shown.map(t=>{
    const r=onChartRank(entryAt(t,y,w));
    const on = sbState.sel==='song:'+t.id;
    return `<div class="sb-item${on?' on':''}" role="option" aria-selected="${on}" data-id="${t.id}" onclick="openTrack('${t.id}')">
      ${thumbHTML(t)}
      <div class="sb-t"><div class="t-name">${esc(t.name)}</div><div class="t-artist">${esc(t.artist)}</div></div>
      <div class="sb-m">${r!=null?`<span class="sb-now${r===1?' no1':''}">#${r}</span>`:''}<span class="sb-v">${metric(t)}</span></div>
    </div>`;
  }).join('') + (list.length>shown.length ? `<button type="button" class="btn ghost small sb-more" onclick="sbMore()">Show ${Math.min(SB_PAGE, list.length-shown.length)} more</button>` : '')
    || '<div class="empty">No songs found.</div>';
  hydrateThumbs();
  // vào tab lần đầu chưa chọn gì -> mở bài đang #1 (hoặc bài đầu danh sách)
  if(!sbState.sel){ const top=w?weekChart(y,w)[0]:null; const t=top?top.t:list[0]; if(t) openTrack(t.id, null, true); }
}
window.sbMore=function(){ sbState.limit+=SB_PAGE; renderTrackList(); };
function markSelected(){
  document.querySelectorAll('#trackList .sb-item').forEach(el=>{
    const on = sbState.sel==='song:'+el.dataset.id;
    el.classList.toggle('on', on); el.setAttribute('aria-selected', on);
    if(on) el.scrollIntoView({block:'nearest'});
  });
}
// Đổi hash mà không mở lại view; replace=true khi tự chọn mặc định (không tạo mục history)
function setRoute(h, replace){
  if(location.hash===h) return;
  try{ history[replace?'replaceState':'pushState'](null,'',h); }catch(e){ location.hash=h; }
}
function routeFromHash(){
  const h=decodeURIComponent(location.hash.slice(1));
  if(h.startsWith('song/')){ const id=h.slice(5); if(model.tracks.has(id)){ openTrack(id, null, true, true); return true; } }
  if(h.startsWith('artist/')){ openArtist(h.slice(7), true); return true; }
  return false;
}
// mở trang trong view Songs mà không vẽ lại danh sách nếu đang ở đó
function ensureSongsView(){
  const active=document.querySelector('nav button.active')?.dataset.view;
  if(active!=='tracks'){
    document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active', b.dataset.view==='tracks'));
    document.querySelectorAll('.view').forEach(s=>s.classList.toggle('active', s.id==='view-tracks'));
    renderTrackList();
  }
}

// Các mốc đáng nhớ của 1 bài, tính liên tục qua mọi season
function songMilestones(t){
  const weeks=[];
  for(const [y,wm] of t.years) for(const [w,e] of wm) weeks.push({ y, w, gw:gwOf(y,w), rank:onChartRank(e), stream:e.stream||0 });
  weeks.sort((a,b)=>a.gw-b.gw);
  const on=weeks.filter(x=>x.rank!=null);
  if(!on.length) return [];
  const L=[], lbl=x=>`W${x.w}/${yy(x.y)}`;
  const debut=on[0];
  L.push({ ic:'✨', t:`Debuted at <b>#${debut.rank}</b>`, d:lbl(debut) });
  // mốc top 10 / top 5 / No.1 — cùng 1 tuần thì chỉ giữ mốc cao nhất
  const tiers=[[10,'top 10'],[5,'top 5'],[1,'No.1']].map(([cut,txt])=>({ cut, txt, f:on.find(x=>x.rank<=cut) }));
  tiers.forEach((tr,i)=>{
    const {cut,txt,f}=tr; if(!f) return;
    if(tiers.slice(i+1).some(o=>o.f===f)) return;
    if(f===debut){ if(cut===1) L.push({ ic:'🏆', t:'Debuted straight at <b>No.1</b>', d:lbl(f) }); return; }
    L.push({ ic:cut===1?'🏆':'📈', t:cut===1?'First week at <b>No.1</b>':`First week in the <b>${txt}</b> (#${f.rank})`, d:lbl(f) });
  });
  let jump=null;
  for(let i=1;i<weeks.length;i++){ const a=weeks[i-1], b=weeks[i]; if(b.gw===a.gw+1 && a.rank!=null && b.rank!=null && a.rank-b.rank>(jump?.d||0)) jump={ d:a.rank-b.rank, x:b, from:a.rank }; }
  if(jump && jump.d>=3) L.push({ ic:'🚀', t:`Biggest climb: <b>+${jump.d}</b> (#${jump.from} → #${jump.x.rank})`, d:lbl(jump.x) });
  const best=[...weeks].sort((a,b)=>b.stream-a.stream)[0];
  if(best && best.stream) L.push({ ic:'🔥', t:`Best week: <b>${fmt(best.stream)}</b> streams`, d:lbl(best) });
  let re=0; for(let i=1;i<on.length;i++) if(on[i].gw>on[i-1].gw+1) re++;
  if(re) L.push({ ic:'🔁', t:`Re-entered the chart <b>${re}</b> time${re>1?'s':''}`, d:'' });
  for(const m of [10,20,30,40,50]) if(on.length>=m){ const x=on[m-1]; if(m===Math.floor(on.length/10)*10) L.push({ ic:'🎖️', t:`Reached <b>${m} weeks</b> on chart`, d:lbl(x) }); }
  return L;
}

window.openTrack = function(id, yPick, quiet, fromHash){
  const t=model.tracks.get(id); if(!t) return;
  sbState.sel='song:'+id;   // đặt trước để danh sách không tự mở bài mặc định
  ensureSongsView();
  if(!fromHash) setRoute('#song/'+encodeURIComponent(id), quiet);
  markSelected();
  const yearsOf=[...t.years.keys()].sort((a,b)=>a-b);
  const y = yPick!=null ? yPick : (t.years.has(currentYear)?currentYear:(yearsOf[yearsOf.length-1]||currentYear));
  const s=statsFor(t,y), mw=maxWeekOf(y), lw=maxWeekOf(currentYear);
  // trạng thái tuần mới nhất
  const nowR=onChartRank(entryAt(t,currentYear,lw));
  const mv=nowR!=null?movement(t,currentYear,lw):null;
  const status = nowR!=null
    ? `<span class="st-pill on">#${nowR} this week${mv&&mv.cls==='up'?` · ▲${mv.txt.slice(1)}`:mv&&mv.cls==='down'?` · ▼${mv.txt.slice(1)}`:mv&&(mv.cls==='new'||mv.cls==='re')?' · '+mv.txt:''}</span>`
    : '<span class="st-pill">Off the chart this week</span>';
  const tags=[t.genre, ...[...trackRegions(t)].filter(r=>r!=='none').map(r=>AT_REGION_LABEL[r]||r)].filter(Boolean);
  // tuần ở peak + tuần đầu
  const wm=t.years.get(y)||new Map();
  let atPeak=0, peakW=null; for(const [w,e] of wm) if(s.peak!=null && e.rank===s.peak){ atPeak++; if(peakW==null||w<peakW) peakW=w; }
  const no1w=[...wm.values()].filter(e=>e.rank===1).length;
  const awards=(DATA.awards||[]).filter(a=>a.type==='track' && a.subject===t.id).sort((a,b)=>b.year-a.year || b.won-a.won);
  const more=[...model.tracks.values()].filter(o=>o.id!==t.id && o.artists.some(a=>t.artists.includes(a)) && o.allTotal>0).sort((a,b)=>b.allTotal-a.allTotal).slice(0,6);
  const ms=songMilestones(t);
  const tile=(lbl,val,sub,cls='')=>`<div class="tile ${cls}"><div class="tl">${lbl}</div><div class="tv">${val}</div><div class="ts">${sub||'&nbsp;'}</div></div>`;

  // bảng từng tuần
  const rows=[];
  for(let w=1; w<=mw; w++){
    const e=wm.get(w); if(!e) continue;
    const prev=entryAtGw(t, gwOf(y,w)-1);
    const r=onChartRank(e), pr=onChartRank(prev);
    const d = r!=null && pr!=null ? pr-r : null;
    const pc=pctCell(e.stream||0, prev?prev.stream:0);
    rows.push(`<tr><td>W${w}</td><td class="wk-rk${r===1?' no1':''}">${r!=null?'#'+r:'<span class="faint">—</span>'}</td>
      <td class="wk-mv ${d>0?'up':d<0?'down':''}">${d==null?(r!=null&&pr==null?'<span class="mv new">IN</span>':''):d===0?'=':(d>0?'+':'')+d}</td>
      <td class="num">${fmt(e.stream||0)}</td><td class="num wk-pct${pc.cls}">${pc.txt}</td></tr>`);
  }

  $('trackDetail').innerHTML = `
    <div class="sd-hero">
      ${thumbHTML(t,'hero')}
      <div class="sd-head">
        <div class="sd-kicker">Song${tags.length?' · '+tags.map(esc).join(' · '):''}</div>
        <h2 class="sd-title">${esc(t.name)}${t.user?'<span class="badge-user">ADDED BY YOU</span>':''}</h2>
        <div class="sd-artists">${t.artists.map(a=>`<a class="alink" onclick="openArtist('${jsStr(a)}')">${esc(a)}</a>`).join('<span class="sep">,</span> ')}</div>
        <div class="sd-actions">${status}
          <button type="button" class="btn ghost small" onclick="compareFrom('${t.id}')">Compare</button>
          <button type="button" class="btn ghost small" onclick="copyLink()">Copy link</button>
        </div>
      </div>
    </div>
    ${yearsOf.length>1?`<div class="pill-row sd-years">${yearsOf.map(yr=>`<button type="button" class="pill ${yr===y?'on':''}" onclick="openTrack('${t.id}',${yr})">Season ${yr}</button>`).join('')}</div>`:''}
    <div class="tiles">
      ${tile('Peak', s.peak?'#'+s.peak:'—', s.peak?`${atPeak} wk${atPeak===1?'':'s'} at peak · W${peakW}`:'', s.peak===1?'gold':'')}
      ${tile('Weeks on chart', s.woc, `${t.allWoc} across all seasons`)}
      ${tile('Weeks at No.1', no1w||'—', s.streak>1?`longest run ${s.streak} wks`:'')}
      ${tile(`Streams ${y}`, bigNum(s.total), s.woc?`${abbr(Math.round(s.total/s.woc))} / chart week`:'')}
      ${tile('All-time streams', bigNum(t.allTotal), t.baseline?`${abbr(t.baseline)} pre-chart`:'')}
    </div>
    <div class="panel">
      <div class="race-head" style="margin-bottom:8px"><h2 style="margin:0">Chart run · ${y}</h2>
        <div class="legend-inline"><span><i class="li-line"></i>Rank</span><span><i class="li-bar"></i>Streams</span></div></div>
      <div class="chartbox"><canvas id="chartTraj"></canvas></div>
      <div class="sd-strip" style="--n:${mw}">${Array.from({length:mw},(_,k)=>{ const r=onChartRank(wm.get(k+1)); const q=r==null?'':rankTier(r); return `<i class="${q}" title="W${k+1}${r?' · #'+r:' · off chart'}"></i>`; }).join('')}</div>
    </div>
    <div class="grid2 sd-grid">
      <div class="panel">
        <h2>Week by week</h2>
        <div class="table-scroll wk-table"><table><thead><tr><th>Week</th><th>Rank</th><th>+/-</th><th style="text-align:right">Streams</th><th style="text-align:right">%</th></tr></thead>
          <tbody>${rows.reverse().join('')||'<tr><td colspan="5"><div class="empty">No weeks this season.</div></td></tr>'}</tbody></table></div>
      </div>
      <div>
        <div class="panel">
          <h2>Milestones</h2>
          ${ms.length?`<ul class="ms">${ms.map(m=>`<li><span class="ms-ic">${m.ic}</span><span class="ms-t">${m.t}</span><span class="ms-d">${m.d}</span></li>`).join('')}</ul>`:'<div class="empty" style="padding:12px 0">Not charted yet.</div>'}
        </div>
        ${awards.length?`<div class="panel"><h2>Awards</h2><ul class="ms">${awards.map(a=>`<li><span class="ms-ic">${a.won?'🏆':'·'}</span><span class="ms-t">${a.won?'<b>Won</b>':'Nominated'} — ${esc(a.category)}</span><span class="ms-d">${a.year}</span></li>`).join('')}</ul></div>`:''}
        ${more.length?`<div class="panel"><h2>More by ${esc(t.artists[0])}${t.artists.length>1?' & co.':''}</h2>
          <div class="mini-list">${more.map(o=>`<div class="mini clickable" onclick="openTrack('${o.id}')">${thumbHTML(o)}<div><div class="t-name">${esc(o.name)}</div><div class="t-artist">${o.allPeak?'Peak #'+o.allPeak+' · ':''}${abbr(o.allTotal)} streams</div></div></div>`).join('')}</div></div>`:''}
      </div>
    </div>`;

  // combo: cột streams (trục phải, nhạt) + line hạng (trục trái, đảo ngược)
  const tt=TH();
  const labels=[], rk=[], st=[];
  for(let w=1; w<=mw; w++){ const e=wm.get(w); labels.push('W'+w); rk.push(onChartRank(e)); st.push(e?e.stream||0:null); }
  drawChart('chartTraj','bar',{ labels, datasets:[
    { type:'line', label:'Rank', data:rk, yAxisID:'y', borderColor:tt.red, backgroundColor:tt.red, borderWidth:2.5, tension:0, spanGaps:false,
      pointRadius:rk.map(r=>r===1?4:0), pointHoverRadius:5, order:1 },
    { type:'bar', label:'Streams', data:st, yAxisID:'y2', backgroundColor:fadeHex(cssv('--faint')||'#7A8496','40'), borderRadius:3, barPercentage:.9, categoryPercentage:1, order:2 }
  ]},{ interaction:{ mode:'index', intersect:false },
     plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:c=>c.dataset.label==='Rank'?(c.parsed.y!=null?'Rank #'+c.parsed.y:'Off chart'):fmt(c.parsed.y)+' streams' } } },
     scales:{ y:{ reverse:true, min:1, max:CHART_SIZE, grid:{color:tt.grid}, ticks:{ callback:v=>'#'+v, stepSize:10 }, afterBuildTicks:a=>{ const st=CHART_SIZE>50?20:10; a.ticks=[1,...Array.from({length:Math.floor(CHART_SIZE/st)},(_,i)=>(i+1)*st)].map(v=>({value:v})); } },
              y2:{ position:'right', beginAtZero:true, grid:{display:false}, ticks:{ callback:v=>abbr(v) } },
              x:{ grid:{display:false}, ticks:{ maxTicksLimit:14 } } } });
  hydrateThumbs();
  scrollDetailIntoView();
};
function scrollDetailIntoView(){
  // màn hẹp: danh sách nằm trên -> cuộn xuống phần chi tiết; màn rộng: lên đầu khung chi tiết
  const el=$('trackDetail'); if(!el) return;
  const top=el.getBoundingClientRect().top+window.scrollY-80;
  if(window.innerWidth<=900 || window.scrollY>top) window.scrollTo({ top, behavior:'smooth' });
}
window.compareFrom=function(id){
  const t=model.tracks.get(id); if(!t) return;
  switchView('analytics'); setAnPane('songs');
  $('cmpA').value=t.name+' — '+t.artist; $('cmpB').value=''; $('cmpB').focus();
  $('cmpB').scrollIntoView({ behavior:'smooth', block:'center' });
};
window.copyLink=function(){
  const url=location.href;
  (navigator.clipboard?navigator.clipboard.writeText(url):Promise.reject()).then(()=>toast('Link copied'), ()=>toast(url));
};

window.openArtist = function(name, fromHash){
  const y=currentYear;
  const key=artistKey(name);
  const list=[...model.tracks.values()].filter(t=>t.artists.some(a=>artistKey(a)===key) && (t.allTotal>0||t.user));
  if(!list.length){ toast('No data yet for this artist'); return; }
  sbState.sel='artist:'+key;
  ensureSongsView(); markSelected();
  if(!fromHash) setRoute('#artist/'+encodeURIComponent(name));
  name = list[0].artists.find(a=>artistKey(a)===key) || name;
  list.sort((a,b)=>statsFor(b,y).total-statsFor(a,y).total || b.allTotal-a.allTotal);
  const yTotal=list.reduce((s,t)=>s+statsFor(t,y).total,0);
  const allTotal=list.reduce((s,t)=>s+t.allTotal,0);
  const no1s=list.filter(t=>t.allPeak===1).length;
  const bestPeak=Math.min(...list.map(t=>t.allPeak||999));
  const meta=ARTMETA.get(key)||{};
  const tags=[meta.gender&&({male:'Male',female:'Female',group:'Group'}[meta.gender]||meta.gender), meta.region&&(AT_REGION_LABEL[meta.region]||meta.region), ...(meta.genres||[])].filter(Boolean);
  const lw=maxWeekOf(y);
  const nowOn=list.filter(t=>onChartRank(entryAt(t,y,lw))!=null).length;
  const top6=list.filter(t=>statsFor(t,y).woc>0).slice(0,6);
  const tile=(lbl,val,sub,cls='')=>`<div class="tile ${cls}"><div class="tl">${lbl}</div><div class="tv">${val}</div><div class="ts">${sub||'&nbsp;'}</div></div>`;
  $('trackDetail').innerHTML = `
    <div class="sd-hero">
      ${thumbHTML(list[0],'hero round')}
      <div class="sd-head">
        <div class="sd-kicker">Artist${tags.length?' · '+tags.map(esc).join(' · '):''}</div>
        <h2 class="sd-title">${esc(name)}</h2>
        <div class="sd-artists">${list.length} song${list.length>1?'s':''} with streams</div>
        <div class="sd-actions"><span class="st-pill${nowOn?' on':''}">${nowOn?nowOn+' song'+(nowOn>1?'s':'')+' on chart this week':'Nothing on the chart this week'}</span>
          <button type="button" class="btn ghost small" onclick="copyLink()">Copy link</button></div>
      </div>
    </div>
    <div class="tiles">
      ${tile('Best peak', bestPeak<999?'#'+bestPeak:'—', '', bestPeak===1?'gold':'')}
      ${tile('No.1 songs', no1s||'—', 'all seasons')}
      ${tile('Songs charted', list.filter(t=>t.allWoc>0).length, `of ${list.length} with streams`)}
      ${tile(`Streams ${y}`, bigNum(yTotal), '')}
      ${tile('All-time streams', bigNum(allTotal), 'collabs count in full')}
    </div>
    ${top6.length?`<div class="panel"><h2>Chart runs · ${y}</h2><div class="chartbox tall"><canvas id="chartArtistTraj"></canvas></div>
      <div class="chip-row">${top6.map((t,i)=>`<span class="chip" onclick="openTrack('${t.id}')"><span class="cs-dot" style="background:${RACE_COLORS[i%RACE_COLORS.length]}"></span>${esc(t.name)}</span>`).join('')}</div></div>`:''}
    <div class="panel"><h2>Songs</h2>
      <table><thead><tr><th></th><th>Song</th><th style="text-align:center">Run ${y}</th><th style="text-align:right">Peak</th><th style="text-align:right">WoC</th><th style="text-align:right">Streams ${y}</th><th style="text-align:right">All-time</th></tr></thead><tbody>
        ${list.map(t=>{const s=statsFor(t,y);return `<tr class="clickable" onclick="openTrack('${t.id}')">
          <td class="thumbcell">${thumbHTML(t)}</td>
          <td><div class="t-name">${esc(t.name)}</div><div class="t-artist">${esc(t.artist)}</div></td>
          <td class="sparkcell">${s.woc?rankSpark(t,y):''}</td>
          <td class="num${t.allPeak===1?' no1c':''}">${t.allPeak?'#'+t.allPeak:'—'}</td>
          <td class="num">${t.allWoc}</td>
          <td class="num">${fmt(s.total)}</td>
          <td class="num">${fmt(t.allTotal)}</td>
        </tr>`;}).join('')}
      </tbody></table></div>`;
  if(top6.length){
    const mw=maxWeekOf(y);
    const labels=[]; for(let w=1;w<=mw;w++) labels.push('W'+w);
    drawChart('chartArtistTraj','line',{
      labels,
      datasets: top6.map((t,i)=>({ label:t.name,
        data: labels.map((_,ix)=>onChartRank(entryAt(t,y,ix+1))),
        borderColor:RACE_COLORS[i%RACE_COLORS.length], backgroundColor:RACE_COLORS[i%RACE_COLORS.length], borderWidth:2.5, tension:0, pointRadius:0, pointHoverRadius:5, spanGaps:false }))
    },{ interaction:{ mode:'nearest', intersect:false }, onHover:focusLineOnHover,
       plugins:{ legend:{display:false}, tooltip:{callbacks:{label:c=>c.dataset.label+' · #'+c.parsed.y}} },
       scales:{ y:{ reverse:true, min:1, max:CHART_SIZE, grid:{color:TH().grid}, ticks:{callback:v=>'#'+v} },
                x:{ grid:{display:false}, ticks:{maxTicksLimit:14} } } });
  }
  hydrateThumbs();
  scrollDetailIntoView();
};

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
// cột season 'y2026'… (chỉ hiện khi có >1 season) — sort được như 3 cột gốc
const atKeyOf = k => AT_SORT_KEY[k] || (/^y\d{4}$/.test(k) ? (t=>statsFor(t,+k.slice(1)).total) : null);
window.setAtSort=function(k){
  if(!atKeyOf(k)) return;
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
  list.sort((a,b)=>b.allTotal-a.allTotal); // thứ tự gốc — quyết định số hạng "#" cố định, không đổi khi sort/lọc/phân trang
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
  // Top 100 luôn lấy theo ĐÚNG cột đang sort (không cố định theo all-time) — sort "On-chart" phải lấy
  // đúng top 100 bài có on-chart stream cao nhất, không phải 100 bài all-time cao nhất rồi sắp lại.
  const yearCols = model.yearList.length>1 ? model.yearList.map(yr=>'y'+yr) : [];
  if(!atKeyOf(atSort) || (atSort[0]==='y' && !yearCols.includes(atSort))) atSort='all';
  const key=atKeyOf(atSort), sgn=atSortDir==='asc'?-1:1;
  const roster=[...pool].sort((a,b)=>key(b)-key(a) || b.allTotal-a.allTotal).slice(0, AT_SIZE);
  const sorted=[...roster].sort((a,b)=> sgn*(key(b)-key(a)) || b.allTotal-a.allTotal);
  const rankOf=rankMap(sorted, key);
  const th=(k,label)=>`<th class="sortable${atSort===k?' on':''}" style="text-align:right" onclick="setAtSort('${k}')">${label}<i class="sar">${atSort===k?(atSortDir==='desc'?'▼':'▲'):''}</i></th>`;
  $('atThead').innerHTML=`<tr><th style="text-align:center">#</th><th style="text-align:center">+/-</th><th></th><th>Song</th>
    ${th('pre','Pre-chart')}${yearCols.map(k=>th(k,k.slice(1))).join('')}${th('on','On-chart')}${th('all','All-time')}<th style="text-align:right">Peak</th></tr>`;

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
    return `<tr class="clickable" onclick="openTrack('${t.id}')">
      <td class="rank r${pos&&pos<=3?pos:''}" style="text-align:center">${pos ?? '<span style="font-size:15px;color:var(--faint)">—</span>'}</td>
      <td style="text-align:center">${mv}</td>
      <td class="thumbcell">${thumbHTML(t)}</td>
      <td><div class="t-name">${esc(t.name)}${t.user?'<span class="badge-user">ADDED BY YOU</span>':''}</div><div class="t-artist">${esc(t.artist)}${t.genre?`<span class="gtag">${esc(t.genre)}</span>`:''}${t.region?' · '+esc(t.region):''}</div></td>
      <td class="num">${t.baseline?fmt(t.baseline):'—'}</td>
      ${yearCols.map(k=>{ const v=atKeyOf(k)(t); return `<td class="num">${v?fmt(v):'—'}</td>`; }).join('')}
      <td class="num">${fmt(t.trackedTotal)}</td>
      <td class="num" style="color:var(--gold);font-weight:700">${fmt(t.allTotal)}</td>
      <td class="num">${t.allPeak?'#'+t.allPeak:'—'}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="${9+yearCols.length}"><div class="empty">${atRegion?'No songs tagged with region '+esc(AT_REGION_LABEL[atRegion]||atRegion)+'.':'No songs found.'}</div></td></tr>`;
  const pg=$('atPager');
  if(pg){
    const scope = atRegion ? ` · ${AT_REGION_LABEL[atRegion]} only (${pool.length} song${pool.length===1?'':'s'} with data)` : '';
    pg.innerHTML = q ? `<span>${shown.length} of ${roster.length} songs match${scope}</span>`
                     : scope ? `<span>Top ${roster.length}${scope}</span>` : '';
  }

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
                   title:{display:true, text:'SONGS', color:td.mid, font:{family:'"Inter", system-ui, sans-serif', size:9}} },
               x:{ grid:{display:false}, ticks:{ autoSkip:true, maxTicksLimit:16, maxRotation:0 },
                   title:{display:true, text:`STREAMS — BIN ${abbr(AT_DIST_BIN)}`, color:td.mid, font:{family:'"Inter", system-ui, sans-serif', size:9}} } },
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
  // rời Songs -> bỏ #song/… khỏi URL để reload không nhảy về bài cũ
  if(v!=='tracks' && /^#(song|artist)\//.test(location.hash)){ try{ history.replaceState(null,'',location.pathname+location.search); }catch(e){} }
  document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active', b.dataset.view===v));
  document.querySelectorAll('.view').forEach(s=>s.classList.toggle('active', s.id==='view-'+v));
  if(v==='chart') renderChartView();
  if(v==='analytics') renderAnalytics();
  if(v==='awards') renderAwards();
  if(v==='tracks') renderTrackList();
}
function refreshAll(){
  renderOverview();
  const active=document.querySelector('nav button.active').dataset.view;
  if(active==='chart') renderChartView();
  if(active==='analytics') renderAnalytics();
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
$('trackSearch').oninput=()=>{ sbState.limit=SB_PAGE; renderTrackList(); };
$('sbFilter').addEventListener('click', e=>{ const b=e.target.closest('button[data-f]'); if(b){ sbState.f=b.dataset.f; sbState.limit=SB_PAGE; renderTrackList(); } });
$('sbSort').onchange=e=>{ sbState.sort=e.target.value; sbState.limit=SB_PAGE; renderTrackList(); };
// phím tắt: "/" để tìm bài; ↑/↓ trong danh sách để chuyển bài
document.addEventListener('keydown', e=>{
  const inField=/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName);
  if(e.key==='/' && !inField){ e.preventDefault(); switchView('tracks'); $('trackSearch').focus(); return; }
  if((e.key==='ArrowDown'||e.key==='ArrowUp') && document.querySelector('#view-tracks.active') && (!inField || document.activeElement.id==='trackSearch')){
    const items=[...document.querySelectorAll('#trackList .sb-item')]; if(!items.length) return;
    e.preventDefault();
    let i=items.findIndex(el=>el.classList.contains('on'));
    i = i<0 ? 0 : Math.max(0, Math.min(items.length-1, i+(e.key==='ArrowDown'?1:-1)));
    openTrack(items[i].dataset.id);
  }
});
window.addEventListener('popstate', ()=>{ if(model && !routeFromHash()) switchView('overview'); });
$('top100Search').oninput=e=>{ top100State.q=e.target.value; renderTop100(); };
$('cmpBtn').onclick=runCompare;
$('anTabs').addEventListener('click', e=>{ const b=e.target.closest('button[data-pane]'); if(b) setAnPane(b.dataset.pane); });
$('debutAddBtn').onclick=addDebutSong;
$('debutAdd').addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); addDebutSong(); } });
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
    routeFromHash(); // mở thẳng #song/… hoặc #artist/… nếu có
  }catch(e){
    const el=$('loading');
    if(el){ el.style.display='block'; el.textContent='Data load error: '+(e.message||e); }
    console.error(e);
  }
})();
