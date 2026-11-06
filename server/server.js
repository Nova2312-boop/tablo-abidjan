/* Tablô Abidjan — backend Node.js + PostgreSQL.
   - Sert le site (index.html, css/, js/) et une API REST sous /api.
   - Base de données : PostgreSQL (connexion via DATABASE_URL dans le fichier .env).
     Les tables sont créées automatiquement au démarrage (server/schema.sql).
   - Clients : connexion par code à usage unique (OTP) envoyé par SMS/e-mail.
     En mode démo (DEMO_OTP=1), aucun SMS n'est envoyé : le code est renvoyé dans la réponse.
   - Administrateurs : e-mail + mot de passe haché (scrypt + sel), blocage après 5 échecs.
   - Sessions : jeton aléatoire (haché en base) dans un cookie HttpOnly, SameSite=Lax.
   Lancer :  npm install   puis   npm start   → http://localhost:3000 */
"use strict";
const http=require("node:http");
const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");

/* ---------- Configuration (.env à la racine du projet) ---------- */
const ROOT=path.resolve(__dirname,"..");
(function loadEnv(){const f=path.join(ROOT,".env");if(!fs.existsSync(f))return;
  for(const line of fs.readFileSync(f,"utf8").split(/\r?\n/)){const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2].replace(/^(['"])(.*)\1$/,"$2")}})();
const PORT=+process.env.PORT||3000;
const DEMO_OTP=process.env.DEMO_OTP!=="0";
const DAY=86400000;
const PUBLIC_URL=process.env.PUBLIC_URL||process.env.RENDER_EXTERNAL_URL||"";
/* Derrière le proxy de Render, l'adresse du client est dans x-forwarded-for */
const ipDe=req=>process.env.RENDER?String(req.headers["x-forwarded-for"]||"").split(",")[0].trim():(req.socket.remoteAddress||"");
/* Identifiants de démonstration : envoyés au navigateur uniquement en mode démo, jamais écrits dans le code public */
const demoInfo=()=>DEMO_OTP?{mail:(process.env.ADMIN_EMAIL||"admin@tablo.ci").toLowerCase(),pass:process.env.ADMIN_PASSWORD||"Tablo2026!"}:null;
const {msg,status:msgStatus}=require("./messaging");
const SLOTS=require("../js/slots.js");
/* Référentiels (communes, types, cuisines, tags) et restaurants d'exemple lus dans js/data.js */
const CAT=(()=>{const vm=require("node:vm"),c={};vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(ROOT,"js/data.js"),"utf8")+";this.__={R,MENUS,COMMUNES,TYPES,CUIS,TAGS,PLANS};",c);return JSON.parse(JSON.stringify(c.__))})();
const RNAMES={};const rname=rid=>RNAMES[rid]||rid;
async function refreshNames(){(await all("SELECT id,data->>'n' AS n FROM restaurants")).forEach(r=>RNAMES[r.id]=r.n)}
const bg=p=>{Promise.resolve(p).catch(e=>console.error("[message]",e.message))}; // envoi en arrière-plan, ne bloque pas la réponse
if(!process.env.DATABASE_URL&&process.env.DB_LOCAL!=="1"){console.error("DATABASE_URL manquant. Copie .env.example en .env et renseigne ta connexion PostgreSQL.");process.exit(1)}

const {Pool}=require("pg");
let pool=null;
const q=(sql,params=[])=>pool.query(sql,params);
const one=async(sql,params)=>(await q(sql,params)).rows[0]||null;
const all=async(sql,params)=>(await q(sql,params)).rows;
async function tx(fn){const c=await pool.connect();try{await c.query("BEGIN");const r=await fn((s,p)=>c.query(s,p));await c.query("COMMIT");return r}catch(e){await c.query("ROLLBACK").catch(()=>{});throw e}finally{c.release()}}

/* ---------- Sécurité ---------- */
const hashPass=(pass,salt)=>crypto.scryptSync(pass,salt,64).toString("hex");
const sha=s=>crypto.createHash("sha256").update(String(s)).digest("hex");
const token=()=>crypto.randomBytes(32).toString("base64url");
const safeEq=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y)};

/* ---------- Démarrage : schéma + données de démo ---------- */
const REWARDS={dessert:{l:"Dessert offert",c:500},cocktail:{l:"Cocktail ou jus offert",c:400},r5000:{l:"5 000 F de réduction",c:1000},prio:{l:"Table prioritaire le week-end",c:1500}};
const iso=d=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
const addDays=n=>{const d=new Date();d.setDate(d.getDate()+n);return iso(d)};
const newCode=()=>"TB-"+crypto.randomBytes(2).toString("hex").toUpperCase();
async function init(){
  if(process.env.DB_LOCAL==="1")await require("./local-db").ensureLocalDb(ROOT);
  pool=new Pool({connectionString:process.env.DATABASE_URL,max:10});
  await q(fs.readFileSync(path.join(__dirname,"schema.sql"),"utf8"));
  if(!await one("SELECT 1 FROM admins LIMIT 1")){
    const mail=(process.env.ADMIN_EMAIL||"admin@tablo.ci").toLowerCase(),pass=process.env.ADMIN_PASSWORD||"Tablo2026!",salt=crypto.randomBytes(16).toString("hex");
    await q("INSERT INTO admins(mail,nom,salt,hash) VALUES($1,$2,$3,$4)",[mail,"Administrateur Tablô",salt,hashPass(pass,salt)]);
    console.log(`[seed] admin créé : ${mail}`);
    if(!DEMO_OTP&&!process.env.ADMIN_PASSWORD)console.warn("[sécurité] Mot de passe admin par défaut : définis ADMIN_PASSWORD avant la mise en production.");
  }
  if(!await one("SELECT 1 FROM users LIMIT 1")){
    const u=await one(`INSERT INTO users(ident,nom,tel,com,pts,favs,notifs) VALUES($1,$2,$1,$3,650,$4,$5) RETURNING id`,
      ["0700000000","Aya Koné","Cocody",JSON.stringify(["kaya","port-pecheurs"]),JSON.stringify([{t:"Bienvenue sur Tablô !",d:"Compte de démonstration.",at:Date.now(),read:false}])]);
    const ins="INSERT INTO reservations(code,user_id,rid,date,time,pers,nom,tel,pay,occ,status) VALUES($1,$2,$3,$4,$5,$6,'Aya Koné','0700000000',$7,$8,$9)";
    await q(ins,["TB-4K7Q",u.id,"lagune-bleue",addDays(2),"19:30",4,"Sur place","Anniversaire","confirmée"]);
    await q(ins,["TB-9RT2",u.id,"cafe-nere",addDays(-6),"11:00",2,"Wave","","honorée"]);
    console.log("[seed] client de démo créé : 07 00 00 00 00");
  }
  if(!await one("SELECT 1 FROM restaurants LIMIT 1")){
    for(const r of CAT.R){const {m,...data}=r;
      await q("INSERT INTO restaurants(id,data,menu,status,demo) VALUES($1,$2,$3,'valide',true) ON CONFLICT DO NOTHING",[r.id,JSON.stringify(data),JSON.stringify(CAT.MENUS[m]||{})])}
    console.log(`[seed] ${CAT.R.length} restaurants d'exemple importés`);
  }
  /* Exemples ajoutés après le premier démarrage et activation de la commande sur les exemples concernés */
  for(const r of CAT.R.filter(x=>x.commande)){const {m,...data}=r;
    await q("INSERT INTO restaurants(id,data,menu,status,demo) VALUES($1,$2,$3,'valide',true) ON CONFLICT DO NOTHING",[r.id,JSON.stringify(data),JSON.stringify(CAT.MENUS[m]||{})]);
    await q("UPDATE restaurants SET data=data||jsonb_build_object('commande',$2::jsonb) WHERE id=$1 AND demo AND NOT (data ? 'commande')",[r.id,JSON.stringify(r.commande)]);
    if(r.commande.seul)await q("UPDATE restaurants SET data=jsonb_set(data,'{commande,seul}','true') WHERE id=$1 AND demo AND NOT (data->'commande' ? 'seul')",[r.id])}
  await q("UPDATE restaurants SET plan='premium',submitted=true WHERE demo");
  for(const x of await all("SELECT r.id,r.rid,r.date,r.time,r.pers,o.data FROM reservations r JOIN restaurants o ON o.id=r.rid WHERE r.status IN ('confirmée','honorée') AND r.tables='[]'::jsonb ORDER BY r.id")){
    const occ=await occupation(x.rid,x.date,q);const t=SLOTS.choisir(x.data,x.date,x.time,x.pers,occ)||[SLOTS.salle(x.data)[0].n];
    await q("UPDATE reservations SET tables=$2 WHERE id=$1",[x.id,JSON.stringify(t)])}
  await refreshNames();
}
/* Tables occupées d'un restaurant pour une date */
const surPlace=(data,date)=>((data&&data.rows)||[]).filter(x=>x.date===date&&x.status==="arrivé"&&x.table).map(x=>({t:[+x.table],time:x.time})); // clients installés sans réservation
async function occupation(rid,date,run,sauf=0){const o=(await run("SELECT tables,time FROM reservations WHERE rid=$1 AND date=$2 AND status IN ('confirmée','honorée') AND id<>$3",[rid,date,sauf])).rows.map(o=>({t:o.tables,time:o.time}));
  const p=(await run("SELECT data FROM pro_state WHERE rid=$1",[rid])).rows[0];return o.concat(surPlace(p&&p.data,date))}
class Conflit extends Error{}
/* Une table se libère : préviens une seule fois les clients qui ont activé une alerte pour ce restaurant et ce jour */
async function alerterTableLibre(rid,date){const o=await one("SELECT data FROM restaurants WHERE id=$1 AND status='valide'",[rid]);if(!o)return;
  const occ=await occupation(rid,date,q);const nom=rname(rid);
  for(const u of await all("SELECT id,tel,alerts FROM users WHERE alerts @> $1::jsonb",[JSON.stringify([{rid,date}])])){let change=false;
    for(const a of u.alerts){if(a.rid!==rid||a.date!==date||a.notified)continue;if(!SLOTS.choisir(o.data,date,a.time,a.pers,occ))continue;
      a.notified=true;change=true;await pushNotif(u.id,"Une table s'est libérée !",`${nom} · ${date} à ${a.time.replace(":","h")} pour ${a.pers} pers. Réserve vite.`);if(u.tel)bg(msg.tableFreed(u.tel,nom,date,a.time))}
    if(change)await q("UPDATE users SET alerts=$2 WHERE id=$1",[u.id,JSON.stringify(u.alerts)])}}
/* Verrouille le restaurant pour ce jour puis attribue les tables : deux clients ne peuvent pas obtenir la même */
async function attribuer(run,rid,b,sauf=0){await run("SELECT pg_advisory_xact_lock(hashtext($1))",[rid+"|"+b.date]);
  const o=(await run("SELECT data FROM restaurants WHERE id=$1",[rid])).rows[0];if(!o)throw new Conflit("Établissement introuvable.");
  const t=SLOTS.choisir(o.data,b.date,b.time,+b.pers,await occupation(rid,b.date,run,sauf));
  if(!t)throw new Conflit("Ce créneau n'est plus disponible. Choisis-en un autre.");return t}

/* ---------- Utilitaires HTTP ---------- */
const json=(res,code,obj,headers={})=>{res.writeHead(code,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...headers});res.end(JSON.stringify(obj))};
const fail=(res,code,msg)=>json(res,code,{error:msg});
function readBody(req){return new Promise((ok,ko)=>{let s="";req.on("data",c=>{s+=c;if(s.length>1e6){ko(new Error("too big"));req.destroy()}});req.on("end",()=>{try{ok(s?JSON.parse(s):{})}catch(e){ko(e)}})})}
const cookies=req=>Object.fromEntries((req.headers.cookie||"").split(";").map(c=>c.trim().split("=")).filter(p=>p[0]).map(([k,...v])=>[k,decodeURIComponent(v.join("="))]));
const COOKIE={user:"tablo_sid",admin:"tablo_admin"};
async function newSession(kind,sub,days){const t=token();await q("INSERT INTO sessions(token,kind,sub,expires) VALUES($1,$2,$3,$4)",[sha(t),kind,sub,new Date(Date.now()+days*DAY)]);
  return `${COOKIE[kind]}=${t}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${days*86400}${/^https:/.test(PUBLIC_URL)?"; Secure":""}`}
const clearCookie=kind=>`${COOKIE[kind]}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
async function session(req,kind){const t=cookies(req)[COOKIE[kind]];if(!t)return null;
  return one("SELECT * FROM sessions WHERE token=$1 AND kind=$2 AND expires>now()",[sha(t),kind])}
const str=(v,max=300)=>typeof v==="string"?v.trim().slice(0,max):"";
const TEL=/^0\d{9}$/,MAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/,DATE=/^\d{4}-\d{2}-\d{2}$/,TIME=/^\d{2}:\d{2}$/;
const normTel=t=>String(t||"").replace(/[\s.-]/g,"").replace(/^\+?225/,"");
const cleanPre=p=>Array.isArray(p)?p.slice(0,40).map(x=>({n:str(x.n,80),q:Math.max(1,Math.min(50,+x.q||1))})):[];

/* ---------- Sérialisation ---------- */
const resaOut=(r,mine=true)=>({id:String(r.id),code:r.code,rid:r.rid,date:r.date,time:r.time,pers:r.pers,nom:r.nom,tel:r.tel,booker:r.booker,pay:r.pay,note:r.note||"",occ:r.occ||"",
  pre:r.pre||[],exp:r.exp,reward:r.reward,status:r.status,tables:r.tables||[],mine});
const cmdOut=c=>({id:String(c.id),code:c.code,rid:c.rid,mode:c.mode,items:c.items,sous_total:c.sous_total,frais:c.frais,total:c.total,adresse:c.adresse,nom:c.nom,tel:c.tel,note:c.note,status:c.status,created:c.created});
async function mePayload(uid){const u=await one("SELECT * FROM users WHERE id=$1",[uid]);if(!u)return null;
  const resas=(await all("SELECT * FROM reservations WHERE user_id=$1 ORDER BY date,time",[uid])).map(r=>resaOut(r));
  const reviews=await all("SELECT * FROM reviews WHERE user_id=$1 ORDER BY created DESC",[uid]);
  const retraits=await all("SELECT code,rid,plat,prix,date,status FROM retraits WHERE user_id=$1 AND date>=$2 ORDER BY id DESC",[uid,addDays(-1)]);
  const commandes=(await all("SELECT * FROM commandes WHERE user_id=$1 ORDER BY id DESC LIMIT 30",[uid])).map(cmdOut);
  return {commandes,retraits,user:{nom:u.nom,tel:u.tel||"",mail:u.mail||"",com:u.com||""},pts:u.pts,favs:u.favs,alerts:u.alerts,redeemed:u.redeemed,notifs:u.notifs,resas,
    myReviews:reviews.map(v=>({rid:v.rid,nom:v.nom,date:v.date,sc:v.sc,txt:v.txt,reply:v.reply,visits:1}))}}
const pushNotif=(uid,t,d,run=q)=>run(`UPDATE users SET notifs=(jsonb_build_array(jsonb_build_object('t',$2::text,'d',$3::text,'at',$4::bigint,'read',false))||notifs) WHERE id=$1`,[uid,t,d,Date.now()]);
const addPts=(uid,n,run=q)=>run("UPDATE users SET pts=GREATEST(0,pts+$2) WHERE id=$1",[uid,n]);

/* ---------- Limitation des tentatives (admin) ---------- */
async function tooMany(key){const f=await one("SELECT * FROM login_fails WHERE key=$1",[key]);return f&&f.n>=5&&f.until>new Date()}
const failed=key=>q(`INSERT INTO login_fails(key,n,until) VALUES($1,1,now()+interval '15 minutes')
  ON CONFLICT(key) DO UPDATE SET n=CASE WHEN login_fails.until<now() THEN 1 ELSE login_fails.n+1 END, until=CASE WHEN login_fails.until<now() THEN now()+interval '15 minutes' ELSE login_fails.until END`,[key]);
const cleared=key=>q("DELETE FROM login_fails WHERE key=$1",[key]);

/* ---------- Routes ---------- */
const routes=[];
const on=(method,pattern,handler)=>routes.push({method,re:new RegExp("^"+pattern.replace(/:(\w+)/g,"(?<$1>[^/]+)")+"$"),handler});
async function needUser(req,res){const s=await session(req,"user");if(!s){fail(res,401,"Connexion requise");return null}return s.sub}
async function needAdmin(req,res){const s=await session(req,"admin");if(!s){fail(res,401,"Connexion administrateur requise");return null}return s.sub}
async function adminCtx(req,res){const s=await session(req,"admin");const a=s&&await one("SELECT id,mail,nom,role FROM admins WHERE id=$1",[s.sub]);
  if(!a){fail(res,401,"Connexion administrateur requise");return null}return a}
async function canManage(a,rid){if(a.role==="super")return true;return !!await one("SELECT 1 FROM restaurants WHERE id=$1 AND owner_id=$2",[rid,a.id])}
async function needResto(req,res,rid){const a=await adminCtx(req,res);if(!a)return null;if(!await canManage(a,rid)){fail(res,403,"Cet établissement ne fait pas partie de ton compte.");return null}return a}
async function superOnly(req,res){const a=await adminCtx(req,res);if(!a)return null;if(a.role!=="super"){fail(res,403,"Réservé à l'équipe Tablô.");return null}return a}

on("GET","/api/health",async(req,res)=>{await q("SELECT 1");json(res,200,{ok:true,db:"postgres",messages:msgStatus()})});

/* Auth client : 1) demander un code */
on("POST","/api/auth/otp",async(req,res,b)=>{
  const mode=b.mode==="mail"?"mail":"tel";let ident=str(b.ident,120);ident=mode==="tel"?normTel(ident):ident.toLowerCase();
  if(mode==="tel"&&!TEL.test(ident))return fail(res,400,"Numéro invalide : 10 chiffres commençant par 0.");
  if(mode==="mail"&&!MAIL.test(ident))return fail(res,400,"Adresse e-mail invalide.");
  const prev=await one("SELECT sent FROM otps WHERE ident=$1",[ident]);
  if(prev&&Date.now()-prev.sent.getTime()<15000)return fail(res,429,"Patiente quelques secondes avant de redemander un code.");
  const code=String(crypto.randomInt(100000,1000000));
  await q(`INSERT INTO otps(ident,code_hash,expires,tries,sent) VALUES($1,$2,now()+interval '10 minutes',0,now())
    ON CONFLICT(ident) DO UPDATE SET code_hash=EXCLUDED.code_hash,expires=EXCLUDED.expires,tries=0,sent=now()`,[ident,sha(ident+":"+code)]);
  // Production : envoyer ici le SMS (Orange, MTN, Twilio…) ou l'e-mail, et NE PAS renvoyer le code.
  if(DEMO_OTP)console.log(`[otp] ${ident} → ${code}`);
  bg(msg.otp(ident,code));
  json(res,200,{sent:true,ident,demoCode:DEMO_OTP?code:undefined});
});
/* Auth client : 2) vérifier le code */
on("POST","/api/auth/verify",async(req,res,b)=>{
  const ident=str(b.ident,120),code=str(b.code,10);
  const o=await one("SELECT * FROM otps WHERE ident=$1",[ident]);
  if(!o||o.expires<new Date())return fail(res,400,"Code expiré, redemande un code.");
  if(o.tries>=5){await q("DELETE FROM otps WHERE ident=$1",[ident]);return fail(res,429,"Trop d'essais, redemande un code.")}
  if(!safeEq(o.code_hash,sha(ident+":"+code))){await q("UPDATE otps SET tries=tries+1 WHERE ident=$1",[ident]);return fail(res,400,"Code incorrect, réessaie.")}
  await q("DELETE FROM otps WHERE ident=$1",[ident]);
  const u=await one("SELECT id FROM users WHERE ident=$1",[ident]);
  if(u)return json(res,200,await mePayload(u.id),{"Set-Cookie":await newSession("user",u.id,30)});
  const t=token();await q("INSERT INTO signups(token,ident,expires) VALUES($1,$2,now()+interval '30 minutes')",[sha(t),ident]);
  json(res,200,{needsProfile:true,signup:t});
});
/* Auth client : 3) créer le profil */
on("POST","/api/auth/register",async(req,res,b)=>{
  const s=await one("SELECT * FROM signups WHERE token=$1 AND expires>now()",[sha(str(b.signup,100))]);
  if(!s)return fail(res,400,"Session d'inscription expirée, recommence.");
  const nom=str(b.nom,80);if(nom.length<2)return fail(res,400,"Indique ton nom.");
  const isTel=TEL.test(s.ident);const tel=isTel?s.ident:normTel(b.tel);if(tel&&!TEL.test(tel))return fail(res,400,"Numéro invalide.");
  const u=await tx(async run=>{
    const r=(await run(`INSERT INTO users(ident,nom,tel,mail,com,notifs) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(ident) DO NOTHING RETURNING id`,
      [s.ident,nom,tel||"",isTel?"":s.ident,str(b.com,40),JSON.stringify([{t:"Bienvenue sur Tablô !",d:"Ton compte est créé. Réserve ta première table pour gagner tes premiers points.",at:Date.now(),read:false}])])).rows[0];
    await run("DELETE FROM signups WHERE token=$1",[s.token]);return r||(await run("SELECT id FROM users WHERE ident=$1",[s.ident])).rows[0]});
  json(res,201,await mePayload(u.id),{"Set-Cookie":await newSession("user",u.id,30)});
});
on("POST","/api/auth/logout",async(req,res)=>{const t=cookies(req)[COOKIE.user];if(t)await q("DELETE FROM sessions WHERE token=$1",[sha(t)]);json(res,200,{ok:true},{"Set-Cookie":clearCookie("user")})});

/* Compte client */
on("GET","/api/me",async(req,res)=>{const s=await session(req,"user");const p=s&&await mePayload(s.sub);json(res,200,p||{user:null})});
on("PUT","/api/me/profile",async(req,res,b)=>{const uid=await needUser(req,res);if(!uid)return;
  const nom=str(b.nom,80),tel=normTel(b.tel);if(nom.length<2)return fail(res,400,"Indique ton nom.");if(tel&&!TEL.test(tel))return fail(res,400,"Numéro invalide.");
  await q("UPDATE users SET nom=$2,tel=$3,com=$4 WHERE id=$1",[uid,nom,tel,str(b.com,40)]);json(res,200,await mePayload(uid))});
on("PUT","/api/me/state",async(req,res,b)=>{const uid=await needUser(req,res);if(!uid)return;
  const favs=Array.isArray(b.favs)?JSON.stringify(b.favs.filter(x=>typeof x==="string").slice(0,200)):null;
  const alerts=Array.isArray(b.alerts)?JSON.stringify(b.alerts.slice(0,50).map(a=>({id:str(a.id,30),rid:str(a.rid,60),date:str(a.date,10),time:str(a.time,5),pers:+a.pers||2,notified:!!a.notified}))):null;
  await q(`UPDATE users SET favs=COALESCE($2::jsonb,favs),alerts=COALESCE($3::jsonb,alerts),
    notifs=CASE WHEN $4 THEN (SELECT COALESCE(jsonb_agg(n||'{"read":true}'::jsonb),'[]'::jsonb) FROM jsonb_array_elements(notifs) n) ELSE notifs END WHERE id=$1`,[uid,favs,alerts,!!b.notifsRead]);
  json(res,200,{ok:true})});
on("POST","/api/rewards/redeem",async(req,res,b)=>{const uid=await needUser(req,res);if(!uid)return;const w=REWARDS[b.id];if(!w)return fail(res,400,"Récompense inconnue.");
  const item=JSON.stringify([{l:w.l,code:"RW-"+crypto.randomBytes(2).toString("hex").toUpperCase(),used:false}]);
  const r=await q("UPDATE users SET pts=pts-$2,redeemed=redeemed||$3::jsonb WHERE id=$1 AND pts>=$2",[uid,w.c,item]);
  if(!r.rowCount)return fail(res,400,"Pas assez de points.");json(res,200,await mePayload(uid))});

/* Disponibilités : créneaux déjà pris (toutes réservations) */
on("GET","/api/availability",async(req,res,b,qs)=>{const date=str(qs.get("date"),10);if(!DATE.test(date))return fail(res,400,"Paramètres invalides.");
  const occ={};(await all("SELECT rid,tables,time FROM reservations WHERE date=$1 AND status IN ('confirmée','honorée')",[date])).forEach(o=>(occ[o.rid]=occ[o.rid]||[]).push({t:o.tables,time:o.time}));
  (await all("SELECT rid,data FROM pro_state")).forEach(p=>surPlace(p.data,date).forEach(x=>(occ[p.rid]=occ[p.rid]||[]).push(x)));
  json(res,200,{occ})});

/* Réservations client */
function validResa(b){const pers=+b.pers;
  if(!DATE.test(str(b.date,10))||!TIME.test(str(b.time,5))||!(pers>=1&&pers<=30))return "Créneau invalide.";
  if(b.date<iso(new Date()))return "Cette date est passée.";
  const now=new Date();if(b.date===iso(now)&&SLOTS.toMin(b.time)<now.getHours()*60+now.getMinutes())return "Cette heure est déjà passée.";
  if(str(b.nom,80).length<2)return "Indique ton nom pour la réservation.";
  if(!TEL.test(normTel(b.tel)))return "Numéro invalide.";return null}
on("POST","/api/reservations",async(req,res,b)=>{const uid=await needUser(req,res);if(!uid)return;
  const e=validResa(b);if(e)return fail(res,400,e);const rid=str(b.rid,60);if(!rid)return fail(res,400,"Restaurant manquant.");
  if(!await one("SELECT 1 FROM restaurants WHERE id=$1 AND status='valide' AND COALESCE(data->'commande'->>'seul','false')<>'true'",[rid]))return fail(res,400,"Cet établissement ne prend pas de réservations pour le moment.");
  try{const id=await tx(async run=>{
      const tables=await attribuer(run,rid,b);
      let reward=null;
      if(b.useReward){const u=(await run("SELECT redeemed FROM users WHERE id=$1 FOR UPDATE",[uid])).rows[0];const red=u.redeemed||[];const w=red.find(x=>!x.used);
        if(w){w.used=true;reward=w.l;await run("UPDATE users SET redeemed=$2 WHERE id=$1",[uid,JSON.stringify(red)])}}
      let r,tries=0;
      for(;;){try{r=(await run("SAVEPOINT c"),await run(`INSERT INTO reservations(code,user_id,rid,date,time,pers,nom,tel,booker,pay,note,occ,pre,exp,reward,status,tables)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'confirmée',$16) RETURNING id`,
          [newCode(),uid,rid,b.date,b.time,+b.pers,str(b.nom,80),normTel(b.tel),str(b.booker,80)||null,str(b.pay,30),str(b.note,500),str(b.occ,40),JSON.stringify(cleanPre(b.pre)),str(b.exp,120)||null,reward,JSON.stringify(tables)])).rows[0];break}
        catch(err){await run("ROLLBACK TO SAVEPOINT c");if(err.constraint==="reservations_code_key"&&++tries<5)continue;throw err}}
      await addPts(uid,50,run);
      await run(`UPDATE users SET alerts=(SELECT COALESCE(jsonb_agg(a),'[]'::jsonb) FROM jsonb_array_elements(alerts) a WHERE NOT (a->>'rid'=$2 AND a->>'date'=$3)) WHERE id=$1`,[uid,rid,b.date]);
      await pushNotif(uid,"Réservation confirmée",`${str(b.rname,80)||rid} · ${b.date} à ${b.time.replace(":","h")} · +50 pts`,run);
      return r.id});
    const row=await one("SELECT * FROM reservations WHERE id=$1",[id]),resa=resaOut(row);
    const um=await one("SELECT mail FROM users WHERE id=$1",[uid]);bg(msg.booked(row,rname(rid),um&&um.mail));
    json(res,201,{resa,...await mePayload(uid)});
  }catch(err){if(err instanceof Conflit)return fail(res,409,err.message);throw err}
});
on("PATCH","/api/reservations/:id",async(req,res,b,qs,p)=>{const uid=await needUser(req,res);if(!uid)return;
  const x=await one("SELECT * FROM reservations WHERE id=$1 AND user_id=$2",[+p.id||0,uid]);if(!x)return fail(res,404,"Réservation introuvable.");
  if(x.status!=="confirmée")return fail(res,400,"Cette réservation ne peut plus être modifiée.");
  if(b.status==="annulée"){await tx(async run=>{await run("UPDATE reservations SET status='annulée' WHERE id=$1",[x.id]);await addPts(uid,-50,run)});
    const um=await one("SELECT mail FROM users WHERE id=$1",[uid]);bg(msg.cancelled(x,rname(x.rid),um&&um.mail));bg(alerterTableLibre(x.rid,x.date));return json(res,200,await mePayload(uid))}
  const e=validResa(b);if(e)return fail(res,400,e);
  try{await tx(async run=>{const tables=await attribuer(run,x.rid,b,x.id);
    await run("UPDATE reservations SET date=$2,time=$3,pers=$4,nom=$5,tel=$6,occ=$7,note=$8,pay=$9,pre=$10,tables=$11 WHERE id=$1",
    [x.id,b.date,b.time,+b.pers,str(b.nom,80),normTel(b.tel),str(b.occ,40),str(b.note,500),str(b.pay,30),JSON.stringify(cleanPre(b.pre)),JSON.stringify(tables)])})}
  catch(err){if(err instanceof Conflit)return fail(res,409,err.message);throw err}
  json(res,200,await mePayload(uid))});

/* Offres anti-gaspi du jour. Le stock restant = quantité du restaurant - portions déjà réservées aujourd'hui */
const PROMO=p=>Math.round(p*.6/100)*100;
async function offresDuJour(){const date=iso(new Date());
  const rows=await all(`SELECT p.rid,p.data->'stock' AS stock,r.data->>'n' AS n,r.data->>'c' AS c FROM pro_state p JOIN restaurants r ON r.id=p.rid WHERE r.status='valide' AND r.plan<>'essentiel'`);
  const pris={};(await all("SELECT rid,plat,COUNT(*)::int AS v FROM retraits WHERE date=$1 AND status<>'annulé' GROUP BY 1,2",[date])).forEach(x=>pris[x.rid+"|"+x.plat]=x.v);
  const out=[];rows.forEach(r=>(r.stock||[]).forEach(s=>{if(!s.promo||s.date!==date)return;const q2=(+s.q||0)-(pris[r.rid+"|"+s.p]||0);if(q2>0)out.push({rid:r.rid,resto:r.n,c:r.c,p:s.p,prix:+s.prix,promo:PROMO(+s.prix),q:q2})}));return out}
on("GET","/api/offres",async(req,res)=>json(res,200,{offres:await offresDuJour()}));
on("POST","/api/offres/reserver",async(req,res,b)=>{const uid=await needUser(req,res);if(!uid)return;const rid=str(b.rid,60),plat=str(b.p,80);
  try{const row=await tx(async run=>{await run("SELECT pg_advisory_xact_lock(hashtext($1))",["offre|"+rid]);
      const o=(await offresDuJour()).find(x=>x.rid===rid&&x.p===plat);if(!o)throw new Conflit("Cette offre vient de se terminer.");
      const dejaPris=(await run("SELECT COUNT(*)::int AS v FROM retraits WHERE rid=$1 AND plat=$2 AND date=$3 AND status<>'annulé'",[rid,plat,iso(new Date())])).rows[0].v;
      const st=(await run("SELECT data FROM pro_state WHERE rid=$1",[rid])).rows[0],it=((st&&st.data.stock)||[]).find(x=>x.p===plat);if(!it||dejaPris>=+it.q)throw new Conflit("Cette offre vient de se terminer.");
      const u=(await run("SELECT nom,tel FROM users WHERE id=$1",[uid])).rows[0];
      const r=(await run("INSERT INTO retraits(code,user_id,rid,plat,prix,date,nom,tel) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",["AG-"+crypto.randomBytes(2).toString("hex").toUpperCase(),uid,rid,plat,o.promo,iso(new Date()),u.nom,u.tel])).rows[0];
      await pushNotif(uid,"Portion réservée",`${plat} chez ${rname(rid)} · ${o.promo.toLocaleString("fr-FR")} F · Code ${r.code}`,run);return r});
    bg(msg.pickup(row,rname(rid)));json(res,201,{retrait:{code:row.code,plat,prix:row.prix,rid},offres:await offresDuJour(),...await mePayload(uid)})}
  catch(e){if(e instanceof Conflit)return fail(res,409,e.message);throw e}});
on("PATCH","/api/admin/retraits/:id",async(req,res,b,qs,p)=>{const x=await one("SELECT * FROM retraits WHERE id=$1",[+p.id||0]);if(!x)return fail(res,404,"Retrait introuvable.");if(!await needResto(req,res,x.rid))return;
  const st=String(b.status||"");if(!["en_attente","retiré","annulé"].includes(st))return fail(res,400,"Statut invalide.");await q("UPDATE retraits SET status=$2 WHERE id=$1",[x.id,st]);json(res,200,{ok:true})});

/* Commandes à emporter et en livraison. Le serveur recalcule les prix depuis le menu : le navigateur n'envoie que les plats et les quantités. */
const CMD_SUITE={"reçue":["en préparation","annulée"],"en préparation":["prête","en livraison","annulée"],"prête":["terminée","annulée"],"en livraison":["terminée","annulée"]};
const CMD_NOTIF={"en préparation":["Commande en préparation","est en préparation"],"prête":["Commande prête","est prête, tu peux venir la retirer"],"en livraison":["Commande en route","est en route"],"terminée":["Commande terminée","est terminée. Merci !"],"annulée":["Commande annulée","a été annulée"]};
on("POST","/api/commandes",async(req,res,b)=>{const uid=await needUser(req,res);if(!uid)return;
  const rid=str(b.rid,60),mode=b.mode==="livraison"?"livraison":"emporter";
  const r=await one("SELECT data,menu,demo,owner_id FROM restaurants WHERE id=$1 AND status='valide'",[rid]);
  const cfg=r&&r.data.commande;if(!cfg||!cfg[mode])return fail(res,400,mode==="livraison"?"Cet établissement ne livre pas pour le moment.":"Cet établissement ne prend pas de commandes à emporter pour le moment.");
  const now=new Date(),hhmm=String(now.getHours()).padStart(2,"0")+":"+String(now.getMinutes()).padStart(2,"0");
  if(!SLOTS.serviceA(r.data,iso(now),hhmm))return fail(res,409,"L'établissement est fermé pour le moment.");
  const prix=new Map(Object.values(r.menu||{}).flat().map(x=>[x[0],+x[1]||0]));
  const qte=new Map();for(const x of (Array.isArray(b.items)?b.items:[]).slice(0,40)){const n=str(x&&x.n,80),k=Math.floor(+(x&&x.q));if(!n||!(k>=1))continue;qte.set(n,Math.min(50,(qte.get(n)||0)+k))}
  if(!qte.size)return fail(res,400,"Ta commande est vide.");
  const items=[];for(const [n,k] of qte){if(!(prix.get(n)>0))return fail(res,409,"La carte a changé : « "+n+" » n'est plus disponible.");items.push({n,q:k,p:prix.get(n)})}
  const sous=items.reduce((s,i)=>s+i.p*i.q,0),frais=mode==="livraison"?(+cfg.frais||0):0;
  if(sous<(+cfg.min||0))return fail(res,400,"Commande minimum : "+(+cfg.min).toLocaleString("fr-FR")+" F.");
  const nom=str(b.nom,80),tel=normTel(b.tel),adresse=mode==="livraison"?str(b.adresse,200):"";
  if(nom.length<2)return fail(res,400,"Indique ton nom.");if(!TEL.test(tel))return fail(res,400,"Numéro invalide : 10 chiffres commençant par 0.");
  if(mode==="livraison"&&adresse.length<5)return fail(res,400,"Indique l'adresse de livraison (quartier, repère).");
  if((await one("SELECT COUNT(*)::int AS v FROM commandes WHERE user_id=$1 AND status IN ('reçue','en préparation')",[uid])).v>=5)return fail(res,429,"Tu as déjà 5 commandes en cours. Attends qu'elles soient traitées.");
  let c=null;for(let i=0;!c;i++){try{c=await one(`INSERT INTO commandes(code,user_id,rid,mode,items,sous_total,frais,total,adresse,nom,tel,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      ["CM-"+crypto.randomBytes(3).toString("hex").toUpperCase(),uid,rid,mode,JSON.stringify(items),sous,frais,sous+frais,adresse,nom,tel,str(b.note,300)])}
    catch(e){if(e.constraint!=="commandes_code_key"||i>=4)throw e}}
  await pushNotif(uid,"Commande envoyée",`${rname(rid)} · ${(sous+frais).toLocaleString("fr-FR")} F · Code ${c.code}`);
  bg(msg.orderPlaced(c,rname(rid)));
  if(!r.demo)bg((async()=>{const o=r.owner_id&&await one("SELECT mail FROM admins WHERE id=$1",[r.owner_id]);await msg.orderNew(r.data.tel,o&&o.mail,c,rname(rid))})());
  json(res,201,{commande:cmdOut(c),...await mePayload(uid)})});
on("PATCH","/api/commandes/:id",async(req,res,b,qs,p)=>{const uid=await needUser(req,res);if(!uid)return;if(b.status!=="annulée")return fail(res,400,"Action invalide.");
  const c=await one("UPDATE commandes SET status='annulée' WHERE id=$1 AND user_id=$2 AND status='reçue' RETURNING *",[+p.id||0,uid]);
  if(!c)return fail(res,409,"Le restaurant a déjà commencé à la préparer : appelle-le pour l'annuler.");
  bg(msg.orderStatus(c,rname(c.rid),"annulée"));json(res,200,await mePayload(uid))});
const commandesDe=async rid=>(await all("SELECT * FROM commandes WHERE rid=$1 AND (status NOT IN ('terminée','annulée') OR created>now()-interval '24 hours') ORDER BY id DESC LIMIT 100",[rid])).map(cmdOut);
on("GET","/api/admin/commandes",async(req,res,b,qs)=>{const rid=str(qs.get("rid"),60);if(!await needResto(req,res,rid))return;json(res,200,{commandes:await commandesDe(rid)})});
on("PATCH","/api/admin/commandes/:id",async(req,res,b,qs,p)=>{const x=await one("SELECT * FROM commandes WHERE id=$1",[+p.id||0]);if(!x)return fail(res,404,"Commande introuvable.");if(!await needResto(req,res,x.rid))return;
  const st=String(b.status||"");const okMode=!(st==="prête"&&x.mode!=="emporter")&&!(st==="en livraison"&&x.mode!=="livraison");
  if(!(CMD_SUITE[x.status]||[]).includes(st)||!okMode)return fail(res,409,"Cette étape n'est plus possible pour cette commande. Actualise la page.");
  const c=await one("UPDATE commandes SET status=$2 WHERE id=$1 AND status=$3 RETURNING *",[x.id,st,x.status]);if(!c)return fail(res,409,"Cette commande vient d'être modifiée. Actualise la page.");
  if(c.user_id)await pushNotif(c.user_id,CMD_NOTIF[st][0],`Ta commande ${c.code} chez ${rname(c.rid)} ${CMD_NOTIF[st][1]}.`);
  bg(msg.orderStatus(c,rname(c.rid),st));json(res,200,{commandes:await commandesDe(c.rid)})});

/* Avis */
on("GET","/api/reviews",async(req,res,b,qs)=>{const rid=str(qs.get("rid"),60);
  json(res,200,{reviews:(await all("SELECT rid,nom,date,sc,txt,reply FROM reviews WHERE rid=$1 ORDER BY created DESC LIMIT 50",[rid])).map(v=>({...v,nom:prive(v.nom),visits:1}))})});
on("POST","/api/reviews",async(req,res,b)=>{const uid=await needUser(req,res);if(!uid)return;const rid=str(b.rid,60),txt=str(b.txt,1500);
  if(txt.length<10)return fail(res,400,"Écris au moins une phrase (10 caractères).");
  if(!await one("SELECT 1 FROM reservations WHERE user_id=$1 AND rid=$2 AND status='honorée'",[uid,rid]))return fail(res,403,"Tu pourras donner ton avis après ta visite.");
  const nb=await one("SELECT (SELECT COUNT(*) FROM reservations WHERE user_id=$1 AND rid=$2 AND status='honorée')::int AS v,(SELECT COUNT(*) FROM reviews WHERE user_id=$1 AND rid=$2)::int AS a",[uid,rid]);
  if(nb.a>=nb.v)return fail(res,409,"Tu as déjà donné ton avis pour cette visite.");
  const sc=(Array.isArray(b.sc)?b.sc:[]).slice(0,4).map(n=>Math.max(1,Math.min(5,+n||5)));while(sc.length<4)sc.push(5);
  await tx(async run=>{await run("INSERT INTO reviews(user_id,rid,nom,date,sc,txt) SELECT $1,$2,nom,$3,$4,$5 FROM users WHERE id=$1",[uid,rid,iso(new Date()),JSON.stringify(sc),txt]);await addPts(uid,30,run)});
  json(res,201,await mePayload(uid))});

/* Admin */
on("POST","/api/admin/login",async(req,res,b)=>{const mail=str(b.mail,120).toLowerCase(),pass=typeof b.pass==="string"?b.pass:"";
  const key="admin:"+mail+":"+ipDe(req);
  if(await tooMany(key))return fail(res,429,"Trop de tentatives. Réessaie dans 15 minutes.");
  const a=await one("SELECT * FROM admins WHERE mail=$1",[mail]);
  if(!a||!safeEq(a.hash,hashPass(pass,a.salt))){await failed(key);return fail(res,401,"E-mail ou mot de passe incorrect.")}
  await cleared(key);json(res,200,{admin:{mail:a.mail,nom:a.nom,role:a.role},restos:await restosFor(a)},{"Set-Cookie":await newSession("admin",a.id,1)})});
on("POST","/api/admin/forgot",async(req,res,b)=>{const mail=str(b.mail,120).toLowerCase(),key="forgot:"+ipDe(req);
  if(await tooMany(key))return fail(res,429,"Trop de demandes. Réessaie plus tard.");await failed(key);
  const a=await one("SELECT id,nom FROM admins WHERE mail=$1",[mail]);
  if(a){const t=token();await q("INSERT INTO activations(token,admin_id,expires) VALUES($1,$2,now()+interval '1 hour')",[sha(t),a.id]);const url=baseUrl(req)+"/admin#activer-"+t;bg(msg.proReset(mail,a.nom,url));if(DEMO_OTP)console.log(`[démo] lien de réinitialisation ${mail} : ${url}`)}
  json(res,200,{ok:true})}); // même réponse que le compte existe ou non
on("POST","/api/admin/logout",async(req,res)=>{const t=cookies(req)[COOKIE.admin];if(t)await q("DELETE FROM sessions WHERE token=$1",[sha(t)]);json(res,200,{ok:true},{"Set-Cookie":clearCookie("admin")})});
on("GET","/api/admin/me",async(req,res)=>{const s=await session(req,"admin");const a=s&&await one("SELECT id,mail,nom,role FROM admins WHERE id=$1",[s.sub]);
  json(res,200,a?{admin:{mail:a.mail,nom:a.nom,role:a.role},restos:await restosFor(a),demo:demoInfo()}:{admin:null,demo:demoInfo()})});
on("PUT","/api/admin/password",async(req,res,b)=>{const aid=await needAdmin(req,res);if(!aid)return;const a=await one("SELECT * FROM admins WHERE id=$1",[aid]);
  if(!safeEq(a.hash,hashPass(String(b.old||""),a.salt)))return fail(res,400,"Mot de passe actuel incorrect.");
  if(String(b.pass||"").length<8)return fail(res,400,"8 caractères minimum.");
  const salt=crypto.randomBytes(16).toString("hex");await q("UPDATE admins SET salt=$2,hash=$3 WHERE id=$1",[aid,salt,hashPass(String(b.pass),salt)]);json(res,200,{ok:true})});
on("GET","/api/admin/resto/:rid",async(req,res,b,qs,p)=>{const rid=decodeURIComponent(p.rid);if(!await needResto(req,res,rid))return;
  const st=await one("SELECT data FROM pro_state WHERE rid=$1",[rid]);
  const resas=(await all("SELECT * FROM reservations WHERE rid=$1 AND date>=$2 ORDER BY date,time",[rid,addDays(-1)])).map(r=>resaOut(r,false));
  const week=await all("SELECT date,SUM(pers)::int AS v FROM reservations WHERE rid=$1 AND date>=$2 AND date<=$3 AND status IN ('confirmée','honorée') GROUP BY date",[rid,addDays(-6),addDays(0)]);
  const top=await all("SELECT p->>'n' AS n,SUM((p->>'q')::int)::int AS v FROM reservations r,jsonb_array_elements(r.pre) p WHERE r.rid=$1 AND r.status<>'annulée' GROUP BY 1 ORDER BY 2 DESC LIMIT 5",[rid]);
  const retraits=await all("SELECT id,code,plat,prix,nom,tel,status FROM retraits WHERE rid=$1 AND date=$2 ORDER BY id DESC",[rid,addDays(0)]);
  json(res,200,{state:st?st.data:null,resas,week,top,retraits,commandes:await commandesDe(rid)})});
on("PUT","/api/admin/resto/:rid",async(req,res,b,qs,p)=>{const rid=decodeURIComponent(p.rid);if(!await needResto(req,res,rid))return;
  const data=JSON.stringify({rows:b.rows||[],wait:b.wait||[],stock:b.stock||[]});if(data.length>200000)return fail(res,413,"Trop volumineux.");
  await q("INSERT INTO pro_state(rid,data,updated) VALUES($1,$2,now()) ON CONFLICT(rid) DO UPDATE SET data=EXCLUDED.data,updated=now()",[rid,data]);json(res,200,{ok:true})});
on("PATCH","/api/admin/reservations/:id",async(req,res,b,qs,p)=>{
  const map={"arrivé":"honorée","parti":"honorée","no-show":"no-show","attendu":"confirmée"};const ns=map[b.status];if(!ns)return fail(res,400,"Statut invalide.");
  const x=await one("SELECT * FROM reservations WHERE id=$1",[+p.id||0]);if(!x)return fail(res,404,"Réservation introuvable.");
  if(!await needResto(req,res,x.rid))return;
  try{await tx(async run=>{const tables=ns==="confirmée"&&x.status!=="confirmée"?await attribuer(run,x.rid,x,x.id):x.tables;
    await run("UPDATE reservations SET status=$2,tables=$3 WHERE id=$1",[x.id,ns,JSON.stringify(tables)]);
    if(ns==="honorée"&&x.status!=="honorée"&&x.user_id){await addPts(x.user_id,100,run);await pushNotif(x.user_id,"Merci de ta visite !","Ton passage est confirmé par le restaurant : +100 pts. Laisse un avis pour +30 pts.",run)}
    if(ns==="no-show"&&x.status!=="no-show"&&x.user_id)await pushNotif(x.user_id,"Réservation manquée","Le restaurant a signalé ton absence. Pense à annuler si tu ne peux pas venir.",run)})}
  catch(err){if(err instanceof Conflit)return fail(res,409,"Plus aucune table libre à cette heure pour rétablir ce client.");throw err}
  if(ns==="honorée"&&x.status!=="honorée")bg(msg.visited(x.tel,rname(x.rid)));
  if(ns==="no-show"&&x.status!=="no-show")bg(alerterTableLibre(x.rid,x.date));
  json(res,200,{ok:true,status:ns})});
/* Admin : le restaurant répond à un avis */
on("PATCH","/api/admin/reviews/:id",async(req,res,b,qs,p)=>{const v=await one("SELECT id,rid FROM reviews WHERE id=$1",[+p.id||0]);if(!v)return fail(res,404,"Avis introuvable.");if(!await needResto(req,res,v.rid))return;
  const reply=str(b.reply,800);if(reply.length<2)return fail(res,400,"Écris une réponse.");await q("UPDATE reviews SET reply=$2 WHERE id=$1",[v.id,reply]);json(res,200,{ok:true})});
/* Admin : prévenir un client de la liste d'attente que sa table est prête (SMS réel) */
on("POST","/api/admin/sms/table-ready",async(req,res,b)=>{if(!await needResto(req,res,str(b.rid,60)))return;const tel=normTel(b.tel);if(!TEL.test(tel))return fail(res,400,"Numéro invalide pour ce client.");
  const r=await msg.tableReady(tel,rname(str(b.rid,60)));json(res,200,{sent:!!r.ok,simulated:r.reason==="non configuré"})});

/* ---------- Établissements ---------- */
const STATUTS=["en_attente","valide","refuse","suspendu"];
const slugify=t=>String(t).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,40)||"resto";
async function uniqueId(name){const base=slugify(name);let id=base,i=2;while(await one("SELECT 1 FROM restaurants WHERE id=$1",[id]))id=base+"-"+i++;return id}
const prive=n=>{const m=String(n||"").trim().split(/\s+/);return m[0]+(m[1]?" "+m[1][0].toUpperCase()+".":"")}; // « Aya K. » : pas de nom complet en public
const restoPublic=r=>({...r.data,id:r.id,m:r.id,demo:r.demo,photos:r.photos||[],note:r.demo?r.data.note:(r.note!=null?+(+r.note).toFixed(1):null),avis:r.demo?r.data.avis:(+r.avis||0)});
async function restosFor(a){const col="id,data->>'n' AS n,data->>'c' AS c,status,plan,submitted";
  return a.role==="super"?all(`SELECT ${col} FROM restaurants ORDER BY data->>'n'`):all(`SELECT ${col} FROM restaurants WHERE owner_id=$1 ORDER BY data->>'n'`,[a.id])}
/* Valide et nettoie une fiche d'établissement */
function cleanFiche(b,telReq=true){const e=[];const n=str(b.n,80),c=str(b.c,40),q2=str(b.q,60),t=str(b.t,40),cu=str(b.cu,40),h=str(b.h,40),d=str(b.d,400);
  const bud=+b.b,tables=+b.tables,tel=normTel(b.tel);
  if(n.length<2)e.push("le nom de l'établissement");if(!CAT.COMMUNES[c])e.push("la commune");if(!q2)e.push("le quartier");
  if(!CAT.TYPES.includes(t))e.push("le type");if(!CAT.CUIS.includes(cu))e.push("la cuisine");if(!(bud>=1&&bud<=4))e.push("le budget");
  if(!/^\d{1,2}h(\d{2})? – \d{1,2}h(\d{2})?$/.test(h))e.push("les horaires (ex. 12h – 23h30)");if(!(tables>=1&&tables<=200))e.push("le nombre de tables (1 à 200)");const FIXE=/^[02]\d{9}$/; // mobile (01, 05, 07…) ou fixe (21, 25, 27…)
  if(telReq?!FIXE.test(tel):(tel&&!FIXE.test(tel)))e.push("le téléphone de l'établissement (10 chiffres)");
  const tags=(Array.isArray(b.tags)?b.tags:[]).filter(x=>CAT.TAGS.includes(x)).slice(0,10);
  return {err:e.length?"Vérifie "+e.join(", ")+".":null,data:{n,c,q:q2,t,cu,b:bud,h,d,tables,tags,tel,nouv:true}}}
function cleanMenu(m){const out={};if(!m||typeof m!=="object")return out;let count=0;
  for(const [cat,items] of Object.entries(m).slice(0,12)){const k=str(cat,40);if(!k||!Array.isArray(items))continue;
    const list=items.slice(0,40).map(x=>[str(x[0],80),Math.max(0,Math.min(1e7,Math.round(+x[1]||0))),str(x[2]||"",120)]).filter(x=>x[0]).map(x=>x[2]?x:x.slice(0,2));
    if(list.length){out[k]=list;count+=list.length}if(count>200)break}return out}

const ZONES_MAX=8;
function cleanConfig(b){const out={};
  if(Array.isArray(b.salle)){const vus=new Set();out.salle=b.salle.slice(0,200).map(t=>({n:Math.round(+t.n),cap:Math.round(+t.cap),zone:str(t.zone,30)||"Salle"})).filter(t=>t.n>=1&&t.cap>=1&&t.cap<=50&&!vus.has(t.n)&&vus.add(t.n));
    if(!out.salle.length)return {err:"Ajoute au moins une table."};if(new Set(out.salle.map(t=>t.zone)).size>ZONES_MAX)return {err:"8 zones maximum."};out.tables=out.salle.length}
  if(Array.isArray(b.services)){out.services=b.services.slice(0,6).map(x=>({nom:str(x.nom,30)||"Service",de:str(x.de,5),a:str(x.a,5),jours:(Array.isArray(x.jours)?x.jours:[]).map(Number).filter(j=>j>=0&&j<=6),zones:(Array.isArray(x.zones)?x.zones:[]).map(z=>str(z,30)).filter(Boolean)}));
    if(!out.services.length)return {err:"Ajoute au moins un service."};
    if(out.services.some(x=>!TIME.test(x.de)||!TIME.test(x.a)||x.de===x.a||!x.jours.length))return {err:"Chaque service doit avoir une heure de début, une heure de fin et au moins un jour."}}
  if(b.duree!==undefined){const d=+b.duree;if(!(d>=30&&d<=300))return {err:"La durée d'un repas doit être entre 30 et 300 minutes."};out.duree=d}
  if(b.maxPers!==undefined){const m=+b.maxPers;if(!(m>=1&&m<=200))return {err:"Le nombre maximum de personnes doit être entre 1 et 200."};out.maxPers=m}
  if(b.commande&&typeof b.commande==="object"){const c=b.commande,frais=Math.round(+c.frais||0),min=Math.round(+c.min||0),delai=Math.round(+c.delai||0);
    if(!(frais>=0&&frais<=50000))return {err:"Les frais de livraison doivent être entre 0 et 50 000 F."};if(!(min>=0&&min<=500000))return {err:"Le minimum de commande doit être entre 0 et 500 000 F."};if(!(delai>=5&&delai<=180))return {err:"Le délai de préparation doit être entre 5 et 180 minutes."};
    out.commande={emporter:!!c.emporter,livraison:!!c.livraison,frais,min,delai,seul:!!c.seul&&(!!c.emporter||!!c.livraison)}}
  return {data:out}}
async function manque(id,r){const m=[],d=r.data;if(String(d.d||"").length<20)m.push("une description");if(!FIXE_OK(d.tel))m.push("le téléphone");
  if(!Object.values(r.menu||{}).flat().length)m.push("le menu");if(!(d.commande&&d.commande.seul)&&(!d.salle||!d.salle.length))m.push("le plan de salle");if(!d.services||!d.services.length)m.push("les services");
  if(!await one("SELECT 1 FROM restaurant_photos WHERE rid=$1 LIMIT 1",[id]))m.push("au moins une photo");return m}
const FIXE_OK=t=>/^[02]\d{9}$/.test(String(t||""));
const baseUrl=req=>PUBLIC_URL||("http://"+req.headers.host);
const notifierEquipe=f=>bg((async()=>{for(const a of await all("SELECT mail FROM admins WHERE role='super'"))await f(a.mail)})());

/* Catalogue public : établissements validés uniquement */
on("GET","/api/restaurants",async(req,res)=>{
  const rows=await all(`SELECT r.*,(SELECT AVG(((v.sc->>0)::int+(v.sc->>1)::int+(v.sc->>2)::int+(v.sc->>3)::int)/4.0) FROM reviews v WHERE v.rid=r.id) AS note,
    (SELECT COUNT(*) FROM reviews v WHERE v.rid=r.id) AS avis,
    (SELECT COALESCE(array_agg(p.id ORDER BY p.pos,p.id),'{}') FROM restaurant_photos p WHERE p.rid=r.id) AS photos FROM restaurants r WHERE status='valide' ORDER BY r.demo DESC, r.created`);
  const revs={};(await all("SELECT id,rid,nom,date,sc,txt,reply FROM reviews ORDER BY created DESC LIMIT 2000")).forEach(v=>{(revs[v.rid]=revs[v.rid]||[]).push({id:v.id,nom:prive(v.nom),date:v.date,sc:v.sc,txt:v.txt,reply:v.reply,visits:1})});
  json(res,200,{restaurants:rows.map(r=>({...restoPublic(r),revs:(revs[r.id]||[]).slice(0,30)})),menus:Object.fromEntries(rows.map(r=>[r.id,r.menu]))})});

/* 1) Le restaurant envoie une demande : l'équipe le rappelle */
on("POST","/api/pro/demande",async(req,res,b)=>{
  const resto=str(b.resto,80),commune=str(b.commune,40),type=str(b.type,40),gerant=str(b.gerant,80),tel=normTel(b.tel),mail=str(b.mail,120).toLowerCase(),tables=Math.round(+b.tables)||null,plan=CAT.PLANS[b.plan]?b.plan:"essentiel",message=str(b.message,800);
  if(resto.length<2)return fail(res,400,"Indique le nom de l'établissement.");if(!CAT.COMMUNES[commune])return fail(res,400,"Choisis la commune.");if(!CAT.TYPES.includes(type))return fail(res,400,"Choisis le type d'établissement.");
  if(gerant.length<2)return fail(res,400,"Indique ton nom.");if(!FIXE_OK(tel))return fail(res,400,"Téléphone invalide : 10 chiffres.");if(!MAIL.test(mail))return fail(res,400,"Adresse e-mail invalide.");
  const key="demande:"+ipDe(req);if(await tooMany(key))return fail(res,429,"Trop de demandes. Réessaie plus tard.");await failed(key);
  await q("INSERT INTO leads(resto,commune,type,gerant,tel,mail,tables,plan,message) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",[resto,commune,type,gerant,tel,mail,tables,plan,message]);
  bg(msg.proLeadReceived(mail,gerant,resto));notifierEquipe(m=>msg.proNewLead(m,resto,commune,gerant,tel));json(res,201,{ok:true})});
/* 2) L'équipe suit les demandes */
on("GET","/api/admin/leads",async(req,res)=>{if(!await superOnly(req,res))return;json(res,200,{leads:await all("SELECT * FROM leads ORDER BY (status IN ('nouveau','contacte')) DESC, created DESC LIMIT 300")})});
on("PATCH","/api/admin/leads/:id",async(req,res,b,qs,p)=>{if(!await superOnly(req,res))return;const st=String(b.status||"");if(!["nouveau","contacte","refuse","entretien_fait"].includes(st))return fail(res,400,"Statut invalide.");
  if(st==="entretien_fait"&&!await one("SELECT 1 FROM leads WHERE id=$1 AND status='entretien'",[+p.id||0]))return fail(res,409,"Planifie d'abord l'appel ou l'entretien.");
  const r=await q("UPDATE leads SET status=$2,notes=COALESCE($3,notes) WHERE id=$1 AND status<>'compte_cree'",[+p.id||0,st,b.notes===undefined?null:str(b.notes,800)]);if(!r.rowCount)return fail(res,404,"Demande introuvable.");json(res,200,{ok:true})});
/* 2 bis) L'équipe convoque le gérant à un entretien */
on("POST","/api/admin/leads/:id/entretien",async(req,res,b,qs,p)=>{if(!await superOnly(req,res))return;
  const mode=b.mode==="appel"?"appel":"sur_place",quand=str(b.quand,16),lieu=mode==="appel"?"Par téléphone":str(b.lieu,200);if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(quand))return fail(res,400,"Choisis la date et l'heure.");
  if(new Date(quand)<new Date())return fail(res,400,"Cette date est passée.");if(lieu.length<3)return fail(res,400,"Indique le lieu de l'entretien.");
  const l=await one("UPDATE leads SET status='entretien',entretien_at=$2,entretien_lieu=$3,entretien_mode=$4 WHERE id=$1 AND status NOT IN ('compte_cree','refuse') RETURNING *",[+p.id||0,quand,lieu,mode]);if(!l)return fail(res,404,"Demande introuvable ou déjà clôturée.");
  bg(msg.proEntretien(l.tel,l.mail,l.gerant,l.resto,quand,lieu,mode));json(res,200,{ok:true})});
/* 3) Après l'entretien : l'équipe choisit le plan et crée le compte. Le gérant reçoit un lien d'activation. */
on("POST","/api/admin/leads/:id/compte",async(req,res,b,qs,p)=>{if(!await superOnly(req,res))return;
  const l=await one("SELECT * FROM leads WHERE id=$1",[+p.id||0]);if(!l)return fail(res,404,"Demande introuvable.");if(l.status==="compte_cree")return fail(res,409,"Le compte de cette demande existe déjà.");
  if(l.status!=="entretien_fait")return fail(res,403,"Le compte ne peut être créé qu'après l'appel ou l'entretien avec le gérant.");
  const plan=CAT.PLANS[b.plan]?b.plan:l.plan,ex=await one("SELECT id,role FROM admins WHERE mail=$1",[l.mail]);if(ex&&ex.role!=="gerant")return fail(res,409,"Cet e-mail appartient à un compte de l'équipe Tablô.");
  const id=await uniqueId(l.resto),t=token(),d={n:l.resto,c:l.commune,q:CAT.COMMUNES[l.commune].q[0],t:l.type,cu:CAT.CUIS[0],b:2,h:"12h – 23h",d:"",tables:l.tables||10,tags:[],tel:l.tel,nouv:true};
  await tx(async run=>{let aid=ex&&ex.id;
    if(!aid){const salt=crypto.randomBytes(16).toString("hex");aid=(await run("INSERT INTO admins(mail,nom,salt,hash,role,tel) VALUES($1,$2,$3,$4,'gerant',$5) RETURNING id",[l.mail,l.gerant,salt,hashPass(token(),salt),l.tel])).rows[0].id}
    await run("INSERT INTO restaurants(id,data,status,owner_id,plan,contact) VALUES($1,$2,'en_attente',$3,$4,$5)",[id,JSON.stringify(d),aid,plan,JSON.stringify({gerant:l.gerant,mail:l.mail,tel:l.tel})]);
    await run("INSERT INTO activations(token,admin_id,expires) VALUES($1,$2,now()+interval '7 days')",[sha(t),aid]);
    await run("UPDATE leads SET status='compte_cree',plan=$2,rid=$3 WHERE id=$1",[l.id,plan,id])});
  RNAMES[id]=l.resto;const url=baseUrl(req)+"/admin#activer-"+t;bg(msg.proActivation(l.mail,l.gerant,l.resto,url));json(res,201,{id,url,mail:l.mail})});
/* 3 bis) L'équipe renvoie le lien d'activation : l'ancien lien cesse de fonctionner, aucun compte ni établissement n'est recréé */
on("POST","/api/admin/leads/:id/lien",async(req,res,b,qs,p)=>{if(!await superOnly(req,res))return;
  const l=await one("SELECT * FROM leads WHERE id=$1",[+p.id||0]);if(!l)return fail(res,404,"Demande introuvable.");if(l.status!=="compte_cree")return fail(res,409,"Le compte de cette demande n'est pas encore créé.");
  const a=await one("SELECT id,role FROM admins WHERE mail=$1",[l.mail]);if(!a||a.role!=="gerant")return fail(res,409,"Le compte du gérant est introuvable.");
  const t=token();await tx(async run=>{await run("DELETE FROM activations WHERE admin_id=$1",[a.id]);await run("INSERT INTO activations(token,admin_id,expires) VALUES($1,$2,now()+interval '7 days')",[sha(t),a.id])});
  const url=baseUrl(req)+"/admin#activer-"+t;bg(msg.proActivation(l.mail,l.gerant,l.resto,url));json(res,201,{url,mail:l.mail})});
/* 4) Le gérant active son compte en choisissant son mot de passe */
on("GET","/api/pro/activation",async(req,res,b,qs)=>{const a=await one("SELECT a.nom,a.mail FROM activations v JOIN admins a ON a.id=v.admin_id WHERE v.token=$1 AND v.expires>now()",[sha(str(qs.get("token"),100))]);
  if(!a)return fail(res,404,"Ce lien n'est plus valable. Demande-en un nouveau à l'équipe Tablô.");json(res,200,a)});
on("POST","/api/pro/activation",async(req,res,b)=>{const pass=typeof b.pass==="string"?b.pass:"";if(pass.length<8||!/[A-Za-z]/.test(pass)||!/\d/.test(pass))return fail(res,400,"Mot de passe : 8 caractères minimum, avec au moins une lettre et un chiffre.");
  const v=await one("SELECT * FROM activations WHERE token=$1 AND expires>now()",[sha(str(b.token,100))]);if(!v)return fail(res,404,"Ce lien n'est plus valable. Demande-en un nouveau à l'équipe Tablô.");
  const salt=crypto.randomBytes(16).toString("hex");await tx(async run=>{await run("UPDATE admins SET salt=$2,hash=$3 WHERE id=$1",[v.admin_id,salt,hashPass(pass,salt)]);await run("DELETE FROM activations WHERE admin_id=$1",[v.admin_id]);await run("DELETE FROM sessions WHERE kind='admin' AND sub=$1",[v.admin_id])});
  const a=await one("SELECT id,mail,nom,role FROM admins WHERE id=$1",[v.admin_id]);json(res,200,{admin:{mail:a.mail,nom:a.nom,role:a.role},restos:await restosFor(a)},{"Set-Cookie":await newSession("admin",a.id,1)})});

/* Un gérant déjà inscrit ajoute un autre établissement */
on("POST","/api/admin/restaurants",async(req,res,b)=>{const a=await adminCtx(req,res);if(!a)return;
  if(a.role!=="super"&&!await one("SELECT 1 FROM restaurants WHERE owner_id=$1 AND plan='premium'",[a.id]))return fail(res,403,"Plusieurs établissements : réservé au plan Premium.");const f=cleanFiche(b.resto||{});if(f.err)return fail(res,400,f.err);
  const id=await uniqueId(f.data.n);const st=a.role==="super"?"valide":"en_attente";
  await q("INSERT INTO restaurants(id,data,menu,status,owner_id,plan,submitted,contact) VALUES($1,$2,$3,$4,$5,'premium',$6,$7)",[id,JSON.stringify(f.data),JSON.stringify(cleanMenu(b.menu)),st,a.role==="super"?null:a.id,a.role==="super",JSON.stringify({rccm:str((b.resto||{}).rccm,40),gerant:a.nom,mail:a.mail})]);
  RNAMES[id]=f.data.n;if(st==="en_attente")bg((async()=>{for(const s2 of await all("SELECT mail FROM admins WHERE role='super'"))await msg.proSubmitted(s2.mail,f.data.n,a.nom)})());
  json(res,201,{id,status:st,restos:await restosFor(a)})});

/* Fiche complète d'un établissement (lecture / modification par son gérant ou l'équipe Tablô) */
on("GET","/api/admin/restaurants/:id",async(req,res,b,qs,p)=>{const id=decodeURIComponent(p.id);if(!await needResto(req,res,id))return;
  const r=await one("SELECT * FROM restaurants WHERE id=$1",[id]);if(!r)return fail(res,404,"Établissement introuvable.");
  const photos=(await all("SELECT id FROM restaurant_photos WHERE rid=$1 ORDER BY pos,id",[id])).map(x=>x.id);
  json(res,200,{id:r.id,data:r.data,menu:r.menu,status:r.status,demo:r.demo,contact:r.contact,plan:r.plan,submitted:r.submitted,photos,manque:await manque(id,r)})});
on("PUT","/api/admin/restaurants/:id",async(req,res,b,qs,p)=>{const id=decodeURIComponent(p.id);if(!await needResto(req,res,id))return;
  const r=await one("SELECT * FROM restaurants WHERE id=$1",[id]);if(!r)return fail(res,404,"Établissement introuvable.");
  const f=cleanFiche({...r.data,...(b.resto||{}),tables:(Array.isArray((b.resto||{}).salle)?b.resto.salle.length:r.data.tables)},!r.demo);if(f.err)return fail(res,400,f.err);
  const cfg=cleanConfig(b.resto||{});if(cfg.err)return fail(res,400,cfg.err);
  const data={...r.data,...f.data,...cfg.data,nouv:r.data.nouv};
  if(cfg.data.services){const fh=t=>t.slice(0,2)+"h"+(t.slice(3)==="00"?"":t.slice(3)),sv=cfg.data.services;data.h=fh(sv[0].de)+" – "+fh(sv[sv.length-1].a)}
  await q("UPDATE restaurants SET data=$2,menu=COALESCE($3,menu),updated=now() WHERE id=$1",[id,JSON.stringify(data),b.menu?JSON.stringify(cleanMenu(b.menu)):null]);
  RNAMES[id]=data.n;json(res,200,{ok:true})});

/* Photos (JPEG, PNG ou WebP, redimensionnées par le navigateur) */
const SIG=[["image/jpeg",[0xFF,0xD8,0xFF]],["image/png",[0x89,0x50,0x4E,0x47]],["image/webp",[0x52,0x49,0x46,0x46]]];
on("POST","/api/admin/restaurants/:id/photos",async(req,res,b,qs,p)=>{const id=decodeURIComponent(p.id);if(!await needResto(req,res,id))return;
  const m=String(b.data||"").match(/^data:image\/[a-z]+;base64,([A-Za-z0-9+/=]+)$/);if(!m)return fail(res,400,"Image invalide.");
  const buf=Buffer.from(m[1],"base64");if(buf.length>700*1024)return fail(res,413,"Image trop lourde (700 Ko maximum).");
  const sig=SIG.find(([,o])=>o.every((v,i)=>buf[i]===v));if(!sig)return fail(res,400,"Format accepté : JPEG, PNG ou WebP.");
  const c=await one("SELECT COUNT(*)::int AS n FROM restaurant_photos WHERE rid=$1",[id]);if(c.n>=8)return fail(res,400,"8 photos maximum.");
  const r=await one("INSERT INTO restaurant_photos(rid,mime,bytes,pos) VALUES($1,$2,$3,$4) RETURNING id",[id,sig[0],buf,c.n]);json(res,201,{id:r.id})});
on("DELETE","/api/admin/restaurants/:id/photos/:pid",async(req,res,b,qs,p)=>{const id=decodeURIComponent(p.id);if(!await needResto(req,res,id))return;
  await q("DELETE FROM restaurant_photos WHERE id=$1 AND rid=$2",[+p.pid||0,id]);json(res,200,{ok:true})});
on("GET","/api/photos/:pid",async(req,res,b,qs,p)=>{const x=await one("SELECT p.mime,p.bytes,p.rid,r.status FROM restaurant_photos p JOIN restaurants r ON r.id=p.rid WHERE p.id=$1",[+p.pid||0]);if(!x)return fail(res,404,"Introuvable");
  if(x.status!=="valide"){const s2=await session(req,"admin"),a=s2&&await one("SELECT id,role FROM admins WHERE id=$1",[s2.sub]);if(!a||!await canManage(a,x.rid))return fail(res,404,"Introuvable")}
  res.writeHead(200,{"Content-Type":x.mime,"Cache-Control":"private, max-age=3600","X-Content-Type-Options":"nosniff"});res.end(x.bytes)});
/* Le gérant soumet sa fiche complète pour publication */
on("POST","/api/admin/restaurants/:id/soumettre",async(req,res,b,qs,p)=>{const id=decodeURIComponent(p.id),a=await needResto(req,res,id);if(!a)return;
  const r=await one("SELECT * FROM restaurants WHERE id=$1",[id]);const m=await manque(id,r);if(m.length)return fail(res,400,"Il manque : "+m.join(", ")+".");
  await q("UPDATE restaurants SET submitted=true,status=CASE WHEN status='refuse' THEN 'en_attente' ELSE status END WHERE id=$1",[id]);notifierEquipe(x=>msg.proSubmitted(x,r.data.n,a.nom));json(res,200,{ok:true})});

/* Relevé du mois : abonnement + clients venus via Tablô. Sert de base à la facturation, rien n'est encaissé. */
on("GET","/api/admin/releve",async(req,res,b,qs)=>{const a=await adminCtx(req,res);if(!a)return;const m=str(qs.get("mois"),7);const mois=/^\d{4}-\d{2}$/.test(m)?m:iso(new Date()).slice(0,7);
  const rows=await all(`SELECT r.id,r.data->>'n' AS n,r.plan,r.status,COALESCE(SUM(v.pers) FILTER (WHERE v.status='honorée'),0)::int AS clients,COUNT(v.id) FILTER (WHERE v.status='no-show')::int AS noshows,COUNT(v.id)::int AS resas
    FROM restaurants r LEFT JOIN reservations v ON v.rid=r.id AND v.date LIKE $1 WHERE NOT r.demo AND r.status='valide' ${a.role==="super"?"":"AND r.owner_id=$2"} GROUP BY r.id`,a.role==="super"?[mois+"%"]:[mois+"%",a.id]);
  json(res,200,{mois,lignes:rows.map(r=>{const p=CAT.PLANS[r.plan]||CAT.PLANS.essentiel,com=r.clients*p.couvert;return {...r,offre:p.l,abonnement:p.prix,commission:com,total:p.prix+com}})})});

/* Équipe Tablô : liste et validation des établissements */
on("GET","/api/admin/restaurants",async(req,res)=>{if(!await superOnly(req,res))return;
  const rows=await all("SELECT r.id,r.data,r.status,r.demo,r.contact,r.created,r.plan,r.submitted,a.nom AS gerant,a.mail AS gerant_mail,a.tel AS gerant_tel FROM restaurants r LEFT JOIN admins a ON a.id=r.owner_id ORDER BY (r.status='en_attente' AND r.submitted) DESC,(r.status='en_attente') DESC, r.created DESC");
  json(res,200,{restaurants:rows.map(r=>({id:r.id,n:r.data.n,c:r.data.c,q:r.data.q,t:r.data.t,cu:r.data.cu,status:r.status,plan:r.plan,submitted:r.submitted,demo:r.demo,created:r.created,
    gerant:r.gerant||null,mail:r.gerant_mail||null,tel:r.gerant_tel||r.data.tel||null,rccm:(r.contact||{}).rccm||""}))})});
on("PATCH","/api/admin/restaurants/:id/status",async(req,res,b,qs,p)=>{if(!await superOnly(req,res))return;const id=decodeURIComponent(p.id),st=String(b.status||"");
  if(!STATUTS.includes(st))return fail(res,400,"Statut invalide.");
  const cur=await one("SELECT * FROM restaurants WHERE id=$1",[id]);if(!cur)return fail(res,404,"Établissement introuvable.");
  if(st==="valide"&&!cur.demo){const m=await manque(id,cur);if(m.length)return fail(res,400,"Publication impossible, il manque : "+m.join(", ")+".")}
  const r=await one("UPDATE restaurants SET status=$2,submitted=$3,updated=now() WHERE id=$1 RETURNING data,owner_id",[id,st,st==="refuse"?false:cur.submitted]);
  const o=r.owner_id&&await one("SELECT mail,nom FROM admins WHERE id=$1",[r.owner_id]);
  if(o){const url=baseUrl(req)+"/admin";
    if(st==="valide")bg(msg.proValidated(o.mail,o.nom,r.data.n,url));
    if(st==="refuse")bg(msg.proRefused(o.mail,o.nom,r.data.n,str(b.motif,300)));
    if(st==="suspendu")bg(msg.proSuspended(o.mail,o.nom,r.data.n))}
  json(res,200,{ok:true,status:st})});

/* ---------- Fichiers statiques ---------- */
const TYPES={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".png":"image/png",".jpg":"image/jpeg",".svg":"image/svg+xml",".ico":"image/x-icon",".webp":"image/webp"};
const PUBLIC=new Set(["index.html","css","js","img"]);
function serveStatic(req,res,pathname){
  if(pathname==="/admin/"){res.writeHead(301,{Location:"/admin"});return res.end()}
  const espace=pathname==="/admin"; // l'espace admin et gérant a sa propre adresse, hors des moteurs de recherche
  let rel=decodeURIComponent(pathname);if(rel==="/"||espace)rel="/index.html";
  const file=path.normalize(path.join(ROOT,rel));const top=path.relative(ROOT,file).split(path.sep)[0];
  if(!file.startsWith(ROOT+path.sep)||!PUBLIC.has(top))return fail(res,404,"Introuvable");
  fs.readFile(file,(err,buf)=>{if(err)return fail(res,404,"Introuvable");
    res.writeHead(200,{"Content-Type":TYPES[path.extname(file).toLowerCase()]||"application/octet-stream","Cache-Control":"no-cache","X-Content-Type-Options":"nosniff",...(espace?{"X-Robots-Tag":"noindex"}:{})});res.end(buf)});
}

/* ---------- Serveur ---------- */
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,"http://localhost");
  if(!url.pathname.startsWith("/api/"))return req.method==="GET"||req.method==="HEAD"?serveStatic(req,res,url.pathname):fail(res,405,"Méthode non autorisée");
  if(req.method!=="GET"){ // anti-CSRF : JSON obligatoire et même origine
    if(!(req.headers["content-type"]||"").includes("application/json"))return fail(res,415,"JSON attendu");
    const o=req.headers.origin;if(o&&new URL(o).host!==req.headers.host)return fail(res,403,"Origine refusée")}
  const r=routes.find(x=>x.method===req.method&&x.re.test(url.pathname));
  if(!r)return fail(res,404,"Route inconnue");
  try{const body=req.method==="GET"?{}:await readBody(req);await r.handler(req,res,body,url.searchParams,url.pathname.match(r.re).groups||{})}
  catch(e){console.error(e);if(!res.headersSent)fail(res,500,"Erreur serveur")}
});
init().then(()=>{envoyerRappels().catch(e=>console.error("[rappels]",e.message));return server}).then(()=>server.listen(PORT,()=>console.log(`Tablô (PostgreSQL) sur http://localhost:${PORT}   ·   admin : http://localhost:${PORT}/admin`)))
  .catch(e=>{console.error("Impossible d'initialiser la base PostgreSQL :",e.message);process.exit(1)});
/* Rappel unique envoyé 2 h avant le repas (heure locale du serveur = heure d'Abidjan en production) */
const hhmm=d=>iso(d)+" "+String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0");
async function envoyerRappels(){const n=new Date(),fin=new Date(n.getTime()+2*3600000);
  const rows=(await q("UPDATE reservations SET reminded=true WHERE status='confirmée' AND NOT reminded AND tel<>'0700000000' AND date||' '||time>$1 AND date||' '||time<=$2 RETURNING *",[hhmm(n),hhmm(fin)])).rows;
  rows.forEach(r=>bg(msg.reminder(r,rname(r.rid))));if(rows.length)console.log(`[rappels] ${rows.length} envoyé(s)`)}
setInterval(()=>envoyerRappels().catch(e=>console.error("[rappels]",e.message)),5*60000).unref();
setInterval(()=>{q("DELETE FROM sessions WHERE expires<now()");q("DELETE FROM otps WHERE expires<now()");q("DELETE FROM signups WHERE expires<now()")},3600000).unref();
