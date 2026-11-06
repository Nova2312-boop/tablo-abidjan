/* Tablô Abidjan — logique de l'application (routage, vues, réservation, compte, espace resto). */
(function(){
"use strict";
/* /admin est réservé à l'équipe Tablô. Clients et gérants utilisent le site (/), le gérant dans #gerant. */
const SITE_ADMIN=location.pathname.replace(/\/+$/,"")==="/admin";
function changeSite(){const h=location.hash.slice(1);
  if(SITE_ADMIN){if(h&&h!=="pro"&&!h.startsWith("activer-")){location.replace("/"+location.hash);return true}}
  else if(h==="pro")history.replaceState(null,"","#gerant"); // même page : le site continue de se charger
  return false}
if(changeSite())return;
let MAPS_KEY="";
if(SITE_ADMIN)document.title="Tablô · Équipe";
/* ---------- HELPERS ---------- */
const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const F=n=>n.toLocaleString("fr-FR").replace(/[  ]/g," ")+" F";
const store={get(k,d){try{const v=localStorage.getItem("tablo2_"+k);return v?JSON.parse(v):d}catch(e){return d}},set(k,v){try{localStorage.setItem("tablo2_"+k,JSON.stringify(v))}catch(e){}}};
function hash(s){let h=2166136261;for(const c of String(s)){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0}
const today=new Date();const iso=d=>{const z=new Date(d.getTime()-d.getTimezoneOffset()*60000);return z.toISOString().slice(0,10)};
const addDays=(n)=>{const d=new Date(today);d.setDate(d.getDate()+n);return iso(d)};
const longDate=s=>new Date(s+"T12:00").toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"});
const hm=t=>t.replace(":","h");
const byId=id=>R.find(r=>r.id===id);
const hues=r=>HUES[hash(r.id)%HUES.length];
function coverBg(r,seed=""){if(!seed&&r.photos&&r.photos.length)return `background:center/cover no-repeat url(/api/photos/${+r.photos[0]})`;const [a,b]=HUES[hash(r.id+seed)%HUES.length];return `background:repeating-linear-gradient(115deg,${a} 0 22px,${a}e6 22px 30px,${b} 30px 36px,${a} 36px 58px),${a}`}
const ini=n=>n.replace(/^(Le|La|Les|Chez|Maison|Café)\s+/i,"").split(/[\s']+/).filter(Boolean).slice(0,2).map(w=>w[0].toUpperCase()).join("");
const price=b=>`<span aria-label="Budget ${b} sur 4">${"F".repeat(b)}<span style="opacity:.3">${"F".repeat(4-b)}</span></span>`;
const heart=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>`;
function toast(m){document.querySelectorAll(".toast").forEach(t=>t.remove());const t=document.createElement("div");t.className="toast";t.setAttribute("role","status");t.textContent=m;document.body.append(t);setTimeout(()=>t.remove(),2600)}

/* ---------- STATE ---------- */
const st={commune:store.get("commune",null),quartier:null,date:iso(today),time:"20:00",pers:2,q:"",types:new Set(),budgets:new Set(),tags:new Set(),cuis:new Set(),sort:"note",ai:false,view:"liste",openNow:false};
let user=null,admin=null,notifs=[],favs=new Set(),alerts=[],pts=0,redeemed=[],myReviews={},resas=[];
let offres=[],retraits=[],commandes=[],demoMode=null;let pro={},proResas={},proStats={},adminRestos=[],ficheCache={};
/* ---------- API (backend Node : server/server.js) ---------- */
/* Catalogue des établissements validés (PostgreSQL) : remplace les données d'exemple de js/data.js */
async function loadCatalog(){try{const d=await api("GET","/api/restaurants");MAPS_KEY=d.mapsKey||"";R.splice(0,R.length,...d.restaurants);
  Object.keys(MENUS).forEach(k=>delete MENUS[k]);Object.assign(MENUS,d.menus);
  try{offres=(await api("GET","/api/offres")).offres||[]}catch(e){offres=[]}
  for(let i=EXPS.length-1;i>=0;i--)if(!byId(EXPS[i].rid))EXPS.splice(i,1)}catch(e){toast(e.message)}}
async function api(method,url,body){
  let r;try{r=await fetch(url,{method,credentials:"same-origin",headers:method==="GET"?{}:{"Content-Type":"application/json"},body:method==="GET"?undefined:JSON.stringify(body||{})})}
  catch(e){const x=new Error("Serveur injoignable. Lance « node server/server.js ».");x.status=0;throw x}
  let d=null;try{d=await r.json()}catch(e){}
  if(d===null){const x=new Error("Backend non lancé : démarre « npm start » puis ouvre http://localhost:3000"+(location.port&&location.port!=="3000"?" (tu es sur le port "+location.port+")":""));x.status=0;throw x}
  if(!r.ok){const x=new Error(d.error||"Erreur "+r.status);x.status=r.status;throw x}return d}
function applyMe(d){d=d||{};retraits=d.retraits||[];commandes=d.commandes||[];user=d.user||null;pts=d.pts||0;favs=new Set(d.favs||[]);alerts=d.alerts||[];redeemed=d.redeemed||[];notifs=d.notifs||[];resas=d.resas||[];
  myReviews={};(d.myReviews||[]).forEach(v=>(myReviews[v.rid]=myReviews[v.rid]||[]).push(v))}
let syncT=null;
function save(){store.set("commune",st.commune);
  if(user){clearTimeout(syncT);syncT=setTimeout(()=>api("PUT","/api/me/state",{favs:[...favs],alerts}).catch(e=>toast(e.message)),250)}
  renderHeader()}
const needLogin=msg=>{toast(msg||"Connecte-toi pour continuer");openLogin();return true};

/* ---------- AVAILABILITY / REVIEWS ---------- */
const occ={};let curB=null;
function ensureOcc(date){if(occ[date])return;occ[date]={};
  api("GET","/api/availability?date="+date).then(d=>{occ[date]=d.occ||{};if(dlg.open){if(curB&&curB.step===1)stepRender(curB)}else if(["accueil","explorer","resto","compte"].includes(view()))rerender()}).catch(()=>{})}
function slotsFor(r,date=st.date,time=st.time,pers=st.pers,edit=null){if(sansResa(r))return [];ensureOcc(date);
  const [H,M]=time.split(":").map(Number);const base=H*60+M,out=[];const n=new Date(),nowM=date===iso(n)?n.getHours()*60+n.getMinutes():-1;
  const ign=edit&&edit.date===date?{time:edit.time,tables:edit.tables}:null;
  for(let k=-2;k<=2;k++){const m=base+k*30;if(m<0||m>=24*60)continue;const t=String(Math.floor(m/60)).padStart(2,"0")+":"+String(m%60).padStart(2,"0");
    out.push({t,free:m>=nowM&&!!SLOTS.choisir(r,date,t,pers,occ[date][r.id],ign)})}
  return out;
}
const horairesTxt=r=>Array.isArray(r.services)&&r.services.length?r.services.map(s=>(r.services.length>1?s.nom+" ":"")+hm(s.de)+" – "+hm(s.a)).join(" · "):r.h+", 7j/7";
const noteTxt=r=>r.note!=null&&r.avis?(+r.note).toFixed(1):"Nouveau";
function reviewsFor(r){
  if(!r.demo)return [...(r.revs||[])];
  const n=8,out=[];
  for(let i=0;i<n;i++){const h=hash(r.id+"rv"+i);const base=Math.round(r.note);const sc=[0,1,2,3].map(j=>Math.max(2,Math.min(5,base-((hash(r.id+i+"s"+j)%3)===0?1:0))));
    const d=new Date(today);d.setDate(d.getDate()-(3+i*5+h%4));
    out.push({nom:FIRST[h%FIRST.length]+" "+String.fromCharCode(65+h%26)+".",date:iso(d),sc,txt:REV[(h>>3)%REV.length],visits:1+h%9,reply:i===1?"Merci pour votre visite, à très bientôt chez nous !":null})}
  return [...(r.revs||[]),...out];
}
function subAvg(revs){if(!revs.length)return [0,0,0,0];const s=[0,0,0,0];revs.forEach(v=>v.sc.forEach((x,i)=>s[i]+=x));return s.map(x=>x/revs.length)}
const SUBL=["Cuisine","Service","Ambiance","Rapport qualité-prix"];
const isOpenAt=(r,t)=>!!SLOTS.serviceA(r,st.date,t);

/* ---------- COMMON CARD ---------- */
const canOrder=r=>!!(r.commande&&(r.commande.emporter||r.commande.livraison));
function sansResa(r){return canOrder(r)&&!!r.commande.seul}
function card(r,opts={}){
  const s=slotsFor(r);const booked=6+hash(r.id+st.date)%42;
  return `<article class="card" data-rid="${r.id}" tabindex="0" aria-label="${esc(r.n)}">
    <div class="cover" style="${coverBg(r)}"><span class="badge ${r.nouv?"new":""}">${r.nouv?"Nouveau":r.t}</span><span class="ini">${ini(r.n)}</span>
      <button class="fav" data-fav="${r.id}" aria-pressed="${favs.has(r.id)}" aria-label="Ajouter aux favoris">${heart}</button></div>
    <div class="card-body">
      <h3>${esc(r.n)}</h3>
      <div class="meta"><span class="stars num">★ ${noteTxt(r)}</span><span class="num">(${(r.avis||0).toLocaleString("fr-FR")} avis)</span><span>${price(r.b)}</span></div>
      <div class="meta"><span>${r.cu}</span><span>·</span><span>${r.q}, ${r.c}</span></div>
      ${r.demo&&!sansResa(r)?`<div class="trend num">Réservé ${booked} fois aujourd'hui</div>`:""}
      ${canOrder(r)?`<button class="btn sm card-order" data-order="${r.id}">Commander</button>`:""}
      ${opts.noSlots||sansResa(r)?"":`<div class="slots">${s.map(x=>`<button class="slot ${x.free?"":"off"}" ${x.free?"":"disabled"} data-book="${r.id}" data-t="${x.t}">${hm(x.t)}</button>`).join("")}</div>`}
    </div></article>`;
}

/* ---------- COMMUNE POPOVER ---------- */
function renderLoc(){
  const c=st.commune;$("#locLabel").textContent=c?(st.quartier?st.quartier+", ":"")+c:"Tout Abidjan";
  const count=(cm,q)=>R.filter(r=>(!cm||r.c===cm)&&(!q||r.q===q)).length;
  const sel=c||CN[0];
  $("#locPop").innerHTML=`<div class="col"><h4>Commune</h4><ul>
    <li><button data-c="" aria-current="${!c}"><span>Tout Abidjan</span><span class="num muted">${R.length}</span></button></li>
    ${CN.map(n=>`<li><button data-c="${n}" aria-current="${n===c}"><span>${n}</span><span class="num muted">${count(n)}</span></button></li>`).join("")}</ul></div>
    <div class="col"><h4>Quartier${c?" · "+c:""}</h4><ul>${c?`<li><button data-qq="" aria-current="${!st.quartier}"><span>Tout ${c}</span><span class="num muted">${count(c)}</span></button></li>`+COMMUNES[c].q.map(q=>`<li><button data-qq="${q}" aria-current="${q===st.quartier}"><span>${q}</span><span class="num muted">${count(c,q)}</span></button></li>`).join(""):`<li class="muted small" style="padding:10px 16px">Choisis une commune pour voir ses quartiers.</li>`}</ul></div>`;
}
$("#locBtn").onclick=e=>{e.stopPropagation();const p=$("#locPop");p.hidden=!p.hidden;$("#locBtn").setAttribute("aria-expanded",!p.hidden);renderLoc()};
$("#locPop").addEventListener("click",e=>{e.stopPropagation();const b=e.target.closest("button");if(!b)return;
  if(b.dataset.c!==undefined){st.commune=b.dataset.c||null;st.quartier=null;renderLoc();save();rerender()}
  else if(b.dataset.qq!==undefined){st.quartier=b.dataset.qq||null;$("#locPop").hidden=true;save();renderLoc();if(view()!=="explorer")location.hash="explorer";else rerender()}});
document.addEventListener("click",()=>{$("#locPop").hidden=true;$("#locBtn").setAttribute("aria-expanded","false")});

/* ---------- SEARCH BAR (shared) ---------- */
function searchBar(){
  let times="";for(let m=7*60;m<=23*60+30;m+=30){const t=String(Math.floor(m/60)).padStart(2,"0")+":"+String(m%60).padStart(2,"0");times+=`<option value="${t}" ${t===st.time?"selected":""}>${hm(t)}</option>`}
  let pers="";for(let i=1;i<=30;i++)pers+=`<option value="${i}" ${i==st.pers?"selected":""}>${i} personne${i>1?"s":""}</option>`;
  return `<div class="modes" role="group" aria-label="Mode de recherche"><button type="button" data-mode="0" aria-pressed="${!st.ai}">Recherche</button><button type="button" data-mode="1" aria-pressed="${st.ai}">Décris ton envie</button></div>
  <form class="search" id="searchForm">
    <div class="field"><label for="sDate">Date</label><input type="date" id="sDate" value="${st.date}" min="${iso(today)}"></div>
    <div class="field"><label for="sTime">Heure</label><select id="sTime">${times}</select></div>
    <div class="field f-pers"><label for="sPers">Personnes</label><select id="sPers">${pers}</select></div>
    <div class="field q"><label for="sQ">${st.ai?"Décris ce que tu veux":"Commune, resto ou cuisine"}</label><input id="sQ" value="${esc(st.ai?"":st.q)}" autocomplete="off" placeholder="${st.ai?"Ex. poisson braisé au bord de l'eau pour 6 à Marcory":"Ex. Riviera, poisson braisé, libanais…"}"></div>
    <button class="btn" type="submit">On y va</button>
  </form>`;
}
function bindSearch(root){
  root.querySelectorAll("[data-mode]").forEach(b=>b.onclick=()=>{st.ai=b.dataset.mode==="1";rerender();setTimeout(()=>{const q=$("#sQ");q&&q.focus()},0)});
  const f=root.querySelector("#searchForm");if(!f)return;
  root.querySelector("#sDate").onchange=e=>{st.date=e.target.value||iso(today);if(view()==="explorer")renderExplorerResults()};
  root.querySelector("#sTime").onchange=e=>{st.time=e.target.value;if(view()==="explorer")renderExplorerResults()};
  root.querySelector("#sPers").onchange=e=>{st.pers=+e.target.value;if(view()==="explorer")renderExplorerResults()};
  root.querySelector("#sQ").addEventListener("input",e=>{if(!st.ai&&view()==="explorer"){st.q=e.target.value;renderExplorerResults()}});
  f.onsubmit=e=>{e.preventDefault();const v=root.querySelector("#sQ").value;
    if(st.ai){const a=parseFree(v);applyIntent(a);toast(a.tags.length||a.budget||a.commune||a.cuis?"J'ai compris : "+[a.commune,...a.tags,a.cuis,a.budget?BUDGETS[a.budget-1].l:null,a.pers?a.pers+" pers.":null].filter(Boolean).join(", "):"Je n'ai pas reconnu d'envie précise, voici toutes les adresses")}
    else{const c=CN.find(n=>n.toLowerCase()===v.trim().toLowerCase());if(c){st.commune=c;st.quartier=null;st.q=""}else st.q=v;save()}
    if(view()!=="explorer")location.hash="explorer";else rerender()};
}
function parseFree(txt){
  const t=txt.toLowerCase();const a={tags:[]};
  const map={"poisson":"Poisson braisé","braisé":"Poisson braisé","lagune":"Bord de lagune","mer":"Bord de lagune","eau":"Bord de lagune","plage":"Bord de lagune","garba":"Garba","attiéké":"Garba","terrasse":"Terrasse","dehors":"Terrasse","grill":"Grillades","viande":"Grillades","choukouya":"Grillades","vue":"Vue","rooftop":"Vue","brunch":"Brunch","végé":"Végétarien","vegan":"Végétarien","groupe":"Groupe","anniv":"Groupe","famille":"Groupe","musique":"Live music","live":"Live music","dj":"Live music","concert":"Live music","clim":"Climatisé","parking":"Parking","wifi":"Wi-Fi","wi-fi":"Wi-Fi","travailler":"Wi-Fi","wave":"Wave / OM","orange money":"Wave / OM","momo":"Wave / OM"};
  for(const k in map)if(t.includes(k)&&!a.tags.includes(map[k]))a.tags.push(map[k]);
  if(/pas cher|petit budget|économique|moins cher/.test(t))a.budget=1;
  if(/chic|luxe|gastro|haut de gamme/.test(t))a.budget=4;
  if(/romantique|amoureux|date/.test(t)&&!a.tags.includes("Vue"))a.tags.push("Vue");
  if(/libanais|chawarma|mezz/.test(t))a.cuis="Libanaise";
  if(/fruits de mer|langouste|crabe/.test(t))a.cuis="Fruits de mer";
  const n=t.match(/(\d{1,2})\s*(pers|personnes|amis|gens|collègues)?/);if(n&&+n[1]>1&&+n[1]<=30)a.pers=+n[1];
  const c=CN.find(c=>t.includes(c.toLowerCase()))||CN.find(c=>COMMUNES[c].q.some(q=>t.includes(q.toLowerCase())));if(c)a.commune=c;
  if(/ce midi|déjeuner|midi/.test(t))a.time="12:30";if(/ce soir|dîner|soir/.test(t))a.time="20:00";
  if(/demain/.test(t))a.date=addDays(1);
  return a;
}
function applyIntent(a){st.tags=new Set(a.tags||[]);st.budgets=new Set(a.budget?[a.budget]:[]);st.types=new Set();st.cuis=new Set(a.cuis?[a.cuis]:[]);st.q="";
  if(a.pers)st.pers=a.pers;if(a.commune){st.commune=a.commune;st.quartier=null}if(a.time)st.time=a.time;if(a.date)st.date=a.date;save();renderLoc()}

/* ---------- VIEW: ACCUEIL ---------- */
const COLL={
 commander:{t:"Commander maintenant",d:"Chaînes, fast-foods et maquis : à emporter ou en livraison. Tu paies au retrait ou à la livraison.",f:canOrder,sort:(a,b)=>(b.t==="Chaîne & fast-food")-(a.t==="Chaîne & fast-food")},
 soir:{t:"Disponibles ce soir",d:"Tables libres autour de 20h près de toi.",f:r=>slotsFor(r,iso(today),"20:00").some(s=>s.free)},
 top:{t:"Les mieux notés d'Abidjan",d:"Les adresses que la communauté Tablô recommande le plus.",f:r=>r.note>=4.5,sort:(a,b)=>(b.note||0)-(a.note||0)},
 nouveau:{t:"Nouveaux sur Tablô",d:"Ouverts récemment ou tout juste arrivés sur la plateforme.",f:r=>r.nouv},
 lagune:{t:"Au bord de l'eau",d:"Lagune Ébrié, océan ou plage de Bassam.",f:r=>r.tags.includes("Bord de lagune")},
 budget:{t:"Bien manger pour moins de 5 000 F",d:"Garba, alloco et braise : le meilleur de la rue, en réservant.",f:r=>r.b===1},
 groupe:{t:"Pour les groupes et événements",d:"Salles privatisables, grandes tablées, anniversaires.",f:r=>r.tags.includes("Groupe")&&r.tables>=14},
};
function offresHtml(l,titre,sous,court){if(!l.length)return"";return `<section class="${court?"r-sec":"block wrap"} offres"><div class="sec-head"><h2>${titre}</h2><p>${sous}</p></div><div class="rail">${l.map(o=>`<div class="offre">${court?"":`<a href="#r-${esc(o.rid)}"><b>${esc(o.resto)}</b></a><span class="small muted">${esc(o.c)}</span>`}<b class="offre-p">${esc(o.p)}</b><span class="num"><s class="muted">${F(o.prix)}</s> <b class="offre-prix">${F(o.promo)}</b></span><span class="small muted num">${o.q} restante${o.q>1?"s":""}</span><button class="btn sm" data-offre="${esc(o.rid)}" data-offrep="${esc(o.p)}">Réserver une portion</button></div>`).join("")}</div></section>`}
function renderHome(){
  const loc=st.commune?(st.quartier||st.commune):"Abidjan";
  const inC=r=>!st.commune||r.c===st.commune;
  const rail=k=>{const C=COLL[k];let l=R.filter(r=>C.f(r));const local=l.filter(inC);if(local.length>=3)l=local;if(C.sort)l.sort(C.sort);if(!l.length)return"";
    return `<section class="block wrap" id="c-${k}"><div class="sec-head"><h2>${C.t}</h2><button class="linkbtn" data-coll="${k}">Tout voir</button><p>${C.d}</p></div><div class="rail">${l.map(r=>card(r)).join("")}</div></section>`};
  const favList=R.filter(r=>favs.has(r.id));
  $("#main").innerHTML=`
  <div class="hero"><div class="wrap">
    <h1>Ta table à <em>${esc(loc)}</em>, réservée en 30 secondes.</h1>
    <p class="lead">Maquis, garbadromes, poisson braisé au bord de la lagune ou gastronomie au Plateau. Choisis ton créneau, pré-commande tes plats si tu veux, et ta table t'attend.</p>
    ${searchBar()}
    <p class="geo">Tu explores <b>${st.commune?esc(loc):"tout Abidjan"}</b>. Pas le bon endroit ? <button class="linkbtn" id="pickLoc">Choisir ma commune</button></p>
    <div class="ai-panel">
      <div><h2>Trouve la bonne table à ${esc(st.commune||"Abidjan")}</h2><p class="muted small" style="margin-top:4px">Dis-le avec tes mots, Tablô règle les filtres pour toi.</p></div>
      <div class="chips">${["Un bon poisson braisé au bord de l'eau","Un garba pas cher ce midi","Un dîner romantique avec vue","Anniversaire à 12 avec de la musique","Brunch tranquille avec wifi pour travailler","Libanais à Angré ce soir"].map(s=>`<button class="chip" data-ask="${esc(s)}">${s}</button>`).join("")}</div>
    </div>
  </div></div>
  ${favList.length?`<section class="block wrap"><div class="sec-head"><h2>Tes favoris</h2><button class="linkbtn" data-go="compte" data-tab="favoris">Gérer</button></div><div class="rail">${favList.map(r=>card(r)).join("")}</div></section>`:""}
  ${rail("commander")}
  ${rail("soir")}
  ${offresHtml(offres,"Anti-gaspi : les invendus de ce soir à -40 %","Des plats à prix réduit dans les restaurants partenaires. Tu paies au retrait.")}
  <section class="block wrap"><div class="sec-head"><h2>Expériences à réserver</h2><p>Soirées, menus spéciaux et événements dans les restaurants partenaires.</p></div>
    <div class="rail">${EXPS.map(e=>{const r=byId(e.rid);return `<div class="exp" data-rid="${r.id}" data-exp="${e.id}" tabindex="0"><span class="when">${e.w}</span><h3>${e.t}</h3><p class="muted small">${e.d}</p><div class="meta" style="margin-top:auto"><span><b style="color:var(--fg)">${r.n}</b></span><span>${r.c}</span><span>${e.p?F(e.p)+" / pers.":"Entrée libre"}</span></div></div>`}).join("")}</div></section>
  ${rail("top")}${rail("nouveau")}${rail("lagune")}${rail("budget")}${rail("groupe")}
  <section class="block wrap"><div class="sec-head"><h2>Comment fonctionne Tablô ?</h2></div>
    <div class="how">
      <div><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2"><circle cx="21" cy="21" r="12"/><path d="m30 30 10 10"/><path d="M16 21h10M21 16v10"/></svg><h3>Découvre la bonne adresse</h3><p>Par commune, quartier, envie ou budget. Avis vérifiés : seuls les clients venus avec Tablô peuvent noter.</p></div>
      <div><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2"><rect x="8" y="10" width="32" height="30" rx="4"/><path d="M8 18h32M16 6v8M32 6v8M16 28l5 5 10-10"/></svg><h3>Réserve et gère tes tables</h3><p>Confirmation immédiate par code, modification ou annulation en un geste, réservation pour un proche.</p></div>
      <div><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2"><rect x="14" y="6" width="20" height="36" rx="4"/><path d="M20 36h8M24 16v7l4 3"/></svg><h3>Pré-commande, zéro attente</h3><p>Choisis tes plats en réservant : la cuisine lance la commande à ton arrivée. Alerte si une table se libère.</p></div>
      <div><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2"><path d="M24 6l5 11 12 1-9 8 3 12-11-6-11 6 3-12-9-8 12-1z"/></svg><h3>Gagne des points</h3><p>50 points par réservation, 100 après ton passage. Échange-les contre un dessert, un cocktail ou une réduction.</p></div>
    </div></section>
  <section class="block wrap" id="faq"><div class="sec-head"><h2>Questions fréquentes</h2></div>
    <div class="tablist" role="tablist">${Object.keys(FAQ).map((k,i)=>`<button role="tab" aria-selected="${i===0}" data-faqtab="${k}">${k}</button>`).join("")}</div>
    <div id="faqBody" class="faq-grid"></div></section>
  <section class="block wrap"><div class="sec-head"><h2>Les meilleures adresses par commune</h2><p>Lieux connus, cuisines, envies et quartiers de chaque commune.</p></div>
    <div class="dir">${CN.map(c=>`<details class="acc"><summary>${c} <span class="muted small num" style="margin-left:auto;font-weight:500">${R.filter(r=>r.c===c).length} adresses</span></summary><div class="acc-body"><div class="dir-cols">
      <div><h4>Lieux connus</h4>${COMMUNES[c].lm.map(l=>`<button data-dc="${c}">Près de ${l}</button>`).join("")}</div>
      <div><h4>Cuisines</h4>${[...new Set(R.filter(r=>r.c===c).map(r=>r.cu))].concat(["Ivoirienne"]).filter((v,i,a)=>a.indexOf(v)===i).slice(0,4).map(cu=>`<button data-dc="${c}" data-dcu="${cu}">${cu} à ${c}</button>`).join("")}</div>
      <div><h4>Envies</h4>${["Terrasse","Groupe","Grillades"].map(tg=>`<button data-dc="${c}" data-dtag="${tg}">${tg} à ${c}</button>`).join("")}</div>
      <div><h4>Quartiers</h4>${COMMUNES[c].q.map(q=>`<button data-dc="${c}" data-dq="${q}">${q}</button>`).join("")}</div>
    </div></div></details>`).join("")}</div></section>
  <div class="wrap"><div class="pro-banner">
    <div class="txt"><span class="pill" style="background:rgba(255,255,255,.18);color:#fff">Restaurateurs</span><h2>Remplis ta salle, réduis les no-shows et le gaspillage.</h2><p>Plan de salle en temps réel, pré-commandes envoyées en cuisine, rappels SMS automatiques et vente des invendus du soir à prix réduit.</p><a class="btn" href="#inscription-resto">Rejoindre Tablô</a> </div>
    <div class="mock" aria-hidden="true">${Array.from({length:12},(_,i)=>`<span class="${[1,4,6,9].includes(i)?"b":""}">T${i+1}</span>`).join("")}</div>
  </div></div>
  <div class="wrap app-band">
    <div><h3>Cartes cadeaux</h3><p class="muted small">Offre un dîner dans plus de 18 restaurants, envoyé par SMS ou WhatsApp.</p><button class="btn ghost sm" data-gift="1">Offrir une carte</button></div>
    <div><h3>Réserver pour un proche</h3><p class="muted small">Ta mère, ton client, ton équipe : la confirmation part à son numéro.</p><button class="btn ghost sm" data-coll="top">Choisir un restaurant</button></div>
    <div><h3>Privatisation et séminaires</h3><p class="muted small">Demande un devis pour 20 à 200 personnes, réponse sous 24h.</p><button class="btn ghost sm" data-private="1">Faire une demande</button></div>
  </div>`;
  bindSearch($("#main"));renderFaq("Découverte");
  $("#pickLoc").onclick=e=>{e.stopPropagation();$("#locBtn").click();window.scrollTo({top:0,behavior:"smooth"})};
}
const FAQ={
 "Découverte":[["Pourquoi utiliser Tablô pour trouver un restaurant ?","Tablô rassemble maquis, restaurants et lounges de toutes les communes d'Abidjan avec leurs vraies disponibilités, leurs menus en FCFA et des avis de clients venus sur place."],["Puis-je lire ou laisser un avis ?","Oui. Après une réservation honorée, tu peux noter la cuisine, le service, l'ambiance et le rapport qualité-prix. Seuls les clients venus avec Tablô peuvent noter, ce qui limite les faux avis."],["Comment fonctionne « Décris ton envie » ?","Tu écris ta recherche comme tu la dirais à un ami. Tablô repère la commune, le budget, le nombre de personnes et tes envies, puis règle les filtres."]],
 "Réservations":[["Comment modifier ou annuler ?","Dans Mon compte, onglet Réservations. L'annulation est gratuite jusqu'à 2h avant ; la table est aussitôt proposée aux clients en liste d'attente."],["Puis-je réserver pour quelqu'un d'autre ?","Oui, coche « Je réserve pour quelqu'un d'autre » : la confirmation et le rappel partent au numéro de ton invité."],["Faut-il payer pour réserver ?","Non, sauf pour certaines expériences. Tu peux laisser une garantie Wave, Orange Money ou MTN MoMo, remboursée si tu viens."]],
 "Disponibilités":[["Que faire si tout est complet ?","Active « Me prévenir » : tu reçois une alerte dès qu'une table se libère sur ton créneau."],["Les créneaux sont-ils à jour ?","Ils viennent du plan de salle du restaurant, mis à jour par l'équipe pendant le service."],["Et les grands groupes ?","Au-delà de 12 personnes, fais une demande de privatisation : le restaurant te répond avec un devis."]],
 "Points Tablô":[["Comment gagner des points ?","50 points à la réservation, 100 de plus quand le restaurant confirme ton passage, 30 pour un avis."],["Comment les utiliser ?","Dans Mon compte, onglet Fidélité : dessert offert, cocktail, réduction de 5 000 F ou table prioritaire."],["Les points expirent-ils ?","Ils restent valables 12 mois après ta dernière réservation."]]
};
function renderFaq(k){const items=FAQ[k];const half=Math.ceil(items.length/2);
  $("#faqBody").innerHTML=[items.slice(0,half),items.slice(half)].map(col=>`<div>${col.map(([q,a])=>`<details class="acc"><summary>${q}</summary><div class="acc-body">${a}</div></details>`).join("")}</div>`).join("");
  document.querySelectorAll("[data-faqtab]").forEach(b=>b.setAttribute("aria-selected",b.dataset.faqtab===k))}

/* ---------- VIEW: EXPLORER ---------- */
function filtered(){
  const q=st.q.trim().toLowerCase();
  let list=R.filter(r=>(!st.commune||r.c===st.commune)&&(!st.quartier||r.q===st.quartier)
    &&(!st.types.size||st.types.has(r.t))&&(!st.budgets.size||st.budgets.has(r.b))&&(!st.cuis.size||st.cuis.has(r.cu))
    &&[...st.tags].every(t=>r.tags.includes(t))&&(!st.openNow||isOpenAt(r,st.time))&&(!st.orderOnly||canOrder(r))
    &&(!q||[r.n,r.c,r.q,r.t,r.cu,...r.tags,...Object.values(MENUS[r.m]).flat().map(x=>x[0])].join(" ").toLowerCase().includes(q)));
  const S={note:(a,b)=>(b.note||0)-(a.note||0),prix:(a,b)=>a.b-b.b||(b.note||0)-(a.note||0),dispo:(a,b)=>slotsFor(b).filter(x=>x.free).length-slotsFor(a).filter(x=>x.free).length,new:(a,b)=>(b.nouv-a.nouv)||(b.note||0)-(a.note||0),avis:(a,b)=>b.avis-a.avis};
  return list.sort(S[st.sort]);
}
function chipRow(items,set,lab=x=>x,key=x=>x,name){return items.map(it=>`<button class="chip" data-f="${name}" data-k="${esc(key(it))}" aria-pressed="${set.has(key(it))}">${lab(it)}</button>`).join("")}
function renderExplorer(){
  $("#main").innerHTML=`<div class="hero" style="padding-block:22px"><div class="wrap">${searchBar()}</div></div>
  <div class="wrap explore">
    <aside class="filters" aria-label="Filtres">
      <div class="fgroup"><h3>Disponibilité</h3><div class="chips"><button class="chip" id="fOpen" aria-pressed="${st.openNow}">Ouvert à ${hm(st.time)}</button><button class="chip" id="fOrder" aria-pressed="${!!st.orderOnly}">Commande en ligne</button></div></div>
      <div class="fgroup"><h3>Type d'endroit</h3><div class="chips">${chipRow(TYPES,st.types,undefined,undefined,"types")}</div></div>
      <div class="fgroup"><h3>Budget / pers.</h3><div class="chips">${chipRow(BUDGETS,st.budgets,b=>b.l,b=>b.id,"budgets")}</div></div>
      <div class="fgroup"><h3>Cuisine</h3><div class="chips">${chipRow(CUIS,st.cuis,undefined,undefined,"cuis")}</div></div>
      <div class="fgroup"><h3>Envies et services</h3><div class="chips">${chipRow(TAGS,st.tags,undefined,undefined,"tags")}</div></div>
      <button class="linkbtn" id="fReset" style="align-self:flex-start">Effacer les filtres</button>
    </aside>
    <div style="min-width:0">
      <div class="results-head"><h2 id="resTitle"></h2>
        <div class="row"><div class="seg" role="group" aria-label="Affichage"><button data-v="liste" aria-pressed="${st.view==="liste"}">Liste</button><button data-v="carte" aria-pressed="${st.view==="carte"}">Carte</button></div>
        <label class="small muted" for="sortSel">Trier</label><select class="plain" id="sortSel">${[["note","Mieux notés"],["avis","Plus d'avis"],["prix","Prix croissant"],["dispo","Plus de créneaux"],["new","Nouveautés"]].map(([v,l])=>`<option value="${v}" ${v===st.sort?"selected":""}>${l}</option>`).join("")}</select></div>
      </div>
      <div class="chips" id="activeChips" style="margin-bottom:12px"></div>
      <div id="results"></div>
    </div>
  </div>`;
  bindSearch($("#main"));
  const fs={types:st.types,budgets:st.budgets,cuis:st.cuis,tags:st.tags};
  $("#main").querySelectorAll("[data-f]").forEach(b=>b.onclick=()=>{const s=fs[b.dataset.f];const k=b.dataset.f==="budgets"?+b.dataset.k:b.dataset.k;s.has(k)?s.delete(k):s.add(k);b.setAttribute("aria-pressed",s.has(k));renderExplorerResults()});
  $("#fOpen").onclick=e=>{st.openNow=!st.openNow;e.currentTarget.setAttribute("aria-pressed",st.openNow);renderExplorerResults()};
  $("#fOrder").onclick=e=>{st.orderOnly=!st.orderOnly;e.currentTarget.setAttribute("aria-pressed",st.orderOnly);renderExplorerResults()};
  $("#fReset").onclick=()=>{["types","budgets","cuis","tags"].forEach(k=>st[k].clear());st.openNow=false;st.orderOnly=false;st.q="";st.quartier=null;renderExplorer()};
  $("#sortSel").onchange=e=>{st.sort=e.target.value;renderExplorerResults()};
  $("#main").querySelectorAll("[data-v]").forEach(b=>b.onclick=()=>{st.view=b.dataset.v;$("#main").querySelectorAll("[data-v]").forEach(x=>x.setAttribute("aria-pressed",x===b));renderExplorerResults()});
  renderExplorerResults();
}
function renderExplorerResults(){
  const list=filtered();const where=st.quartier?st.quartier+", "+st.commune:st.commune||"Abidjan";
  $("#resTitle").textContent=`${list.length} adresse${list.length>1?"s":""} à ${where}`;
  const act=[];if(st.commune)act.push(["commune",st.commune]);if(st.quartier)act.push(["quartier",st.quartier]);if(st.q)act.push(["q","« "+st.q+" »"]);
  act.push(["info",longDate(st.date)+" · "+hm(st.time)+" · "+st.pers+" pers."]);
  $("#activeChips").innerHTML=act.map(([k,l])=>k==="info"?`<span class="pill info">${l}</span>`:`<button class="chip" data-rm="${k}" aria-label="Retirer ${esc(l)}">${esc(l)} ×</button>`).join("");
  $("#activeChips").querySelectorAll("[data-rm]").forEach(b=>b.onclick=()=>{const k=b.dataset.rm;if(k==="commune"){st.commune=null;st.quartier=null}else if(k==="quartier")st.quartier=null;else st.q="";save();renderLoc();renderExplorer()});
  const box=$("#results");
  if(!list.length){box.innerHTML=`<div class="empty">Aucune table ne correspond. Retire un filtre ou passe à « Tout Abidjan ».<br><br><button class="btn ghost sm" id="emptyAll">Voir tout Abidjan</button></div>`;$("#emptyAll").onclick=()=>{st.commune=null;st.quartier=null;["types","budgets","cuis","tags"].forEach(k=>st[k].clear());st.openNow=false;st.q="";save();renderLoc();renderExplorer()};return}
  if(st.view==="liste"){box.innerHTML=`<div class="grid">${list.map(r=>card(r)).join("")}</div>`;return}
  box.innerHTML=`<div class="mapbox"><div class="gmap" id="gmapList">${mapSvg(list)}</div></div><p class="small muted" id="mapNote" style="margin-top:6px">Plan schématique des communes. Touche une commune pour filtrer.</p><div class="map-list">${list.map(r=>`<div class="map-item" data-rid="${r.id}" tabindex="0"><i style="${coverBg(r)}"></i><div style="min-width:0"><b>${esc(r.n)}</b><div class="meta"><span class="stars">★ ${noteTxt(r)}</span><span>${r.q}, ${r.c}</span></div></div></div>`).join("")}</div>`;
  const lierPlan=()=>box.querySelectorAll("[data-mapc]").forEach(g=>{g.onclick=()=>{st.commune=g.dataset.mapc;st.quartier=null;save();renderLoc();renderExplorerResults()};g.onkeydown=e=>{if(e.key==="Enter")g.onclick()}});
  lierPlan();monterCarte($("#gmapList"),list,ok=>{const n=$("#mapNote");if(ok){if(n)n.textContent="Touche un repère pour voir le restaurant. Sans adresse exacte, sa position est approximative."}else{if(n)n.textContent="Plan schématique des communes. Touche une commune pour filtrer.";lierPlan()}});
}
/* ---------- GOOGLE MAPS ----------
   Le plan schématique reste affiché tant que la carte n'est pas prête, et revient si Google refuse la clé. */
let mapsPromise=null,mapsKO=false;const mapsReplis=[];
function chargerMaps(){
  if(window.google&&google.maps&&google.maps.Map&&google.maps.Marker)return Promise.resolve();
  if(!MAPS_KEY||mapsKO)return Promise.reject(new Error("Carte indisponible"));
  if(mapsPromise)return mapsPromise;
  window.gm_authFailure=()=>{mapsKO=true;mapsReplis.splice(0).forEach(f=>f())};
  mapsPromise=new Promise((ok,ko)=>{window.__tabloMaps=()=>Promise.all(["maps","marker","geocoding"].map(l=>google.maps.importLibrary(l))).then(()=>ok(),ko);
    const s=document.createElement("script");s.src="https://maps.googleapis.com/maps/api/js?key="+encodeURIComponent(MAPS_KEY)+"&loading=async&callback=__tabloMaps&language=fr&region=CI";s.async=true;s.onerror=()=>{mapsKO=true;ko(new Error("Carte indisponible"))};document.head.append(s)});
  return mapsPromise}
/* Position enregistrée par le gérant, sinon point approximatif dans la commune (toujours le même pour un restaurant) */
function posOf(r){if(r.lat!=null&&r.lng!=null)return{lat:+r.lat,lng:+r.lng,exact:true};const g=GPS[r.c]||[5.34,-4.02];let h=0;for(const ch of String(r.id))h=(h*31+ch.charCodeAt(0))>>>0;
  return{lat:g[0]+((h%100)/100-.5)*.014,lng:g[1]+(((h>>8)%100)/100-.5)*.014,exact:false}}
const mapOpts=o=>({mapTypeControl:false,streetViewControl:false,fullscreenControl:false,...o});
function monterCarte(el,list,apres){if(!el||!list.length)return;
  chargerMaps().then(()=>{if(!el.isConnected||mapsKO)return;const svg=el.innerHTML;el.innerHTML="";el.classList.add("gmap-on");
    mapsReplis.push(()=>{if(!el.isConnected)return;el.classList.remove("gmap-on");el.innerHTML=svg;if(apres)apres(false)});
    const pts=list.map(r=>({r,p:posOf(r)})),map=new google.maps.Map(el,mapOpts({center:pts[0].p,zoom:pts[0].p.exact?16:14})),info=new google.maps.InfoWindow();
    const bornes=new google.maps.LatLngBounds();
    pts.forEach(({r,p})=>{const pos={lat:p.lat,lng:p.lng},m=new google.maps.Marker({position:pos,map,title:r.n});bornes.extend(pos);
      m.addListener("click",()=>{const d=document.createElement("div");d.className="gmap-info";const b=document.createElement("b");b.textContent=r.n;const q=document.createElement("div");q.textContent=r.q+", "+r.c+(p.exact?"":" · position approximative");const a=document.createElement("a");a.href="#r-"+r.id;a.textContent="Voir la fiche";d.append(b,q,a);info.setContent(d);info.open({map,anchor:m})})});
    if(pts.length>1)map.fitBounds(bornes,48);if(apres)apres(true)}).catch(()=>{})}
function bindPosition(){const box=$("#posEd");if(!box)return;
  chargerMaps().then(()=>{if(!box.isConnected||mapsKO)return;box.hidden=false;mapsReplis.push(()=>{box.hidden=true});
    const la=$("#f_lat"),ln=$("#f_lng"),info=$("#posInfo"),g=GPS[$("#f_c").value]||[5.34,-4.02],a=la.value!=="",c=a?{lat:+la.value,lng:+ln.value}:{lat:g[0],lng:g[1]};
    const map=new google.maps.Map($("#posMap"),mapOpts({center:c,zoom:a?16:13})),mk=new google.maps.Marker({position:c,map,draggable:true,visible:a});
    const dire=t=>{info.textContent=t};
    const poser=(lat,lng,zoom)=>{if(!(lat>=4.9&&lat<=5.8&&lng>=-4.6&&lng<=-3.4))return dire("Cette position est hors du Grand Abidjan.");la.value=lat.toFixed(6);ln.value=lng.toFixed(6);const p={lat,lng};mk.setPosition(p);mk.setVisible(true);map.panTo(p);if(zoom)map.setZoom(zoom);dire("Position choisie. Pense à enregistrer ta fiche.")};
    map.addListener("click",e=>poser(e.latLng.lat(),e.latLng.lng()));mk.addListener("dragend",()=>{const p=mk.getPosition();poser(p.lat(),p.lng())});
    $("#posMe").onclick=()=>{if(!navigator.geolocation)return dire("Ton navigateur ne donne pas ta position.");dire("Recherche de ta position…");navigator.geolocation.getCurrentPosition(x=>poser(x.coords.latitude,x.coords.longitude,17),()=>dire("Position refusée ou introuvable. Clique plutôt sur la carte."),{enableHighAccuracy:true,timeout:10000})};
    const chercher=()=>{const t=$("#posQ").value.trim();if(!t)return;dire("Recherche…");new google.maps.Geocoder().geocode({address:t+", "+$("#f_c").value+", Abidjan, Côte d'Ivoire"}).then(r=>{const l=r.results[0].geometry.location;poser(l.lat(),l.lng(),17)}).catch(()=>dire("Lieu introuvable. Clique plutôt sur la carte."))};
    $("#posGo").onclick=chercher;$("#posQ").onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();chercher()}}}).catch(()=>{})}
function mapSvg(list,focus){
  const cnt={};list.forEach(r=>cnt[r.c]=(cnt[r.c]||0)+1);
  return `<svg viewBox="0 0 860 520" role="img" aria-label="Plan schématique d'Abidjan">
    <rect x="0" y="0" width="860" height="520" fill="var(--land)"/>
    <path d="M0 290 C120 270 200 300 280 280 C330 268 330 215 400 210 C450 206 470 255 520 262 C600 272 640 240 720 262 C780 280 820 300 860 300 L860 380 C780 370 700 395 620 388 C540 382 480 395 420 385 C350 372 300 400 220 380 C140 360 60 375 0 370 Z" fill="var(--water)"/>
    <path d="M0 480 C200 470 400 500 600 485 C700 478 780 490 860 482 L860 520 L0 520Z" fill="var(--water)"/>
    <text x="70" y="335" font-size="13" fill="var(--muted)" font-style="italic">Lagune Ébrié</text>
    <text x="620" y="510" font-size="13" fill="var(--muted)" font-style="italic">Océan Atlantique</text>
    ${CN.map(c=>{const p=COMMUNES[c],n=cnt[c]||0,on=focus?c===focus:st.commune===c;const rad=n?20+n*4:12;
      return `<g data-mapc="${c}" tabindex="0" role="button" aria-label="${c}, ${n} adresses" style="cursor:pointer">
        <circle cx="${p.x}" cy="${p.y}" r="${rad}" fill="${n?"var(--orange)":"var(--surface)"}" fill-opacity="${n?(on?1:.85):1}" stroke="${on?"var(--fg)":"var(--line)"}" stroke-width="${on?3:1.5}"/>
        ${n?`<text x="${p.x}" y="${p.y+5}" text-anchor="middle" font-size="15" font-weight="700" fill="#fff">${n}</text>`:""}
        <text x="${p.x}" y="${p.y+rad+16}" text-anchor="middle" font-size="13" font-weight="600" fill="var(--fg)">${c}</text></g>`}).join("")}
  </svg>`;
}

/* ---------- VIEW: FICHE RESTO ---------- */
function renderResto(id){
  const r=byId(id);if(!r){location.hash="explorer";return}
  const revs=reviewsFor(r),sub=subAvg(revs),menu=MENUS[r.m],exps=EXPS.filter(e=>e.rid===r.id);
  const dist=[5,4,3,2,1].map(s=>revs.filter(v=>Math.round(v.sc.reduce((a,b)=>a+b)/4)===s).length);
  const similar=R.filter(x=>x.id!==r.id&&(x.c===r.c||x.cu===r.cu)).slice(0,6);
  const canReview=resas.some(x=>x.rid===r.id&&x.status==="honorée");
  $("#main").innerHTML=`
  <div class="r-hero" style="${coverBg(r)}"><div class="wrap"><button class="back" id="backBtn">← Retour</button>
    <button class="fav" style="top:14px;right:max(16px,env(safe-area-inset-right,0px))" data-fav="${r.id}" aria-pressed="${favs.has(r.id)}" aria-label="Favori">${heart}</button></div></div>
  <div class="wrap r-layout">
    <div style="min-width:0">
      <div class="r-head"><div class="row"><span class="pill info">${r.t}</span>${r.nouv?`<span class="pill warn">Nouveau</span>`:""}</div>
        <h1>${esc(r.n)}</h1>
        <div class="meta" style="font-size:14px"><span class="stars">★ ${noteTxt(r)}</span><span class="num">${(r.avis||0).toLocaleString("fr-FR")} avis</span><span>${price(r.b)} · ${F(BUD_AVG[r.b])} en moyenne</span><span>${r.cu}</span><span>${r.q}, ${r.c}</span></div></div>
      <div class="r-nav"><div class="tablist">${["Aperçu","Expériences","Menu","Photos","Avis","Accès"].filter(x=>x!=="Expériences"||exps.length).map((x,i)=>`<button data-jump="s-${i}-${x}" aria-selected="${i===0}">${x}</button>`).join("")}</div></div>
      <div class="r-sec" data-sec="Aperçu"><h2>À propos</h2><p style="margin-bottom:12px">${r.d}</p>
        <div class="chips" style="margin-bottom:14px">${r.tags.map(t=>`<span class="dish">${t}</span>`).join("")}</div>
        <dl class="kv"><dt>Horaires</dt><dd>${horairesTxt(r)}</dd><dt>Cuisine</dt><dd>${r.cu}</dd>${r.demo||r.tags.includes("Wave / OM")?`<dt>Paiement</dt><dd>${r.demo?"Espèces, carte":""}${r.tags.includes("Wave / OM")?(r.demo?", ":"")+"Wave, Orange Money, MTN MoMo":""}</dd>`:""}${sansResa(r)?"":`<dt>Capacité</dt><dd>${r.tables} tables · en ligne jusqu'à ${Math.min(SLOTS.maxPers(r),SLOTS.salle(r).reduce((s,t)=>s+t.cap,0))} pers.</dd>`}${r.demo?`<dt>Tenue</dt><dd>${r.b>=4?"Élégante":"Décontractée"}</dd>`:""}</dl></div>
      ${exps.length?`<div class="r-sec" data-sec="Expériences"><h2>Expériences</h2><div class="grid">${exps.map(e=>`<div class="exp" style="cursor:default"><span class="when">${e.w}</span><h3>${e.t}</h3><p class="muted small">${e.d}</p><div class="row" style="justify-content:space-between;margin-top:auto"><b>${e.p?F(e.p)+" / pers.":"Entrée libre"}</b><button class="btn sm" data-expbook="${e.id}">Réserver</button></div></div>`).join("")}</div></div>`:""}
      <div class="r-sec" data-sec="Menu"><h2>Menu</h2><p class="muted small" style="margin-bottom:12px">Prix en FCFA, mis à jour par le restaurant. ${sansResa(r)?"Commande-les à emporter ou en livraison.":canOrder(r)?"Commande-les à emporter ou en livraison, ou pré-commande-les en réservant.":"Tu peux pré-commander ces plats en réservant."}</p>
        <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">${Object.entries(menu).map(([cat,items])=>`<div class="menu-cat"><h3>${cat}</h3>${items.map(([n,p,d])=>`<div class="menu-item"><span>${n}${d?`<small>${d}</small>`:""}</span><b class="num">${p?F(p):"Offert"}</b></div>`).join("")}</div>`).join("")}</div></div>
      ${offresHtml(offres.filter(o=>o.rid===r.id),"Anti-gaspi ce soir","Plats restants à -40 %, à retirer et payer sur place.",true)}
      <div class="r-sec" data-sec="Photos"><h2>Photos</h2>${r.photos&&r.photos.length?`<div class="photos">${r.photos.map(id=>`<div style="background:center/cover no-repeat url(/api/photos/${+id})"></div>`).join("")}</div>`:r.demo?`<div class="photos">${["Salle","Terrasse","Plat signature","Bar","Équipe","Dessert","Vue","Cuisine"].map((p,i)=>`<div style="${coverBg(r,"ph"+i)}">${p}</div>`).join("")}</div>`:`<p class="muted">Pas encore de photos.</p>`}</div>
      <div class="r-sec" data-sec="Avis"><h2>Ce que disent ${(r.avis||0).toLocaleString("fr-FR")} clients</h2>
        <div class="rating-sum"><div><div class="big-note num">${noteTxt(r)}</div><div class="stars">★★★★★</div><div class="small muted">Avis de clients venus avec Tablô</div></div>
          <div style="display:flex;flex-direction:column;gap:6px">${sub.map((v,i)=>`<div class="subr"><span>${SUBL[i]}</span><div class="bar"><i style="width:${v/5*100}%"></i></div><b class="num">${v.toFixed(1)}</b></div>`).join("")}
          <div class="small muted" style="margin-top:4px">${dist.map((n,i)=>`${5-i}★ ${n}`).join(" · ")} sur les ${revs.length} derniers avis</div></div></div>
        ${canReview?`<button class="btn ghost sm" id="writeRev">Laisser un avis (+30 pts)</button>`:`<p class="small muted">Tu pourras noter ce restaurant après une visite réservée sur Tablô.</p>`}
        <div>${revs.map(v=>{const [a]=HUES[hash(v.nom)%HUES.length];return `<div class="review"><div class="who"><span class="avatar" style="background:${a}">${v.nom[0]}</span><div><b>${esc(v.nom)}</b><div class="small muted">${v.visits} visite${v.visits>1?"s":""} · ${new Date(v.date+"T12:00").toLocaleDateString("fr-FR",{day:"numeric",month:"long"})}</div></div><span class="stars" style="margin-left:auto">★ ${(v.sc.reduce((x,y)=>x+y)/4).toFixed(1)}</span></div>
          <div class="small muted">${v.sc.map((x,i)=>SUBL[i]+" "+x).join(" · ")}</div><p>${esc(v.txt)}</p>${v.reply?`<div class="reply"><b>Réponse du restaurant :</b> ${esc(v.reply)}</div>`:""}</div>`}).join("")}</div></div>
      <div class="r-sec" data-sec="Accès" style="border:0"><h2>Accès</h2><p style="margin-bottom:10px">${r.q}, ${r.c}, Abidjan${r.tags.includes("Parking")?" · Parking sur place":""}</p>
        <div class="minimap"><div class="gmap" id="gmapFiche" data-r="${esc(r.id)}">${mapSvg([r],r.c)}</div></div>
        <p class="small" style="margin-top:8px"><a href="${posOf(r).exact?"https://www.google.com/maps/dir/?api=1&destination="+posOf(r).lat+","+posOf(r).lng:"https://www.google.com/maps/search/"+encodeURIComponent(r.q+" "+r.c+" Abidjan")}" target="_blank" rel="noopener">Ouvrir l'itinéraire dans Google Maps</a> · Taxi, Yango ou gbaka : indique « ${r.q}, ${r.c} ».</p></div>
      ${similar.length?`<section class="block" style="padding-top:24px"><div class="sec-head"><h2>Tu aimeras aussi</h2></div><div class="rail">${similar.map(x=>card(x,{noSlots:true})).join("")}</div></section>`:""}
    </div>
    <aside class="widget" id="widget"></aside>
  </div>`;
  renderWidget(r);
  $("#backBtn").onclick=()=>history.length>1?history.back():(location.hash="explorer");
  $("#main").querySelectorAll("[data-jump]").forEach(b=>b.onclick=()=>{const name=b.dataset.jump.split("-").slice(2).join("-");const s=$(`[data-sec="${name}"]`);if(s)window.scrollTo({top:s.getBoundingClientRect().top+scrollY-130,behavior:"smooth"});$("#main").querySelectorAll("[data-jump]").forEach(x=>x.setAttribute("aria-selected",x===b))});
  const wr=$("#writeRev");if(wr)wr.onclick=()=>openReview(r);
  $("#main").querySelectorAll("[data-expbook]").forEach(b=>b.onclick=()=>{const e=EXPS.find(x=>x.id===b.dataset.expbook);openBooking(r,null,{exp:e})});
}
function renderWidget(r){
  const w=$("#widget");if(!w)return;
  const s=slotsFor(r);const any=s.some(x=>x.free);
  let times="";for(let m=7*60;m<=23*60+30;m+=30){const t=String(Math.floor(m/60)).padStart(2,"0")+":"+String(m%60).padStart(2,"0");times+=`<option value="${t}" ${t===st.time?"selected":""}>${hm(t)}</option>`}
  const hasAlert=alerts.some(a=>a.rid===r.id&&a.date===st.date&&a.time===st.time);
  const co=r.commande||{};
  if(sansResa(r)){w.innerHTML=`<div class="order-cta solo"><h3>Commander</h3><p class="small muted">${[co.emporter&&"À emporter",co.livraison&&"En livraison"].filter(Boolean).join(" ou ")} · prêt en ${+co.delai||30} min environ</p><button class="btn" data-order="${r.id}">Voir la carte et commander</button><p class="small muted">Horaires : ${horairesTxt(r)}. Pas de réservation de table.</p></div>`;return}
  w.innerHTML=`${canOrder(r)?`<div class="order-cta"><h3>Commander</h3><p class="small muted">${[co.emporter&&"À emporter",co.livraison&&"En livraison"].filter(Boolean).join(" ou ")} · prêt en ${+co.delai||30} min environ</p><button class="btn" data-order="${r.id}">Voir la carte et commander</button></div>`:""}<h3>Réserver une table</h3>
    <div class="wf"><div class="field"><label for="wDate">Date</label><input type="date" id="wDate" value="${st.date}" min="${iso(today)}"></div>
      <div class="field"><label for="wTime">Heure</label><select id="wTime">${times}</select></div>
      <div class="field"><label for="wPers">Personnes</label><select id="wPers">${Array.from({length:30},(_,i)=>`<option ${i+1==st.pers?"selected":""} value="${i+1}">${i+1}</option>`).join("")}</select></div></div>
    ${isOpenAt(r,st.time)?"":`<p class="small" style="color:var(--warn);font-weight:600">Le restaurant est fermé à ${hm(st.time)}. Horaires : ${horairesTxt(r)}.</p>`}
    <div><b class="small muted">CRÉNEAUX DISPONIBLES</b><div class="slots">${s.map(x=>`<button class="slot ${x.free?"":"off"}" ${x.free?"":"disabled"} data-book="${r.id}" data-t="${x.t}">${hm(x.t)}</button>`).join("")}</div></div>
    ${any?"":`<div class="notify"><b>Complet sur ce créneau</b><span class="muted">On te prévient dès qu'une table se libère.</span></div>`}
    <button class="btn ghost sm" id="notifyBtn" ${hasAlert?"disabled":""}>${hasAlert?"Alerte activée":"Me prévenir si une table se libère à "+hm(st.time)}</button>
    ${r.demo?`<p class="small muted trend num">Réservé ${6+hash(r.id+st.date)%42} fois aujourd'hui</p>`:""}
    ${st.pers>12?`<div class="notify"><b>Groupe de ${st.pers} personnes</b><span class="muted">Fais plutôt une demande de privatisation.</span><button class="btn green sm" data-private="${r.id}">Demander un devis</button></div>`:""}`;
  $("#wDate").onchange=e=>{st.date=e.target.value||iso(today);renderWidget(r)};
  $("#wTime").onchange=e=>{st.time=e.target.value;renderWidget(r)};
  $("#wPers").onchange=e=>{st.pers=+e.target.value;renderWidget(r)};
  $("#notifyBtn").onclick=()=>{if(!user)return needLogin("Connecte-toi pour être prévenu");alerts.push({id:Date.now()+"",rid:r.id,date:st.date,time:st.time,pers:st.pers});save();toast("Alerte activée. Retrouve-la dans Mon compte.");renderWidget(r)};
}

/* ---------- BOOKING FLOW ---------- */
const dlg=$("#dlg"),inner=$("#dlgInner");
function openDlg(title,body){inner.innerHTML=`<div class="d-head"><h2>${title}</h2><button class="x" aria-label="Fermer" data-close>×</button></div><div class="d-body">${body}</div>`;inner.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>dlg.close());if(!dlg.open)dlg.showModal()}
dlg.addEventListener("click",e=>{if(e.target===dlg)dlg.close()});
/* ---------- COMMANDE À EMPORTER / EN LIVRAISON ---------- */
function openOrder(r){
  if(!r||!canOrder(r))return;if(!user)return needLogin("Connecte-toi pour commander");
  const c=r.commande,O={mode:c.emporter?"emporter":"livraison",q:{}},liste=Object.entries(MENUS[r.m]||{}).map(([cat,items])=>[cat,items.filter(x=>x[1]>0)]).filter(x=>x[1].length),plats=liste.flatMap(x=>x[1]);
  const n=new Date(),ouvert=!!SLOTS.serviceA(r,iso(n),String(n.getHours()).padStart(2,"0")+":"+String(n.getMinutes()).padStart(2,"0"));
  openDlg("Commander · "+esc(r.n),`${r.demo?`<p class="order-note">Établissement d'exemple : cette commande sert à tester, personne ne la préparera.</p>`:""}
    ${ouvert?"":`<p class="order-note warn">Fermé pour le moment. Horaires : ${horairesTxt(r)}.</p>`}
    ${c.emporter&&c.livraison?`<div class="pay"><label><input type="radio" name="oMode" value="emporter" checked> À emporter</label><label><input type="radio" name="oMode" value="livraison"> En livraison (${F(+c.frais||0)})</label></div>`:`<p class="small"><b>${c.emporter?"À emporter uniquement":"En livraison uniquement"}</b></p>`}
    <div class="order-menu">${liste.map(([cat,items])=>`<h3>${esc(cat)}</h3>${items.map(it=>{const i=plats.indexOf(it);return `<div class="order-item"><span>${esc(it[0])}${it[2]?`<small>${esc(it[2])}</small>`:""}<b class="num">${F(it[1])}</b></span><span class="qty"><button type="button" data-om="${i}" aria-label="Retirer ${esc(it[0])}">−</button><b class="num" id="oq${i}">0</b><button type="button" data-op="${i}" aria-label="Ajouter ${esc(it[0])}">+</button></span></div>`}).join("")}`).join("")}</div>
    <div class="form"><label>Nom<input id="oNom" maxlength="80" value="${esc(user.nom||"")}"></label><label>Téléphone<input id="oTel" inputmode="tel" value="${esc(user.tel||"")}" placeholder="07 12 34 56 78"></label>
      <label class="full" id="oAdrL" ${O.mode==="livraison"?"":"hidden"}>Adresse de livraison<input id="oAdr" maxlength="200" placeholder="Quartier, rue, repère"></label>
      <label class="full">Note pour le restaurant (facultatif)<input id="oNote" maxlength="300" placeholder="Sans piment, sonner deux fois…"></label></div>
    <div class="order-sum num" id="oSum"></div><p class="err" id="oErr" role="alert" hidden></p>
    <button class="btn" id="oGo" disabled>Envoyer la commande</button>`);
  const maj=()=>{const sous=plats.reduce((s,it,i)=>s+it[1]*(O.q[i]||0),0),frais=O.mode==="livraison"?(+c.frais||0):0,min=+c.min||0,manque=sous>0&&sous<min;
    $("#oSum").innerHTML=`<span>Sous-total</span><b>${F(sous)}</b>${frais?`<span>Livraison</span><b>${F(frais)}</b>`:""}<span class="tot">Total à payer ${O.mode==="livraison"?"à la livraison":"au retrait"}</span><b class="tot">${F(sous?sous+frais:0)}</b>${manque?`<span class="min">Minimum de commande : ${F(min)}</span>`:""}`;
    $("#oGo").disabled=!ouvert||!sous||manque};
  inner.querySelectorAll("[data-op],[data-om]").forEach(b=>b.onclick=()=>{const i=+(b.dataset.op??b.dataset.om);O.q[i]=Math.max(0,Math.min(50,(O.q[i]||0)+(b.dataset.op!==undefined?1:-1)));$("#oq"+i).textContent=O.q[i];maj()});
  inner.querySelectorAll('[name="oMode"]').forEach(x=>x.onchange=()=>{O.mode=x.value;$("#oAdrL").hidden=O.mode!=="livraison";maj()});
  $("#oGo").onclick=()=>{const go=$("#oGo"),er=$("#oErr");er.hidden=true;go.disabled=true;
    api("POST","/api/commandes",{rid:r.id,mode:O.mode,items:plats.map((it,i)=>({n:it[0],q:O.q[i]||0})).filter(x=>x.q),nom:$("#oNom").value,tel:$("#oTel").value,adresse:$("#oAdr").value,note:$("#oNote").value}).then(d=>{applyMe(d);renderHeader();const x=d.commande;
      openDlg("Commande envoyée",`<div class="confirm"><h2>C'est envoyé !</h2><p>${esc(r.n)} a reçu ta commande. ${F(x.total)} à payer ${x.mode==="livraison"?"à la livraison":"au retrait"}.</p><div class="code num">${esc(x.code)}</div><p class="small muted">Prête en ${+c.delai||30} min environ. Suis-la dans Mon compte, onglet Commandes.</p><button class="btn ghost" data-close>Fermer</button></div>`);if(view()==="compte")renderAccount()})
      .catch(e=>{er.textContent=e.message;er.hidden=false;go.disabled=false;if(e.status===401)needLogin()})};
  maj();
}
function openBooking(r,time,extra={}){
  if(!user)return needLogin("Connecte-toi pour réserver une table");
  const B={r,date:st.date,time:time||(slotsFor(r).find(s=>s.free)||{}).t,pers:st.pers,pre:{},exp:extra.exp||null,step:1,
    nom:user?user.nom:"",tel:user?user.tel:"",other:false,gnom:"",gtel:"",occ:"",note:"",pay:"Sur place",edit:extra.edit||null};
  if(B.edit){Object.assign(B,{date:B.edit.date,time:B.edit.time,pers:B.edit.pers,nom:B.edit.nom,tel:B.edit.tel,occ:B.edit.occ||"",note:B.edit.note||"",pay:B.edit.pay});(B.edit.pre||[]).forEach(p=>B.pre[p.n]=p.q)}
  if(B.exp&&!B.time){B.time=B.exp.w.match(/(\d+)h(\d+)?/)?String(B.exp.w.match(/(\d+)h/)[1]).padStart(2,"0")+":"+(B.exp.w.match(/h(\d+)/)?.[1]||"00"):"20:00"}
  stepRender(B);
}
function preTotal(B){let t=0;Object.entries(B.pre).forEach(([n,q])=>{const it=Object.values(MENUS[B.r.m]).flat().find(x=>x[0]===n);if(it)t+=it[1]*q});return t}
function stepRender(B){
  curB=B;
  const r=B.r;const steps=["Créneau","Tes infos","Pré-commande","Confirmation"];
  const head=`<div class="steps">${steps.map((s,i)=>`<span class="${i<B.step?"on":""}">${i+1}. ${s}</span>`).join("")}</div>
   <div class="recap"><i style="${coverBg(r)}"></i><div><b>${esc(r.n)}</b>${B.exp?` · ${B.exp.t}`:""}<div class="small muted">${longDate(B.date)} · ${B.time?hm(B.time):"—"} · ${B.pers} pers. · ${r.q}, ${r.c}</div></div></div>`;
  let body="";
  if(B.step===1){const s=slotsFor(r,B.date,B.time||st.time,B.pers,B.edit);
    body=`<div class="form"><label>Date<input type="date" id="bDate" value="${B.date}" min="${iso(today)}"></label>
      <label>Personnes<select id="bPers">${Array.from({length:30},(_,i)=>`<option value="${i+1}" ${i+1==B.pers?"selected":""}>${i+1}</option>`).join("")}</select></label>
      ${B.pers>SLOTS.maxPers(r)?`<p class="full small err">Réservation en ligne jusqu'à ${SLOTS.maxPers(r)} personnes. Pour un groupe plus grand, appelle le restaurant${r.tel?" au "+esc(r.tel):""}.</p>`:""}<div class="full"><b class="small muted">CRÉNEAU</b><div class="slots" id="bSlots">${s.map(x=>`<button type="button" class="slot ${x.free?"":"off"}" ${x.free?"":"disabled"} data-t="${x.t}" aria-pressed="${x.t===B.time}">${hm(x.t)}</button>`).join("")}</div></div>
      <label class="full">Occasion<select id="bOcc">${["","Anniversaire","Rendez-vous galant","Repas d'affaires","Famille","Entre amis","Célébration"].map(o=>`<option ${o===B.occ?"selected":""} value="${o}">${o||"Aucune en particulier"}</option>`).join("")}</select></label></div>
      <p class="err" id="bErr" hidden></p><button class="btn" id="next">Continuer</button>`}
  if(B.step===2){body=`<div class="form">
      <label>Ton nom<input id="bNom" autocomplete="name" value="${esc(B.nom)}" placeholder="Ex. Aya Koné"></label>
      <label>Téléphone<input id="bTel" inputmode="tel" value="${esc(B.tel)}" placeholder="07 12 34 56 78"></label>
      <label class="check full"><input type="checkbox" id="bOther" ${B.other?"checked":""}> Je réserve pour quelqu'un d'autre</label>
      <div class="full form" id="otherBox" ${B.other?"":"hidden"} style="grid-template-columns:1fr 1fr"><label>Nom de l'invité<input id="bGnom" value="${esc(B.gnom)}"></label><label>Téléphone de l'invité<input id="bGtel" inputmode="tel" value="${esc(B.gtel)}"></label></div>
      <label class="full">Demande spéciale<textarea id="bNote" rows="2" placeholder="Chaise bébé, table en terrasse, gâteau d'anniversaire…">${esc(B.note)}</textarea></label></div>
      ${user?"":`<p class="small muted">Astuce : connecte-toi pour remplir ces champs automatiquement et cumuler tes points.</p>`}
      <p class="err" id="bErr" hidden></p><div class="row"><button class="btn ghost" id="prev">Retour</button><button class="btn" id="next" style="flex:1">Continuer</button></div>`}
  if(B.step===3){const items=Object.entries(MENUS[r.m]).filter(([c])=>!/boisson|cocktail|extra/i.test(c)||true);
    body=`<p class="small muted">Optionnel. Choisis tes plats maintenant : la cuisine les lance dès que tu t'installes. Tu paies sur place.</p>
      <div>${items.map(([cat,list])=>`<div class="menu-cat"><h3>${cat}</h3>${list.map(([n,p])=>`<div class="menu-item"><span>${n}<small class="num">${p?F(p):"Offert"}</small></span><span class="qty"><button type="button" data-dec="${esc(n)}" aria-label="Retirer">−</button><b class="num" style="min-width:16px;text-align:center">${B.pre[n]||0}</b><button type="button" data-inc="${esc(n)}" aria-label="Ajouter">+</button></span></div>`).join("")}</div>`).join("")}</div>
      <div class="recap" style="justify-content:space-between"><b>Pré-commande</b><b class="num">${F(preTotal(B))}</b></div>
      <div><b class="small muted">GARANTIE (SIMULÉE)</b><div class="pay" style="margin-top:6px">${["Sur place","Wave","Orange Money","MTN MoMo"].map(p=>`<label><input type="radio" name="pay" value="${p}" ${p===B.pay?"checked":""}> ${p}</label>`).join("")}</div>
      <p class="small muted" style="margin-top:6px">${B.exp&&B.exp.p?`Expérience : acompte de ${F(B.exp.p*B.pers*0.3)} (30 %).`:"Aucun prélèvement. La garantie limite les no-shows."}</p></div>
      ${redeemed.filter(x=>!x.used).length?`<label class="check small" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="useReward"> Utiliser ma récompense : ${redeemed.find(x=>!x.used).l}</label>`:""}
      <div class="row"><button class="btn ghost" id="prev">Retour</button><button class="btn" id="next" style="flex:1">${B.edit?"Enregistrer les modifications":"Confirmer la table"}</button></div>`}
  openDlg(B.edit?"Modifier ma réservation":"Réserver",head+body);
  const err=m=>{const e=$("#bErr");e.textContent=m;e.hidden=false};
  const prev=$("#prev");if(prev)prev.onclick=()=>{collect(B);B.step--;stepRender(B)};
  if(B.step===1){
    $("#bDate").onchange=e=>{B.date=e.target.value||iso(today);B.time=null;stepRender(B)};
    $("#bPers").onchange=e=>{B.pers=+e.target.value;stepRender(B)};
    inner.querySelectorAll("#bSlots .slot:not(.off)").forEach(b=>b.onclick=()=>{B.time=b.dataset.t;inner.querySelectorAll("#bSlots .slot").forEach(x=>x.setAttribute("aria-pressed",x===b));inner.querySelector(".recap .small").textContent=`${longDate(B.date)} · ${hm(B.time)} · ${B.pers} pers. · ${r.q}, ${r.c}`});
    $("#next").onclick=()=>{B.occ=$("#bOcc").value;const ok=slotsFor(r,B.date,B.time||"20:00",B.pers,B.edit).some(s=>s.t===B.time&&s.free);if(!B.time||!ok)return err("Choisis un créneau disponible.");B.step=2;stepRender(B)}}
  if(B.step===2){
    $("#bOther").onchange=e=>{B.other=e.target.checked;$("#otherBox").hidden=!B.other};
    $("#next").onclick=()=>{collect(B);const tel=B.tel.replace(/[\s.-]/g,"");
      if(B.nom.trim().length<2)return err("Indique ton nom pour la réservation.");
      if(!/^(\+?225)?0\d{9}$/.test(tel))return err("Numéro invalide : 10 chiffres commençant par 0, par exemple 07 12 34 56 78.");
      if(B.other&&(B.gnom.trim().length<2||!/^(\+?225)?0\d{9}$/.test(B.gtel.replace(/[\s.-]/g,""))))return err("Indique le nom et un numéro valide pour ton invité.");
      B.step=3;stepRender(B)}}
  if(B.step===3){
    inner.querySelectorAll("[data-inc]").forEach(b=>b.onclick=()=>{collect(B);B.pre[b.dataset.inc]=(B.pre[b.dataset.inc]||0)+1;const y=inner.querySelector(".d-body").scrollTop;stepRender(B);inner.querySelector(".d-body").scrollTop=y});
    inner.querySelectorAll("[data-dec]").forEach(b=>b.onclick=()=>{collect(B);const k=b.dataset.dec;B.pre[k]=Math.max(0,(B.pre[k]||0)-1);if(!B.pre[k])delete B.pre[k];const y=inner.querySelector(".d-body").scrollTop;stepRender(B);inner.querySelector(".d-body").scrollTop=y});
    $("#next").onclick=()=>{collect(B);finish(B)}}
}
function collect(B){const v=id=>{const e=$("#"+id);return e?e.value:null};
  if($("#bNom")){B.nom=v("bNom");B.tel=v("bTel");B.note=v("bNote");B.other=$("#bOther").checked;if(B.other){B.gnom=v("bGnom");B.gtel=v("bGtel")}}
  const p=inner.querySelector("input[name=pay]:checked");if(p)B.pay=p.value}
async function finish(B){
  const pre=Object.entries(B.pre).map(([n,q])=>({n,q}));const useR=!!($("#useReward")&&$("#useReward").checked);
  const nb=$("#next");if(nb){nb.disabled=true;nb.textContent="Envoi…"}
  const payload={rid:B.r.id,rname:B.r.n,date:B.date,time:B.time,pers:B.pers,nom:B.other?B.gnom:B.nom,tel:B.other?B.gtel:B.tel,booker:B.other?B.nom:null,pay:B.pay,note:B.note,occ:B.occ,pre,exp:B.exp?B.exp.t:null,useReward:useR};
  let d;try{d=B.edit?await api("PATCH","/api/reservations/"+B.edit.id,payload):await api("POST","/api/reservations",payload)}
  catch(e){if(nb){nb.disabled=false;nb.textContent=B.edit?"Enregistrer les modifications":"Confirmer la table"}if(e.status===409){delete occ[B.date];B.step=1;B.time=null;stepRender(B)}if(e.status===401){user=null;dlg.close();needLogin("Ta session a expiré, reconnecte-toi")}else toast(e.message);return}
  applyMe(d);renderHeader();delete occ[B.date];
  if(B.edit){dlg.close();toast("Réservation modifiée");rerender();return}
  const code=d.resa.code,rw=d.resa.reward?{l:d.resa.reward}:null;
  inner.querySelector(".d-body").innerHTML=`<div class="confirm"><h2>C'est réservé !</h2>
    <p>${esc(B.r.n)} · ${longDate(B.date)} à ${hm(B.time)} · ${B.pers} pers.${B.other?`<br>Au nom de <b>${esc(B.gnom)}</b>, confirmation envoyée à son numéro (simulation).`:""}</p>
    <div class="code num">${code}</div><p class="small muted">Présente ce code à l'accueil. Tu recevras un rappel par SMS 2 h avant.</p>
    ${pre.length?`<p class="small"><b>Pré-commande transmise en cuisine :</b> ${pre.map(p=>p.q+" × "+p.n).join(", ")} · ${F(preTotal(B))}</p>`:""}
    ${rw?`<p class="small"><b>Récompense appliquée :</b> ${rw.l}</p>`:""}
    <p><b>+50 points</b> maintenant, +100 après ton passage.</p>
    <div class="row" style="justify-content:center"><button class="btn green" id="goMine">Voir mes réservations</button><button class="btn ghost" data-close>Fermer</button></div></div>`;
  inner.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>dlg.close());
  $("#goMine").onclick=()=>{dlg.close();location.hash="compte"};
  if(view()!=="compte")rerender();
}
function openReview(r){
  let sc=[5,5,5,5];
  openDlg("Ton avis sur "+esc(r.n),`<div class="form">${SUBL.map((l,i)=>`<label>${l}<select data-sc="${i}">${[5,4,3,2,1].map(n=>`<option value="${n}">${n} ★</option>`).join("")}</select></label>`).join("")}
    <label class="full">Ton avis<textarea id="rvTxt" rows="3" placeholder="Qu'as-tu pensé du repas, du service, de l'ambiance ?"></textarea></label></div><p class="err" id="bErr" hidden></p><button class="btn" id="rvSend">Publier mon avis</button>`);
  $("#rvSend").onclick=()=>{const t=$("#rvTxt").value.trim();if(t.length<10){const e=$("#bErr");e.textContent="Écris au moins une phrase (10 caractères).";e.hidden=false;return}
    sc=[...inner.querySelectorAll("[data-sc]")].map(s=>+s.value);
    api("POST","/api/reviews",{rid:r.id,sc,txt:t}).then(async d=>{applyMe(d);renderHeader();await loadCatalog();dlg.close();toast("Avis publié, +30 points");rerender()}).catch(e=>{const x=$("#bErr");x.textContent=e.message;x.hidden=false})};
}
function openSignin(){
  if(!user)return openLogin();
  openDlg(user?"Mon profil":"Connexion",`<p class="muted small">Ton profil est enregistré sur ton compte Tablô (serveur).</p>
    <div class="form"><label>Nom complet<input id="uNom" value="${esc(user?user.nom:"")}" placeholder="Aya Koné"></label><label>Téléphone<input id="uTel" inputmode="tel" value="${esc(user?user.tel:"")}" placeholder="07 12 34 56 78"></label>
    <label class="full">Commune préférée<select id="uCom"><option value="">Tout Abidjan</option>${CN.map(c=>`<option ${user&&user.com===c?"selected":""}>${c}</option>`).join("")}</select></label></div>
    <p class="err" id="bErr" hidden></p><div class="row"><button class="btn" id="uSave" style="flex:1">${user?"Enregistrer":"Me connecter"}</button>${user?`<button class="btn ghost" id="uOut">Déconnexion</button>`:""}</div>`);
  $("#uSave").onclick=()=>{const n=$("#uNom").value.trim(),t=$("#uTel").value.replace(/[\s.-]/g,"");
    if(n.length<2||(t&&!/^(\+?225)?0\d{9}$/.test(t))){const e=$("#bErr");e.textContent="Indique ton nom et un numéro à 10 chiffres commençant par 0.";e.hidden=false;return}
    api("PUT","/api/me/profile",{nom:n,tel:$("#uTel").value,com:$("#uCom").value}).then(d=>{applyMe(d);if(user.com){st.commune=user.com;st.quartier=null}save();renderLoc();dlg.close();toast("Profil enregistré");rerender()}).catch(e=>{const x=$("#bErr");x.textContent=e.message;x.hidden=false})};
  const o=$("#uOut");if(o)o.onclick=()=>{dlg.close();logoutUser()};
}
function openPrivate(rid){
  openDlg("Privatisation et événements",`<div class="form">
    <label class="full">Restaurant<select id="pvR">${R.filter(r=>r.tags.includes("Groupe")||r.b>=3).map(r=>`<option value="${r.id}" ${r.id===rid?"selected":""}>${esc(r.n)} · ${r.c}</option>`).join("")}</select></label>
    <label>Date<input type="date" id="pvD" value="${addDays(14)}" min="${iso(today)}"></label><label>Invités<input type="number" id="pvN" min="10" max="300" value="30"></label>
    <label>Type d'événement<select id="pvT"><option>Anniversaire</option><option>Séminaire</option><option>Mariage / dot</option><option>Afterwork</option><option>Baptême</option></select></label>
    <label>Budget / pers.<select id="pvB">${BUDGETS.map(b=>`<option>${b.l}</option>`).join("")}</select></label>
    <label>Ton téléphone<input id="pvTel" inputmode="tel" value="${esc(user?user.tel:"")}"></label>
    <label class="full">Détails<textarea id="pvTxt" rows="2" placeholder="Menu, décoration, sono…"></textarea></label></div>
    <p class="err" id="bErr" hidden></p><button class="btn" id="pvSend">Envoyer la demande</button>`);
  $("#pvSend").onclick=()=>{if(!/^(\+?225)?0\d{9}$/.test($("#pvTel").value.replace(/[\s.-]/g,""))){const e=$("#bErr");e.textContent="Indique un numéro valide pour que le restaurant te rappelle.";e.hidden=false;return}
    const r=byId($("#pvR").value);inner.querySelector(".d-body").innerHTML=`<div class="confirm"><h2>Demande envoyée</h2><p>${esc(r.n)} te répond sous 24h avec un devis pour ${$("#pvN").value} personnes (simulation).</p><button class="btn ghost" data-close>Fermer</button></div>`;inner.querySelector("[data-close]").onclick=()=>dlg.close()};
}
function openGift(){
  openDlg("Offrir une carte cadeau",`<p class="muted small">Valable 12 mois dans tous les restaurants Tablô.</p><div class="chips" id="gAm">${[10000,25000,50000,100000].map((a,i)=>`<button class="chip" data-am="${a}" aria-pressed="${i===1}">${F(a)}</button>`).join("")}</div>
    <div class="form"><label>Pour<input id="gTo" placeholder="Prénom du destinataire"></label><label>Son numéro (SMS / WhatsApp)<input id="gTel" inputmode="tel" placeholder="05 12 34 56 78"></label><label class="full">Message<textarea id="gMsg" rows="2" placeholder="Joyeux anniversaire !"></textarea></label>
    <div class="full pay">${["Wave","Orange Money","MTN MoMo"].map((p,i)=>`<label><input type="radio" name="gpay" ${i?"":"checked"}> ${p}</label>`).join("")}</div></div><p class="err" id="bErr" hidden></p><button class="btn" id="gSend">Payer et envoyer (simulation)</button>`);
  let am=25000;inner.querySelectorAll("[data-am]").forEach(b=>b.onclick=()=>{am=+b.dataset.am;inner.querySelectorAll("[data-am]").forEach(x=>x.setAttribute("aria-pressed",x===b))});
  $("#gSend").onclick=()=>{if($("#gTo").value.trim().length<2||!/^(\+?225)?0\d{9}$/.test($("#gTel").value.replace(/[\s.-]/g,""))){const e=$("#bErr");e.textContent="Indique le prénom et un numéro valide du destinataire.";e.hidden=false;return}
    inner.querySelector(".d-body").innerHTML=`<div class="confirm"><h2>Carte envoyée</h2><div class="code num">${F(am)}</div><p>Code cadeau : <b class="num">CG-${Math.random().toString(36).slice(2,8).toUpperCase()}</b>, envoyé à ${esc($("#gTo").value)} (simulation).</p><button class="btn ghost" data-close>Fermer</button></div>`;inner.querySelector("[data-close]").onclick=()=>dlg.close()};
}

/* ---------- VIEW: COMPTE ---------- */
const REWARDS=[{id:"dessert",l:"Dessert offert",c:500,d:"Dans tous les restaurants partenaires"},{id:"cocktail",l:"Cocktail ou jus offert",c:400,d:"Bissap, gingembre ou cocktail maison"},{id:"r5000",l:"5 000 F de réduction",c:1000,d:"Dès 20 000 F d'addition"},{id:"prio",l:"Table prioritaire le week-end",c:1500,d:"Accès aux créneaux réservés aux membres"}];
const CMD_PILL={"reçue":"warn","en préparation":"info","prête":"ok","en livraison":"info","terminée":"ok","annulée":"bad"};
let accTab="reservations";
function renderAccount(){
  const lvl=pts>=2000?"Or":pts>=800?"Argent":"Bronze",next=pts>=2000?null:pts>=800?2000:800;
  const up=resas.filter(x=>x.status==="confirmée").sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  const past=resas.filter(x=>x.status!=="confirmée").sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time));
  const tabs=[["reservations","Réservations ("+up.length+")"],["commandes","Commandes ("+commandes.filter(x=>!["terminée","annulée"].includes(x.status)).length+")"],["historique","Historique"],["favoris","Favoris ("+favs.size+")"],["alertes","Alertes ("+alerts.length+")"],["fidelite","Fidélité"]];
  $("#main").innerHTML=`<div class="wrap page"><h1>${user?"Bonjour "+esc(user.nom.split(" ")[0]):"Mon compte"}</h1><p class="sub">${user?"Tes tables, tes adresses préférées et tes points.":`Tu n'es pas connecté. <button class="linkbtn" id="accSign">Se connecter</button> pour retrouver tes réservations partout.`}</p>
    <div class="loyal"><div><span class="small muted">Points</span><b class="num">${pts.toLocaleString("fr-FR")}</b><div class="bar"><i style="width:${next?Math.min(100,pts/next*100):100}%"></i></div><span class="small muted">${next?`${(next-pts).toLocaleString("fr-FR")} pts avant le niveau ${lvl==="Bronze"?"Argent":"Or"}`:"Niveau maximum"}</span></div>
      <div><span class="small muted">Niveau</span><b>${lvl}</b><span class="small muted">${lvl==="Bronze"?"Rappels prioritaires":lvl==="Argent"?"Apéritif offert chez les partenaires":"Table prioritaire le week-end"}</span></div>
      <div><span class="small muted">Réservations</span><b class="num">${resas.length}</b><span class="small muted">${past.filter(x=>x.status==="honorée").length} honorée(s)</span></div></div>
    <div class="tablist" role="tablist">${tabs.map(([k,l])=>`<button role="tab" data-acc="${k}" aria-selected="${k===accTab}">${l}</button>`).join("")}</div>
    <div id="accBody"></div></div>`;
  const s=$("#accSign");if(s)s.onclick=()=>openLogin();
  $("#main").querySelectorAll("[data-acc]").forEach(b=>b.onclick=()=>{accTab=b.dataset.acc;renderAccount()});
  const body=$("#accBody");
  const row=x=>{const r=byId(x.rid),d=new Date(x.date+"T12:00");const pill={confirmée:"ok",honorée:"info",annulée:"bad","no-show":"warn"}[x.status];
    return `<div class="resa"><div class="dateb"><span class="num">${d.getDate()}</span><small>${d.toLocaleDateString("fr-FR",{month:"short"})}</small></div>
      <div style="min-width:0"><b>${esc(r.n)}</b> <span class="pill ${pill}">${x.status}</span>${x.ex?` <span class="pill warn">exemple</span>`:""}
      <div class="meta">${hm(x.time)} · ${x.pers} pers. · ${r.q}, ${r.c} · Code <b class="num">${x.code}</b> · ${x.pay}</div>
      ${x.exp?`<div class="small">Expérience : ${x.exp}</div>`:""}${x.occ?`<div class="small">Occasion : ${x.occ}</div>`:""}${x.booker?`<div class="small">Réservé pour ${esc(x.nom)}</div>`:""}
      ${x.pre&&x.pre.length?`<div class="small muted">Pré-commande : ${x.pre.map(p=>p.q+" × "+p.n).join(", ")}</div>`:""}</div>
      <div class="r-act acts">${x.status==="confirmée"?`<button class="btn ghost sm" data-edit="${x.id}">Modifier</button><button class="btn ghost sm" data-cancel="${x.id}">Annuler</button>`:
        x.status==="honorée"?`<button class="btn ghost sm" data-again="${x.rid}">Réserver à nouveau</button><button class="btn sm" data-rev="${x.rid}">Laisser un avis</button>`:`<button class="btn ghost sm" data-again="${x.rid}">Réserver à nouveau</button>`}</div></div>`};
  if(accTab==="reservations")body.innerHTML=(retraits.length?`<h3 style="font-size:18px;margin-bottom:8px">Mes portions anti-gaspi</h3><div class="list" style="margin-bottom:18px">${retraits.map(x=>`<div class="resa" style="grid-template-columns:minmax(0,1fr) auto"><div><b>${esc(x.plat)}</b> · ${esc((byId(x.rid)||{}).n||"")}<div class="meta num">${F(x.prix)} · Code ${esc(x.code)}</div></div><span class="pill ${x.status==="retiré"?"ok":x.status==="annulé"?"bad":"warn"}">${esc(x.status==="en_attente"?"à retirer":x.status)}</span></div>`).join("")}</div>`:"")+(up.length?`<div class="list">${up.map(row).join("")}</div>`:`<div class="empty">Aucune réservation à venir. <a href="#explorer">Trouve une table</a>.</div>`);
  if(accTab==="commandes")body.innerHTML=(commandes.length?`<div class="list">${commandes.map(x=>{const r=byId(x.rid)||{n:x.rid};return `<div class="resa" style="grid-template-columns:minmax(0,1fr) auto"><div style="min-width:0"><b>${esc(r.n)}</b> <span class="pill ${CMD_PILL[x.status]}">${esc(x.status)}</span>
      <div class="meta num">${x.mode==="livraison"?"Livraison":"À emporter"} · ${F(x.total)} · Code <b>${esc(x.code)}</b> · ${new Date(x.created).toLocaleString("fr-FR",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}</div>
      <div class="small muted">${x.items.map(i=>i.q+" × "+esc(i.n)).join(", ")}</div></div><div class="r-act acts">${x.status==="reçue"?`<button class="btn ghost sm" data-cmdcancel="${esc(x.id)}">Annuler</button>`:""}</div></div>`}).join("")}</div>`:`<div class="empty">Aucune commande pour l'instant. <button class="linkbtn" data-coll="commander">Voir qui prend les commandes</button>.</div>`);
  if(accTab==="historique")body.innerHTML=past.length?`<div class="list">${past.map(row).join("")}</div>`:`<div class="empty">Ton historique apparaîtra ici après tes premières visites.</div>`;
  if(accTab==="favoris")body.innerHTML=favs.size?`<div class="grid">${R.filter(r=>favs.has(r.id)).map(r=>card(r)).join("")}</div>`:`<div class="empty">Touche le cœur sur un restaurant pour le garder ici.</div>`;
  if(accTab==="alertes")body.innerHTML=alerts.length?`<div class="list">${alerts.map(a=>{const r=byId(a.rid);const free=slotsFor(r,a.date,a.time,a.pers).find(s=>s.t===a.time&&s.free);return `<div class="resa"><div class="dateb"><span class="num">${new Date(a.date+"T12:00").getDate()}</span><small>${new Date(a.date+"T12:00").toLocaleDateString("fr-FR",{month:"short"})}</small></div><div><b>${esc(r.n)}</b> ${free?`<span class="pill ok">table libérée</span>`:`<span class="pill warn">en attente</span>`}<div class="meta">${hm(a.time)} · ${a.pers} pers.</div></div><div class="r-act acts">${free?`<button class="btn sm" data-alertbook="${a.id}">Réserver</button>`:""}<button class="btn ghost sm" data-alertdel="${a.id}">Supprimer</button></div></div>`}).join("")}</div>`:`<div class="empty">Sur un créneau complet, active « Me prévenir » pour être alerté quand une table se libère.</div>`;
  if(accTab==="fidelite")body.innerHTML=`<p class="sub">Échange tes points contre des avantages. Une récompense s'applique à ta prochaine réservation.</p>
    <div class="rewards">${REWARDS.map(w=>`<div class="reward"><b>${w.l}</b><span class="small muted">${w.d}</span><span class="pill info num">${w.c} pts</span><button class="btn sm ${pts>=w.c?"":"ghost"}" data-redeem="${w.id}" ${pts>=w.c?"":"disabled"}>${pts>=w.c?"Échanger":"Pas assez de points"}</button></div>`).join("")}</div>
    ${redeemed.length?`<h3 style="margin:22px 0 8px;font-size:18px">Mes récompenses</h3><div class="list">${redeemed.map(x=>`<div class="resa" style="grid-template-columns:minmax(0,1fr) auto"><div><b>${x.l}</b><div class="meta">Code ${x.code}</div></div><span class="pill ${x.used?"bad":"ok"}">${x.used?"utilisée":"disponible"}</span></div>`).join("")}</div>`:""}
    <p class="small muted" style="margin-top:16px">Barème : réservation +50 · visite confirmée par le restaurant +100 · avis +30.</p>`;
  body.querySelectorAll("[data-cmdcancel]").forEach(b=>b.onclick=()=>{b.disabled=true;api("PATCH","/api/commandes/"+b.dataset.cmdcancel,{status:"annulée"}).then(d=>{applyMe(d);renderHeader();toast("Commande annulée");renderAccount()}).catch(e=>{toast(e.message);api("GET","/api/me").then(d=>{applyMe(d);renderAccount()}).catch(()=>{})})});
  body.querySelectorAll("[data-cancel]").forEach(b=>b.onclick=()=>{const x=resas.find(y=>y.id===b.dataset.cancel);
    openDlg("Annuler la réservation ?",`<p>${esc(byId(x.rid).n)}, ${longDate(x.date)} à ${hm(x.time)}. La table sera proposée aux clients en liste d'attente.</p><div class="row"><button class="btn" id="cOk">Oui, annuler</button><button class="btn ghost" data-close>Garder ma table</button></div>`);
    $("#cOk").onclick=()=>api("PATCH","/api/reservations/"+x.id,{status:"annulée"}).then(d=>{applyMe(d);renderHeader();delete occ[x.date];dlg.close();toast("Réservation annulée, la table est libérée");renderAccount()}).catch(e=>toast(e.message))});
  body.querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>{const x=resas.find(y=>y.id===b.dataset.edit);openBooking(byId(x.rid),x.time,{edit:x})});
  body.querySelectorAll("[data-again]").forEach(b=>b.onclick=()=>location.hash="r-"+b.dataset.again);
  body.querySelectorAll("[data-rev]").forEach(b=>b.onclick=()=>openReview(byId(b.dataset.rev)));
  body.querySelectorAll("[data-alertdel]").forEach(b=>b.onclick=()=>{alerts=alerts.filter(a=>a.id!==b.dataset.alertdel);save();renderAccount()});
  body.querySelectorAll("[data-alertbook]").forEach(b=>b.onclick=()=>{const a=alerts.find(x=>x.id===b.dataset.alertbook);st.date=a.date;st.pers=a.pers;openBooking(byId(a.rid),a.time)});
  body.querySelectorAll("[data-redeem]").forEach(b=>b.onclick=()=>{const w=REWARDS.find(x=>x.id===b.dataset.redeem);b.disabled=true;api("POST","/api/rewards/redeem",{id:w.id}).then(d=>{applyMe(d);renderHeader();toast(w.l+" ajouté à tes récompenses");renderAccount()}).catch(e=>{b.disabled=false;toast(e.message)})});
}

function renderAccountGate(){
  $("#main").innerHTML=`<div class="wrap page"><div class="acc-gate">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>
    <h1>Connecte-toi pour voir ton compte</h1>
    <p class="muted">Tes réservations, tes favoris, tes alertes et tes points Tablô t'attendent.</p>
    <div class="row" style="justify-content:center"><button class="btn" id="gateIn">Connexion</button><button class="btn ghost" id="gateJoin">Créer un compte</button></div>
  </div></div>`;
  $("#gateIn").onclick=()=>openLogin();$("#gateJoin").onclick=()=>openLogin(true);
}
/* ---------- EN-TÊTE CLIENT (invité / connecté) ---------- */
const initials=n=>String(n||"?").trim().split(/\s+/).map(w=>w[0]).slice(0,2).join("").toUpperCase();
const espaceUrl=()=>admin&&admin.role==="super"?"/admin":"#gerant";
const espaceNom=()=>admin&&admin.role==="super"?"Accès équipe Tablô":"Mon espace gérant";
function renderHeader(){
  const seulPro=!user&&!!admin; // gérant ou équipe connecté, sans compte client ouvert
  $("#guestActs").hidden=!!user||seulPro;$("#userActs").hidden=!user&&!seulPro;const nc=document.querySelector('nav.tabs a[data-view="compte"]');if(nc){nc.hidden=!user&&!seulPro;nc.setAttribute("href",seulPro?espaceUrl():"#compte")}
  document.querySelectorAll("#userActs .hp-wrap").forEach((w,i)=>{if(i)w.style.display=seulPro?"none":""});
  if(seulPro){$("#avIni").textContent=initials(admin.nom);$("#avDot").hidden=true}
  if(user){$("#avIni").textContent=initials(user.nom);$("#notifDot").hidden=!notifs.some(n=>!n.read);$("#avDot").hidden=!!user.com}
}
function closeHpops(except){document.querySelectorAll(".hpop").forEach(p=>{if(p!==except){p.hidden=true;const b=p.previousElementSibling;if(b)b.setAttribute("aria-expanded","false")}})}
const BELL=`<svg class="sketch" viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="60" cy="20" r="5"/><path d="M34 82c4-6 6-14 6-26 0-14 9-26 20-26s20 12 20 26c0 12 2 20 6 26"/><ellipse cx="60" cy="86" rx="30" ry="8"/><path d="M53 94a7 7 0 0 0 14 0"/><path d="M74 46c2 3 3 7 3 11" opacity=".5"/></svg>`;
function fillHpop(k){
  const p=$("#hp-"+k);const go=(h,t)=>`<a class="hp-link" href="#${h}" ${t?`data-acct="${t}"`:""}>`;
  if(k==="av"&&!user){p.innerHTML=`<div class="hp-head"><span class="hp-av">${esc(initials(admin.nom))}</span><div><b>Bonjour ${esc(admin.nom.split(" ")[0])} !</b><small class="muted">${esc(admin.mail||"")}</small></div></div><nav class="hp-menu"><a class="hp-link" href="${espaceUrl()}">${espaceNom()}</a><button type="button" data-hpact="logoutpro" class="danger">Déconnexion</button></nav>`;return}
  if(k==="av"){p.innerHTML=`<div class="hp-head"><span class="hp-av">${esc(initials(user.nom))}</span><div><b>Bonjour ${esc(user.nom.split(" ")[0])} !</b><small class="muted">${esc(user.tel?"+225 "+user.tel.replace(/\D/g,"").replace(/^225/,"").replace(/(\d{2})(?=\d)/g,"$1 "):(user.mail||""))}</small></div></div>
    ${user.com?"":`<button class="hp-hint" type="button" data-hpact="profil"><i class="hdot"></i>Complète ton profil : choisis ta commune préférée</button>`}
    <nav class="hp-menu">${go("compte","reservations")}Mes réservations</a>${go("compte","favoris")}Mes favoris</a>${go("compte","fidelite")}Mes points (${pts.toLocaleString("fr-FR")})</a>${admin?`<a class="hp-link" href="${espaceUrl()}">${espaceNom()}</a>`:""}<button type="button" data-hpact="profil">Mon profil</button><button type="button" data-hpact="logout" class="danger">Déconnexion</button></nav>`}
  if(k==="resa"){const up=resas.filter(x=>x.status==="confirmée"&&x.date>=iso(today)).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
    p.innerHTML=`<h3>Réservations à venir</h3>${up.length?`<ul class="hp-list">${up.slice(0,4).map(x=>{const r=byId(x.rid);return `<li><a href="#r-${r.id}"><b>${esc(r.n)}</b><span class="small muted">${longDate(x.date)} · ${hm(x.time)} · ${x.pers} pers.</span><span class="small num">Code ${x.code}</span></a></li>`}).join("")}</ul>${go("compte","reservations")}Tout voir</a>`:`<p class="muted">Tu n'as aucune réservation à venir.</p><a class="btn sm" href="#explorer">Trouver une table</a>`}`}
  if(k==="notif"){
    const al=alerts.map(a=>({t:"Alerte de disponibilité active",d:(byId(a.rid)||{n:""}).n+" · "+longDate(a.date)+" vers "+hm(a.time),at:+a.id||0,read:true}));
    const all=[...notifs,...al].sort((a,b)=>b.at-a.at);
    p.innerHTML=`<h3>Notifications</h3>${all.length?`<ul class="hp-list">${all.slice(0,6).map(n=>`<li class="${n.read?"":"unread"}"><div><b>${esc(n.t)}</b><span class="small muted">${esc(n.d)}</span></div></li>`).join("")}</ul>`:`<div class="hp-empty">${BELL}<b>Rien à voir pour l'instant !</b><p class="small muted">Pas encore de notifications. Réserve des tables pour en recevoir.</p></div>`}`;
    if(notifs.some(n=>!n.read)){notifs.forEach(n=>n.read=true);api("PUT","/api/me/state",{notifsRead:true}).catch(()=>{})}$("#notifDot").hidden=true}
  if(k==="gift"){const next=pts>=2000?null:pts>=800?2000:800,lvl=pts>=2000?"Or":pts>=800?"Argent":"Bronze";
    p.innerHTML=`<h3>Tablô Récompenses</h3><div class="hp-pts"><b class="num">${pts.toLocaleString("fr-FR")}</b><span>points · niveau ${lvl}</span></div><div class="bar"><i style="width:${next?Math.min(100,pts/next*100):100}%"></i></div>
      <p class="small muted">${next?`Encore ${(next-pts).toLocaleString("fr-FR")} pts pour le niveau ${lvl==="Bronze"?"Argent":"Or"}.`:"Niveau maximum atteint."} +50 pts par réservation, +100 pts quand tu es venu.</p>${go("compte","fidelite")}Échanger mes points</a>`}
}
document.querySelectorAll("[data-hp]").forEach(b=>b.onclick=e=>{e.stopPropagation();const p=$("#hp-"+b.dataset.hp);const open=p.hidden;closeHpops(p);$("#locPop").hidden=true;if(open)fillHpop(b.dataset.hp);p.hidden=!open;b.setAttribute("aria-expanded",String(open))});
document.querySelectorAll(".hpop").forEach(p=>p.addEventListener("click",e=>{e.stopPropagation();
  const a=e.target.closest("[data-acct]");if(a){accTab=a.dataset.acct;closeHpops();if(location.hash==="#compte")route();return}
  if(e.target.closest("a")){closeHpops();return}
  const act=e.target.closest("[data-hpact]");if(!act)return;closeHpops();
  if(act.dataset.hpact==="profil")openSignin();
  if(act.dataset.hpact==="logout")logoutUser();
  if(act.dataset.hpact==="logoutpro")api("POST","/api/admin/logout").catch(()=>{}).finally(()=>{admin=null;adminRestos=[];pro={};proResas={};ficheCache={};renderHeader();toast("Tu es déconnecté");rerender()})}));
document.addEventListener("click",()=>closeHpops());
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeHpops()});
$("#signBtn").onclick=()=>openProfil();
$("#joinBtn").onclick=()=>openLogin(true);
$("#searchBtn").onclick=()=>{const go=()=>{const i=document.querySelector("#main .search input:not([type=date]),#main input[type=search]");if(i){i.focus();i.scrollIntoView({block:"center",behavior:"smooth"})}};if(view()==="explorer"||view()==="accueil")go();else{location.hash="explorer";setTimeout(go,80)}};

/* ---------- CONNEXION CLIENT : téléphone (ou e-mail) → code → profil (API) ---------- */
function logoutUser(){api("POST","/api/auth/logout").catch(()=>{}).finally(()=>{applyMe({});renderHeader();toast("Tu es déconnecté");if(view()==="compte")location.hash="accueil";else rerender()})}
/* Première question : client ou gérant ? Se déclarer gérant ne donne aucun accès : demande et validation restent obligatoires. */
function openProfil(){
  openDlg("Bienvenue sur Tablô",`<div class="login"><h3>Tu viens pour quoi ?</h3>
    <button type="button" class="profil" id="pfCompte"><b>J'ai déjà un compte</b><span>Connecte-toi avec ton numéro ou ton e-mail : tu retrouves tes réservations, tes favoris et tes points.</span></button>
    <button type="button" class="profil" id="pfClient"><b>Je veux réserver une table</b><span>Crée ton compte en 1 minute, réserve et cumule des points.</span></button>
    <button type="button" class="profil" id="pfGerant"><b>Je gère un établissement</b><span>Restaurant, maquis ou lounge : fais ta demande pour rejoindre Tablô.</span></button></div>`);
  $("#pfCompte").onclick=()=>openLogin(false,true,true);
  $("#pfClient").onclick=()=>openLogin(false,true);
  $("#pfGerant").onclick=()=>{dlg.close();if(location.hash==="#inscription-resto")route();else location.hash="inscription-resto"};
}
function openLogin(join=false,retour=false,existant=false){
  const L={mode:"tel",val:"",demo:"",signup:""};
  const flag=`<span class="flag-ci" aria-hidden="true"><i></i><i></i><i></i></span>`;
  const busy=(b,on,txt)=>{b.disabled=on;if(txt)b.textContent=txt};
  const showErr=m=>{const e=$("#lgErr");e.textContent=m;e.hidden=false};
  function step1(){openDlg(join?"Rejoindre Tablô Récompenses":existant?"Se connecter":"Créer mon compte",`<div class="login">
    ${existant?`<p class="muted">Content de te revoir ! Utilise le numéro ou l'e-mail de ton compte.</p>`:""}
    <h3>${L.mode==="tel"?"Entre ton numéro de téléphone":"Entre ton adresse e-mail"}</h3>
    <p class="muted">${L.mode==="tel"?"Tu vas recevoir un SMS pour vérifier ton compte. Des frais d'opérateur peuvent s'appliquer.":"Tu vas recevoir un code par e-mail pour vérifier ton compte."}</p>
    ${L.mode==="tel"?`<div class="tel-row"><span class="cc">${flag}<span>+225</span></span><input id="lgVal" inputmode="tel" autocomplete="tel" placeholder="07 12 34 56 78" aria-label="Numéro de téléphone" value="${esc(L.val)}"></div>`:`<input class="lg-in" id="lgVal" type="email" autocomplete="email" placeholder="aya.kone@email.ci" aria-label="Adresse e-mail" value="${esc(L.val)}">`}
    <p class="err" id="lgErr" hidden></p>
    <button class="btn lg-go" id="lgNext">Continuer</button>
    <button class="linkbtn lg-alt" id="lgAlt">${L.mode==="tel"?"Utiliser l'e-mail à la place":"Utiliser le téléphone à la place"}</button>
    ${retour?`<button type="button" class="linkbtn lg-alt" id="lgRetour">← Retour</button>`:""}
    ${join?`<ul class="lg-perks"><li>+50 pts à chaque réservation</li><li>Desserts, cocktails et réductions à débloquer</li><li>Rappels SMS avant ton repas</li></ul>`:""}</div>`);
    const inp=$("#lgVal");setTimeout(()=>inp.focus(),30);
    if($("#lgRetour"))$("#lgRetour").onclick=openProfil;
    $("#lgAlt").onclick=()=>{L.mode=L.mode==="tel"?"mail":"tel";L.val="";step1()};
    const next=async()=>{const b=$("#lgNext");busy(b,true,"Envoi…");
      try{const d=await api("POST","/api/auth/otp",{ident:inp.value,mode:L.mode});L.val=d.ident;L.demo=d.demoCode||"";step2();
        toast((L.mode==="tel"?"SMS":"E-mail")+" envoyé"+(L.demo?" (démo) · code "+L.demo:""))}
      catch(e){busy(b,false,"Continuer");showErr(e.message)}};
    $("#lgNext").onclick=next;inp.onkeydown=e=>{if(e.key==="Enter")next()}}
  function step2(){const shown=L.mode==="tel"?"+225 "+L.val.replace(/(\d{2})(?=\d)/g,"$1 "):L.val;
    openDlg("Vérification",`<div class="login"><h3>Saisis le code reçu</h3><p class="muted">Code envoyé au <b>${esc(shown)}</b>. <button class="linkbtn" id="lgBack">Modifier</button></p>
    <input class="lg-in lg-code num" id="lgCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="••••••" aria-label="Code à 6 chiffres">
    ${L.demo?`<p class="small muted">Mode démo : le code est <b class="num">${L.demo}</b> (aucun vrai SMS n'est envoyé).</p>`:""}
    <p class="err" id="lgErr" hidden></p><button class="btn lg-go" id="lgVerify">Vérifier</button>
    <button class="linkbtn lg-alt" id="lgResend">Renvoyer le code</button></div>`);
    const c=$("#lgCode");setTimeout(()=>c.focus(),30);
    $("#lgBack").onclick=step1;
    $("#lgResend").onclick=()=>api("POST","/api/auth/otp",{ident:L.val,mode:L.mode}).then(d=>{L.demo=d.demoCode||"";step2();toast("Nouveau code envoyé"+(L.demo?" · "+L.demo:""))}).catch(e=>showErr(e.message));
    let pending=false;
    const verify=async()=>{if(pending)return;const v=c.value.trim();if(v.length!==6)return showErr("Le code contient 6 chiffres.");pending=true;busy($("#lgVerify"),true,"Vérification…");
      try{const d=await api("POST","/api/auth/verify",{ident:L.val,code:v});
        if(d.needsProfile){L.signup=d.signup;if(existant)return aucunCompte();step3();return}
        applyMe(d);if(user.com){st.commune=user.com;st.quartier=null}save();renderLoc();dlg.close();toast("Bon retour "+user.nom.split(" ")[0]+" !");rerender()}
      catch(e){pending=false;busy($("#lgVerify"),false,"Vérifier");showErr(e.message)}};
    $("#lgVerify").onclick=verify;c.onkeydown=e=>{if(e.key==="Enter")verify()};c.oninput=()=>{if(c.value.trim().length===6)verify()}}
  function aucunCompte(){const shown=L.mode==="tel"?"+225 "+L.val.replace(/(\d{2})(?=\d)/g,"$1 "):L.val;
    openDlg("Aucun compte trouvé",`<div class="login"><h3>Aucun compte avec ${esc(shown)}</h3><p class="muted">Tu t'es peut-être inscrit avec un autre numéro ou un autre e-mail.</p>
    <button class="btn lg-go" id="acOther">Essayer un autre ${L.mode==="tel"?"numéro":"e-mail"}</button><button class="btn ghost lg-go" id="acNew">Créer un compte avec ${esc(shown)}</button></div>`);
    $("#acOther").onclick=()=>{L.val="";step1()};$("#acNew").onclick=()=>step3()}
  function step3(){openDlg("Crée ton profil",`<div class="login"><h3>Bienvenue sur Tablô !</h3><p class="muted">Dernière étape : comment doit-on t'appeler ?</p>
    <div class="form"><label class="full">Nom complet<input id="lgNom" autocomplete="name" placeholder="Aya Koné"></label>
    ${L.mode==="mail"?`<label class="full">Téléphone (pour les rappels SMS)<input id="lgTel" inputmode="tel" placeholder="07 12 34 56 78"></label>`:""}
    <label class="full">Commune préférée<select id="lgCom"><option value="">Tout Abidjan</option>${CN.map(c=>`<option>${c}</option>`).join("")}</select></label></div>
    <p class="err" id="lgErr" hidden></p><button class="btn lg-go" id="lgCreate">Créer mon compte</button></div>`);
    setTimeout(()=>$("#lgNom").focus(),30);
    $("#lgCreate").onclick=async()=>{const b=$("#lgCreate");busy(b,true,"Création…");
      try{const d=await api("POST","/api/auth/register",{signup:L.signup,nom:$("#lgNom").value,tel:($("#lgTel")||{}).value||"",com:$("#lgCom").value});
        applyMe(d);if(user.com){st.commune=user.com;st.quartier=null}save();renderLoc();dlg.close();toast("Compte créé, bienvenue "+user.nom.split(" ")[0]+" !");rerender()}
      catch(e){busy(b,false,"Créer mon compte");showErr(e.message)}}}
  step1();
}

/* ---------- ADMIN : connexion par mot de passe ---------- */
/* Identifiants vérifiés par le serveur (mot de passe haché scrypt, session en cookie HttpOnly). */
function renderAdminLogin(){
  $("#main").innerHTML=`<div class="adm-login"><div class="adm-card">
    <a class="logo" href="#accueil" aria-label="Tablô, retour au site client"><span class="logo-mark"></span><span><b>Tablô</b><small>${SITE_ADMIN?"Équipe Tablô":"Espace gérant"}</small></span></a>
    <div><h1>${SITE_ADMIN?"Accès équipe Tablô":"Connexion gérant"}</h1><p class="muted">${SITE_ADMIN?"Réservé à l'équipe Tablô.":"Gère tes réservations, ta salle et tes invendus."}</p></div>
    <form id="admForm" class="adm-form" novalidate>
      <label>E-mail ou téléphone<input id="admMail" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="ton@email.ci ou 07 12 34 56 78" required></label>
      <label>Mot de passe<span class="pw"><input id="admPass" type="password" autocomplete="current-password" placeholder="••••••••" required><button type="button" id="admEye" aria-label="Afficher le mot de passe">Afficher</button></span></label>
      <p class="err" id="admErr" role="alert" hidden></p>
      <button class="btn">Se connecter</button>
      <button type="button" class="linkbtn" id="admForgot" style="align-self:center">Mot de passe oublié ?</button>
    </form>
    ${demoMode&&SITE_ADMIN?`<div class="adm-demo"><b>Accès démo (jury)</b><span>E-mail : <code>${esc(demoMode.mail)}</code></span><span>Mot de passe : <code>${esc(demoMode.pass)}</code></span><button type="button" class="btn ghost sm" id="admFill">Remplir automatiquement</button></div>`:""}
    ${SITE_ADMIN?"":`<div class="adm-join"><span>Tu gères un restaurant, un maquis ou un lounge ?</span><a class="btn ghost" href="#inscription-resto">Rejoindre Tablô</a></div>`}
    <a class="adm-back" href="#accueil">← Retour au site client</a></div></div>`;
  $("#admEye").onclick=()=>{const p=$("#admPass"),s=p.type==="password";p.type=s?"text":"password";$("#admEye").textContent=s?"Masquer":"Afficher";$("#admEye").setAttribute("aria-label",s?"Masquer le mot de passe":"Afficher le mot de passe")};
  if($("#admFill"))$("#admFill").onclick=()=>{$("#admMail").value=demoMode.mail;$("#admPass").value=demoMode.pass;$("#admErr").hidden=true};
  $("#admForgot").onclick=async()=>{const m=$("#admMail").value.trim(),x=$("#admErr");if(!m){x.textContent="Saisis d'abord ton e-mail ou ton téléphone.";x.hidden=false;$("#admMail").focus();return}try{await api("POST","/api/admin/forgot",{mail:m});x.hidden=true;toast("Si ce compte existe, un lien vient de partir par e-mail.")}catch(e){x.textContent=e.message;x.hidden=false}};
  $("#admForm").onsubmit=async e=>{e.preventDefault();const err=$("#admErr"),b=$("#admForm .btn:not(.ghost)");err.hidden=true;b.disabled=true;b.textContent="Connexion…";
    try{const d=await api("POST","/api/admin/login",{mail:$("#admMail").value,pass:$("#admPass").value,espace:SITE_ADMIN?"admin":"gerant"});admin=d.admin;adminRestos=d.restos||[];pro={};proResas={};ficheCache={};proTab="service";toast("Connecté à l'espace restaurateur");renderPro()}
    catch(x){b.disabled=false;b.textContent="Se connecter";err.textContent=x.message;err.hidden=false;$("#admPass").value="";$("#admPass").focus()}};
  setTimeout(()=>$("#admMail").focus(),30);
}

/* ---------- ESPACE PRO : barre latérale commune ---------- */
const EXTRA_TABS=["fiche","etabs","ajout","demandes","releve"];
const stL=x=>x.status==="valide"?["En ligne","ok"]:x.status==="refuse"?["Refusé","bad"]:x.status==="suspendu"?["Suspendu","bad"]:x.submitted?["À publier","warn"]:["En configuration","info"];
const planAutorise=(id,tab)=>{if(admin&&admin.role==="super")return true;const x=adminRestos.find(y=>y.id===id);return !["cuisine","stats"].includes(tab)||(x&&x.plan!=="essentiel")};
const PIC={commandes:'<path d="M6 7h12l1 14H5z"/><path d="M9 10V6a3 3 0 0 1 6 0v4"/>',service:'<path d="M3 11h18M5 11V7a7 7 0 0 1 14 0v4M4 15h16l-1 5H5z"/>',cuisine:'<path d="M6 3v8a3 3 0 0 0 6 0V3M9 3v18M17 3c-2 2-2 6 0 8v10"/>',stats:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  fiche:'<path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h8M8 17h5"/>',etabs:'<path d="M3 21V9l9-6 9 6v12"/><path d="M9 21v-6h6v6"/>',releve:'<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',demandes:'<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2z"/>'};
function curResto(){const sel=store.get("proR",null);return adminRestos.find(x=>x.id===sel)||adminRestos[0]||null}
function proSide(id,badges={}){
  const cur=adminRestos.find(x=>x.id===id)||{n:"Tablô",c:"",status:"valide"};const isSuper=admin&&admin.role==="super";
  const online=cur.status==="valide"&&byId(id);
  const tabs=[...(online?[["service","Service & salle"],["commandes","Commandes"],...(planAutorise(id,"cuisine")?[["cuisine","Cuisine & anti-gaspi"],["stats","Statistiques & avis"]]:[])]:[]),["fiche","Ma fiche & configuration"],["releve","Relevé du mois"],...(isSuper?[["demandes","Demandes"],["etabs","Établissements"]]:[])];
  const aPublier=isSuper?adminRestos.filter(x=>x.status==="en_attente"&&x.submitted).length:0;
  const peutAjouter=isSuper||adminRestos.some(x=>x.plan==="premium");
  return `<aside class="pro-side" aria-label="Menu restaurateur">
    <div class="pro-resto"><span class="pro-av">${esc(initials(cur.n))}</span><div><b>${esc(cur.n)}</b><small>${esc(cur.c)} · ${stL(cur)[0]}${cur.plan&&PLANS[cur.plan]?" · "+PLANS[cur.plan].l:""}</small></div></div>
    ${adminRestos.length>1?`<label class="pro-sel"><span>Changer d'établissement</span><select id="proSel">${adminRestos.map(x=>`<option value="${esc(x.id)}" ${x.id===id?"selected":""}>${esc(x.n)} · ${esc(x.c)}${x.status!=="valide"?" ("+stL(x)[0].toLowerCase()+")":""}</option>`).join("")}</select></label>`:""}
    <nav class="pro-nav">${tabs.map(([k,l])=>`<button type="button" data-pt="${k}" ${k===proTab?'aria-current="page"':""}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">${PIC[k]}</svg><span>${l}</span>${k==="etabs"&&aPublier?`<em>${aPublier}</em>`:k==="demandes"?'<em id="leadsN" hidden></em>':badges[k]?`<em>${badges[k]}</em>`:""}</button>`).join("")}
      ${peutAjouter?`<button type="button" data-pt="ajout" ${proTab==="ajout"?'aria-current="page"':""}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span>Ajouter un établissement</span></button>`:""}</nav>
    <div class="pro-live"><span class="dot"></span><div><b>${isSuper?"Équipe Tablô":"Gérant"}</b><small>${longDate(iso(today))}</small></div></div>
    <div class="pro-user"><span>${esc((admin&&admin.nom)||"Admin")}<small>${esc((admin&&admin.mail)||"")}</small></span><button type="button" id="admOut">Déconnexion</button></div>
    <a class="pro-back" href="#accueil">← Retour au site client</a></aside>`}
function bindProSide(){
  $("#admOut").onclick=()=>api("POST","/api/admin/logout").catch(()=>{}).finally(()=>{admin=null;adminRestos=[];pro={};proResas={};ficheCache={};toast("Déconnecté de l'espace restaurateur");renderAdminLogin()});
  const s=$("#proSel");if(s)s.onchange=e=>{store.set("proR",e.target.value);const x=adminRestos.find(y=>y.id===e.target.value);if(x&&x.status!=="valide"&&!EXTRA_TABS.includes(proTab))proTab="fiche";renderPro()};
  $("#main").querySelectorAll("[data-pt]").forEach(b=>b.onclick=()=>{proTab=b.dataset.pt;renderPro()});
  const n=$("#leadsN");if(n)api("GET","/api/admin/leads").then(d=>{const c=d.leads.filter(l=>l.status==="nouveau").length;if(c){n.textContent=c;n.hidden=false}}).catch(()=>{});
}
async function refreshAdminRestos(){try{const d=await api("GET","/api/admin/me");adminRestos=d.restos||[]}catch(e){}}

/* ---------- Formulaire d'établissement (inscription, fiche, ajout) ---------- */
const HOURS=(()=>{const o=[];for(let m=0;m<24*60;m+=30)o.push(String(Math.floor(m/60)).padStart(2,"0")+"h"+(m%60?"30":""));return o})();
function ficheForm(d={},opts={}){
  const c=d.c||"Cocody",[ho,hc]=(d.h||"12h – 23h").split("–").map(x=>x.trim());
  const opt=(list,v)=>list.map(x=>`<option ${x===v?"selected":""}>${esc(x)}</option>`).join("");
  return `<div class="form fiche">
    <label class="full">Nom de l'établissement<input id="f_n" value="${esc(d.n||"")}" placeholder="Ex. Chez Tantie Akissi" maxlength="80"></label>
    <label>Type<select id="f_t">${opt(TYPES,d.t||"Restaurant")}</select></label>
    <label>Cuisine<select id="f_cu">${opt(CUIS,d.cu||"Ivoirienne")}</select></label>
    <label>Commune<select id="f_c">${opt(CN,c)}</select></label>
    <label>Quartier<select id="f_q">${opt(COMMUNES[c].q,d.q)}</select></label>
    <label>Budget moyen par personne<select id="f_b">${BUDGETS.map(x=>`<option value="${x.id}" ${x.id===(+d.b||2)?"selected":""}>${"F".repeat(x.id)} · ${x.l}</option>`).join("")}</select></label>
    ${opts.config?"":`<label>Nombre de tables<input id="f_tables" type="number" min="1" max="200" value="${+d.tables||12}"></label>
    <label>Ouverture<select id="f_ho">${opt(HOURS,ho)}</select></label>
    <label>Fermeture<select id="f_hc">${opt(HOURS,hc)}</select></label>`}
    <label>Téléphone de l'établissement<input id="f_tel" inputmode="tel" value="${esc(d.tel||"")}" placeholder="27 22 00 00 00 ou 07 12 34 56 78"></label>
    ${opts.rccm!==false?`<label>RCCM (facultatif)<input id="f_rccm" value="${esc(d.rccm||"")}" placeholder="CI-ABJ-2026-B-12345"></label>`:""}
    <label class="full">Description<textarea id="f_d" rows="3" maxlength="400" placeholder="Ambiance, spécialités, ce qui vous rend unique…">${esc(d.d||"")}</textarea></label>
    <fieldset class="full tagset"><legend>Atouts (10 max)</legend>${TAGS.map(t=>`<label class="check"><input type="checkbox" value="${esc(t)}" ${(d.tags||[]).includes(t)?"checked":""}> ${esc(t)}</label>`).join("")}</fieldset>
    <input type="hidden" id="f_lat" value="${d.lat!=null?+d.lat:""}"><input type="hidden" id="f_lng" value="${d.lng!=null?+d.lng:""}">
    <div class="full pos-ed" id="posEd" hidden><b>Position sur la carte (facultatif)</b><p class="small muted">Clique sur la carte ou fais glisser le repère. Les clients verront l'endroit exact et auront l'itinéraire.</p><div class="pos-row"><input id="posQ" maxlength="120" placeholder="Nom du lieu, rue, repère" aria-label="Chercher un lieu"><button type="button" class="btn ghost sm" id="posGo">Chercher</button><button type="button" class="btn ghost sm" id="posMe">Ma position</button></div><div class="gmap gmap-on" id="posMap"></div><p class="small muted" id="posInfo" role="status"></p></div>
  </div>`}
function bindFicheForm(){bindPosition();const c=$("#f_c");if(c)c.onchange=()=>{$("#f_q").innerHTML=COMMUNES[c.value].q.map(x=>`<option>${esc(x)}</option>`).join("")}}
function readFiche(){const v=id=>{const e=$("#"+id);return e?e.value:""};
  return {n:v("f_n"),t:v("f_t"),cu:v("f_cu"),c:v("f_c"),q:v("f_q"),b:+v("f_b"),...($("#f_tables")?{tables:+v("f_tables"),h:v("f_ho")+" – "+v("f_hc")}:{}),
    lat:v("f_lat"),lng:v("f_lng"),tel:v("f_tel").replace(/[\s.-]/g,""),rccm:v("f_rccm"),d:v("f_d"),tags:[...document.querySelectorAll(".tagset input:checked")].map(x=>x.value).slice(0,10)}}
function menuEditor(menu={}){const rows=[];Object.entries(menu).forEach(([cat,list])=>list.forEach(it=>rows.push([cat,it[0],it[1],it[2]||""])));if(!rows.length)rows.push(["Plats","","",""]);
  const row=r=>`<div class="menu-row"><input data-mc value="${esc(r[0])}" placeholder="Catégorie" aria-label="Catégorie"><input data-mn value="${esc(r[1])}" placeholder="Plat" aria-label="Plat"><input data-mp type="number" min="0" step="100" value="${r[2]===""?"":+r[2]}" placeholder="Prix F" aria-label="Prix en francs CFA"><button type="button" class="x" data-mdel aria-label="Supprimer">×</button></div>`;
  return `<div class="menu-ed" id="menuEd"><div class="menu-head small muted"><span>Catégorie</span><span>Plat</span><span>Prix (F)</span><span></span></div>${rows.map(row).join("")}</div>
    <button type="button" class="btn ghost sm" id="menuAdd">+ Ajouter un plat</button>`}
function bindMenuEditor(){const ed=$("#menuEd");if(!ed)return;
  ed.addEventListener("click",e=>{const d=e.target.closest("[data-mdel]");if(d){d.parentElement.remove()}});
  $("#menuAdd").onclick=()=>{const last=[...ed.querySelectorAll("[data-mc]")].pop();const div=document.createElement("div");div.className="menu-row";
    div.innerHTML=`<input data-mc value="${esc(last?last.value:"Plats")}" placeholder="Catégorie" aria-label="Catégorie"><input data-mn placeholder="Plat" aria-label="Plat"><input data-mp type="number" min="0" step="100" placeholder="Prix F" aria-label="Prix en francs CFA"><button type="button" class="x" data-mdel aria-label="Supprimer">×</button>`;ed.append(div);div.querySelector("[data-mn]").focus()}}
function readMenu(){const out={};document.querySelectorAll("#menuEd .menu-row").forEach(r=>{const c=r.querySelector("[data-mc]").value.trim()||"Plats",n=r.querySelector("[data-mn]").value.trim(),p=+r.querySelector("[data-mp]").value||0;if(n)(out[c]=out[c]||[]).push([n,p])});return out}

/* ---------- Configuration : salle, services, photos ---------- */
const JOURS=[[1,"L"],[2,"M"],[3,"M"],[4,"J"],[5,"V"],[6,"S"],[0,"D"]];
const salleRow=t=>`<div class="salle-row"><input data-tn type="number" min="1" value="${+t.n||""}" placeholder="N°" aria-label="Numéro de table"><input data-tc type="number" min="1" max="50" value="${+t.cap||""}" placeholder="Places" aria-label="Nombre de places"><input data-tz list="zonesL" value="${esc(t.zone||"Salle")}" placeholder="Zone" aria-label="Zone"><button type="button" class="x" data-del aria-label="Supprimer">×</button></div>`;
const serviceRow=s=>`<div class="svc-row"><div class="svc-l"><input data-sn value="${esc(s.nom||"")}" placeholder="Nom (Déjeuner…)" aria-label="Nom du service"><input data-sd type="time" step="1800" value="${esc(s.de||"12:00")}" aria-label="Début"><input data-sa type="time" step="1800" value="${esc(s.a||"15:00")}" aria-label="Fin"><button type="button" class="x" data-del aria-label="Supprimer">×</button></div>
  <div class="svc-j">${JOURS.map(([v,l])=>`<label class="jour"><input type="checkbox" value="${v}" ${(s.jours||SLOTS.TOUS).includes(v)?"checked":""}><span>${l}</span></label>`).join("")}<input data-sz value="${esc((s.zones||[]).join(", "))}" placeholder="Zones réservables (vide = toutes)" aria-label="Zones réservables"></div></div>`;
function readConfig(){
  const salle=[...document.querySelectorAll(".salle-row")].map(r=>({n:+r.querySelector("[data-tn]").value,cap:+r.querySelector("[data-tc]").value,zone:r.querySelector("[data-tz]").value.trim()||"Salle"})).filter(t=>t.n&&t.cap);
  const services=[...document.querySelectorAll(".svc-row")].map(r=>({nom:r.querySelector("[data-sn]").value.trim(),de:r.querySelector("[data-sd]").value,a:r.querySelector("[data-sa]").value,jours:[...r.querySelectorAll(".jour input:checked")].map(i=>+i.value),zones:r.querySelector("[data-sz]").value.split(",").map(x=>x.trim()).filter(Boolean)}));
  return {salle,services,duree:+$("#f_duree").value,maxPers:+$("#f_max").value}}
/* Réduit l'image dans le navigateur (1280 px, JPEG) avant l'envoi */
function imageVersData(file){return new Promise((ok,ko)=>{const u=URL.createObjectURL(file),i=new Image();i.onerror=()=>{URL.revokeObjectURL(u);ko(new Error("Image illisible : "+file.name))};
  i.onload=()=>{const k=Math.min(1,1280/Math.max(i.width,i.height)),c=document.createElement("canvas");c.width=Math.round(i.width*k);c.height=Math.round(i.height*k);c.getContext("2d").drawImage(i,0,0,c.width,c.height);URL.revokeObjectURL(u);ok(c.toDataURL("image/jpeg",.8))};i.src=u})}

/* ---------- Espace pro : fiche, ajout, demandes, établissements ---------- */
function renderProExtra(){
  const cur=curResto();const id=cur?cur.id:null;const isSuper=admin&&admin.role==="super";
  if(["etabs","demandes"].includes(proTab)&&!isSuper)proTab="fiche";
  if(proTab==="fiche"&&!cur)proTab=isSuper?"demandes":"ajout";
  const T={fiche:["Ma fiche & configuration","Complète chaque étape, puis envoie ta fiche pour publication."],ajout:["Ajouter un établissement",isSuper?"Créé directement en ligne.":"Il sera visible après publication par l'équipe Tablô."],demandes:["Demandes","Échange avec le gérant par appel ou en entretien, puis crée son compte."],etabs:["Établissements","Vérifie les fiches terminées et publie-les."],releve:["Relevé du mois","Abonnement et clients venus via Tablô. Aucun paiement n'est prélevé automatiquement."]}[proTab];
  $("#main").innerHTML=`<div class="pro-shell">${proSide(id)}<div class="pro-main"><div class="pro-title"><div><h1>${T[0]}</h1><p class="muted">${T[1]}</p></div></div><div id="proBody"><p class="muted">Chargement…</p></div></div></div>`;
  bindProSide();const body=$("#proBody");
  const onErr=e=>{if(e.status===401){admin=null;renderAdminLogin()}else body.innerHTML=`<p class="err">${esc(e.message)}</p>`};
  if(proTab==="fiche"){
    const show=f=>{const st=stL(f),d=f.data,sv=Array.isArray(d.services)&&d.services.length?d.services:[{nom:"Déjeuner",de:"12:00",a:"15:00",jours:SLOTS.TOUS,zones:[]},{nom:"Dîner",de:"19:00",a:"23:00",jours:SLOTS.TOUS,zones:[]}];
      const etapes=[["Informations",!f.manque.includes("une description")&&!f.manque.includes("le téléphone")],["Photos",!f.manque.includes("au moins une photo")],["Menu",!f.manque.includes("le menu")],["Plan de salle",!f.manque.includes("le plan de salle")],["Services",!f.manque.includes("les services")]];
      const faits=etapes.filter(e=>e[1]).length;
      body.innerHTML=`${f.status==="valide"?`<div class="pro-banner-st ok"><b>En ligne.</b> Tes modifications sont visibles immédiatement.</div>`:f.status==="refuse"?`<div class="pro-banner-st bad"><b>Fiche refusée.</b> Corrige-la puis renvoie-la pour publication.</div>`:f.status==="suspendu"?`<div class="pro-banner-st bad"><b>Établissement suspendu.</b> Il n'est plus visible par les clients.</div>`:f.submitted?`<div class="pro-banner-st warn"><b>Fiche envoyée.</b> L'équipe Tablô la vérifie avant de la publier.</div>`:`<div class="pro-banner-st info"><b>Configuration : ${faits} étape${faits>1?"s":""} sur ${etapes.length}.</b> Ton établissement sera visible après publication.</div>`}
        <ol class="checklist">${etapes.map(e=>`<li class="${e[1]?"done":""}">${e[1]?"✓":"○"} ${e[0]}</li>`).join("")}</ol>
        <div class="cfg-stack"><div class="panel"><h3>1. Informations</h3>${ficheForm(d,{rccm:false,config:true})}</div>
        <div class="panel"><h3>2. Photos</h3><p class="small muted">8 photos maximum. La première sert de couverture.</p><div class="ph-grid" id="phGrid"></div><label class="btn ghost sm ph-add">+ Ajouter des photos<input id="phIn" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden></label></div>
        <div class="panel"><h3>3. Menu</h3><p class="small muted">Les clients le voient sur ta page et peuvent pré-commander.</p>${menuEditor(f.menu)}</div>
        <div class="panel"><h3>4. Plan de salle</h3><p class="small muted">Tes tables, leurs places et leur zone (Salle, Terrasse, VIP…).</p><datalist id="zonesL"><option>Salle</option><option>Terrasse</option><option>VIP</option><option>Bord de lagune</option></datalist><div class="salle-head small muted"><span>N°</span><span>Places</span><span>Zone</span><span></span></div><div id="salleEd">${SLOTS.salle(d).map(salleRow).join("")}</div><button type="button" class="btn ghost sm" id="salleAdd">+ Ajouter une table</button></div>
        <div class="panel"><h3>5. Services et disponibilités</h3><p class="small muted">Les clients réservent uniquement pendant ces services, sur les tables libres.</p><div id="svcEd">${sv.map(serviceRow).join("")}</div><button type="button" class="btn ghost sm" id="svcAdd">+ Ajouter un service</button>
          <div class="form"><label>Durée d'un repas (minutes)<input id="f_duree" type="number" min="30" max="300" step="15" value="${SLOTS.duree(d)}"></label><label>Réservation en ligne jusqu'à (personnes)<input id="f_max" type="number" min="1" max="200" value="${SLOTS.maxPers(d)}"></label></div></div></div>
        <div class="panel cfg-order"><h3>6. Commandes en ligne (facultatif)</h3><p class="small muted">Les clients commandent depuis ton menu et paient au retrait ou à la livraison. Tu reçois les commandes dans l'onglet « Commandes ». Tu assures toi-même la livraison.</p>
          <div class="form"><label class="check"><input type="checkbox" id="c_emp" ${d.commande&&d.commande.emporter?"checked":""}> À emporter</label><label class="check"><input type="checkbox" id="c_liv" ${d.commande&&d.commande.livraison?"checked":""}> Livraison</label>
          <label class="check full"><input type="checkbox" id="c_seul" ${d.commande&&d.commande.seul?"checked":""}> Commande seulement : pas de réservation de table, le plan de salle n'est pas obligatoire</label>
          <label>Frais de livraison (F)<input id="c_frais" type="number" min="0" max="50000" step="100" value="${d.commande?+d.commande.frais||0:1000}"></label><label>Commande minimum (F)<input id="c_min" type="number" min="0" max="500000" step="500" value="${d.commande?+d.commande.min||0:0}"></label><label>Préparation (minutes)<input id="c_delai" type="number" min="5" max="180" step="5" value="${d.commande?+d.commande.delai||30:30}"></label></div></div>
        <p class="err" id="fErr" role="alert" hidden></p><div class="row cfg-actions"><button class="btn ghost" id="fSave">Enregistrer</button>${f.status==="valide"||f.submitted&&f.status==="en_attente"||f.status==="suspendu"?"":`<button class="btn" id="fSubmit">Envoyer pour publication</button>`}<span class="pill ${st[1]}">${st[0]}</span>${f.plan&&PLANS[f.plan]?`<span class="small muted">Offre ${PLANS[f.plan].l} · ${F(PLANS[f.plan].prix)} / mois</span>`:""}</div>`;
      bindFicheForm();bindMenuEditor();
      const del=e=>{const x=e.target.closest("[data-del]");if(x)x.closest(".salle-row,.svc-row").remove()};$("#salleEd").onclick=del;$("#svcEd").onclick=del;
      $("#salleAdd").onclick=()=>{const ns=[...document.querySelectorAll("[data-tn]")].map(i=>+i.value||0);$("#salleEd").insertAdjacentHTML("beforeend",salleRow({n:Math.max(0,...ns)+1,cap:4,zone:"Salle"}))};
      $("#svcAdd").onclick=()=>$("#svcEd").insertAdjacentHTML("beforeend",serviceRow({nom:"",de:"19:00",a:"23:00",jours:SLOTS.TOUS,zones:[]}));
      const drawPh=()=>{$("#phGrid").innerHTML=f.photos.length?f.photos.map((p,i)=>`<div class="ph" style="background-image:url(/api/photos/${+p})">${i===0?'<span>Couverture</span>':""}<button type="button" class="x" data-ph="${+p}" aria-label="Supprimer la photo">×</button></div>`).join(""):'<p class="small muted">Aucune photo pour le moment.</p>'};drawPh();
      $("#phGrid").onclick=async e=>{const x=e.target.closest("[data-ph]");if(!x)return;try{await api("DELETE","/api/admin/restaurants/"+encodeURIComponent(id)+"/photos/"+x.dataset.ph);f.photos=f.photos.filter(p=>p!==+x.dataset.ph);drawPh();delete ficheCache[id]}catch(er){toast(er.message)}};
      $("#phIn").onchange=async e=>{for(const file of e.target.files){try{const data=await imageVersData(file);const r=await api("POST","/api/admin/restaurants/"+encodeURIComponent(id)+"/photos",{data});f.photos.push(r.id);drawPh()}catch(er){toast(er.message)}}e.target.value="";delete ficheCache[id]};
      const err=m=>{const x=$("#fErr");x.textContent=m;x.hidden=false};
      const enregistrer=()=>api("PUT","/api/admin/restaurants/"+encodeURIComponent(id),{resto:{...readFiche(),...readConfig(),commande:{emporter:$("#c_emp").checked,livraison:$("#c_liv").checked,seul:$("#c_seul").checked,frais:+$("#c_frais").value||0,min:+$("#c_min").value||0,delai:+$("#c_delai").value||0}},menu:readMenu()});
      const apres=async m=>{delete ficheCache[id];await refreshAdminRestos();await loadCatalog();Object.keys(occ).forEach(k=>delete occ[k]);toast(m);renderPro()};
      $("#fSave").onclick=async()=>{$("#fErr").hidden=true;const b=$("#fSave");b.disabled=true;try{await enregistrer();await apres("Fiche enregistrée")}catch(e){err(e.message);b.disabled=false}};
      const sub=$("#fSubmit");if(sub)sub.onclick=async()=>{$("#fErr").hidden=true;sub.disabled=true;try{await enregistrer();await api("POST","/api/admin/restaurants/"+encodeURIComponent(id)+"/soumettre");await apres("Fiche envoyée à l'équipe Tablô")}catch(e){err(e.message);sub.disabled=false}}};
    if(ficheCache[id])show(ficheCache[id]);else api("GET","/api/admin/restaurants/"+encodeURIComponent(id)).then(f=>{ficheCache[id]=f;show(f)}).catch(onErr);
  }
  if(proTab==="releve"){api("GET","/api/admin/releve").then(d=>{const t=d.lignes.reduce((a,x)=>a+x.total,0);
      body.innerHTML=d.lignes.length?`<div class="kpis"><div class="kpi"><small>Mois</small><b class="num" style="font-size:22px">${esc(d.mois)}</b></div><div class="kpi"><small>Clients venus</small><b class="num">${d.lignes.reduce((a,x)=>a+x.clients,0)}</b></div><div class="kpi"><small>No-show</small><b class="num">${d.lignes.reduce((a,x)=>a+x.noshows,0)}</b></div><div class="kpi"><small>Total du mois</small><b class="num" style="font-size:22px">${F(t)}</b></div></div>
      <div class="panel"><div class="tbl-wrap"><table><thead><tr><th>Établissement</th><th>Offre</th><th>Clients venus</th><th>Abonnement</th><th>Par client</th><th>Total</th></tr></thead><tbody>${d.lignes.map(x=>`<tr><td><b>${esc(x.n)}</b></td><td>${esc(x.offre)}</td><td class="num">${x.clients}</td><td class="num">${F(x.abonnement)}</td><td class="num">${F(x.commission)}</td><td class="num"><b>${F(x.total)}</b></td></tr>`).join("")}</tbody></table></div></div>`:'<div class="empty">Aucun établissement partenaire en ligne pour le moment. Les restaurants d\'exemple ne sont pas facturés.</div>'}).catch(onErr)}
  if(proTab==="ajout"){
    body.innerHTML=`<div class="panel"><h3>Informations</h3>${ficheForm()}</div>
      <p class="err" id="fErr" hidden></p><button class="btn" id="fAdd" style="margin-top:14px">${isSuper?"Créer et mettre en ligne":"Créer et configurer"}</button>`;
    bindFicheForm();
    $("#fAdd").onclick=async()=>{const b=$("#fAdd"),err=$("#fErr");err.hidden=true;b.disabled=true;
      try{const d=await api("POST","/api/admin/restaurants",{resto:readFiche()});adminRestos=d.restos||adminRestos;store.set("proR",d.id);await loadCatalog();toast("Établissement créé");proTab="fiche";renderPro()}
      catch(e){err.textContent=e.message;err.hidden=false;b.disabled=false}}}
  if(proTab==="demandes"){
    const L={nouveau:["À rappeler","warn"],contacte:["Contacté","info"],entretien:["Échange prévu","warn"],entretien_fait:["Échange réalisé","ok"],compte_cree:["Compte créé","ok"],refuse:["Refusé","bad"]};
    const quandTxt=q=>new Date(q).toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"})+" à "+hm(q.slice(11));
    const load=()=>api("GET","/api/admin/leads").then(d=>{const l=d.leads;
      body.innerHTML=l.length?`<div class="panel"><div class="tbl-wrap"><table><thead><tr><th>Établissement</th><th>Contact</th><th>Reçue le</th><th>Statut</th><th>Offre et action</th></tr></thead><tbody>
        ${l.map(x=>`<tr><td><b>${esc(x.resto)}</b><div class="small muted">${esc(x.type)} · ${esc(x.commune)}${x.tables?" · "+(+x.tables)+" tables":""}</div>${x.message?`<div class="small">« ${esc(x.message)} »</div>`:""}</td>
          <td>${esc(x.gerant)}<div class="small"><a href="tel:${esc(x.tel)}">${esc(x.tel)}</a></div><div class="small muted">${esc(x.mail)}</div></td>
          <td class="small num">${new Date(x.created).toLocaleDateString("fr-FR")}</td><td><span class="pill ${L[x.status][1]}">${L[x.status][0]}</span>${x.status==="entretien"&&x.entretien_at?`<div class="small"><b>${x.entretien_mode==="appel"?"Appel":"Entretien"}</b> · ${esc(quandTxt(x.entretien_at))}<br><span class="muted">${esc(x.entretien_lieu||"")}</span></div>`:""}</td>
          <td>${x.status==="compte_cree"?`<div class="acts"><span class="small muted">${PLANS[x.plan]?PLANS[x.plan].l:""}</span><button class="btn ghost sm" data-relink="${+x.id}">Renvoyer le lien</button></div>`:x.status==="refuse"?`<button class="btn ghost sm" data-ls="nouveau" data-id="${+x.id}">Rouvrir</button>`:`<div class="acts">${x.status==="entretien_fait"?`<select class="plain" data-plan="${+x.id}" aria-label="Offre">${Object.entries(PLANS).map(([k,p])=>`<option value="${k}" ${k===x.plan?"selected":""}>${p.l}</option>`).join("")}</select><button class="btn green sm" data-make="${+x.id}">Créer le compte</button>`:x.status==="entretien"?`<button class="btn green sm" data-ls="entretien_fait" data-id="${+x.id}">Échange réalisé</button><button class="btn ghost sm" data-plani="${+x.id}">Reporter</button>`:`<button class="btn green sm" data-plani="${+x.id}">Planifier un échange</button>${x.status==="nouveau"?`<button class="btn ghost sm" data-ls="contacte" data-id="${+x.id}">Contacté</button>`:""}`}<button class="btn ghost sm" data-ls="refuse" data-id="${+x.id}">Refuser</button></div>`}</td></tr>`).join("")}
        </tbody></table></div></div>`:'<div class="empty">Aucune demande pour le moment.</div>';
      body.querySelectorAll("[data-ls]").forEach(b=>b.onclick=()=>api("PATCH","/api/admin/leads/"+b.dataset.id,{status:b.dataset.ls}).then(load).catch(e=>toast(e.message)));
      body.querySelectorAll("[data-plani]").forEach(b=>b.onclick=()=>{const x=l.find(y=>y.id===+b.dataset.plani);
        openDlg("Échange · "+esc(x.resto),`<div class="form"><label class="full">Format<select id="enMode"><option value="sur_place" ${x.entretien_mode==="appel"?"":"selected"}>Entretien sur place</option><option value="appel" ${x.entretien_mode==="appel"?"selected":""}>Appel téléphonique</option></select></label><label class="full">Date et heure<input id="enQuand" type="datetime-local" value="${esc(x.entretien_at||"")}"></label><label class="full" id="enLieuL">Lieu<input id="enLieu" maxlength="200" value="${esc(x.entretien_lieu||store.get("enLieu",""))}" placeholder="Adresse de nos bureaux, ou sur place dans l'établissement"></label></div><p class="small muted">${esc(x.gerant)} sera prévenu par SMS et par e-mail.</p><p class="err" id="enErr" hidden></p><button class="btn" id="enOk">Prévenir le gérant</button>`);
        const majMode=()=>{$("#enLieuL").hidden=$("#enMode").value==="appel"};$("#enMode").onchange=majMode;majMode();
        $("#enOk").onclick=async()=>{const e=$("#enErr");e.hidden=true;try{await api("POST","/api/admin/leads/"+x.id+"/entretien",{mode:$("#enMode").value,quand:$("#enQuand").value,lieu:$("#enLieu").value});if($("#enMode").value!=="appel")store.set("enLieu",$("#enLieu").value);dlg.close();toast("Échange planifié, gérant prévenu");load()}catch(er){e.textContent=er.message;e.hidden=false}}});
      const lienDlg=(titre,d)=>{openDlg(titre,`<p>Le lien d'activation part par e-mail à <b>${esc(d.mail)}</b> si l'envoi est configuré. Tu peux aussi le transmettre par WhatsApp :</p><input class="lg-in" id="actUrl" readonly value="${esc(d.url)}"><div class="row" style="margin-top:12px"><button class="btn" id="actCopy">Copier le lien</button><button class="btn ghost" data-close>Fermer</button></div>`);
          inner.querySelectorAll("[data-close]").forEach(c=>c.onclick=()=>dlg.close());$("#actCopy").onclick=()=>{$("#actUrl").select();navigator.clipboard&&navigator.clipboard.writeText(d.url);toast("Lien copié")}};
      body.querySelectorAll("[data-relink]").forEach(b=>b.onclick=async()=>{const x=l.find(y=>y.id===+b.dataset.relink);if(!confirm("Envoyer un nouveau lien à "+x.mail+" ? L'ancien lien ne fonctionnera plus."))return;b.disabled=true;
        try{lienDlg("Nouveau lien d'activation",await api("POST","/api/admin/leads/"+b.dataset.relink+"/lien",{}))}catch(e){toast(e.message)}b.disabled=false});
      body.querySelectorAll("[data-make]").forEach(b=>b.onclick=async()=>{b.disabled=true;
        try{const d=await api("POST","/api/admin/leads/"+b.dataset.make+"/compte",{plan:body.querySelector('[data-plan="'+b.dataset.make+'"]').value});await refreshAdminRestos();
          lienDlg("Compte créé",d);load()}
        catch(e){b.disabled=false;toast(e.message)}})
    }).catch(onErr);load()}
  if(proTab==="etabs"){
    api("GET","/api/admin/restaurants").then(d=>{const list=d.restaurants;const n=f=>list.filter(f).length;
      body.innerHTML=`<div class="kpis"><div class="kpi"><small>À publier</small><b class="num">${n(x=>x.status==="en_attente"&&x.submitted)}</b></div><div class="kpi"><small>En configuration</small><b class="num">${n(x=>x.status==="en_attente"&&!x.submitted)}</b></div><div class="kpi"><small>En ligne</small><b class="num">${n(x=>x.status==="valide")}</b></div>
        <div class="kpi"><small>Suspendus ou refusés</small><b class="num">${n(x=>x.status==="suspendu"||x.status==="refuse")}</b></div></div>
        <div class="panel"><div class="tbl-wrap"><table><thead><tr><th>Établissement</th><th>Gérant</th><th>Offre</th><th>Statut</th><th>Action</th></tr></thead><tbody>
        ${list.map(x=>`<tr><td><b>${esc(x.n)}</b><div class="small muted">${esc(x.t)} · ${esc(x.cu)} · ${esc(x.q)}, ${esc(x.c)}${x.demo?" · exemple":""}</div></td>
          <td>${x.gerant?`${esc(x.gerant)}<div class="small muted">${esc(x.mail||"")}${x.tel?" · "+esc(x.tel):""}</div>`:`<span class="small muted">Équipe Tablô</span>`}</td>
          <td class="small">${PLANS[x.plan]?PLANS[x.plan].l:""}</td><td><span class="pill ${stL(x)[1]}">${stL(x)[0]}</span></td>
          <td><div class="acts">${(x.status==="en_attente"&&x.submitted)||x.status==="suspendu"?`<button class="btn green sm" data-st="valide" data-id="${esc(x.id)}">Publier</button>`:""}${x.status==="en_attente"&&x.submitted?`<button class="btn ghost sm" data-st="refuse" data-id="${esc(x.id)}">Refuser</button>`:""}${x.status==="valide"?`<button class="btn ghost sm" data-st="suspendu" data-id="${esc(x.id)}">Suspendre</button>`:""}<button class="btn ghost sm" data-open="${esc(x.id)}">Fiche</button></div></td></tr>`).join("")}
        </tbody></table></div></div>`;
      body.querySelectorAll("[data-st]").forEach(b=>b.onclick=async()=>{const st=b.dataset.st;let motif="";
        if(st==="refuse"){motif=prompt("Motif du refus (envoyé au gérant par e-mail) :","")||"";}
        if(st==="suspendu"&&!confirm("Suspendre cet établissement ? Il ne sera plus visible par les clients."))return;
        b.disabled=true;try{await api("PATCH","/api/admin/restaurants/"+encodeURIComponent(b.dataset.id)+"/status",{status:st,motif});await refreshAdminRestos();await loadCatalog();delete ficheCache[b.dataset.id];
          toast(st==="valide"?"Établissement publié":st==="refuse"?"Fiche refusée":"Établissement suspendu");renderPro()}catch(e){b.disabled=false;toast(e.message)}});
      body.querySelectorAll("[data-open]").forEach(b=>b.onclick=()=>{store.set("proR",b.dataset.open);proTab="fiche";renderPro()});
    }).catch(onErr)}
}

/* ---------- Page publique : rejoindre Tablô (demande de contact) ---------- */
function renderProRegister(){
  if(admin){location.hash="pro";return}
  let plan="essentiel";
  $("#main").innerHTML=`<div class="adm-login"><div class="adm-card reg-card">
    <a class="logo" href="#accueil" aria-label="Tablô, retour au site client"><span class="logo-mark"></span><span><b>Tablô</b><small>Pour les restaurateurs</small></span></a>
    <div><h1>Fais connaître ton établissement à Abidjan</h1><p class="muted">Restaurant, maquis ou lounge : laisse tes coordonnées et l'équipe Tablô te contacte pour un appel ou un entretien.</p></div>
    <ol class="how-steps"><li><b>1. Ta demande</b><span>Tu remplis ce formulaire.</span></li><li><b>2. L'échange</b><span>Appel ou entretien : on choisit ton offre. Ton accès est créé ensuite.</span></li><li><b>3. Ta configuration</b><span>Fiche, photos, menu, salle et services.</span></li><li><b>4. En ligne</b><span>Tablô vérifie puis publie.</span></li></ol>
    <h2 class="reg-h">Nos offres</h2>
    <div class="plans" id="plans">${Object.entries(PLANS).map(([k,p])=>`<button type="button" class="plan" data-plan="${k}" aria-pressed="${k===plan}"><b>${p.l}</b><small>${p.d}</small><span class="price num">${F(p.prix)}<small> / mois</small></span><small class="num">+ ${F(p.couvert)} par client venu via Tablô</small><ul>${p.f.map(x=>`<li>${x}</li>`).join("")}</ul></button>`).join("")}</div>
    <h2 class="reg-h">Ta demande</h2>
    <div class="form">
      <label class="full">Nom de l'établissement<input id="l_resto" maxlength="80" placeholder="Ex. Chez Tantie Akissi"></label>
      <label>Type<select id="l_type">${TYPES.map(t=>`<option>${esc(t)}</option>`).join("")}</select></label>
      <label>Commune<select id="l_com">${CN.map(c=>`<option>${esc(c)}</option>`).join("")}</select></label>
      <label>Ton nom<input id="l_nom" autocomplete="name" placeholder="Aya Koné"></label>
      <label>Nombre de tables (facultatif)<input id="l_tables" type="number" min="1" max="200"></label>
      <label>Téléphone<input id="l_tel" inputmode="tel" autocomplete="tel" placeholder="07 12 34 56 78"></label>
      <label>E-mail<input id="l_mail" type="email" autocomplete="email" placeholder="contact@monrestaurant.ci"></label>
      <label class="full">Message (facultatif)<textarea id="l_msg" rows="2" maxlength="800" placeholder="Le meilleur moment pour t'appeler, tes questions…"></textarea></label></div>
    <p class="err" id="rErr" role="alert" hidden></p>
    <button class="btn" id="rSend">Envoyer ma demande</button>
    <div class="adm-join"><span>Tu as déjà un compte gérant ? Connecte-toi avec ton e-mail ou ton téléphone, et ton mot de passe.</span><a class="btn ghost" href="#gerant">Se connecter</a></div>
    <a class="adm-back" href="#accueil">← Retour au site client</a></div></div>`;
  $("#plans").onclick=e=>{const b=e.target.closest("[data-plan]");if(!b)return;plan=b.dataset.plan;document.querySelectorAll("#plans .plan").forEach(x=>x.setAttribute("aria-pressed",x===b))};
  $("#rSend").onclick=async()=>{const err=$("#rErr"),b=$("#rSend");err.hidden=true;b.disabled=true;b.textContent="Envoi…";
    try{await api("POST","/api/pro/demande",{resto:$("#l_resto").value,type:$("#l_type").value,commune:$("#l_com").value,gerant:$("#l_nom").value,tables:$("#l_tables").value,tel:$("#l_tel").value,mail:$("#l_mail").value,message:$("#l_msg").value,plan});
      document.querySelector(".reg-card").innerHTML=`<div class="confirm"><h2>Demande envoyée !</h2><p>Merci. Il n'y a plus rien à faire de ton côté : l'équipe Tablô va t'appeler pour fixer ton rendez-vous (appel ou entretien).</p><p class="small muted">Ton accès à l'espace restaurateur sera créé après ce rendez-vous. Tu le recevras par e-mail.</p><a class="btn ghost" href="#accueil">Retour au site</a></div>`}
    catch(e){b.disabled=false;b.textContent="Envoyer ma demande";err.textContent=e.message;err.hidden=false}};
}
/* ---------- Activation du compte gérant ---------- */
function renderActivation(token){
  $("#main").innerHTML=`<div class="adm-login"><div class="adm-card" id="actCard"><p class="muted">Vérification du lien…</p></div></div>`;
  api("GET","/api/pro/activation?token="+encodeURIComponent(token)).then(a=>{
    $("#actCard").innerHTML=`<a class="logo" href="#accueil"><span class="logo-mark"></span><span><b>Tablô</b><small>Espace restaurateur</small></span></a>
      <div><h1>Bonjour ${esc(a.nom.split(" ")[0])} !</h1><p class="muted">Choisis ton mot de passe pour ${esc(a.mail)}.</p></div>
      <form id="actForm" class="adm-form" novalidate><label>Mot de passe<input id="a_p" type="password" autocomplete="new-password" placeholder="8 caractères, lettres et chiffres"></label><label>Confirmation<input id="a_p2" type="password" autocomplete="new-password"></label><p class="err" id="aErr" role="alert" hidden></p><button class="btn">Enregistrer mon mot de passe</button></form>`;
    $("#actForm").onsubmit=async e=>{e.preventDefault();const x=$("#aErr");x.hidden=true;if($("#a_p").value!==$("#a_p2").value){x.textContent="Les deux mots de passe ne correspondent pas.";x.hidden=false;return}
      try{const d=await api("POST","/api/pro/activation",{token,pass:$("#a_p").value});admin=d.admin;adminRestos=d.restos||[];const last=adminRestos[adminRestos.length-1];if(last)store.set("proR",last.id);proTab="fiche";ficheCache={};toast("Mot de passe enregistré");location.hash="pro"}
      catch(er){x.textContent=er.message;x.hidden=false}}
  }).catch(e=>{$("#actCard").innerHTML=`<h1>Lien non valable</h1><p class="muted">${esc(e.message)}</p><a class="btn ghost" href="#accueil">Retour au site</a>`});
}

/* ---------- VIEW: PRO ---------- */
let proTab="service",cmdPoll=null;
function proData(id){
  const r=byId(id);
  if(!pro[id]&&!r.demo)pro[id]={rows:[],wait:[],stock:Object.values(MENUS[r.m]||{}).flat().filter(x=>x[1]>0).slice(0,8).map(d=>({p:d[0],prix:d[1],q:0,promo:false})),orders:[]};
  if(!pro[id]){const n=7+hash(id)%5,rows=[];
    for(let i=0;i<n;i++){const m=12*60+((hash(id+i)%20)*30);rows.push({k:"s"+i,time:String(Math.floor(m/60)).padStart(2,"0")+":"+String(m%60).padStart(2,"0"),nom:FIRST[hash(id+"n"+i)%FIRST.length]+" "+String.fromCharCode(65+hash(id+"l"+i)%26)+".",pers:2+hash(id+"p"+i)%5,status:["attendu","arrivé","attendu","attendu","parti"][hash(id+"s"+i)%5],table:1+hash(id+"t"+i)%Math.min(r.tables,16),src:i%3?"Tablô":"Téléphone"})}
    const dishes=Object.values(MENUS[r.m]).flat().filter(x=>x[1]>0);
    pro[id]={rows,wait:[{k:"w0",nom:"Yao K.",pers:3,since:"20:05",tel:"0707070707"}],stock:dishes.slice(0,4).map((d,i)=>({p:d[0],prix:d[1],q:hash(id+d[0])%7,promo:false})),orders:[]}}
  return pro[id];
}
function savePro(id){api("PUT","/api/admin/resto/"+encodeURIComponent(id),pro[id]).catch(e=>{if(e.status===401){admin=null;renderAdminLogin()}toast(e.message)})}
function renderPro(){
  if(EXTRA_TABS.includes(proTab))return renderProExtra();
  const valid=adminRestos.filter(x=>x.status==="valide"&&byId(x.id));
  if(!valid.length){proTab=admin&&admin.role==="super"?"etabs":"fiche";return renderProExtra()}
  const sel=store.get("proR",valid[0].id);const id=valid.some(x=>x.id===sel)?sel:valid[0].id;const r=byId(id);
  if(!planAutorise(id,proTab))proTab="service";
  if(!(id in proResas)){$("#main").innerHTML=`<div class="adm-login"><p style="color:#fff">Chargement de l'espace restaurateur…</p></div>`;
    api("GET","/api/admin/resto/"+encodeURIComponent(id)).then(d=>{proResas[id]=d.resas||[];proStats[id]={week:d.week||[],top:d.top||[],retraits:d.retraits||[],commandes:d.commandes||[]};if(d.state&&d.state.rows)pro[id]=d.state;else{delete pro[id];proData(id);savePro(id)}if(view()==="pro")renderPro()})
      .catch(e=>{if(e.status===401){admin=null;renderAdminLogin()}else{$("#main").innerHTML=`<div class="adm-login"><div class="adm-card"><h1>Serveur injoignable</h1><p class="muted">${esc(e.message)}</p><button class="btn" onclick="location.reload()">Réessayer</button></div></div>`}});return}
  const D=proData(id);
  const tdy=iso(today);
  D.stock.forEach(s=>{if(s.promo&&s.date!==tdy)s.promo=false});
  const mine=proResas[id].filter(x=>x.date===tdy&&["confirmée","honorée","no-show"].includes(x.status)).map(x=>({k:x.id,time:x.time,nom:x.nom,pers:x.pers,status:x.status==="honorée"?"arrivé":x.status==="no-show"?"no-show":"attendu",table:(x.tables||[])[0]||1,tbls:x.tables,src:"Tablô · "+x.code,live:true,pre:x.pre,occ:x.occ,note:x.note}));
  const rows=[...D.rows.filter(x=>!x.date||x.date===tdy),...mine].sort((a,b)=>a.time.localeCompare(b.time));
  const cov=rows.reduce((s,x)=>s+(x.status!=="no-show"?x.pers:0),0),arr=rows.filter(x=>x.status==="arrivé"||x.status==="parti").length,ns=rows.filter(x=>x.status==="no-show").length;
  const allPre=proResas[id].filter(x=>x.pre&&x.pre.length&&x.status==="confirmée");
  const IC={service:'<path d="M3 11h18M5 11V7a7 7 0 0 1 14 0v4M4 15h16l-1 5H5z"/>',cuisine:'<path d="M6 3v8a3 3 0 0 0 6 0V3M9 3v18M17 3c-2 2-2 6 0 8v10"/>',stats:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'};
  const TABS=[["service","Service & salle","Réservations du jour, plan de salle et liste d'attente."],["commandes","Commandes","À emporter et en livraison. La liste se met à jour toute seule."],["cuisine","Cuisine & anti-gaspi","Pré-commandes à lancer et invendus du soir."],["stats","Statistiques & avis","Fréquentation, plats phares et avis clients."]];
  const cur=TABS.find(t=>t[0]===proTab)||TABS[0];
  const waitN=D.wait.length,preN=allPre.length+(r.demo?1:0),cmds=proStats[id].commandes||[],cmdEnCours=cmds.filter(x=>!["terminée","annulée"].includes(x.status));
  $("#main").innerHTML=`<div class="pro-shell">
    ${proSide(id,{service:waitN,cuisine:preN,commandes:cmdEnCours.length})}
    <div class="pro-main">
      <div class="pro-title"><div><h1>${cur[1]}</h1><p class="muted">${cur[2]}</p></div><button class="btn ghost sm" id="proRefresh" type="button">↻ Actualiser</button></div>
      <div class="kpis" ${proTab==="commandes"?"hidden":""}>
        <div class="kpi"><small>Couverts prévus</small><b class="num">${cov}</b><span class="small muted">aujourd'hui</span></div>
        <div class="kpi"><small>Arrivés</small><b class="num">${arr}<span class="muted" style="font-size:18px"> / ${rows.length}</span></b><div class="kbar"><i style="width:${rows.length?arr/rows.length*100:0}%"></i></div></div>
        <div class="kpi ${ns?"alert":""}"><small>No-show</small><b class="num">${ns}</b><span class="small muted">${ns?"à relancer par SMS":"aucun pour l'instant"}</span></div>
        <div class="kpi"><small>CA estimé</small><b class="num" style="font-size:24px">${F(cov*BUD_AVG[r.b])}</b><span class="small muted">panier moyen ${F(BUD_AVG[r.b])}</span></div>
      </div>
      <div id="proBody"></div>
    </div></div>`;
  bindProSide();
  $("#proRefresh").onclick=()=>{delete proResas[id];renderPro()};
  const body=$("#proBody");const pill={attendu:"warn","arrivé":"ok","no-show":"bad",parti:"info"};
  if(proTab==="service"){
    const busy=new Set(rows.filter(x=>x.status==="arrivé").flatMap(x=>x.tbls||[x.table])),held=new Set(rows.filter(x=>x.status==="attendu").flatMap(x=>x.tbls||[x.table]));
    const tableLibre=()=>{const t=SLOTS.salle(r).find(t=>!busy.has(t.n)&&!held.has(t.n));return t?t.n:SLOTS.salle(r)[0].n};
    body.innerHTML=`<div class="pro-grid"><div style="display:flex;flex-direction:column;gap:18px;min-width:0">
      <div class="panel"><h3>Réservations du jour</h3><div class="tbl-wrap"><table><thead><tr><th>Heure</th><th>Client</th><th>Pers.</th><th>Source</th><th>Statut</th><th>Action</th></tr></thead><tbody>
      ${rows.map(x=>`<tr><td class="num"><b>${hm(x.time)}</b></td><td>${esc(x.nom)}<div class="small muted">Table ${(x.tbls||[x.table]).join(" + ")}${x.occ?" · "+x.occ:""}${x.pre&&x.pre.length?" · pré-commande":""}</div></td><td class="num">${x.pers}</td><td class="small">${x.src}</td><td><span class="pill ${pill[x.status]}">${x.status}</span></td>
        <td><div class="acts">${x.status==="attendu"?`<button class="btn green sm" data-k="${x.k}" data-s="arrivé">Arrivé</button><button class="btn ghost sm" data-k="${x.k}" data-s="no-show">No-show</button>`:x.status==="arrivé"?`<button class="btn ghost sm" data-k="${x.k}" data-s="parti">Table libérée</button>`:`<button class="btn ghost sm" data-k="${x.k}" data-s="attendu">Rétablir</button>`}</div></td></tr>`).join("")}</tbody></table></div></div>
      <div class="panel"><h3>Ajouter un client sans réservation</h3><form class="inline-form" id="walkin"><input id="wiNom" placeholder="Nom" aria-label="Nom"><input id="wiPers" type="number" min="1" max="20" value="2" aria-label="Personnes" style="flex:0 1 80px"><button class="btn green sm">Installer</button></form></div></div>
      <div style="display:flex;flex-direction:column;gap:18px;min-width:0">
      <div class="panel"><h3>Plan de salle</h3><div class="floor">${SLOTS.salle(r).map(t=>{const n=t.n,c=busy.has(n)?"busy":held.has(n)?"held":"";return `<div class="tbl ${c}">T${n}<small>${t.cap} pl. · ${esc(t.zone)}</small><small>${c==="busy"?"occupée":c==="held"?"réservée":"libre"}</small></div>`}).join("")}</div>
        <div class="legend"><span><i style="background:var(--bg)"></i>Libre</span><span><i style="background:var(--petrol-soft)"></i>Réservée</span><span><i style="background:var(--orange-soft)"></i>Occupée</span></div></div>
      <div class="panel"><h3>Liste d'attente</h3>${D.wait.length?`<ul class="stock">${D.wait.map(w=>`<li><span><b>${esc(w.nom)}</b> · ${w.pers} pers.<br><span class="small muted">depuis ${hm(w.since)} · ${w.tel}</span></span><span class="acts"><button class="btn green sm" data-wsms="${w.k}">Prévenir par SMS</button><button class="btn ghost sm" data-wseat="${w.k}">Installer</button></span></li>`).join("")}</ul>`:`<p class="small muted">Personne en attente.</p>`}
        <form class="inline-form" id="waitAdd"><input id="waNom" placeholder="Nom" aria-label="Nom"><input id="waTel" inputmode="tel" placeholder="Téléphone" aria-label="Téléphone" style="flex:1 1 110px"><input id="waPers" type="number" min="1" max="20" value="2" aria-label="Personnes" style="flex:0 1 70px"><button class="btn ghost sm">Ajouter</button></form></div></div></div>`;
    body.querySelectorAll("[data-k]").forEach(b=>b.onclick=()=>{const row=D.rows.find(x=>x.k===b.dataset.k);
      if(row)row.status=b.dataset.s;else{const m=proResas[id].find(x=>x.id===b.dataset.k);if(m){const s=b.dataset.s;b.disabled=true;
        api("PATCH","/api/admin/reservations/"+m.id,{status:s}).then(d=>{const was=m.status;m.status=d.status;if(s==="arrivé"&&was!=="honorée")toast("Client arrivé : +100 pts crédités sur son compte Tablô");if(s==="parti")toast("Table libérée et proposée à la liste d'attente");renderPro()}).catch(e=>{toast(e.message);renderPro()});return}}
      if(b.dataset.s==="parti")toast("Table libérée et proposée à la liste d'attente");savePro(id);renderPro()});
    $("#walkin").onsubmit=e=>{e.preventDefault();const n=$("#wiNom").value.trim()||"Client sur place";const now=new Date();D.rows.push({k:"wi"+Date.now(),time:String(now.getHours()).padStart(2,"0")+":"+String(now.getMinutes()<30?0:30).padStart(2,"0"),nom:n,pers:+$("#wiPers").value||2,status:"arrivé",table:tableLibre(),date:tdy,src:"Sur place"});savePro(id);toast(n+" installé");renderPro()};
    $("#waitAdd").onsubmit=e=>{e.preventDefault();const n=$("#waNom").value.trim();if(!n)return;const now=new Date();D.wait.push({k:"w"+Date.now(),nom:n,pers:+$("#waPers").value||2,since:String(now.getHours()).padStart(2,"0")+":"+String(now.getMinutes()).padStart(2,"0"),tel:($("#waTel").value||"").trim()||"—"});savePro(id);renderPro()};
    body.querySelectorAll("[data-wsms]").forEach(b=>b.onclick=()=>{const w=D.wait.find(x=>x.k===b.dataset.wsms);b.disabled=true;api("POST","/api/admin/sms/table-ready",{tel:w.tel,rid:id}).then(d=>toast(d.sent?"SMS envoyé à "+w.nom+" : table prête":"SMS simulé (fournisseur non configuré)")).catch(e=>toast(e.message)).finally(()=>{b.disabled=false})});
    body.querySelectorAll("[data-wseat]").forEach(b=>b.onclick=()=>{const w=D.wait.find(x=>x.k===b.dataset.wseat);D.wait=D.wait.filter(x=>x!==w);const now=new Date();D.rows.push({k:"ws"+Date.now(),time:String(now.getHours()).padStart(2,"0")+":"+(now.getMinutes()<30?"00":"30"),nom:w.nom,pers:w.pers,status:"arrivé",table:tableLibre(),date:tdy,src:"Liste d'attente"});savePro(id);renderPro()});
  }
  clearInterval(cmdPoll);
  if(proTab==="commandes"){
    const acts=x=>x.status==="reçue"?[["en préparation","Accepter","green"],["annulée","Refuser","ghost"]]:x.status==="en préparation"?[[x.mode==="livraison"?"en livraison":"prête",x.mode==="livraison"?"Partie en livraison":"Prête à retirer","green"],["annulée","Annuler","ghost"]]:x.status==="prête"?[["terminée","Retirée et payée","green"],["annulée","Non retirée","ghost"]]:x.status==="en livraison"?[["terminée","Livrée et payée","green"],["annulée","Échec","ghost"]]:[];
    const ligne=x=>`<li class="cmd"><div style="min-width:0"><b class="num">${esc(x.code)}</b> <span class="pill ${CMD_PILL[x.status]}">${esc(x.status)}</span> <span class="pill info">${x.mode==="livraison"?"Livraison":"À emporter"}</span>
      <div>${x.items.map(i=>i.q+" × "+esc(i.n)).join("<br>")}</div>
      <div class="small muted num">${esc(x.nom)} · <a href="tel:${esc(x.tel)}">${esc(x.tel)}</a> · ${new Date(x.created).toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})} · <b>${F(x.total)}</b></div>
      ${x.adresse?`<div class="small"><b>Adresse :</b> ${esc(x.adresse)}</div>`:""}${x.note?`<div class="small"><b>Note :</b> ${esc(x.note)}</div>`:""}</div>
      <div class="acts">${acts(x).map(a=>`<button class="btn ${a[2]} sm" data-cmd="${esc(x.id)}" data-cs="${esc(a[0])}">${a[1]}</button>`).join("")}</div></li>`;
    const fini=cmds.filter(x=>["terminée","annulée"].includes(x.status));
    body.innerHTML=`${r.commande&&(r.commande.emporter||r.commande.livraison)?"":`<div class="pro-banner-st warn"><b>Commandes désactivées.</b> Active-les dans « Ma fiche & configuration », étape 6.</div>`}
      <div class="panel"><h3>En cours (${cmdEnCours.length})</h3>${cmdEnCours.length?`<ul class="stock cmds">${cmdEnCours.map(ligne).join("")}</ul>`:'<p class="small muted">Aucune commande en cours.</p>'}</div>
      ${fini.length?`<div class="panel" style="margin-top:18px"><h3>Dernières 24 heures</h3><ul class="stock cmds">${fini.map(ligne).join("")}</ul></div>`:""}`;
    body.querySelectorAll("[data-cmd]").forEach(b=>b.onclick=()=>{b.disabled=true;api("PATCH","/api/admin/commandes/"+b.dataset.cmd,{status:b.dataset.cs}).then(d=>{proStats[id].commandes=d.commandes;renderPro()}).catch(e=>{toast(e.message);delete proResas[id];renderPro()})});
    cmdPoll=setInterval(()=>{if(view()!=="pro"||proTab!=="commandes"||!admin)return clearInterval(cmdPoll);if(document.hidden)return;
      api("GET","/api/admin/commandes?rid="+encodeURIComponent(id)).then(d=>{const avant=proStats[id].commandes||[];if(JSON.stringify(d.commandes)===JSON.stringify(avant))return;
        if(d.commandes.some(x=>!avant.some(y=>y.id===x.id)))toast("Nouvelle commande !");proStats[id].commandes=d.commandes;const y=scrollY;renderPro();scrollTo(0,y)}).catch(()=>{})},20000);
  }
  if(proTab==="cuisine"){
    const preRows=[...allPre.map(x=>({who:x.nom,time:x.time,date:x.date,items:x.pre,live:true})),...(r.demo?[{who:"Mariam T.",time:"20:30",date:tdy,items:[{n:Object.values(MENUS[r.m]).flat()[2][0],q:2}]}]:[])];
    body.innerHTML=`<div class="pro-grid"><div class="panel"><h3>Pré-commandes à préparer</h3><p class="small muted">Lancées en cuisine dès que le client est marqué arrivé.</p>
      <div class="tbl-wrap"><table><thead><tr><th>Arrivée</th><th>Client</th><th>Plats</th></tr></thead><tbody>${preRows.map(p=>`<tr><td class="num"><b>${hm(p.time)}</b>${p.date!==tdy?`<div class="small muted">${new Date(p.date+"T12:00").toLocaleDateString("fr-FR",{day:"numeric",month:"short"})}</div>`:""}</td><td>${esc(p.who)}${p.live?` <span class="pill info">Tablô</span>`:""}</td><td>${p.items.map(i=>i.q+" × "+esc(i.n)).join("<br>")}</td></tr>`).join("")}</tbody></table></div></div>
      <div class="panel"><h3>Portions à retirer aujourd'hui</h3>${proStats[id].retraits.length?`<ul class="stock">${proStats[id].retraits.map(x=>`<li><span><b>${esc(x.plat)}</b> · ${esc(x.nom)}<br><span class="small muted num">${esc(x.code)} · ${F(x.prix)}${x.tel?" · "+esc(x.tel):""}</span></span>${x.status==="en_attente"?`<button class="btn green sm" data-ret="${+x.id}">Retirée</button>`:`<span class="pill ${x.status==="retiré"?"ok":"bad"}">${esc(x.status)}</span>`}</li>`).join("")}</ul>`:'<p class="small muted">Aucune portion réservée pour le moment.</p>'}</div>
      <div class="panel"><h3>Anti-gaspillage du soir</h3><p class="small muted">Plats restants proposés à -40 % aux clients Tablô proches, à retirer avant la fermeture.</p>
      <ul class="stock">${D.stock.map((s,i)=>`<li><span><b>${esc(s.p)}</b><br><span class="small muted num">${s.promo?`<s>${F(s.prix)}</s> ${F(Math.round(s.prix*.6/100)*100)}`:F(s.prix)}</span></span>
        <span class="row"><span class="qty"><button type="button" data-sd="${i}" aria-label="Moins">−</button><b class="num">${s.q}</b><button type="button" data-su="${i}" aria-label="Plus">+</button></span>
        <button class="btn sm ${s.promo?"ghost":""}" data-promo="${i}" ${s.q?"":"disabled"}>${s.promo?"Retirer l'offre":"Proposer -40 %"}</button></span></li>`).join("")}</ul>
      <p class="small"><b class="num">${D.stock.filter(s=>s.promo).reduce((a,s)=>a+s.q,0)}</b> portions en vente · <b class="num">${F(D.stock.filter(s=>s.promo).reduce((a,s)=>a+s.q*Math.round(s.prix*.6/100)*100,0))}</b> récupérables ce soir</p></div></div>`;
    body.querySelectorAll("[data-su]").forEach(b=>b.onclick=()=>{D.stock[+b.dataset.su].q++;savePro(id);renderPro()});
    body.querySelectorAll("[data-sd]").forEach(b=>b.onclick=()=>{const s=D.stock[+b.dataset.sd];s.q=Math.max(0,s.q-1);if(!s.q)s.promo=false;savePro(id);renderPro()});
    body.querySelectorAll("[data-ret]").forEach(b=>b.onclick=()=>api("PATCH","/api/admin/retraits/"+b.dataset.ret,{status:"retiré"}).then(()=>{delete proResas[id];renderPro()}).catch(e=>toast(e.message)));
    body.querySelectorAll("[data-promo]").forEach(b=>b.onclick=()=>{const s=D.stock[+b.dataset.promo];s.promo=!s.promo;s.date=tdy;savePro(id);setTimeout(()=>loadCatalog(),300);toast(s.promo?"Offre publiée : "+s.p+" à -40 %":"Offre retirée");renderPro()});
  }
  if(proTab==="stats"){
    const hours=[12,13,14,15,16,17,18,19,20,21,22,23];const vals=hours.map(h=>rows.filter(x=>+x.time.slice(0,2)===h).reduce((s,x)=>s+x.pers,0)+(r.demo?hash(id+h)%6:0));
    const max=Math.max(...vals,5),W=560,H=200,bw=W/hours.length;
    const week=r.demo?["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"].map((d,i)=>({d,v:40+hash(id+d)%90+(i>=4?60:0)})):Array.from({length:7},(_,i)=>{const dd=new Date(today);dd.setDate(dd.getDate()-6+i);const k=iso(dd);return {d:dd.toLocaleDateString("fr-FR",{weekday:"short"}),v:(proStats[id].week.find(w=>w.date===k)||{}).v||0}});
    const revs=reviewsFor(r).slice(0,4),sub=subAvg(reviewsFor(r));
    const top=!r.demo?proStats[id].top:Object.values(MENUS[r.m]).flat().filter(x=>x[1]>0).slice(0,5).map(x=>({n:x[0],v:10+hash(id+x[0])%40})).sort((a,b)=>b.v-a.v);
    body.innerHTML=`<div class="pro-grid"><div style="display:flex;flex-direction:column;gap:18px;min-width:0">
      <div class="panel chart"><h3>Couverts par heure, aujourd'hui</h3><svg viewBox="0 0 ${W+40} ${H+40}" role="img" aria-label="Couverts par heure">
        ${[0,.5,1].map(f=>`<line x1="36" x2="${W+36}" y1="${10+H-H*f}" y2="${10+H-H*f}" stroke="var(--line)"/><text x="30" y="${14+H-H*f}" text-anchor="end" font-size="11" fill="var(--muted)">${Math.round(max*f)}</text>`).join("")}
        ${vals.map((v,i)=>`<rect x="${40+i*bw}" y="${10+H-v/max*H}" width="${bw-8}" height="${v/max*H}" rx="3" fill="${hours[i]>=19&&hours[i]<=21?"var(--orange)":"var(--petrol)"}"/><text x="${40+i*bw+(bw-8)/2}" y="${H+28}" text-anchor="middle" font-size="11" fill="var(--muted)">${hours[i]}h</text>`).join("")}
      </svg><p class="small muted">En rouge : de 19h à 21h.</p></div>
      <div class="panel chart"><h3>Couverts sur 7 jours</h3><svg viewBox="0 0 600 150" role="img" aria-label="Couverts sur 7 jours">
        ${(()=>{const mx=Math.max(...week.map(w=>w.v),1);const pts2=week.map((w,i)=>[40+i*85,15+110-w.v/mx*100]);return `<path d="M${pts2.map(p=>p.join(" ")).join(" L")} L${pts2[6][0]} 125 L40 125Z" fill="var(--petrol-soft)"/><path d="M${pts2.map(p=>p.join(" ")).join(" L")}" fill="none" stroke="var(--petrol)" stroke-width="2.5"/>${pts2.map((p,i)=>`<circle cx="${p[0]}" cy="${p[1]}" r="${i===6?5:3}" fill="${i===6?"var(--orange)":"var(--petrol)"}"/><text x="${p[0]}" y="143" text-anchor="middle" font-size="11" fill="var(--muted)">${week[i].d}</text><text x="${p[0]}" y="${p[1]-9}" text-anchor="middle" font-size="11" fill="var(--fg)">${week[i].v}</text>`).join("")}`})()}
      </svg></div></div>
      <div style="display:flex;flex-direction:column;gap:18px;min-width:0">
      <div class="panel"><h3>Plats les plus pré-commandés</h3><ul class="stock">${top.map(t=>`<li><span>${esc(t.n)}</span><b class="num">${t.v}</b></li>`).join("")}</ul></div>
      <div class="panel"><h3>Note ${noteTxt(r)} · ${r.avis} avis</h3>${sub.map((v,i)=>`<div class="subr"><span>${SUBL[i]}</span><div class="bar"><i style="width:${v/5*100}%"></i></div><b class="num">${v.toFixed(1)}</b></div>`).join("")}
        <h3 style="font-size:15px;margin-top:6px">Derniers avis</h3>${revs.map((v,i)=>`<div class="review" style="padding:8px 0"><div class="row"><b>${esc(v.nom)}</b><span class="stars">★ ${(v.sc.reduce((a,b)=>a+b)/4).toFixed(1)}</span></div><p class="small">${esc(v.txt)}</p>${v.reply?`<div class="reply">${esc(v.reply)}</div>`:v.id?`<button class="btn ghost sm" data-reply="${+v.id}" style="align-self:flex-start">Répondre</button>`:`<span class="small muted">Avis d'exemple</span>`}</div>`).join("")}</div></div></div>`;
    body.querySelectorAll("[data-reply]").forEach(b=>b.onclick=()=>{const rid2=b.dataset.reply,f=document.createElement("form");f.className="inline-form";f.innerHTML=`<input value="Merci pour votre visite, à bientôt !" aria-label="Réponse" maxlength="800"><button class="btn green sm">Publier</button>`;b.replaceWith(f);
      f.onsubmit=async e=>{e.preventDefault();const v=f.querySelector("input").value;try{await api("PATCH","/api/admin/reviews/"+rid2,{reply:v});await loadCatalog();toast("Réponse publiée");renderPro()}catch(er){toast(er.message)}}});
  }
}

/* ---------- ROUTER & GLOBAL EVENTS ---------- */
function view(){const h=(location.hash||(SITE_ADMIN?"#pro":"#accueil")).slice(1);if(h.startsWith("r-"))return"resto";if(h.startsWith("activer-"))return"activer";if(h==="gerant")return"pro";return["accueil","explorer","compte","pro","inscription-resto"].includes(h)?h:"accueil"}
function rerender(keepScroll=true){const y=scrollY;route(false);if(keepScroll)window.scrollTo(0,y)}
function route(top=true){
  if(changeSite())return;
  renderHeader();
  const v=view();
  if(v==="compte"&&!user&&admin){if(admin.role==="super")location.replace("/admin");else location.hash="gerant";return}
  if(v==="pro"&&admin){if(SITE_ADMIN&&admin.role!=="super"){location.replace("/#gerant");return}if(!SITE_ADMIN&&admin.role==="super"){location.replace("/admin");return}}document.body.classList.toggle("is-pro",["pro","inscription-resto","activer"].includes(v));document.querySelectorAll("nav.tabs a").forEach(a=>{if(a.dataset.view===v||(v==="resto"&&a.dataset.view==="explorer"))a.setAttribute("aria-current","page");else a.removeAttribute("aria-current")});
  if(v==="accueil")renderHome();if(v==="explorer")renderExplorer();if(v==="compte")user?renderAccount():renderAccountGate();if(v==="pro")admin?renderPro():renderAdminLogin();if(v==="inscription-resto")renderProRegister();if(v==="activer")renderActivation(location.hash.slice(9));
  if(v==="resto"){renderResto(location.hash.slice(3));const gf=$("#gmapFiche");if(gf&&byId(gf.dataset.r))monterCarte(gf,[byId(gf.dataset.r)])}
  if(top)window.scrollTo(0,0);
}
window.addEventListener("hashchange",()=>route(true));
document.addEventListener("click",e=>{
  const t=e.target;
  const fav=t.closest("[data-fav]");if(fav){e.stopPropagation();if(!user){needLogin("Connecte-toi pour garder tes adresses préférées");return}const id=fav.dataset.fav;favs.has(id)?favs.delete(id):favs.add(id);save();document.querySelectorAll(`[data-fav="${id}"]`).forEach(b=>b.setAttribute("aria-pressed",favs.has(id)));toast(favs.has(id)?"Ajouté aux favoris":"Retiré des favoris");return}
  const ord=t.closest("[data-order]");if(ord){e.stopPropagation();openOrder(byId(ord.dataset.order));return}
  const bk=t.closest("[data-book]");if(bk){e.stopPropagation();if(!bk.disabled)openBooking(byId(bk.dataset.book),bk.dataset.t);return}
  const ask=t.closest("[data-ask]");if(ask){st.ai=true;const a=parseFree(ask.dataset.ask);applyIntent(a);location.hash="explorer";if(view()==="explorer")rerender(false);return}
  const coll=t.closest("[data-coll]");if(coll){const k=coll.dataset.coll;["types","budgets","cuis","tags"].forEach(x=>st[x].clear());st.q="";st.openNow=false;st.orderOnly=k==="commander";
    if(k==="lagune")st.tags.add("Bord de lagune");if(k==="budget")st.budgets.add(1);if(k==="groupe")st.tags.add("Groupe");if(k==="nouveau")st.sort="new";if(k==="top")st.sort="note";if(k==="soir"){st.date=iso(today);st.time="20:00";st.sort="dispo";st.openNow=true}if(k==="experiences"){location.hash="accueil";setTimeout(()=>{const el=document.querySelector(".exp");el&&el.scrollIntoView({behavior:"smooth",block:"center"})},50);return}
    if(view()==="explorer")rerender(false);else location.hash="explorer";return}
  const of=t.closest("[data-offre]");if(of){if(!user){needLogin("Connecte-toi pour réserver une portion");return}of.disabled=true;
    api("POST","/api/offres/reserver",{rid:of.dataset.offre,p:of.dataset.offrep}).then(d=>{applyMe(d);offres=d.offres||[];renderHeader();
      openDlg("Portion réservée",`<div class="confirm"><h2>C'est noté !</h2><p>${esc(d.retrait.plat)} chez ${esc((byId(d.retrait.rid)||{}).n||"")}, ${F(d.retrait.prix)} à payer au retrait ce soir.</p><div class="code num">${esc(d.retrait.code)}</div><p class="small muted">Présente ce code au restaurant.</p><button class="btn ghost" data-close>Fermer</button></div>`);inner.querySelectorAll("[data-close]").forEach(c=>c.onclick=()=>dlg.close());rerender()})
      .catch(e=>{toast(e.message);loadCatalog().then(()=>rerender())});return}
  const dc=t.closest("[data-dc]");if(dc){["types","budgets","cuis","tags"].forEach(x=>st[x].clear());st.q="";st.commune=dc.dataset.dc;st.quartier=dc.dataset.dq||null;if(dc.dataset.dcu)st.cuis.add(dc.dataset.dcu);if(dc.dataset.dtag)st.tags.add(dc.dataset.dtag);save();renderLoc();location.hash="explorer";return}
  const go=t.closest("[data-go]");if(go){if(go.dataset.tab){if(go.dataset.go==="compte")accTab=go.dataset.tab;else proTab=go.dataset.tab}if(location.hash==="#"+go.dataset.go)route();else location.hash=go.dataset.go;return}
  const fq=t.closest("[data-faqtab]");if(fq){renderFaq(fq.dataset.faqtab);return}
  if(t.closest("[data-faq]")){if(view()!=="accueil"){location.hash="accueil";setTimeout(()=>$("#faq").scrollIntoView(),60)}else $("#faq").scrollIntoView({behavior:"smooth"});return}
  if(t.closest("[data-gift]")){openGift();return}
  const pv=t.closest("[data-private]");if(pv){openPrivate(pv.dataset.private==="1"?null:pv.dataset.private);return}
  const ex=t.closest("[data-exp]");if(ex){location.hash="r-"+ex.dataset.rid;return}
  const c=t.closest("[data-rid]");if(c&&!t.closest("button")){location.hash="r-"+c.dataset.rid;return}
});
document.addEventListener("keydown",e=>{if(e.key==="Enter"&&e.target.matches(".card,.map-item,.exp")){location.hash="r-"+e.target.dataset.rid}});
$("#themeBtn").onclick=()=>{const r=document.documentElement;const cur=r.dataset.theme||(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");r.dataset.theme=cur==="dark"?"light":"dark"};
$("#footCommunes").innerHTML=CN.slice(0,7).map(c=>`<li><button data-dc="${c}">Restaurants à ${c}</button></li>`).join("");

if(user&&user.com&&!st.commune)st.commune=user.com;
renderHeader();renderLoc();$("#main").innerHTML=`<div class="wrap page"><p class="muted">Chargement…</p></div>`;
Promise.all([api("GET","/api/me").catch(e=>{toast(e.message);return{}}),api("GET","/api/admin/me").catch(()=>({})),loadCatalog()]).then(([me,ad])=>{applyMe(me);admin=ad.admin||null;adminRestos=ad.restos||[];demoMode=ad.demo||null;if(user&&user.com&&!store.get("commune",null)){st.commune=user.com}renderHeader();renderLoc();route()});
})();
