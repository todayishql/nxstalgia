/* ───────── state ───────── */
// Dữ liệu lấy từ backend MongoDB qua /api/bootstrap (không còn SEED/localStorage)
let DATA = { settings:{}, tracks:[], entries:[] };
let SEED_YEAR = 2026;
let model = null;
let charts = {};
let currentYear = SEED_YEAR;
let selectedWeek = null;

const $ = id => document.getElementById(id);
const fmt = n => (n==null ? '—' : n.toLocaleString('en-US'));

function toast(msg){ const t=$('toast'); t.textContent=msg; t.style.display='block'; clearTimeout(t._h); t._h=setTimeout(()=>t.style.display='none', 3200); }

/* ───────── data (backend API) ───────── */
async function loadData(){
  const res = await fetch('/api/bootstrap');
  if(!res.ok) throw new Error('Failed to load data (/api/bootstrap): HTTP '+res.status);
  DATA = await res.json();
  DATA.settings = DATA.settings || {};
  DATA.tracks = DATA.tracks || [];
  DATA.entries = DATA.entries || [];
  SEED_YEAR = DATA.settings.currentYear || DATA.entries[0]?.year || 2026;
  currentYear = SEED_YEAR;
}

/* ───────── model ───────── */
function buildModel(){
  const tracks = new Map();
  for(const t of DATA.tracks){
    tracks.set(t.id, { id:t.id, name:t.name, artist:t.artist, artworkUrl:t.artworkUrl||'', baseline:t.baseline||0, years:new Map(), user:false });
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
  // Neo: Tuần 46/2026 bắt đầu 10/07/2026; các năm chart dài 52 tuần
  const start = new Date(Date.UTC(2026,6,10) + ((w-46) + (y-2026)*52)*7*86400000);
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
  $('beatBody').innerHTML = beat
    ? `<div class="bt">${esc(beat.title)}</div>`+beat.lines.map(l=>`<p>${esc(l)}</p>`).join('')
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
  const artists=new Set(charted.map(t=>t.artist));
  const no1=rows[0];
  $('kpis').innerHTML = `
    <div class="kpi"><div class="lbl">Current week</div><div class="val">${w?('W'+w):'—'}</div><div class="note">${rows.length} songs on chart</div></div>
    <div class="kpi"><div class="lbl">No.1 this week</div><div class="val" style="font-size:17px;font-family:var(--display)">${no1?esc(no1.t.name):'—'}</div><div class="note">${no1?esc(no1.t.artist):''}</div></div>
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
      <div style="display:flex; gap:12px; align-items:center">
        ${thumbHTML(r.t, idx===0?'big':'med')}
        <div>
          <div class="tname">${esc(r.t.name)}</div>
          <div class="taname">${esc(r.t.artist)}</div>
        </div>
      </div>
      <div class="meta"><span>Stream <b>${fmt(r.stream)}</b></span><span>Peak <b>#${peakUpTo(r.t,y,w)}</b></span><span>WOC <b>${wocUpTo(r.t,y,w)}</b></span>${mv?`<span class="mv ${mv.cls}">${mv.txt}</span>`:''}</div>
    </div>`;
  });

  $('top10').innerHTML = rows.slice(0,10).map(r=>{
    const mv=movement(r.t,y,w);
    return `<tr class="clickable" onclick="openTrack('${r.t.id}')">
      <td class="rank r${r.rank<=3?r.rank:''}">${r.rank}</td>
      <td>${mv?`<span class="mv ${mv.cls}">${mv.txt}</span>`:''}</td>
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
  drawChart('chartNo1','line',{
    labels, datasets:[{ data, borderColor:'#0A0A0A', backgroundColor:'rgba(10,10,10,.07)', fill:true, tension:.3, pointRadius:2, pointHoverRadius:5, spanGaps:true }]
  },{ plugins:{ legend:{display:false}, tooltip:{ callbacks:{ title:(items)=>items[0]?names[items[0].dataIndex]:'', label:(c)=>c.label+': '+fmt(c.parsed.y)+' streams' } } },
     scales:{ x:{ ticks:{ maxTicksLimit:12 } }, y:{ beginAtZero:true } } });
  renderBeat();
  hydrateThumbs();
}

/* ───────── render: chart sheet ───────── */
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
    return `<tr class="clickable" onclick="openTrack('${r.t.id}')">
      <td class="rk-tw${r.rank===1?' no1':''}">${r.rank}${bullet?'<span class="blt">●</span>':''}</td>
      <td class="rk-lw">${lw}</td>
      <td class="rk-mv ${hasMv?mv.cls:'none'}">${hasMv?mv.txt:'—'}</td>
      <td><div class="songcell">${thumbHTML(r.t)}<div class="songmeta"><div class="s-name">${esc(r.t.name)}${r.user?'<span class="badge-user">YOUR ENTRY</span>':''}${callout}</div><div class="s-artist">${esc(r.t.artist)}</div></div></div></td>
      <td class="pts">${fmt(r.stream)}</td>
      <td class="pct${pctCls}">${pctTxt}</td>
      <td class="peakc${pk===1?' no1':''}">${pk}</td>
      <td class="wocc">${woc}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="8"><div class="empty">No data yet for this week — edit data at /admin.</div></td></tr>';
  hydrateThumbs();
}
async function exportPNG(){
  if(typeof html2canvas==='undefined'){ toast('Image rendering library not loaded — open the file in a browser and try again'); return; }
  toast('Rendering image…');
  try{
    const canvas=await html2canvas($('sheetEl'),{ scale:2, useCORS:true, backgroundColor:'#FAFAFA' });
    const a=document.createElement('a');
    a.href=canvas.toDataURL('image/png');
    a.download='n'+yy(currentYear)+'stalgia-w'+selectedWeek+'.png';
    a.click();
    toast('PNG image downloaded');
  }catch(e){ toast('Could not render image (artwork may be blocked by CORS)'); }
}

/* ───────── render: analytics ───────── */
const RACE_COLORS=['#0A0A0A','#4A4A4A','#767676','#9E9E9E','#2E2E2E','#5F5F5F','#8A8A8A','#BDBDBD'];
/* nét đứt xen kẽ để phân biệt các đường cùng tông xám (style trắng đen) */
const RACE_DASHES=[[],[6,3],[2,3],[10,4],[],[6,3],[2,3],[10,4]];
function renderAnalytics(){
  const y=currentYear;
  $('recYear').textContent=y;
  const charted=[...model.tracks.values()].filter(t=>statsFor(t,y).woc>0);
  if(!charted.length){
    $('records').innerHTML='<div class="empty">No data yet for this year.</div>';
    ['chartBump','chartArtists','chartWoc','chartPeaks','chartScatter'].forEach(id=>{ if(charts[id]){charts[id].destroy(); delete charts[id];} });
    $('predBody').innerHTML='<div class="empty" style="padding:16px 0">No data yet.</div>';
    return;
  }
  const S=t=>statsFor(t,y);

  const byStreak=[...charted].sort((a,b)=>S(b).streak-S(a).streak)[0];
  const byBest=[...charted].sort((a,b)=>S(b).best-S(a).best)[0];
  const byWoc=[...charted].sort((a,b)=>S(b).woc-S(a).woc)[0];
  const no1s={}; for(const t of charted) if(S(t).peak===1) no1s[t.artist]=(no1s[t.artist]||0)+1;
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

  // Bump chart — cuộc đua No.1: mọi bài có peak #1 trong năm, vẽ trọn quỹ đạo
  const mw=maxWeekOf(y);
  const firstNo1=t=>{ const wm=t.years.get(y); if(wm) for(let w=1;w<=mw;w++){ const e=wm.get(w); if(e&&e.rank===1) return w; } return Infinity; };
  let racers=charted.filter(t=>S(t).peak===1).sort((a,b)=>firstNo1(a)-firstNo1(b));
  if(!racers.length) racers=[...charted].sort((a,b)=>S(b).total-S(a).total).slice(0,8); // năm chưa có bài #1 nào
  const rankMax=Math.max(10, ...racers.flatMap(t=>{ const wm=t.years.get(y)||new Map(); return [...wm.values()].filter(e=>e.rank!=null).map(e=>e.rank); }));
  const labels=[]; for(let w=1;w<=mw;w++) labels.push('W'+w);
  drawChart('chartBump','line',{
    labels,
    datasets: racers.map((t,i)=>({
      label:t.name,
      data: labels.map((_,ix)=>{ const e=entryAt(t,y,ix+1); return (e&&e.rank!=null)?e.rank:null; }),
      borderColor:RACE_COLORS[i%RACE_COLORS.length], backgroundColor:RACE_COLORS[i%RACE_COLORS.length], borderDash:RACE_DASHES[i%RACE_DASHES.length],
      tension:.3, pointRadius:2, pointHoverRadius:5, spanGaps:false
    }))
  },{ plugins:{ legend:{ position:'bottom', labels:{ color:'#4A4A4A', boxWidth:10, font:{size:11} } },
       tooltip:{ callbacks:{ label:c=>c.dataset.label+': #'+c.parsed.y } } },
     scales:{ y:{ reverse:true, min:1, max:rankMax, ticks:{ ...(rankMax<=15?{stepSize:1}:{}), callback:v=>'#'+v } }, x:{ ticks:{ maxTicksLimit:14 } } } });

  const byArtist={}; for(const t of charted) byArtist[t.artist]=(byArtist[t.artist]||0)+S(t).total;
  const topA=Object.entries(byArtist).sort((a,b)=>b[1]-a[1]).slice(0,10);
  drawChart('chartArtists','bar',{
    labels: topA.map(x=>x[0]),
    datasets:[{ data: topA.map(x=>x[1]), backgroundColor:'#0A0A0A', borderRadius:0 }]
  },{ indexAxis:'y', plugins:{legend:{display:false}}, scales:{x:{beginAtZero:true}},
     onClick:(ev,els)=>{ if(els.length) openArtist(topA[els[0].index][0]); } });

  const topW=[...charted].sort((a,b)=>S(b).woc-S(a).woc).slice(0,10);
  drawChart('chartWoc','bar',{
    labels: topW.map(t=>t.name),
    datasets:[{ data: topW.map(t=>S(t).woc), backgroundColor:'#4A4A4A', borderRadius:0 }]
  },{ indexAxis:'y', plugins:{legend:{display:false}, tooltip:{callbacks:{label:c=>c.parsed.x+' weeks · '+topW[c.dataIndex].artist}}}, scales:{x:{beginAtZero:true}} });

  const buckets={'#1':0,'Top 3':0,'Top 10':0,'Top 20':0,'Top 51':0,'Outside Top 51':0};
  for(const t of charted){
    const p=S(t).peak;
    if(p===1) buckets['#1']++; else if(p<=3) buckets['Top 3']++;
    else if(p<=10) buckets['Top 10']++; else if(p<=20) buckets['Top 20']++;
    else if(p<=51) buckets['Top 51']++; else buckets['Outside Top 51']++;
  }
  drawChart('chartPeaks','doughnut',{
    labels:Object.keys(buckets),
    datasets:[{ data:Object.values(buckets), backgroundColor:['#0A0A0A','#3D3D3D','#666666','#8F8F8F','#B5B5B5','#D6D6D6'], borderColor:'#EFEFEF', borderWidth:2 }]
  },{ plugins:{ legend:{ position:'right', labels:{color:'#4A4A4A', boxWidth:12} } } });

  const pts=charted.filter(t=>S(t).woc>=2).map(t=>({x:S(t).woc, y:Math.round(S(t).total/S(t).woc), t}));
  drawChart('chartScatter','scatter',{
    datasets:[{ data:pts, backgroundColor:'rgba(10,10,10,.65)', pointRadius:4, pointHoverRadius:7 }]
  },{ plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:c=>{const p=c.raw; return p.t.name+' — '+p.t.artist+' · '+p.x+' weeks · '+fmt(p.y)+' streams/week';} } } },
     scales:{ x:{ title:{display:true, text:'Weeks on chart', color:'#5A5A5A'} }, y:{ title:{display:true, text:'Avg streams / week', color:'#5A5A5A'}, beginAtZero:true } },
     onClick:(ev,els)=>{ if(els.length) openTrack(pts[els[0].index].t.id); } });

  renderPrediction(y);
}

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
    const mv=d===0?'<span class="mv eq">=</span>':(d>0?'<span class="mv up">▲'+d+'</span>':'<span class="mv down">▼'+(-d)+'</span>');
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
  drawChart('chartCmp','line',{ labels, datasets:[mk(a,'#0A0A0A'), mk(b,'#8F8F8F')] },
    { plugins:{ legend:{position:'bottom', labels:{color:'#4A4A4A', boxWidth:10, font:{size:11}}}, tooltip:{callbacks:{label:c=>c.dataset.label+': #'+c.parsed.y}} },
      scales:{ y:{ reverse:true, min:1, max:maxR, ticks:{callback:v=>'#'+v} }, x:{ ticks:{maxTicksLimit:12} } } });
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
            <div class="t-artist" style="font-size:14px"><span class="alink" onclick="openArtist('${escAttr(t.artist)}')">${esc(t.artist)}</span></div>
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
  drawChart('chartTraj','line',{
    labels: ws.map(([w])=>'W'+w),
    datasets:[{ data: ws.map(([w,e])=>e.rank), borderColor:'#0A0A0A', backgroundColor:'rgba(10,10,10,.06)',
      pointBackgroundColor: ws.map(([w,e])=>e.rank===1?'#0A0A0A':'#9E9E9E'),
      pointRadius: ws.map(([w,e])=>e.rank===1?5:3), tension:.25, fill:false }]
  },{ plugins:{ legend:{display:false}, tooltip:{callbacks:{label:c=>'#'+c.parsed.y}} },
     scales:{ y:{ reverse:true, min:1, max:maxRank, ticks:{ callback:v=>'#'+v } }, x:{ ticks:{ maxTicksLimit:14 } } } });
  hydrateThumbs();
  document.querySelector('#view-tracks').scrollIntoView({behavior:'smooth'});
}
window.openArtist = function(name){
  switchView('tracks');
  const y=currentYear;
  const list=[...model.tracks.values()].filter(t=>t.artist===name && (t.allTotal>0||t.user));
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
        borderColor:RACE_COLORS[i], backgroundColor:RACE_COLORS[i], borderDash:RACE_DASHES[i], tension:.25, pointRadius:2, spanGaps:false }))
    },{ plugins:{ legend:{position:'bottom', labels:{color:'#4A4A4A', boxWidth:10, font:{size:11}}}, tooltip:{callbacks:{label:c=>c.dataset.label+': #'+c.parsed.y}} },
       scales:{ y:{ reverse:true, min:1, ticks:{callback:v=>'#'+v} }, x:{ ticks:{maxTicksLimit:14} } } });
  }
  hydrateThumbs();
  document.querySelector('#view-tracks').scrollIntoView({behavior:'smooth'});
}

/* ───────── All-time ───────── */
function renderAllTime(){
  const list=[...model.tracks.values()].filter(t=>t.allTotal>0);
  list.sort((a,b)=>b.allTotal-a.allTotal);
  const artists={}; for(const t of list) artists[t.artist]=(artists[t.artist]||0)+t.allTotal;
  const grand=list.reduce((s,t)=>s+t.allTotal,0);
  const grandBase=list.reduce((s,t)=>s+t.baseline,0);
  const n1=list[0];
  $('atKpis').innerHTML=`
    <div class="kpi"><div class="lbl">Total streams all-time</div><div class="val">${fmt(grand)}</div><div class="note">${fmt(grandBase)} from pre-chart</div></div>
    <div class="kpi"><div class="lbl">No.1 song all-time</div><div class="val" style="font-size:17px;font-family:var(--display)">${n1?esc(n1.name):'—'}</div><div class="note">${n1?fmt(n1.allTotal)+' streams':''}</div></div>
    <div class="kpi"><div class="lbl">Songs with data</div><div class="val">${list.length}</div><div class="note">of ${model.tracks.size} songs in catalog</div></div>
    <div class="kpi"><div class="lbl">Artists</div><div class="val">${Object.keys(artists).length}</div><div class="note">years tracked: ${model.yearList.join(', ')}</div></div>`;

  const q=($('atSearch').value||'').trim().toLowerCase();
  const shown=(q?list.filter(t=>t.name.toLowerCase().includes(q)||t.artist.toLowerCase().includes(q)):list).slice(0,100);
  $('atTable').innerHTML = shown.map((t,i)=>{
    const pos=list.indexOf(t)+1;
    return `<tr>
      <td class="rank r${pos<=3?pos:''}" style="text-align:center">${pos}</td>
      <td class="thumbcell clickable" onclick="openTrack('${t.id}')">${thumbHTML(t)}</td>
      <td class="clickable" onclick="openTrack('${t.id}')"><div class="t-name">${esc(t.name)}${t.user?'<span class="badge-user">ADDED BY YOU</span>':''}</div><div class="t-artist">${esc(t.artist)}</div></td>
      <td class="num">${t.baseline?fmt(t.baseline):'—'}</td>
      <td class="num">${fmt(t.trackedTotal)}</td>
      <td class="num" style="color:var(--gold);font-weight:700">${fmt(t.allTotal)}</td>
      <td class="num">${t.allPeak?'#'+t.allPeak:'—'}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="7"><div class="empty">No songs found.</div></td></tr>';

  const topA=Object.entries(artists).sort((a,b)=>b[1]-a[1]).slice(0,10);
  drawChart('chartAtArtists','bar',{
    labels: topA.map(x=>x[0]),
    datasets:[{ data: topA.map(x=>x[1]), backgroundColor:'#2E2E2E', borderRadius:0 }]
  },{ indexAxis:'y', plugins:{legend:{display:false}}, scales:{x:{beginAtZero:true}},
     onClick:(ev,els)=>{ if(els.length) openArtist(topA[els[0].index][0]); } });
  hydrateThumbs();
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
Chart.defaults.color='#5A5A5A';
Chart.defaults.borderColor='rgba(10,10,10,.10)';
Chart.defaults.font.family='"Libre Franklin", system-ui, sans-serif';
function drawChart(id,type,data,options){
  if(charts[id]){ charts[id].destroy(); delete charts[id]; }
  const ctx=$(id); if(!ctx) return;
  charts[id]=new Chart(ctx,{ type, data, options:Object.assign({responsive:true, maintainAspectRatio:false}, options) });
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
  if(v==='tracks') renderTrackList();
}
function refreshAll(){
  renderOverview();
  const active=document.querySelector('nav button.active').dataset.view;
  if(active==='chart') renderChartView();
  if(active==='analytics') renderAnalytics();
  if(active==='alltime') renderAllTime();
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

(async function init(){
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
