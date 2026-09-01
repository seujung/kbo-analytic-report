const DATA = __DATA__;
const MATCH = __MATCH__; /* "pid_bid": [n,sw,wf,pa,K,BB,HBP,1B,2B,3B,HR,woba_n,woba_d] */
const PATTERN = __PATTERN__; /* counts_order, league:{cnt:{type:share}}, pitchers:{pid:{counts,seq,stance}} */
const GLMCFG = __GLMCFG__; /* build 시 .env의 GLM_API_KEY/GLM_MODEL/GLM_BASE_URL 주입 */
const MONTHLY = __MONTHLY__; /* months[], league:[rec], pitchers/batters:{id:[rec|null]} — rec=[n,pa,K,BB,HBP,SF,H,HR,wn,wd,sw,wf,velo] */

/* ---------- constants ---------- */
const PITCH_COLOR = {"직구":"--c8","투심":"--c2","커터":"--c4","슬라이더":"--c7","스위퍼":"--c5","커브":"--c1","체인지업":"--c6","포크":"--c3","너클볼":"--c0"};
/* 구단 브랜드 컬러 모노그램 배지 (공식 로고 아님) */
const TEAM_META = {
  "KIA":{c:"#EA0029",t:"#ffffff",s:"KIA"},
  "두산":{c:"#131230",t:"#ffffff",s:"두"},
  "LG":{c:"#C30452",t:"#ffffff",s:"LG"},
  "삼성":{c:"#074CA1",t:"#ffffff",s:"삼"},
  "SSG":{c:"#CE0E2D",t:"#FFB81C",s:"SSG"},
  "롯데":{c:"#041E42",t:"#ffffff",s:"롯"},
  "NC":{c:"#315288",t:"#E0C88F",s:"NC"},
  "KT":{c:"#1A1A1A",t:"#ffffff",s:"KT"},
  "키움":{c:"#570514",t:"#ffffff",s:"키"},
  "한화":{c:"#F05A22",t:"#ffffff",s:"한"}
};
const TEAM_LOGOS = __LOGOS__; /* build 시 site/logos/의 이미지가 data URI로 임베드됨 */
function teamBadge(team,size=18){
  const src = TEAM_LOGOS[team];
  if(src) return `<img class="tlogo" alt="${team}" title="${team}" src="${src}" style="width:${size+4}px;height:${size+4}px">`;
  const m=TEAM_META[team];
  if(!m) return "";
  const fs = m.s.length>=3 ? size*0.34 : m.s.length===2 ? size*0.42 : size*0.5;
  return `<span class="tbadge" title="${team}" style="width:${size}px;height:${size}px;background:${m.c};color:${m.t};font-size:${fs}px">${m.s}</span>`;
}
const ZONE_RC = ["상","중","하"], ZONE_CC = ["3루측","가운데","1루측"];
const LG = DATA.league.overall, LGP = DATA.league.byPitch;

/* league per-zone baselines (aggregate all pitchers) */
const LGZ = {n:Array(10).fill(0), sw:Array(10).fill(0), wf:Array(10).fill(0), wn:Array(10).fill(0), wd:Array(10).fill(0)};
DATA.pitchers.forEach(p=>{ for(let i=0;i<10;i++){ LGZ.n[i]+=p.zones.n[i]; LGZ.sw[i]+=p.zones.sw[i]; LGZ.wf[i]+=p.zones.wf[i]; LGZ.wn[i]+=(p.zones.wn[i]||0); LGZ.wd[i]+=p.zones.wd[i]; }});
const lgZoneWoba = i => LGZ.wd[i]>0 ? LGZ.wn[i]/LGZ.wd[i] : null;
const lgZoneWhiff = i => LGZ.sw[i]>0 ? LGZ.wf[i]/LGZ.sw[i] : null;

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const pr = (x,d=1) => x==null?"—":(x*100).toFixed(d)+"%";
const f3 = x => x==null?"—":x.toFixed(3).replace(/^(-?)0\./,"$1.");
const f1 = x => x==null?"—":x.toFixed(1);
const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function hex2rgb(h){h=h.replace("#","");if(h.length===3)h=h.split("").map(c=>c+c).join("");return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];}
function lerp(a,b,t){const A=hex2rgb(a),B=hex2rgb(b);return "rgb("+A.map((v,i)=>Math.round(v+(B[i]-v)*t)).join(",")+")";}
function lum(c){let r,g,b;if(c.startsWith("rgb")){[r,g,b]=c.match(/\d+/g).map(Number);}else{[r,g,b]=hex2rgb(c);}return (0.299*r+0.587*g+0.114*b)/255;}
const inkFor = bg => lum(bg)>0.56 ? "#15191d" : "#ffffff";
function seqColor(t,orange){const a=cssv(orange?"--seq1o":"--seq1"),b=cssv(orange?"--seq7o":"--seq7");return lerp(a,b,Math.max(0,Math.min(1,t)));}
function divColor(t){ /* t -1..1 : neg(blue) .. mid .. pos(red) */
  const mid=cssv("--div-mid");t=Math.max(-1,Math.min(1,t));
  return t>=0 ? lerp(mid,cssv("--pos"),t) : lerp(mid,cssv("--neg"),-t);
}

/* ---------- state ---------- */
const state = {mode:"P", team:"ALL", q:"", sort:"pitches", sel:null, view:"player"};
const leagueState = {mode:"P", sort:"pitches", dir:-1};
const players = () => state.mode==="P" ? DATA.pitchers : DATA.batters;
const TEAMS = [...new Set([...DATA.pitchers,...DATA.batters].map(p=>p.team))].sort();

const SORTS = {
  P: [["pitches","투구수"],["woba","피wOBA ↑"],["k","K% ↑"],["bb","BB% ↓"],["whiff","Whiff% ↑"],["csw","CSW% ↑"]],
  B: [["pa","타석"],["woba","wOBA ↑"],["avg","타율 ↑"],["hr","홈런 ↑"],["k","K% ↓"],["bb","BB% ↑"]]
};
const ASC = new Set(["bb_P","k_B"]); // sorts where lower is better/top

/* ---------- sidebar ---------- */
function renderChips(){
  $("#teamChips").innerHTML = ["ALL",...TEAMS].map(t=>
    `<button data-t="${t}" class="${state.team===t?"on":""}">${t==="ALL"?"전체":`<i class="tdot" style="background:${TEAM_META[t]?TEAM_META[t].c:"#999"}"></i>${t}`}</button>`).join("");
  $("#teamChips").querySelectorAll("button").forEach(b=>b.onclick=()=>{state.team=b.dataset.t;renderList();});
}
function renderSortSel(){
  $("#sortSel").innerHTML = SORTS[state.mode].map(([k,l])=>`<option value="${k}">${l}</option>`).join("");
  $("#sortSel").value = state.sort;
}
function sortedList(){
  let L = players().filter(p=>(state.team==="ALL"||p.team===state.team) && (!state.q || p.name.includes(state.q)));
  const k = state.sort, asc = ASC.has(k+"_"+state.mode);
  L.sort((a,b)=>{const va=a[k]??(asc?1e9:-1e9),vb=b[k]??(asc?1e9:-1e9);return asc?va-vb:vb-va;});
  return L;
}
function sideMetric(p){
  const k = state.sort;
  if(k==="pitches") return p.pitches+"구";
  if(k==="pa") return p.pa+"타석";
  if(k==="hr") return p.hr+"HR";
  if(k==="woba"||k==="avg") return f3(p[k]);
  return pr(p[k]);
}
function renderList(){
  if(state.view==="league"){ $("#playerPanel").hidden=true; renderLeague(); return; }
  if(state.view==="match"){ $("#playerPanel").hidden=true; renderMatch(); return; }
  $("#playerPanel").hidden=false;
  renderChips();
  const L = sortedList();
  if(state.sel==null || !L.some(p=>p.id===state.sel)) state.sel = L.length?L[0].id:null;
  $("#plist").innerHTML = L.map(p=>
    `<button data-id="${p.id}" class="${p.id===state.sel?"on":""}">
      <span class="nm">${esc(p.name)}</span><span class="tm">${teamBadge(p.team,16)}</span><span class="mv num">${sideMetric(p)}</span></button>`).join("");
  $("#plist").querySelectorAll("button").forEach(b=>b.onclick=()=>{state.sel=+b.dataset.id;renderList();});
  const onBtn=$("#plist button.on"); if(onBtn) onBtn.scrollIntoView({block:"nearest"});
  $("#countNote").textContent = `${L.length}명 표시 · 전체 ${state.mode==="P"?"투수":"타자"} 집계 (백분위는 200구+ 분포 기준)`;
  renderReport();
}

/* ---------- report pieces ---------- */
function tiles(p){
  const isP = state.mode==="P";
  /* [label, key, dir(+1 = high good), fmt] */
  const defs = isP
    ? [["피wOBA","woba",-1,"f3"],["K%","k",1,"pr"],["BB%","bb",-1,"pr"],
       ["Whiff%","whiff",1,"pr"],["CSW%","csw",1,"pr"],["Chase 유도","chase",1,"pr"]]
    : [["wOBA","woba",1,"f3"],["타율","avg",1,"f3"],["홈런","hr",0,"raw"],
       ["K%","k",-1,"pr"],["BB%","bb",1,"pr"],["Chase%","chase",-1,"pr"]];
  return `<div class="tiles">`+defs.map(([l,k,dir,kind])=>{
    if(kind==="raw") return `<div class="tile"><div class="lb">${l}</div><div class="v num">${p[k]}</div><div class="lg num">${p.pa}타석</div></div>`;
    const v=p[k], lgv=LG[k], fmt=x=>kind==="f3"?f3(x):pr(x);
    if(v==null) return `<div class="tile"><div class="lb">${l}</div><div class="v num">—</div><div class="lg num">리그 ${fmt(lgv)}</div></div>`;
    const d=v-lgv, good=dir*d>0;
    const dl=`<span class="dl ${good?"up":"down"}">${d>=0?"↗":"↘"} ${kind==="f3"?f3(Math.abs(d)):(Math.abs(d)*100).toFixed(1)+"%p"}</span>`;
    return `<div class="tile"><div class="lb">${l}</div><div class="v num">${fmt(v)}</div><div class="lg num">${dl}<span>리그 ${fmt(lgv)}</span></div></div>`;
  }).join("")+`</div>`;
}

const PCT_DEFS = {
  P: [["k","탈삼진율 K%"],["bb","볼넷율 BB% ↓"],["woba","피wOBA ↓"],["whiff","헛스윙 유도 Whiff%"],["csw","CSW%"],
      ["chase","체이스 유도율"],["zone","존 투구율"],["fstr","초구 스트라이크율"],["babip","BABIP ↓"]],
  B: [["woba","wOBA"],["avg","타율"],["bb","볼넷율 BB%"],["k","삼진율 K% ↓"],["whiff","헛스윙율 ↓"],
      ["chase","체이스율 ↓"],["zcon","존 컨택트율"],["babip","BABIP"]]
};
function pctRows(p){
  if(!p.pct) return "";
  const rows = PCT_DEFS[state.mode].filter(([k])=>p.pct[k]!=null).map(([k,label])=>{
    const v = p.pct[k], col = divColor((v-50)/50);
    const raw = ["woba","avg","babip"].includes(k)?f3(p[k]):pr(p[k]);
    return `<div class="pct-row"><span class="lb">${label}</span>
      <span class="pct-track"><span class="pct-fill" style="width:${v}%;background:${col};opacity:.35"></span>
      <span class="pct-dot" style="left:${v}%;background:${col};color:${inkFor(col)}">${v}</span></span>
      <span class="rv num">${raw}</span></div>`;
  }).join("");
  return `<div class="card"><h2>리그 백분위</h2><p class="cap">규정 표본(200구+) 선수 분포 기준 백분위 — 표본이 그 미만인 선수는 같은 분포에 대입한 참고값입니다. 100에 가까울수록 리그 상위, ↓ 표시는 낮을수록 좋은 지표.</p>
    <div class="pct-rows">${rows}</div></div>`;
}

function arsenalTable(p){
  const isP = state.mode==="P";
  const types = Object.entries(p.byPitch).sort((a,b)=>b[1].n-a[1].n);
  if(!types.length) return "";
  const head = isP
    ? "<th>구종</th><th>구사율</th><th>구속</th><th>Whiff%</th><th>CSW%</th><th>Zone%</th><th>Chase</th><th>결정구%</th><th>피wOBA</th><th>RV/100</th>"
    : "<th>구종</th><th>비중</th><th>구속</th><th>Whiff%</th><th>Chase%</th><th>wOBA</th><th>표본(PA)</th><th>RV/100</th>";
  const rows = types.map(([t,d])=>{
    const col = cssv(PITCH_COLOR[t]||"--c0");
    const lg = LGP[t]||{};
    const tip = `${t} 리그 평균\nWhiff ${pr(lg.whiff)} · CSW ${pr(lg.csw)}\nwOBA ${f3(lg.woba)} · 구속 ${f1(lg.velo)}km/h`;
    const rvGood = isP ? d.rv100<0 : d.rv100>0;
    const rv = d.rv100==null?"—":`<span class="${rvGood?"good":"bad"}">${d.rv100>0?"+":""}${d.rv100.toFixed(2)}</span>`;
    const usage = `<span class="num">${pr(d.usage)}</span><span class="ubar"><i style="width:${Math.min(100,d.usage*100/0.6*60)}%;background:${col}"></i></span>`;
    const cells = isP
      ? `<td>${usage}</td><td class="num">${f1(d.velo)}</td><td class="num">${pr(d.whiff)}</td><td class="num">${pr(d.csw)}</td><td class="num">${pr(d.zone)}</td><td class="num">${pr(d.chase)}</td><td class="num">${d.putaway==null?"—":pr(d.putaway)}</td><td class="num">${f3(d.woba)}</td><td class="num">${rv}</td>`
      : `<td>${usage}</td><td class="num">${f1(d.velo)}</td><td class="num">${pr(d.whiff)}</td><td class="num">${pr(d.chase)}</td><td class="num">${f3(d.woba)}</td><td class="num">${d.wd}</td><td class="num">${rv}</td>`;
    return `<tr data-tip="${esc(tip)}"><td><span class="ptype"><span class="dotc" style="background:${col}"></span>${t} <span style="color:var(--muted);font-weight:400">${d.n}구</span></span></td>${cells}</tr>`;
  }).join("");
  const cap = isP
    ? "결정구% = 2스트라이크에서 해당 구종으로 삼진을 끝낸 비율. RV/100 = 100구당 기대득점 변화(타자 기준, <b>음수일수록 투수에게 유리</b>). 행에 마우스를 올리면 리그 평균."
    : "RV/100 = 100구당 기대득점 변화(타자 기준, <b>양수일수록 타자에게 유리</b>). 행에 마우스를 올리면 해당 구종의 리그 평균.";
  return `<div class="card"><h2>${isP?"구종 아스널":"구종별 대응"}</h2><p class="cap">${cap}</p>
    <div class="tscroll"><table class="tb"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

/* ---------- monthly trends ---------- */
const M_IDX = {n:0,pa:1,K:2,BB:3,HBP:4,SF:5,H:6,HR:7,wn:8,wd:9,sw:10,wf:11,velo:12};
const mLabel = m => parseInt(m.slice(5),10)+"월";
function mStat(r,k){
  if(!r) return null;
  const g=i=>r[i];
  switch(k){
    case "woba": return g(9)>=10 ? g(8)/g(9) : null;
    case "k":    return g(1)>=15 ? g(2)/g(1) : null;
    case "bb":   return g(1)>=15 ? g(3)/g(1) : null;
    case "whiff":return g(10)>=15 ? g(11)/g(10) : null;
    case "avg":  { const ab=g(1)-g(3)-g(4)-g(5); return (g(1)>=15&&ab>0) ? g(6)/ab : null; }
    case "velo": return g(0)>=50 ? g(12) : null;
    default: return null;
  }
}
function monthlyCard(p){
  const src = state.mode==="P"?MONTHLY.pitchers:MONTHLY.batters;
  const arr = src[String(p.id)];
  if(!arr) return "";
  const isP = state.mode==="P";
  const cols = isP
    ? [["woba","피wOBA",-1,"f3",0.07],["k","K%",1,"pr",0.08],["bb","BB%",-1,"pr",0.05],["whiff","Whiff%",1,"pr",0.08],["velo","평균구속",0,"v",0]]
    : [["woba","wOBA",1,"f3",0.07],["avg","타율",1,"f3",0.06],["k","K%",-1,"pr",0.08],["bb","BB%",1,"pr",0.05],["whiff","Whiff%",-1,"pr",0.08]];
  const rows = MONTHLY.months.map((m,i)=>{
    const r=arr[i]; if(!r||r[0]<10) return "";
    const lgR=MONTHLY.league[i];
    const tds = cols.map(([k,,dir,kind,scale])=>{
      const v=mStat(r,k);
      if(v==null) return `<td class="num" style="color:var(--muted)">—</td>`;
      if(kind==="v") return `<td class="num">${f1(v)}</td>`;
      const lgv=mStat(lgR,k);
      const fmt=x=>kind==="f3"?f3(x):pr(x);
      if(lgv==null||!dir) return `<td class="num">${fmt(v)}</td>`;
      const t=Math.max(-1,Math.min(1,(v-lgv)/scale*dir));
      const bg=lerp(cssv("--div-mid"), cssv(t>=0?"--pos":"--neg"), Math.abs(t)*0.55);
      return `<td class="num heat" style="background:${bg};color:${inkFor(bg)}" data-tip="${esc(mLabel(m)+" 리그 "+fmt(lgv)+" · 편차 "+(v-lgv>=0?"+":"")+fmt(v-lgv))}">${fmt(v)}</td>`;
    }).join("");
    const extra = isP?"":`<td class="num">${r[7]}</td>`;
    return `<tr><td><b>${mLabel(m)}</b></td><td class="num" style="color:var(--muted)">${isP?r[0]+"구":r[1]+"타석"}</td>${tds}${extra}</tr>`;
  }).join("");
  if(!rows) return "";
  /* insights */
  const ins=[];
  const mw = MONTHLY.months.map((m,i)=>({m,i,w:arr[i]&&arr[i][9]>=15?arr[i][8]/arr[i][9]:null})).filter(x=>x.w!=null);
  if(mw.length>=2){
    const best = mw.reduce((a,b)=> (isP? a.w<b.w : a.w>b.w) ? a : b);
    const worst = mw.reduce((a,b)=> (isP? a.w>b.w : a.w<b.w) ? a : b);
    if(Math.abs(best.w-worst.w)>=0.06){
      ins.push(`최고의 달은 <b>${mLabel(best.m)}</b>(${isP?"피":""}wOBA ${f3(best.w)}), 가장 부진한 달은 <b>${mLabel(worst.m)}</b>(${f3(worst.w)}) — 월별 편차 ${f3(Math.abs(best.w-worst.w))}.`);
    } else {
      ins.push(`월별 ${isP?"피":""}wOBA 편차가 ${f3(Math.abs(best.w-worst.w))}로 시즌 내내 기복이 작은 편.`);
    }
    const last = mw[mw.length-1];
    const diff = last.w - p.woba;
    if(Math.abs(diff)>=0.04){
      const better = isP ? diff<0 : diff>0;
      ins.push(`최근(${mLabel(last.m)}) ${isP?"피":""}wOBA ${f3(last.w)} — 시즌 전체(${f3(p.woba)}) 대비 ${better?"상승세":"하락세"}.`);
    }
  }
  if(isP){
    const mv = MONTHLY.months.map((m,i)=>({m,v:mStat(arr[i],"velo")})).filter(x=>x.v!=null);
    if(mv.length>=2){
      const d = mv[mv.length-1].v - mv[0].v;
      if(Math.abs(d)>=1.0) ins.push(`평균 구속이 ${mLabel(mv[0].m)} ${f1(mv[0].v)} → ${mLabel(mv[mv.length-1].m)} ${f1(mv[mv.length-1].v)}km/h로 ${d>0?"+":""}${f1(d)}km/h ${d>0?"상승":"하락"} — ${d>0?"컨디션 상승 신호":"피로 누적 가능성"}.`);
    }
  }
  const head = `<th>월</th><th>표본</th>`+cols.map(c=>`<th>${c[1]}</th>`).join("")+(isP?"":"<th>HR</th>");
  return `<div class="card"><h2>월별 흐름</h2>
    <p class="cap">월별 성적을 그 달의 리그 평균과 비교했습니다 (셀 색상 = 강점 빨강 / 약점 파랑, 지표 방향 반영). 표본 기준 미달 항목은 — 처리.</p>
    ${ins.length?`<ul style="margin:0 0 16px;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px">${ins.map(s=>`<li style="background:var(--surface2);border-radius:12px;padding:9px 14px;font-size:12.5px;line-height:1.6">${s}</li>`).join("")}</ul>`:""}
    <div class="tscroll"><table class="tb"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div></div>`;
}
function leagueMonthlyCard(){
  const rows = MONTHLY.months.map((m,i)=>{
    const r=MONTHLY.league[i]; if(!r) return "";
    return `<tr><td><b>${mLabel(m)}</b></td><td class="num" style="color:var(--muted)">${r[0].toLocaleString()}구</td>
      <td class="num">${f3(mStat(r,"woba"))}</td><td class="num">${f3(mStat(r,"avg"))}</td>
      <td class="num">${pr(mStat(r,"k"))}</td><td class="num">${pr(mStat(r,"bb"))}</td>
      <td class="num">${pr(mStat(r,"whiff"))}</td><td class="num">${r[7]}</td><td class="num">${f1(r[12])}</td></tr>`;
  }).join("");
  return `<div class="card"><h2>월별 리그 트렌드</h2>
    <p class="cap">리그 전체의 월별 흐름 — 타고/투고 경향과 구속 변화를 확인할 수 있습니다.</p>
    <div class="tscroll"><table class="tb"><thead><tr><th>월</th><th>투구수</th><th>wOBA</th><th>타율</th><th>K%</th><th>BB%</th><th>Whiff%</th><th>HR</th><th>평균구속</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

/* ---------- pitch pattern (pitchers) ---------- */
function patternCard(p){
  const pat = PATTERN.pitchers[String(p.id)];
  if(!pat) return "";
  const CO = PATTERN.counts_order;
  const types = Object.keys(pat.counts).sort((a,b)=>{
    const s=t=>pat.counts[t].reduce((x,y)=>x+y,0); return s(b)-s(a);});
  if(!types.length) return "";
  const totType = Object.fromEntries(types.map(t=>[t, pat.counts[t].reduce((a,b)=>a+b,0)]));
  const allN = types.reduce((a,t)=>a+totType[t],0);
  const usage = Object.fromEntries(types.map(t=>[t, totType[t]/allN]));
  const colTot = CO.map((_,i)=>types.reduce((a,t)=>a+pat.counts[t][i],0));

  /* A. count table */
  const cntHead = CO.map((c,i)=>`<th data-tip="${esc(c+" 카운트 · "+colTot[i]+"구")}">${c}</th>`).join("");
  const cntRows = types.map(t=>{
    const col=cssv(PITCH_COLOR[t]||"--c0");
    const cells = CO.map((c,i)=>{
      if(colTot[i]<15) return `<td class="num" style="color:var(--muted)">·</td>`;
      const v = pat.counts[t][i]/colTot[i];
      const bg = seqColor(v/0.7,false);
      const lgv = (PATTERN.league[c]||{})[t];
      return `<td class="num heat" style="background:${bg};color:${inkFor(bg)}" data-tip="${esc(c+" 카운트에서 "+t+" "+(v*100).toFixed(0)+"% ("+pat.counts[t][i]+"구)"+(lgv!=null?"\n리그 평균 "+(lgv*100).toFixed(0)+"%":""))}">${(v*100).toFixed(0)}</td>`;
    }).join("");
    return `<tr><td><span class="ptype"><span class="dotc" style="background:${col}"></span>${t}</span></td>${cells}</tr>`;
  }).join("");

  /* B. sequence matrix */
  const rowN = Object.fromEntries(types.map(t=>[t, types.reduce((a,b)=>a+((pat.seq[t]||{})[b]||0),0)]));
  const seqTypes = types.filter(t=>rowN[t]>=30);
  const seqHead = seqTypes.map(t=>`<th>${t}</th>`).join("");
  const seqRows = seqTypes.map(a=>{
    const col=cssv(PITCH_COLOR[a]||"--c0");
    const cells = seqTypes.map(b0=>{
      const n=(pat.seq[a]||{})[b0]||0, v=n/rowN[a];
      const bg=seqColor(v/0.65,true);
      const rep = a===b0?" (반복)":"";
      return `<td class="num heat" style="background:${bg};color:${inkFor(bg)}" data-tip="${esc(a+" 다음 "+b0+rep+"\n"+(v*100).toFixed(0)+"% ("+n+"회)")}">${(v*100).toFixed(0)}</td>`;
    }).join("");
    return `<tr><td><span class="ptype"><span class="dotc" style="background:${col}"></span>${a} →</span></td>${cells}<td class="num" style="color:var(--muted)">${rowN[a]}</td></tr>`;
  }).join("");

  /* C. vs L/R usage */
  const totL = types.reduce((a,t)=>a+pat.stance[t][0],0), totR = types.reduce((a,t)=>a+pat.stance[t][1],0);
  const lrRows = types.map(t=>{
    const col=cssv(PITCH_COLOR[t]||"--c0");
    const l=totL?pat.stance[t][0]/totL:0, r=totR?pat.stance[t][1]/totR:0;
    const bar=v=>`<span class="num">${(v*100).toFixed(1)}%</span><span class="ubar"><i style="width:${Math.min(100,v*160)}%;background:${col}"></i></span>`;
    return `<tr><td><span class="ptype"><span class="dotc" style="background:${col}"></span>${t}</span></td><td>${bar(l)}</td><td>${bar(r)}</td>
      <td class="num ${Math.abs(l-r)>=0.08?"good":""}" style="${Math.abs(l-r)>=0.08?"":"color:var(--muted)"}">${((l-r)>=0?"+":"")+((l-r)*100).toFixed(1)}%p</td></tr>`;
  }).join("");

  /* D. insights */
  const ins=[];
  const i00=CO.indexOf("0-0");
  if(colTot[i00]>=30){
    const first = types.map(t=>[t,pat.counts[t][i00]/colTot[i00]]).sort((a,b)=>b[1]-a[1])[0];
    const lgv=(PATTERN.league["0-0"]||{})[first[0]];
    ins.push(`초구는 <b>${first[0]}</b> ${pr(first[1])}${lgv!=null?` (리그 초구 ${first[0]} 비중 ${pr(lgv)})`:""} — 초구 스트라이크율 ${pr(p.fstr)}.`);
  }
  const idx2s=[CO.indexOf("0-2"),CO.indexOf("1-2"),CO.indexOf("2-2"),CO.indexOf("3-2")];
  const n2s=idx2s.reduce((a,i)=>a+colTot[i],0);
  if(n2s>=40){
    const shift = types.map(t=>{const s=idx2s.reduce((a,i)=>a+pat.counts[t][i],0)/n2s;return [t,s,s-usage[t]];}).sort((a,b)=>b[2]-a[2])[0];
    if(shift[2]>=0.05) ins.push(`2스트라이크에서 <b>${shift[0]}</b> 비중이 ${pr(usage[shift[0]])} → ${pr(shift[1])}로 상승 — 확실한 결정구 패턴.`);
  }
  const idxBh=[CO.indexOf("2-0"),CO.indexOf("3-0"),CO.indexOf("3-1")];
  const nBh=idxBh.reduce((a,i)=>a+colTot[i],0);
  if(nBh>=30){
    const top = types.map(t=>[t,idxBh.reduce((a,i)=>a+pat.counts[t][i],0)/nBh]).sort((a,b)=>b[1]-a[1])[0];
    ins.push(top[1]>=0.6?`불리한 카운트(2-0/3-0/3-1)에서 <b>${top[0]}</b> ${pr(top[1])} 의존 — 타자가 노리기 쉬운 패턴.`:`불리한 카운트에서도 <b>${top[0]}</b> ${pr(top[1])}로 구종이 분산 — 예측이 어려움.`);
  }
  const reps = seqTypes.map(t=>({t,rep:((pat.seq[t]||{})[t]||0)/rowN[t],u:usage[t]})).filter(x=>rowN[x.t]>=40);
  const maxRep = reps.sort((a,b)=>(b.rep-b.u)-(a.rep-a.u))[0];
  if(maxRep && maxRep.rep-maxRep.u>=0.08) ins.push(`<b>${maxRep.t}</b> 연속 사용 경향 — 직전 ${maxRep.t} 후 다시 ${maxRep.t}일 확률 ${pr(maxRep.rep)} (평균 구사율 ${pr(maxRep.u)}).`);
  const lrDiff = types.map(t=>{const l=totL?pat.stance[t][0]/totL:0,r=totR?pat.stance[t][1]/totR:0;return [t,l,r,Math.abs(l-r)];}).sort((a,b)=>b[3]-a[3])[0];
  if(lrDiff && lrDiff[3]>=0.08) ins.push(`좌/우타자에 따라 구성 변화 — <b>${lrDiff[0]}</b> 좌타 ${pr(lrDiff[1])} vs 우타 ${pr(lrDiff[2])}.`);

  return `<div class="card"><h2>투구 패턴 분석</h2>
    <p class="cap">카운트(볼-스트라이크)는 투구 직전 기준이며, 셀 값은 그 카운트에서 각 구종이 선택된 비율(%)입니다. 20구 미만 구종은 제외.</p>
    ${ins.length?`<ul style="margin:0 0 18px;padding:0;list-style:none;display:flex;flex-direction:column">${ins.map(s=>`<li style="padding:8px 0;font-size:12.5px;line-height:1.6;border-bottom:1px solid var(--grid)">${s}</li>`).join("")}</ul>`:""}
    <h3 class="pat-h">카운트별 구종 선택</h3>
    <div class="tscroll"><table class="tb"><thead><tr><th>구종</th>${cntHead}</tr></thead><tbody>${cntRows}</tbody></table></div>
    ${seqTypes.length>=2?`<h3 class="pat-h" style="margin-top:22px">구종 시퀀스 — 직전 구종 → 다음 구종</h3>
    <div class="tscroll"><table class="tb"><thead><tr><th>직전 구종</th>${seqHead}<th>표본</th></tr></thead><tbody>${seqRows}</tbody></table></div>
    <p class="small-note" style="margin:8px 0 0">행 기준 정규화 — 같은 타석 안에서 직전 구종이 주어졌을 때 다음 구종의 분포입니다. 대각선 = 같은 구종 반복.</p>`:""}
    <h3 class="pat-h" style="margin-top:22px">좌/우타자별 구사율</h3>
    <div class="tscroll"><table class="tb"><thead><tr><th>구종</th><th>vs 좌타 (${totL.toLocaleString()}구)</th><th>vs 우타 (${totR.toLocaleString()}구)</th><th>차이</th></tr></thead><tbody>${lrRows}</tbody></table></div></div>`;
}

/* ---------- zone heatmap ---------- */
const zoneState = {metric:"freq"};
function zoneLabel(i,p){
  const r=ZONE_RC[Math.floor(i/3)];
  let c=ZONE_CC[i%3];
  if(state.mode==="B" && p && (p.stance==="R"||p.stance==="L")){
    const inside = p.stance==="R" ? 0 : 2;
    c = i%3===1 ? "가운데" : (i%3===inside ? "몸쪽" : "바깥쪽");
  }
  return r+"·"+c;
}
function zoneCells(p, metric){
  const z=p.zones, inN=z.n.slice(0,9).reduce((a,b)=>a+b,0);
  const isP = state.mode==="P";
  const out=[];
  for(let i=0;i<9;i++){
    const n=z.n[i], sw=z.sw[i], wf=z.wf[i], wd=z.wd[i], wn=z.wn[i]||0;
    let val=null, txt="—", bg="var(--surface2)", low=false, extra="";
    if(metric==="freq"){ val=inN?n/inN:0; txt=(val*100).toFixed(0)+"%"; bg=seqColor(val/0.22,false); }
    else if(metric==="whiff"){ if(sw>=10){val=wf/sw;txt=(val*100).toFixed(0)+"%";bg=seqColor(val/0.45,true);} else low=true; }
    else if(metric==="swing"){ if(n>=15){val=sw/n;txt=(val*100).toFixed(0)+"%";bg=seqColor(val/0.85,true);} else low=true; }
    else if(metric==="woba"){ const lz=lgZoneWoba(i); if(wd>=12&&lz!=null){val=wn/wd;txt=f3(val);bg=divColor((val-lz)/0.18);extra=`\n리그 존 평균 ${f3(lz)}`;} else low=true; }
    const tip=`${zoneLabel(i,p)} 존\n투구 ${n} · 스윙 ${sw} · 헛스윙 ${wf}\n${isP?"피":""}wOBA ${wd>0?f3(wn/wd):"—"} (${wd}PA 종료)${extra}${low?"\n표본 부족":""}`;
    const ink = low?"var(--muted)":inkFor(typeof bg==="string"&&bg.startsWith("rgb")?bg:cssv("--surface2"));
    out.push(`<div class="zcell" style="background:${low?"var(--surface2)":bg};color:${ink}" data-tip="${esc(tip)}">${low?"·":txt}</div>`);
  }
  return out.join("");
}
function zoneCard(p){
  const isP = state.mode==="P";
  const metrics=[["freq","투구 빈도"],["whiff","헛스윙율"],["swing","스윙율"],["woba",(isP?"피":"")+"wOBA (리그 대비)"]];
  const z=p.zones, trk=z.n.reduce((a,b)=>a+b,0), oz=z.n[9];
  const ozChase = oz? z.sw[9]/oz : null;
  const seq = zoneState.metric==="woba";
  const legend = seq
    ? `<div class="legend-bar"><span>낮음</span><span class="legend-grad" style="background:linear-gradient(90deg,var(--neg),var(--div-mid),var(--pos))"></span><span>높음 (리그 대비)</span></div>`
    : `<div class="legend-bar"><span>적음</span><span class="legend-grad" style="background:linear-gradient(90deg,${seqColor(0,zoneState.metric!=="freq")},${seqColor(1,zoneState.metric!=="freq")})"></span><span>많음</span></div>`;
  let minis="";
  if(isP){
    const types=Object.entries(p.byPitch).sort((a,b)=>b[1].n-a[1].n).slice(0,6);
    minis = `<h2 style="margin-top:20px">구종별 로케이션</h2><p class="cap">각 구종이 존 어디에 집중되는지 (셀 = 해당 구종 내 비중)</p><div class="zone-flex">`+
      types.map(([t,d])=>{
        const col=cssv(PITCH_COLOR[t]||"--c0");
        const inN=d.zfreq.slice(0,9).reduce((a,b)=>a+b,0)||1;
        const cells=d.zfreq.slice(0,9).map((n,i)=>{
          const v=n/inN, bg=seqColor(v/0.25,false);
          return `<div class="zcell" style="background:${bg};color:${inkFor(bg)}" data-tip="${esc(t+" · "+zoneLabel(i,p)+"\n"+n+"구 ("+(v*100).toFixed(0)+"%)")}">${(v*100).toFixed(0)}</div>`;}).join("");
        return `<div class="zwrap"><div class="zgrid mini">${cells}</div><span class="zcap"><span class="dotc" style="background:${col};display:inline-block;margin-right:5px"></span>${t}</span><span class="zsub num">존 밖 ${d.zfreq[9]}구 · Zone ${pr(d.zone)}</span></div>`;
      }).join("")+`</div>`;
  }
  return `<div class="card"><h2>9분할 존 히트맵</h2><p class="cap">포수 시점 (왼쪽 = 3루측${state.mode==="B"&&p.stance==="R"?" = 우타자 몸쪽":state.mode==="B"&&p.stance==="L"?" = 좌타자 바깥쪽":""}) · 셀에 마우스를 올리면 상세.</p>
    <div class="metric-tabs">${metrics.map(([k,l])=>`<button data-m="${k}" class="${zoneState.metric===k?"on":""}">${l}</button>`).join("")}</div>
    <div class="zone-flex"><div class="zwrap"><div class="zgrid">${zoneCells(p,zoneState.metric)}</div>${legend}</div>
    <div style="flex:1;min-width:200px"><div class="oz-note">존 밖 투구 ${pr(oz/trk)} · ${isP?"체이스 유도":"체이스율"} ${pr(ozChase)} <span style="color:var(--muted)">(리그 ${pr(LG.chase)})</span><br>
    존 안 투구율 ${pr(p.zone)} <span style="color:var(--muted)">(리그 ${pr(LG.zone)})</span></div></div></div>${minis}</div>`;
}

function splitCard(p){
  const isP=state.mode==="P";
  const lbl = isP?{L:"vs 좌타자",R:"vs 우타자"}:{L:"vs 좌투수",R:"vs 우투수"};
  const boxes = ["L","R"].filter(s=>p.vs[s]).map(s=>{
    const v=p.vs[s];
    return `<div class="split-box"><div class="t">${lbl[s]}</div>
      <div class="r"><span>상대 투구</span><b class="num">${v.n}구</b></div>
      <div class="r"><span>${isP?"피":""}wOBA</span><b class="num">${f3(v.woba)} <span style="color:var(--muted);font-weight:400">(${v.wd}PA)</span></b></div>
      <div class="r"><span>Whiff%</span><b class="num">${pr(v.whiff)}</b></div></div>`;
  }).join("");
  return boxes?`<div class="card"><h2>좌/우 스플릿</h2><p class="cap">${isP?"타자":"투수"} 좌우별 성적${isP?"":" (투수 유형은 릴리스 좌표로 추정)"}</p><div class="split-grid">${boxes}</div></div>`:"";
}

/* ---------- strengths / weaknesses ---------- */
function swCard(p){
  const isP=state.mode==="P";
  const S=[],W=[];
  const zonesEval=[];
  for(let i=0;i<9;i++){
    const wd=p.zones.wd[i], lz=lgZoneWoba(i);
    if(wd>=12&&lz!=null) zonesEval.push({i,w:(p.zones.wn[i]||0)/wd,diff:(p.zones.wn[i]||0)/wd-lz,wd});
  }
  zonesEval.sort((a,b)=>a.diff-b.diff);
  const types=Object.entries(p.byPitch).filter(([,d])=>d.n>=80&&d.rv100!=null);
  if(isP){
    if(types.length){
      const best=types.reduce((a,b)=>a[1].rv100<b[1].rv100?a:b), worst=types.reduce((a,b)=>a[1].rv100>b[1].rv100?a:b);
      if(best[1].rv100<=-0.5) S.push(`<span class="sw-tag">주무기</span><b>${best[0]}</b> — RV/100 ${best[1].rv100.toFixed(2)}, Whiff ${pr(best[1].whiff)}, 피wOBA ${f3(best[1].woba)} (${best[1].n}구)`);
      if(worst[1].rv100>=0.5&&worst[0]!==best[0]) W.push(`<span class="sw-tag">공략 대상</span><b>${worst[0]}</b> — RV/100 +${worst[1].rv100.toFixed(2)}, 피wOBA ${f3(worst[1].woba)} (${worst[1].n}구)`);
    }
    const zb=zonesEval[0], zw=zonesEval[zonesEval.length-1];
    if(zb&&zb.diff<=-0.05) S.push(`<span class="sw-tag">강한 존</span><b>${zoneLabel(zb.i,p)}</b> — 피wOBA ${f3(zb.w)} (리그 ${f3(lgZoneWoba(zb.i))}, ${zb.wd}PA)`);
    if(zw&&zw.diff>=0.05) W.push(`<span class="sw-tag">약한 존</span><b>${zoneLabel(zw.i,p)}</b> — 피wOBA ${f3(zw.w)} (리그 ${f3(lgZoneWoba(zw.i))}, ${zw.wd}PA)`);
    if(p.pct){ if(p.pct.bb>=80) S.push(`<span class="sw-tag">제구</span>BB% ${pr(p.bb)} — 리그 상위 ${100-p.pct.bb}% 수준의 볼넷 억제`);
      if(p.pct.bb<=20) W.push(`<span class="sw-tag">제구 불안</span>BB% ${pr(p.bb)} — 리그 하위권 볼넷율`);
      if(p.pct.k>=85) S.push(`<span class="sw-tag">탈삼진</span>K% ${pr(p.k)} — 리그 상위 ${100-p.pct.k}%`);
      if(p.pct.chase>=85) S.push(`<span class="sw-tag">유인구</span>체이스 유도 ${pr(p.chase)} — 존 밖 스윙을 리그 최상위 수준으로 끌어냄`);
      if(p.pct.woba<=25) W.push(`<span class="sw-tag">피안타 억제</span>피wOBA ${f3(p.woba)} — 리그 하위권`);}
  } else {
    const zh=zonesEval[zonesEval.length-1], zc=zonesEval[0];
    if(zh&&zh.diff>=0.06) S.push(`<span class="sw-tag">핫존</span><b>${zoneLabel(zh.i,p)}</b> — wOBA ${f3(zh.w)} (리그 존 평균 ${f3(lgZoneWoba(zh.i))}, ${zh.wd}PA)`);
    if(zc&&zc.diff<=-0.06) W.push(`<span class="sw-tag">콜드존</span><b>${zoneLabel(zc.i,p)}</b> — wOBA ${f3(zc.w)} (리그 ${f3(lgZoneWoba(zc.i))}, ${zc.wd}PA)`);
    const tw=Object.entries(p.byPitch).filter(([,d])=>d.wd>=15);
    if(tw.length){
      const best=tw.reduce((a,b)=>(a[1].woba||0)>(b[1].woba||0)?a:b), worst=tw.reduce((a,b)=>(a[1].woba??1)<(b[1].woba??1)?a:b);
      const lgb=LGP[best[0]], lgw=LGP[worst[0]];
      if(lgb&&best[1].woba-lgb.woba>=0.05) S.push(`<span class="sw-tag">강한 구종</span><b>${best[0]}</b> — wOBA ${f3(best[1].woba)} (리그 ${f3(lgb.woba)}, ${best[1].wd}PA)`);
      if(lgw&&lgw.woba-worst[1].woba>=0.05) W.push(`<span class="sw-tag">약한 구종</span><b>${worst[0]}</b> — wOBA ${f3(worst[1].woba)} (리그 ${f3(lgw.woba)}), Whiff ${pr(worst[1].whiff)}`);
    }
    if(p.pct){ if(p.pct.chase>=80) S.push(`<span class="sw-tag">선구안</span>체이스율 ${pr(p.chase)} — 존 밖 유인구를 잘 참음 (리그 ${pr(LG.chase)})`);
      if(p.pct.chase<=20) W.push(`<span class="sw-tag">선구안</span>체이스율 ${pr(p.chase)} — 존 밖 스윙이 많음 (리그 ${pr(LG.chase)})`);
      if(p.pct.zcon>=85) S.push(`<span class="sw-tag">컨택트</span>존 컨택트 ${pr(p.zcon)} — 리그 최상위`);
      if(p.pct.whiff<=20) W.push(`<span class="sw-tag">헛스윙</span>Whiff% ${pr(p.whiff)} — 리그 하위권 (리그 ${pr(LG.whiff)})`);
      if(p.pct.bb>=85) S.push(`<span class="sw-tag">출루 기여</span>BB% ${pr(p.bb)} — 리그 상위 ${100-p.pct.bb}%`);}
  }
  if(!S.length) S.push("리그 대비 뚜렷한 강점 신호가 기준선을 넘지 않았습니다 (표본 기준 미달 포함).");
  if(!W.length) W.push("리그 대비 뚜렷한 약점 신호가 기준선을 넘지 않았습니다.");
  return `<div class="card"><h2>강점 / 약점 요약</h2><p class="cap">리그 평균 대비 편차와 백분위를 규칙 기반으로 요약한 자동 분석입니다. 표본(괄호)을 함께 확인하세요.</p>
    <div class="sw-grid"><div class="sw-col strength"><h3>강점</h3><ul>${S.map(s=>`<li>${s}</li>`).join("")}</ul></div>
    <div class="sw-col weak"><h3>약점</h3><ul>${W.map(s=>`<li>${s}</li>`).join("")}</ul></div></div></div>`;
}

function glossary(){
  return `<div class="card"><h2>용어 설명</h2><div class="gloss" style="margin-top:8px">
  <p><b>wOBA</b> — 출루 사건에 득점 가치 가중치를 준 종합 공격 지표 (BB .69 / 1루타 .88 / 2루타 1.25 / 3루타 1.58 / HR 2.03). 리그 평균 ${f3(LG.woba)}. 투수는 낮을수록, 타자는 높을수록 좋습니다.</p>
  <p><b>Whiff%</b> — 스윙 대비 헛스윙 비율. <b>CSW%</b> — 전체 투구 중 루킹 스트라이크 + 헛스윙 비율로, 구위·커맨드를 함께 반영합니다.</p>
  <p><b>Chase%</b> — 존 밖 투구에 스윙한 비율. 투수에겐 유인 능력, 타자에겐 선구안(낮을수록 좋음) 지표.</p>
  <p><b>RV/100</b> — 카운트 변화·타석 결과의 기대득점 가치를 100구당으로 환산한 값(타자 기준). 투수의 구종은 음수일수록, 타자의 대응은 양수일수록 우수합니다.</p>
  <p><b>결정구% (PutAway%)</b> — 2스트라이크 상황에서 그 구종이 삼진으로 타석을 끝낸 비율.</p>
  <p><b>BABIP</b> — 인플레이 타구의 안타 비율. 리그 평균(${f3(LG.babip)})에서 크게 벗어나면 운/수비 영향이 섞였을 가능성이 있습니다.</p>
  <p><b>9분할 존</b> — 각 투구에 기록된 개인별 스트라이크 존 상·하한을 3×3 등분. 존 밖은 별도 집계했습니다.</p></div></div>`;
}

function renderReport(){
  const p = players().find(x=>x.id===state.sel);
  if(!p){ $("#report").innerHTML = `<div class="card">조건에 맞는 선수가 없습니다.</div>`; return; }
  const isP = state.mode==="P";
  const hand = isP ? (p.hand==="L"?"좌투(추정)":"우투(추정)") : ({R:"우타",L:"좌타",S:"스위치"}[p.stance]||p.stance);
  $("#report").innerHTML = `
    <div class="card"><div class="player-head">
      <span class="big">${esc(p.name)}</span><span class="badge team">${teamBadge(p.team,20)}<span>${p.team}</span></span><span class="badge">${hand}</span>${p.q?"":`<span class="badge" style="color:var(--bd);border-color:var(--bd-soft);background:var(--bd-soft)">표본 부족 (200구 미만)</span>`}
      <div class="facts num">${p.games}경기 · ${p.pitches.toLocaleString()}구 ${isP?"":"상대"} · ${p.pa}타석<br>
      H ${p.h} · HR ${p.hr} · K ${p.kn} · BB ${p.bbn}</div></div>
      <div style="height:14px"></div>${tiles(p)}</div>
    ${pctRows(p)}
    ${monthlyCard(p)}
    ${arsenalTable(p)}
    ${isP?patternCard(p):""}
    ${zoneCard(p)}
    ${splitCard(p)}
    ${swCard(p)}
    ${glossary()}`;
  $("#report").querySelectorAll(".metric-tabs button").forEach(b=>b.onclick=()=>{zoneState.metric=b.dataset.m;renderReport();});
  applyGloss();
}

/* ---------- league analysis view ---------- */
const LG_METRICS = {
  P: [["k","K%",1,"pr",0.08],["bb","BB%",-1,"pr",0.05],["woba","피wOBA",-1,"f3",0.06],
      ["whiff","Whiff%",1,"pr",0.08],["csw","CSW%",1,"pr",0.05],["chase","체이스 유도율",1,"pr",0.08],["zone","Zone%",1,"pr",0.06]],
  B: [["woba","wOBA",1,"f3",0.06],["avg","타율",1,"f3",0.05],["k","K%",-1,"pr",0.08],
      ["bb","BB%",1,"pr",0.05],["whiff","Whiff%",-1,"pr",0.08],["chase","체이스율",-1,"pr",0.08],["zcon","존 컨택트율",1,"pr",0.06]]
};
const fmtBy = (kind,v)=> kind==="f3"?f3(v):pr(v);
function lgQualified(m){ return (m==="P"?DATA.pitchers:DATA.batters).filter(p=>m==="P"?p.pitches>=500:p.pa>=200); }
function goToPlayer(mode,id){
  state.mode=mode; state.view="player"; state.sel=id; state.team="ALL"; state.q="";
  state.sort = mode==="P"?"pitches":"pa"; $("#search").value="";
  syncTabs(); renderSortSel(); renderList();
  window.scrollTo({top:0});
}
function syncTabs(){
  $("#tabP").classList.toggle("on", state.view==="player"&&state.mode==="P");
  $("#tabB").classList.toggle("on", state.view==="player"&&state.mode==="B");
  $("#tabL").classList.toggle("on", state.view==="league");
  $("#tabM").classList.toggle("on", state.view==="match");
  $("#pageTitle").textContent = state.view==="league"?"리그 분석":state.view==="match"?"가상 매칭":(state.mode==="P"?"투수 리포트":"타자 리포트");
}
function leaderCards(m){
  const Q = lgQualified(m), lgm = LG_METRICS[m].slice(0,6);
  const cards = lgm.map(([k,label,dir,kind])=>{
    const arr = Q.filter(p=>p[k]!=null).sort((a,b)=>dir===1? b[k]-a[k] : a[k]-b[k]);
    const mkRows = (list,offset)=>list.map((p,i)=>
      `<div class="lead-row" data-go="${m}:${p.id}"><span class="rk num">${offset+i+1}</span><span class="nm">${teamBadge(p.team,14)} ${esc(p.name)}</span><span class="vl num">${fmtBy(kind,p[k])}</span></div>`).join("");
    const worst = arr.slice(-5).reverse();
    return `<div class="lead-card"><div class="mt"><b>${label}</b><span>리그 평균 ${fmtBy(kind,LG[k])}${dir===-1?" · 낮을수록 좋음":""}</span></div>
      <div class="lead-cols"><div class="lead-col hi"><h4>리그 상위</h4>${mkRows(arr.slice(0,5),0)}</div>
      <div class="lead-col lo"><h4>리그 하위</h4>${mkRows(worst,0)}</div></div></div>`;
  }).join("");
  const capQ = m==="P"?"500구":"200타석";
  return `<div class="card"><h2>지표별 리그 상위 · 하위</h2><p class="cap">규정 표본(${capQ}) 이상 ${m==="P"?"투수":"타자"} ${lgQualified(m).length}명 기준. 이름을 클릭하면 상세 리포트로 이동합니다.</p>
    <div class="lead-grid">${cards}</div></div>`;
}
function pitchRankCard(m){
  const isP = m==="P";
  const src = isP?DATA.pitchers:DATA.batters;
  const all=[];
  src.forEach(p=>Object.entries(p.byPitch).forEach(([t,d])=>{
    if(d.rv100==null) return;
    if(isP ? d.n>=250 : (d.n>=120&&d.wd>=25)) all.push({p,t,d});
  }));
  all.sort((a,b)=>isP? a.d.rv100-b.d.rv100 : b.d.rv100-a.d.rv100);
  const best = all.slice(0,10), worst = all.slice(-5).reverse();
  const row = (e,i,neg)=>{
    const col=cssv(PITCH_COLOR[e.t]||"--c0");
    const rvGood = isP? e.d.rv100<0 : e.d.rv100>0;
    return `<tr class="clk" data-go="${m}:${e.p.id}"><td class="num" style="color:var(--muted)">${neg?"":i+1}</td>
      <td><span class="tcell">${teamBadge(e.p.team,15)}<b>${esc(e.p.name)}</b></span></td>
      <td><span class="ptype"><span class="dotc" style="background:${col}"></span>${e.t}</span></td>
      <td class="num">${e.d.n}구</td><td class="num">${isP?f1(e.d.velo):pr(e.d.whiff)}</td>
      <td class="num">${isP?pr(e.d.whiff):pr(e.d.chase)}</td><td class="num">${f3(e.d.woba)}</td>
      <td class="num"><span class="${rvGood?"good":"bad"}">${e.d.rv100>0?"+":""}${e.d.rv100.toFixed(2)}</span></td></tr>`;
  };
  const head = isP
    ? "<th></th><th>투수</th><th>구종</th><th>투구</th><th>구속</th><th>Whiff%</th><th>피wOBA</th><th>RV/100</th>"
    : "<th></th><th>타자</th><th>구종</th><th>상대</th><th>Whiff%</th><th>Chase%</th><th>wOBA</th><th>RV/100</th>";
  return `<div class="card"><h2>${isP?"리그 최고의 구종 TOP 10":"구종 상대 최강 타자 TOP 10"}</h2>
    <p class="cap">${isP?"RV/100이 낮을수록(음수) 타자 기대득점을 많이 깎은 구종입니다 (250구 이상).":"RV/100이 높을수록 그 구종을 상대로 많은 득점 가치를 만든 타자입니다 (120구·25PA 이상)."} 행 클릭 시 상세로 이동.</p>
    <div class="tscroll"><table class="tb"><thead><tr>${head}</tr></thead><tbody>${best.map((e,i)=>row(e,i,false)).join("")}</tbody></table></div>
    <div class="rank-note">반대편 — ${isP?"가장 많이 공략당한 구종":"가장 고전한 구종 대응"}:</div>
    <div class="tscroll"><table class="tb"><tbody>${worst.map((e,i)=>row(e,i,true)).join("")}</tbody></table></div></div>`;
}
function leagueTable(m){
  const isP=m==="P";
  const cols = [["name","선수"],["team","팀"],[isP?"pitches":"pa",isP?"투구수":"타석"],...LG_METRICS[m].map(x=>[x[0],x[1]])];
  const mset = Object.fromEntries(LG_METRICS[m].map(x=>[x[0],x]));
  let Q = lgQualified(m).slice();
  const sk = leagueState.sort;
  Q.sort((a,b)=>{
    const va=a[sk], vb=b[sk];
    if(typeof va==="string") return leagueState.dir*va.localeCompare(vb,"ko");
    return leagueState.dir*((va??-1e9)-(vb??-1e9));
  });
  const thead = cols.map(([k,l])=>`<th data-sk="${k}" class="${sk===k?"on":""}">${l}${sk===k?(leagueState.dir===1?" ↑":" ↓"):""}</th>`).join("");
  const rows = Q.map(p=>{
    const tds = cols.map(([k])=>{
      if(k==="name") return `<td><b>${esc(p.name)}</b></td>`;
      if(k==="team") return `<td><span class="tcell">${teamBadge(p.team,16)}${p.team}</span></td>`;
      if(!mset[k]) return `<td class="num">${(p[k]??0).toLocaleString()}</td>`;
      const [,,dir,kind,scale]=mset[k];
      const v=p[k];
      if(v==null) return `<td class="num">—</td>`;
      const t=Math.max(-1,Math.min(1,(v-LG[k])/scale*dir));
      const bg=lerp(cssv("--div-mid"), cssv(t>=0?"--pos":"--neg"), Math.abs(t)*0.55);
      return `<td class="num heat" style="background:${bg};color:${inkFor(bg)}" data-tip="${esc("리그 평균 "+fmtBy(kind,LG[k])+" · 편차 "+(v-LG[k]>=0?"+":"")+fmtBy(kind,v-LG[k]))}">${fmtBy(kind,v)}</td>`;
    }).join("");
    return `<tr class="clk" data-go="${m}:${p.id}">${tds}</tr>`;
  }).join("");
  return `<div class="card"><h2>전체 ${isP?"투수":"타자"} · 리그 평균 대비</h2>
    <p class="cap">셀 색상 = 리그 평균 대비 강점(<span class="good">빨강</span>) / 약점(<span class="bad">파랑</span>) — 지표 방향을 반영했습니다. 헤더 클릭으로 정렬, 행 클릭 시 상세 리포트.</p>
    <div class="tscroll" style="max-height:560px;overflow-y:auto"><table class="tb sortable"><thead><tr>${thead}</tr></thead><tbody>${rows}</tbody></table></div></div>`;
}
function renderLeague(){
  const m = leagueState.mode;
  $("#report").innerHTML = `
    <div class="card"><div class="player-head"><span class="big">리그 분석</span>
      <span class="sub-toggle"><button data-sm="P" class="${m==="P"?"on":""}">투수</button><button data-sm="B" class="${m==="B"?"on":""}">타자</button></span>
      <div class="facts num">${DATA.meta.games}경기 · ${m==="P"?DATA.pitchers.length+"명 투수":DATA.batters.length+"명 타자"} 집계<br>리그 wOBA ${f3(LG.woba)} · K% ${pr(LG.k)} · BB% ${pr(LG.bb)}</div></div></div>
    ${leagueMonthlyCard()}
    ${leaderCards(m)}
    ${pitchRankCard(m)}
    ${leagueTable(m)}`;
  $("#report").querySelectorAll(".sub-toggle button").forEach(b=>b.onclick=()=>{
    leagueState.mode=b.dataset.sm;
    leagueState.sort=b.dataset.sm==="P"?"pitches":"pa"; leagueState.dir=-1;
    renderLeague();
  });
  $("#report").querySelectorAll("[data-go]").forEach(el=>el.onclick=()=>{
    const [mm,id]=el.dataset.go.split(":"); goToPlayer(mm,+id);
  });
  $("#report").querySelectorAll("th[data-sk]").forEach(th=>th.onclick=()=>{
    const k=th.dataset.sk;
    if(leagueState.sort===k) leagueState.dir*=-1; else {leagueState.sort=k;leagueState.dir=(k==="name"||k==="team")?1:-1;}
    renderLeague();
  });
  applyGloss();
}

/* ---------- virtual matchup view ---------- */
const matchState = {pid:null, bid:null, pTeam:null, bTeam:null};
function zoneLabelB(i,b){
  const r=ZONE_RC[Math.floor(i/3)];
  let c=ZONE_CC[i%3];
  if(b && (b.stance==="R"||b.stance==="L")){
    const inside = b.stance==="R" ? 0 : 2;
    c = i%3===1 ? "가운데" : (i%3===inside ? "몸쪽" : "바깥쪽");
  }
  return r+"·"+c;
}
function teamSelHtml(team, aria){
  return `<select aria-label="${aria}">`+TEAMS.map(t=>`<option value="${t}" ${t===team?"selected":""}>${t}</option>`).join("")+`</select>`;
}
function playerSelHtml(list, team, id, volKey, aria){
  const L = list.filter(p=>p.team===team).sort((a,b)=>b[volKey]-a[volKey]);
  return `<select aria-label="${aria}">`+L.map(p=>
    `<option value="${p.id}" ${p.id===id?"selected":""}>${esc(p.name)} (${p[volKey].toLocaleString()}${volKey==="pitches"?"구":"타석"})</option>`).join("")+`</select>`;
}
function h2hCard(P,B){
  const rec = MATCH[P.id+"_"+B.id];
  if(!rec) return `<div class="card"><h2>상대 전적</h2><p class="cap" style="margin-bottom:0">2026시즌 두 선수의 맞대결 기록이 없습니다. 아래 매치업 분석은 각자의 시즌 성향을 교차한 가상 분석입니다.</p></div>`;
  const [n,sw,wf,pa,K,BB,HBP,H1,H2,H3,HR,wn,wd]=rec;
  const H=H1+H2+H3+HR, ab=Math.max(1,pa-BB-HBP);
  const cells=[["타석",pa],["투구",n],["타율",f3(H/ab)],["wOBA",wd?f3(wn/wd):"—"],
    ["안타",H],["홈런",HR],["삼진",K],["볼넷",BB],["헛스윙율",sw?pr(wf/sw):"—"]];
  return `<div class="card"><h2>상대 전적 <span class="small-note">2026시즌 맞대결</span></h2>
    <div class="h2h-strip">${cells.map(([l,v])=>`<div class="cell"><div class="l">${l}</div><div class="v num">${v}</div></div>`).join("")}</div>
    ${pa<8?`<p class="small-note" style="margin:8px 0 0">표본이 ${pa}타석으로 작아 참고용입니다 — 아래 성향 교차 분석과 함께 보세요.</p>`:""}</div>`;
}
function edgeOf(t, pT, bT){
  const lg = LGP[t]; if(!lg) return {score:0};
  const pW = pT.woba!=null && pT.wd>=10 ? pT.woba : lg.woba;
  const bW = bT && bT.woba!=null && bT.wd>=8 ? bT.woba : lg.woba;
  const pWh = pT.whiff??lg.whiff, bWh = bT? (bT.whiff??lg.whiff) : lg.whiff;
  const score = (lg.woba-pW) + (lg.woba-bW) + 0.35*((pWh-lg.whiff)+(bWh-lg.whiff));
  return {score, pW, bW, pWh, bWh, lg, bSample: !!(bT && bT.wd>=8)};
}
function matchupTable(P,B){
  const types = Object.entries(P.byPitch).filter(([,d])=>d.usage>=0.04).sort((a,b)=>b[1].n-a[1].n);
  const rows = types.map(([t,d])=>{
    const bT = B.byPitch[t];
    const e = edgeOf(t,d,bT);
    const chip = e.score>=0.045?`<span class="edge-chip edge-p">투수 우위</span>`:e.score<=-0.045?`<span class="edge-chip edge-b">타자 우위</span>`:`<span class="edge-chip edge-n">백중</span>`;
    const col=cssv(PITCH_COLOR[t]||"--c0");
    return `<tr><td><span class="ptype"><span class="dotc" style="background:${col}"></span>${t}</span></td>
      <td class="num">${pr(d.usage)}</td><td class="num">${f1(d.velo)}</td>
      <td class="num">${f3(d.woba)}</td><td class="num">${pr(d.whiff)}</td>
      <td class="num">${bT&&bT.wd>=8?f3(bT.woba):`<span style="color:var(--muted)">— 표본↓</span>`}</td>
      <td class="num">${bT?pr(bT.whiff):"—"}</td>
      <td class="num" style="color:var(--muted)">${f3(e.lg?.woba)}</td><td>${chip}</td></tr>`;
  }).join("");
  return `<div class="card"><h2>구종 매치업</h2><p class="cap">투수의 구종별 성적과 타자의 해당 구종 상대 성적을 교차 비교했습니다. 우위 판정 = 양측 wOBA 편차 + 헛스윙 편차의 합성 점수 (타자 표본 부족 시 리그 평균으로 대체).</p>
    <div class="tscroll"><table class="tb"><thead><tr><th>구종</th><th>구사율</th><th>구속</th><th>투수 피wOBA</th><th>투수 Whiff</th><th>타자 wOBA</th><th>타자 Whiff</th><th>리그 wOBA</th><th>판정</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}
function matchZones(P,B){
  const pIn = P.zones.n.slice(0,9), pTot = pIn.reduce((a,b)=>a+b,0)||1;
  const pCells = pIn.map((n,i)=>{
    const v=n/pTot, bg=seqColor(v/0.22,false);
    return `<div class="zcell" style="background:${bg};color:${inkFor(bg)}" data-tip="${esc(zoneLabelB(i,B)+"\n투구 비중 "+(v*100).toFixed(0)+"% ("+n+"구)")}">${(v*100).toFixed(0)}%</div>`;}).join("");
  const bCells = [...Array(9)].map((_,i)=>{
    const wd=B.zones.wd[i], lz=lgZoneWoba(i);
    if(wd<10||lz==null) return `<div class="zcell" style="background:var(--surface2);color:var(--muted)" data-tip="${esc(zoneLabelB(i,B)+"\n표본 부족 ("+wd+"PA)")}">·</div>`;
    const w=(B.zones.wn[i]||0)/wd, bg=divColor((w-lz)/0.18);
    return `<div class="zcell" style="background:${bg};color:${inkFor(bg)}" data-tip="${esc(zoneLabelB(i,B)+"\nwOBA "+f3(w)+" (리그 "+f3(lz)+", "+wd+"PA)")}">${f3(w)}</div>`;}).join("");
  return `<div class="card"><h2>존 매치업</h2><p class="cap">포수 시점 · 왼쪽 그리드 = 투수의 로케이션 분포, 오른쪽 = 타자의 존별 wOBA(리그 대비 색상).</p>
    <div class="zone-pair">
      <div class="zwrap"><div class="zgrid">${pCells}</div><span class="zcap">${esc(P.name)} 로케이션</span></div>
      <div class="zwrap"><div class="zgrid">${bCells}</div><span class="zcap">${esc(B.name)} 존별 wOBA</span>
        <div class="legend-bar"><span>약함</span><span class="legend-grad" style="background:linear-gradient(90deg,var(--neg),var(--div-mid),var(--pos))"></span><span>강함</span></div></div>
    </div></div>`;
}
function strategyCard(P,B){
  const pts=[], bts=[];
  const types = Object.entries(P.byPitch).filter(([,d])=>d.usage>=0.04);
  const edges = types.map(([t,d])=>({t,d,e:edgeOf(t,d,B.byPitch[t])})).sort((a,b)=>b.e.score-a.e.score);
  const best=edges[0], worst=edges[edges.length-1];
  /* batter cold/hot zones */
  const zs=[];
  for(let i=0;i<9;i++){const wd=B.zones.wd[i],lz=lgZoneWoba(i);
    if(wd>=10&&lz!=null) zs.push({i,w:(B.zones.wn[i]||0)/wd,diff:(B.zones.wn[i]||0)/wd-lz,wd});}
  zs.sort((a,b)=>a.diff-b.diff);
  const cold=zs.filter(z=>z.diff<=-0.04).slice(0,2), hot=zs.filter(z=>z.diff>=0.04).slice(-2).reverse();
  const pShare=i=>P.zones.n[i]/(P.zones.n.slice(0,9).reduce((a,b)=>a+b,0)||1);
  /* pitcher perspective */
  if(best && best.e.score>0.02) pts.push(`<b>${best.t}</b>를 축으로 — 투수 피wOBA ${f3(best.e.pW)}, ${best.e.bSample?`타자는 이 구종에 wOBA ${f3(best.e.bW)}${best.e.bW<best.e.lg.woba?"로 리그 평균 이하":""}`:"타자 표본 부족(리그 평균 가정)"} (구사율 ${pr(best.d.usage)}).`);
  const put = edges.filter(x=>x.d.putaway!=null&&x.e.score>-0.02).sort((a,b)=>b.d.putaway-a.d.putaway)[0];
  if(put) pts.push(`2스트라이크 결정구는 <b>${put.t}</b> — 결정구율 ${pr(put.d.putaway)}${B.byPitch[put.t]?`, 타자 헛스윙율 ${pr(B.byPitch[put.t].whiff)}`:""}.`);
  cold.forEach(z=>pts.push(`<b>${zoneLabelB(z.i,B)}</b> 존 공략 — 타자 wOBA ${f3(z.w)} (리그 ${f3(lgZoneWoba(z.i))}). 현재 이 존 투구 비중 ${pr(pShare(z.i))}${pShare(z.i)<0.09?" → 비중을 늘릴 여지":""}.`));
  hot.forEach(z=>pts.push(`<b>${zoneLabelB(z.i,B)}</b> 존 회피 — 타자 wOBA ${f3(z.w)}로 리그 대비 강함. 유인구 외 승부 자제.`));
  if(worst && worst.e.score<-0.03) pts.push(`<b>${worst.t}</b>는 신중히 — ${worst.e.bSample?`타자 wOBA ${f3(worst.e.bW)}`:`투수 피wOBA ${f3(worst.e.pW)}`}. 카운트 잡기용 이외 지양.`);
  const pvs=P.vs[B.stance==="S"?(P.hand==="R"?"L":"R"):B.stance];
  if(pvs&&pvs.wd>=30) pts.push(`${B.stance==="L"?"좌":B.stance==="R"?"우":"스위치("+(P.hand==="R"?"좌":"우")+"타 예상)"}타자 상대 피wOBA ${f3(pvs.woba)} — 시즌 전체(${f3(P.woba)})와 비교해 ${pvs.woba>P.woba+0.02?"부담이 큰 매치업":pvs.woba<P.woba-0.02?"유리한 매치업":"평이한 매치업"}.`);
  /* batter perspective */
  const bBest=edges[edges.length-1];
  if(bBest && bBest.e.score<-0.02) bts.push(`<b>${bBest.t}</b>를 노릴 것 — ${bBest.e.bSample?`이 구종 상대 wOBA ${f3(bBest.e.bW)}`:`투수의 피wOBA가 ${f3(bBest.e.pW)}로 높음`} (구사율 ${pr(bBest.d.usage)}).`);
  const hiWhiff=edges.filter(x=>x.e.pWh>=(x.e.lg?.whiff??0.22)+0.05).sort((a,b)=>b.e.pWh-a.e.pWh)[0];
  if(hiWhiff) bts.push(`<b>${hiWhiff.t}</b> 헛스윙 주의 — 투수 Whiff ${pr(hiWhiff.e.pWh)} (리그 ${pr(hiWhiff.e.lg.whiff)}). 2스트라이크 전 커트/골라내기 필요.`);
  hot.forEach(z=>bts.push(`<b>${zoneLabelB(z.i,B)}</b> 존에서 승부 — 본인 wOBA ${f3(z.w)}. 투수의 해당 존 비중 ${pr(pShare(z.i))}${pShare(z.i)>=0.12?" → 기회가 자주 옴":""}.`));
  if(P.pct&&P.pct.chase>=75) bts.push(`존 밖 유인구 참기 — 투수의 체이스 유도율 ${pr(P.chase)}는 리그 상위권. 스윙 존을 좁혀야 함.`);
  if(P.fstr!=null&&P.fstr<LG.fstr-0.03) bts.push(`초구 지켜보기 유효 — 초구 스트라이크율 ${pr(P.fstr)} (리그 ${pr(LG.fstr)}).`);
  else if(P.pct&&P.pct.bb<=25) bts.push(`볼넷 기대 — 투수 BB% ${pr(P.bb)}로 리그 하위권. 깊은 카운트로 끌고 갈 것.`);
  const bvs=B.vs[P.hand];
  if(bvs&&bvs.wd>=30) bts.push(`${P.hand==="L"?"좌":"우"}완 상대 wOBA ${f3(bvs.woba)} — 시즌 전체(${f3(B.woba)})와 비교해 ${bvs.woba>B.woba+0.02?"자신 있는 매치업":bvs.woba<B.woba-0.02?"까다로운 매치업":"평이한 매치업"}.`);
  if(!pts.length) pts.push("뚜렷한 우위 신호가 없습니다 — 기본 볼배합 유지가 무난합니다.");
  if(!bts.length) bts.push("뚜렷한 공략 신호가 없습니다 — 자신의 핫존 중심 접근이 무난합니다.");
  return `<div class="card"><h2>대응 전략</h2><p class="cap">두 선수의 시즌 성향(구종·존·스플릿)과 상대 전적을 교차한 규칙 기반 제안입니다. 표본이 작은 항목은 리그 평균으로 보정됩니다.</p>
    <div class="strat-grid">
      <div class="strat-col"><h3>배터리 전략 — ${esc(P.name)} 관점</h3><ol>${pts.map(s=>`<li>${s}</li>`).join("")}</ol></div>
      <div class="strat-col bat"><h3>타자 접근 — ${esc(B.name)} 관점</h3><ol>${bts.map(s=>`<li>${s}</li>`).join("")}</ol></div>
    </div></div>`;
}
function topOfTeam(list, team, volKey){
  return list.filter(p=>p.team===team).sort((a,b)=>b[volKey]-a[volKey])[0];
}
function renderMatch(){
  if(matchState.pTeam==null){
    const top = DATA.pitchers.reduce((a,b)=>a.pitches>b.pitches?a:b);
    matchState.pTeam = top.team; matchState.pid = top.id;
  }
  if(matchState.bTeam==null){
    const top = DATA.batters.reduce((a,b)=>a.pa>b.pa?a:b);
    matchState.bTeam = top.team; matchState.bid = top.id;
  }
  let P = DATA.pitchers.find(p=>p.id===matchState.pid);
  if(!P || P.team!==matchState.pTeam){ P = topOfTeam(DATA.pitchers, matchState.pTeam, "pitches"); matchState.pid = P.id; }
  let B = DATA.batters.find(b=>b.id===matchState.bid);
  if(!B || B.team!==matchState.bTeam){ B = topOfTeam(DATA.batters, matchState.bTeam, "pa"); matchState.bid = B.id; }
  const hand = P.hand==="L"?"좌투":"우투", st = {R:"우타",L:"좌타",S:"스위치"}[B.stance]||B.stance;
  $("#report").innerHTML = `
    <div class="card"><div class="vs-row">
      <div class="vs-side"><label>투수 — 팀 선택 후 선수 선택</label>
        <div class="selrow">${teamSelHtml(matchState.pTeam,"투수 팀 선택").replace("<select","<select id=\"selPT\"")}${playerSelHtml(DATA.pitchers,matchState.pTeam,P.id,"pitches","투수 선택").replace("<select","<select id=\"selP\"")}</div>
        <div class="vs-name" data-go="P:${P.id}" style="cursor:pointer">${teamBadge(P.team,18)} ${esc(P.name)}<em>${P.team} · ${hand} · ${P.pitches.toLocaleString()}구 · 피wOBA ${f3(P.woba)} · K% ${pr(P.k)}</em></div></div>
      <div class="vs-mark">VS</div>
      <div class="vs-side"><label>타자 — 팀 선택 후 선수 선택</label>
        <div class="selrow">${teamSelHtml(matchState.bTeam,"타자 팀 선택").replace("<select","<select id=\"selBT\"")}${playerSelHtml(DATA.batters,matchState.bTeam,B.id,"pa","타자 선택").replace("<select","<select id=\"selB\"")}</div>
        <div class="vs-name" data-go="B:${B.id}" style="cursor:pointer">${teamBadge(B.team,18)} ${esc(B.name)}<em>${B.team} · ${st} · ${B.pa}타석 · wOBA ${f3(B.woba)} · 타율 ${f3(B.avg)}</em></div></div>
    </div><p class="small-note" style="margin:10px 0 0">선수 목록은 투구수/타석 많은 순입니다. 선수 이름을 클릭하면 개인 상세 리포트로 이동합니다.</p></div>
    ${h2hCard(P,B)}
    ${matchupTable(P,B)}
    ${matchZones(P,B)}
    ${strategyCard(P,B)}`;
  $("#selPT").onchange=e=>{matchState.pTeam=e.target.value;matchState.pid=null;renderMatch();};
  $("#selBT").onchange=e=>{matchState.bTeam=e.target.value;matchState.bid=null;renderMatch();};
  $("#selP").onchange=e=>{matchState.pid=+e.target.value;renderMatch();};
  $("#selB").onchange=e=>{matchState.bid=+e.target.value;renderMatch();};
  $("#report").querySelectorAll("[data-go]").forEach(el=>el.onclick=()=>{
    const [mm,id]=el.dataset.go.split(":"); goToPlayer(mm,+id);
  });
  applyGloss();
}

/* ---------- metric glossary tooltips ---------- */
const GLOSS = [
  [/존 컨택트/, "존 컨택트율 — 스트라이크 존 안의 공에 스윙했을 때 배트에 맞힌 비율. 높을수록 컨택 능력이 좋습니다."],
  [/초구 스트라이크/, "초구 스트라이크율 (F-Strike%) — 타석의 첫 번째 공이 스트라이크(루킹·스윙·파울·인플레이 포함)가 된 비율. 카운트 싸움의 출발점입니다."],
  [/결정구/, "결정구% (PutAway%) — 2스트라이크 상황에서 그 구종을 던져 삼진으로 타석을 끝낸 비율. 높을수록 확실한 마무리 구종입니다."],
  [/RV\/100/, "RV/100 — 카운트 변화와 타석 결과의 기대득점 가치를 100구당으로 환산한 값(타자 관점). 투수의 구종은 음수일수록, 타자의 대응은 양수일수록 우수합니다."],
  [/피?wOBA/, "wOBA — 출루 사건에 득점 가치 가중치(볼넷 .69 · 1루타 .88 · 2루타 1.25 · 홈런 2.03)를 부여한 종합 공격 지표. 리그 평균 약 .330. 타자는 높을수록, 투수(피wOBA)는 낮을수록 좋습니다."],
  [/BABIP/, "BABIP — 인플레이 타구(홈런 제외)가 안타가 된 비율. 리그 평균(약 .318)에서 크게 벗어나면 운·수비 영향이 섞였을 가능성이 있어 지속성이 낮은 지표입니다."],
  [/CSW/, "CSW% — 전체 투구 중 루킹 스트라이크 + 헛스윙의 비율 (Called Strikes + Whiffs). 구위와 커맨드를 함께 반영하는 지표로, 투수는 높을수록 좋습니다."],
  [/헛스윙|Whiff/, "Whiff% — 스윙 대비 헛스윙 비율. 투수는 높을수록(헛스윙 유도), 타자는 낮을수록(컨택) 좋습니다."],
  [/스윙율/, "스윙율 — 해당 존/전체 투구에 스윙한 비율. 타자의 공격 성향과 노림 존을 보여줍니다."],
  [/투구 빈도/, "투구 빈도 — 전체 추적 투구 중 해당 존에 들어온 비율. 투수의 로케이션 패턴을 보여줍니다."],
  [/체이스|Chase/, "Chase% (체이스율) — 스트라이크 존 밖 공에 스윙한 비율. 투수에게는 유인 능력(높을수록 좋음), 타자에게는 선구안(낮을수록 좋음) 지표입니다."],
  [/존 투구율|Zone%/, "Zone% (존 투구율) — 전체 투구 중 스트라이크 존 안에 들어간 비율. 공격적인 투구 성향을 나타냅니다."],
  [/탈삼진|삼진율|^K%$|K% /, "K% — 타석 대비 삼진 비율. 투수는 높을수록, 타자는 낮을수록 좋습니다. 리그 평균 약 19.5%."],
  [/볼넷|^BB%$|BB% /, "BB% — 타석 대비 볼넷 비율. 투수는 낮을수록(제구), 타자는 높을수록(선구안·출루) 좋습니다. 리그 평균 약 9.4%."],
  [/구사율|^비중$/, "구사율 — 그 투수의 전체 투구 중 해당 구종이 차지하는 비율."],
  [/^구속$|평균구속/, "평균 구속 (km/h) — 트래킹된 투구의 평균 속도."],
  [/^타율$/, "타율 (AVG) — 안타 ÷ 타수. 볼넷·몸에 맞는 공·희생타는 타수에서 제외됩니다."],
  [/^홈런$|^HR$/, "홈런 개수."],
  [/^판정$/, "판정 — 양측 wOBA 편차와 헛스윙 편차를 합성한 점수(±0.045 기준)로 구종별 우위를 추정한 결과입니다."],
];
function applyGloss(){
  document.querySelectorAll("#report th, #report .tile .lb, #report .pct-row .lb, #report .h2h-strip .l, #report .split-box .r > span:first-child, #report .metric-tabs button, #report .lead-card .mt b").forEach(el=>{
    if(el.dataset.tip) return;
    const t = el.textContent.trim();
    if(!t) return;
    for(const [re,txt] of GLOSS){
      if(re.test(t)){ el.dataset.tip = txt; el.classList.add("hint"); break; }
    }
  });
  if(typeof updateChatCtx==="function") updateChatCtx();
}

/* ---------- tooltip ---------- */
const tip=$("#tip");
document.addEventListener("mousemove",e=>{
  const t=e.target.closest("[data-tip]");
  if(t){tip.textContent=t.dataset.tip;tip.style.opacity=1;
    const x=Math.min(e.clientX+14,innerWidth-250), y=Math.min(e.clientY+14,innerHeight-90);
    tip.style.left=x+"px";tip.style.top=y+"px";}
  else tip.style.opacity=0;
});

/* ---------- AI chat (GLM) ---------- */
const chat = {hist:[], busy:false, init:false};
function lsGet(k){try{return localStorage.getItem(k)}catch(e){return null}}
function lsSet(k,v){try{if(v)localStorage.setItem(k,v);else localStorage.removeItem(k)}catch(e){}}
function glmCfg(){
  /* .env로 빌드에 주입된 설정이 있으면 항상 우선 — 브라우저 저장값은 .env 미설정 시에만 사용 */
  if(GLMCFG.key){
    return { key: GLMCFG.key.trim(), env: true,
      model: (GLMCFG.model||"glm-5.3-flash").trim(),
      base:  (GLMCFG.base||"https://open.bigmodel.cn/api/paas/v4").trim().replace(/\/+$/,"") };
  }
  return { key: (lsGet("glm_key")||"").trim(), env: false,
    model: (lsGet("glm_model") || GLMCFG.model || "glm-5.3-flash").trim(),
    base:  (lsGet("glm_base")  || GLMCFG.base  || "https://open.bigmodel.cn/api/paas/v4").trim().replace(/\/+$/,"") };
}
function ctxPlayer(p,isP){
  const lines=[];
  const hand=isP?(p.hand==="L"?"좌투":"우투"):({R:"우타",L:"좌타",S:"스위치"}[p.stance]||"");
  lines.push(`${isP?"투수":"타자"} ${p.name} (${p.team}, ${hand}) — ${p.games}경기 ${p.pitches}구 ${p.pa}타석${p.q?"":" [표본 부족: 200구 미만]"}`);
  lines.push(`시즌: ${isP?"피":""}wOBA ${f3(p.woba)} · K% ${pr(p.k)} · BB% ${pr(p.bb)} · ${isP?"":"타율 "+f3(p.avg)+" · HR "+p.hr+" · "}Whiff ${pr(p.whiff)} · CSW ${pr(p.csw)} · Chase ${pr(p.chase)} · Zone ${pr(p.zone)} · BABIP ${f3(p.babip)}${isP&&p.fstr!=null?" · 초구스트라이크 "+pr(p.fstr):""}`);
  const types=Object.entries(p.byPitch).sort((a,b)=>b[1].n-a[1].n)
    .map(([t,d])=>`${t} ${pr(d.usage)} ${f1(d.velo)}km/h Whiff ${pr(d.whiff)} ${isP?"피":""}wOBA ${f3(d.woba)} RV/100 ${d.rv100==null?"-":d.rv100}${isP&&d.putaway!=null?" 결정구 "+pr(d.putaway):""}`).join("\n  - ");
  if(types) lines.push("구종별:\n  - "+types);
  const zw=[]; for(let i=0;i<9;i++){const wd=p.zones.wd[i];zw.push(wd>=10?f3((p.zones.wn[i]||0)/wd):"–");}
  lines.push(`존별 ${isP?"피":""}wOBA (9분할 포수시점, 상단좌→하단우): ${zw.join(" / ")}`);
  const mon=(isP?MONTHLY.pitchers:MONTHLY.batters)[String(p.id)];
  if(mon){const ms=MONTHLY.months.map((m,i)=>{const r=mon[i];return (r&&r[9]>=10)?mLabel(m)+" "+f3(r[8]/r[9]):null;}).filter(Boolean).join(", ");
    if(ms) lines.push(`월별 ${isP?"피":""}wOBA: ${ms}`);}
  ["L","R"].forEach(s=>{const v=p.vs&&p.vs[s]; if(v&&v.wd>=10) lines.push(`vs ${isP?(s==="L"?"좌타자":"우타자"):(s==="L"?"좌투수":"우투수")}: ${isP?"피":""}wOBA ${f3(v.woba)}, Whiff ${pr(v.whiff)} (${v.n}구)`);});
  return lines.join("\n");
}
function chatContext(){
  if(state.view==="match"){
    const P=DATA.pitchers.find(x=>x.id===matchState.pid), B=DATA.batters.find(x=>x.id===matchState.bid);
    if(!P||!B) return {label:"가상 매칭", text:"선수 미선택"};
    let s="[가상 매칭 화면]\n"+ctxPlayer(P,true)+"\n---\n"+ctxPlayer(B,false);
    const rec=MATCH[P.id+"_"+B.id];
    if(rec){const[n,sw,wf,pa,K,BB,HBP,H1,H2,H3,HR,wn,wd]=rec;
      s+=`\n---\n두 선수 상대전적(2026): ${pa}타석 ${n}구, 안타 ${H1+H2+H3+HR} (HR ${HR}), K ${K}, BB ${BB}, wOBA ${wd?f3(wn/wd):"–"}, 헛스윙율 ${sw?pr(wf/sw):"–"}`;}
    else s+="\n---\n두 선수의 2026시즌 맞대결 기록 없음";
    return {label:`${P.name} vs ${B.name}`, text:s};
  }
  if(state.view==="league"){
    return {label:"리그 전체", text:`[리그 분석 화면] 2026 KBO ${DATA.meta.games}경기 ${DATA.meta.pitches.toLocaleString()}구 집계\n리그 평균: wOBA ${f3(LG.woba)} · 타율 ${f3(LG.avg)} · K% ${pr(LG.k)} · BB% ${pr(LG.bb)} · Whiff ${pr(LG.whiff)} · CSW ${pr(LG.csw)} · Chase ${pr(LG.chase)} · BABIP ${f3(LG.babip)}`};
  }
  const p=players().find(x=>x.id===state.sel);
  if(!p) return {label:"–", text:"선수 미선택"};
  return {label:p.name, text:ctxPlayer(p, state.mode==="P")};
}
function updateChatCtx(){ const el=$("#chatCtx"); if(el) el.textContent=chatContext().label; }
function scrollMsgs(){ const m=$("#chatMsgs"); m.scrollTop=m.scrollHeight; }
function addMsg(cls,text){
  const d=document.createElement("div"); d.className="msg "+cls; d.textContent=text;
  $("#chatMsgs").appendChild(d); scrollMsgs(); return d;
}
async function chatSend(){
  const inp=$("#chatInput"); const q=inp.value.trim();
  if(!q||chat.busy) return;
  const cfg=glmCfg();
  if(!cfg.key){ $("#chatCfg").hidden=false; addMsg("err","API Key가 설정되지 않았습니다. 저장소 루트 .env에 GLM_API_KEY를 넣고 재빌드하거나, ⚙ 설정에 키를 입력해 주세요."); return; }
  const ctx=chatContext();
  addMsg("user",q); inp.value=""; chat.busy=true; $("#chatSend").disabled=true;
  const sys=`너는 KBO 야구 세이버메트릭스 분석 어시스턴트다. 아래는 사용자가 지금 열람 중인 2026 KBO 트래킹 데이터 집계다. 반드시 이 데이터를 근거로 한국어로 간결하게 답하고, 수치를 인용할 때 어떤 지표인지 밝혀라. 데이터에 없는 내용(다른 시즌, 부상, 연봉 등)은 추측하지 말고 데이터에 없다고 답해라.\n\n${ctx.text}\n\n[리그 평균 참고] wOBA ${f3(LG.woba)} · K% ${pr(LG.k)} · BB% ${pr(LG.bb)} · Whiff ${pr(LG.whiff)} · Chase ${pr(LG.chase)}\n[지표 방향] 투수: 피wOBA·BB% 낮을수록, K%·Whiff·CSW·Chase유도 높을수록 좋음. RV/100은 투수 구종 음수가 좋음.`;
  const msgs=[{role:"system",content:sys},...chat.hist.slice(-10),{role:"user",content:q}];
  const el=addMsg("ai","…");
  try{
    const res=await fetch(cfg.base+"/chat/completions",{method:"POST",
      headers:{"Content-Type":"application/json","Authorization":"Bearer "+cfg.key},
      body:JSON.stringify({model:cfg.model,messages:msgs,stream:true,temperature:0.4})});
    if(!res.ok){ const t=await res.text().catch(()=>""); throw new Error(`HTTP ${res.status} ${t.slice(0,180)}`); }
    let acc="";
    const ct=(res.headers.get("content-type")||"");
    if(res.body && ct.includes("event-stream")){
      const rd=res.body.getReader(), dec=new TextDecoder(); let buf="";
      while(true){
        const {done,value}=await rd.read(); if(done) break;
        buf+=dec.decode(value,{stream:true});
        const parts=buf.split("\n"); buf=parts.pop();
        for(const ln of parts){
          const s=ln.trim(); if(!s.startsWith("data:")) continue;
          const d=s.slice(5).trim(); if(!d||d==="[DONE]") continue;
          try{ const j=JSON.parse(d);
            const c=(j.choices&&j.choices[0]&&(j.choices[0].delta?.content??j.choices[0].message?.content))||"";
            if(c){ acc+=c; el.textContent=acc; scrollMsgs(); }
          }catch(e){}
        }
      }
    } else {
      const j=await res.json();
      acc=(j.choices&&j.choices[0]&&j.choices[0].message&&j.choices[0].message.content)||"";
      el.textContent=acc||"(빈 응답)";
    }
    if(!acc) el.textContent="(빈 응답)";
    chat.hist.push({role:"user",content:q},{role:"assistant",content:acc});
  }catch(e){
    el.remove();
    let hint="브라우저에서 API를 직접 호출하므로 키·모델명·Base URL 또는 네트워크(CORS) 문제일 수 있습니다. ⚙ 설정에서 확인해 주세요.";
    const m=e.message||"";
    if(m.includes("1113")||m.includes("Insufficient balance")) hint=`계정에 사용 가능한 크레딧/리소스 패키지가 없다는 응답입니다.\n① Base URL(${cfg.base})이 키 발급 플랫폼과 일치하는지 확인 (bigmodel.cn 키 ↔ open.bigmodel.cn, z.ai 키 ↔ api.z.ai)\n② 해당 플랫폼 콘솔에서 모델 "${cfg.model}"의 무료 할당/크레딧 확인\n③ 무료 모델(예: flash 계열)로 모델명 변경 시도`;
    else if(m.includes("401")||m.includes("invalid")) hint="API Key가 잘못되었거나 만료되었습니다. 키와 Base URL 발급처가 일치하는지 확인하세요.";
    else if(m.includes("Failed to fetch")) hint="네트워크/CORS 차단으로 보입니다. 로컬 파일 또는 GitHub Pages에서 열었는지, Base URL이 정확한지 확인하세요.";
    addMsg("err","요청 실패: "+m+"\n"+hint);
  }
  chat.busy=false; $("#chatSend").disabled=false;
}
function initChat(){
  $("#chatToggle").onclick=()=>{
    const p=$("#chatPanel"); p.hidden=!p.hidden;
    if(!p.hidden){ updateChatCtx();
      if(!chat.init){ chat.init=true;
        const cfg=glmCfg();
        addMsg("sys",`모델: ${cfg.model}${cfg.key?"":" · API Key 미설정(⚙)"}\n예시: "이 선수 2스트라이크 결정구는 뭐가 좋아?" / "좌타 상대 약점 분석해줘"`);
      }
      $("#chatInput").focus();
    }
  };
  $("#chatClose").onclick=()=>$("#chatPanel").hidden=true;
  $("#chatNew").onclick=()=>{ chat.hist=[]; $("#chatMsgs").innerHTML=""; addMsg("sys","새 대화 시작 — 현재 컨텍스트: "+chatContext().label); };
  $("#chatSettings").onclick=()=>{
    const c=$("#chatCfg"); c.hidden=!c.hidden;
    if(!c.hidden){
      const cfg=glmCfg(); const lock=cfg.env;
      $("#cfgEnvNote").hidden=!lock;
      ["cfgKey","cfgModel","cfgBase"].forEach(id=>$("#"+id).disabled=lock);
      if(lock){ $("#cfgKey").value="(.env 설정 사용 중)"; $("#cfgModel").value=cfg.model; $("#cfgBase").value=cfg.base; }
      else { $("#cfgKey").value=lsGet("glm_key")||""; $("#cfgModel").value=lsGet("glm_model")||GLMCFG.model||"glm-5.3-flash"; $("#cfgBase").value=lsGet("glm_base")||GLMCFG.base||"https://open.bigmodel.cn/api/paas/v4"; }
    }
  };
  $("#cfgSave").onclick=e=>{ e.preventDefault();
    if(glmCfg().env){ $("#chatCfg").hidden=true; return; }
    lsSet("glm_key",$("#cfgKey").value.trim()); lsSet("glm_model",$("#cfgModel").value.trim()); lsSet("glm_base",$("#cfgBase").value.trim());
    $("#chatCfg").hidden=true; addMsg("sys","설정이 이 브라우저에 저장되었습니다."); };
  $("#cfgReset").onclick=e=>{ e.preventDefault();
    ["glm_key","glm_model","glm_base"].forEach(k=>lsSet(k,""));
    $("#chatCfg").hidden=true; addMsg("sys","브라우저 저장값을 초기화했습니다. 이제 .env(빌드) 설정 또는 기본값이 사용됩니다."); };
  $("#chatForm").onsubmit=e=>{ e.preventDefault(); chatSend(); };
  $("#chatInput").addEventListener("keydown",e=>{ if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); chatSend(); } });
}

/* ---------- boot ---------- */
$("#metaLine").textContent = `${DATA.meta.games}경기 · ${DATA.meta.pitches.toLocaleString()}구 · ${DATA.meta.dateFrom} ~ ${DATA.meta.dateTo}`;
$("#tabP").onclick=()=>{state.view="player";state.mode="P";state.sort="pitches";state.sel=null;syncTabs();renderSortSel();renderList();};
$("#tabB").onclick=()=>{state.view="player";state.mode="B";state.sort="pa";state.sel=null;syncTabs();renderSortSel();renderList();};
$("#tabL").onclick=()=>{state.view="league";syncTabs();renderList();};
$("#tabM").onclick=()=>{state.view="match";syncTabs();renderList();};
$("#search").addEventListener("input",e=>{state.q=e.target.value.trim();renderList();});
$("#sortSel").addEventListener("change",e=>{state.sort=e.target.value;renderList();});
if(window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change",()=>renderReport());
initChat();
renderSortSel();renderList();
