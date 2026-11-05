/* Base PostgreSQL propre au projet (dossier pgdata/, port 5433).
   Utilise les outils de PostgreSQL déjà installés (initdb, pg_ctl).
   - Premier lancement : crée le cluster avec un mot de passe aléatoire, la base « tablo », et écrit DATABASE_URL dans .env.
   - Lancements suivants : démarre simplement le serveur PostgreSQL du projet s'il est arrêté.
   Activé par DB_LOCAL=1 dans .env. */
"use strict";
const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");
const {execFileSync}=require("node:child_process");

const exe=n=>process.platform==="win32"?n+".exe":n;
function findBin(){
  const cands=[];
  if(process.env.PG_BIN)cands.push(process.env.PG_BIN);
  if(process.platform==="win32"){
    for(const base of ["C:/Program Files/PostgreSQL","C:/Program Files (x86)/PostgreSQL"]){
      if(fs.existsSync(base))fs.readdirSync(base).filter(v=>/^\d+/.test(v)).sort((a,b)=>parseFloat(b)-parseFloat(a)).forEach(v=>cands.push(path.join(base,v,"bin")))}
  }else ["/usr/lib/postgresql","/opt/homebrew/opt/postgresql/bin","/usr/local/bin","/usr/bin"].forEach(p=>{
    if(p==="/usr/lib/postgresql"&&fs.existsSync(p))fs.readdirSync(p).sort().reverse().forEach(v=>cands.push(path.join(p,v,"bin")));else cands.push(p)});
  const bin=cands.find(d=>fs.existsSync(path.join(d,exe("initdb"))));
  if(!bin)throw new Error("Outils PostgreSQL introuvables (initdb). Indique leur dossier dans PG_BIN, ex. PG_BIN=C:/Program Files/PostgreSQL/18/bin");
  return bin;
}
function setEnv(file,key,val){let s=fs.existsSync(file)?fs.readFileSync(file,"utf8"):"";const re=new RegExp("^"+key+"=.*$","m");
  s=re.test(s)?s.replace(re,key+"="+val):s.replace(/\s*$/,"\n")+key+"="+val+"\n";fs.writeFileSync(file,s)}

async function ensureLocalDb(root){
  const bin=findBin(),run=(n,args)=>execFileSync(path.join(bin,exe(n)),args,{stdio:"ignore",windowsHide:true});
  const data=path.join(root,"pgdata"),log=path.join(root,"pgdata.log"),port=String(process.env.DB_LOCAL_PORT||5433),envFile=path.join(root,".env");
  if(!fs.existsSync(path.join(data,"PG_VERSION"))){
    const pass=crypto.randomBytes(18).toString("base64url"),pw=path.join(root,".pgpass.tmp");
    fs.writeFileSync(pw,pass);
    try{console.log("[db] création de la base PostgreSQL du projet (pgdata/)…");
      run("initdb",["-D",data,"-U","tablo","-A","scram-sha-256","--pwfile",pw,"-E","UTF8","--locale=C"])}
    finally{fs.rmSync(pw,{force:true})}
    const url=`postgres://tablo:${pass}@localhost:${port}/tablo`;
    setEnv(envFile,"DATABASE_URL",url);process.env.DATABASE_URL=url;
  }
  let up=true;try{run("pg_ctl",["-D",data,"status"])}catch(e){up=false}
  if(!up){console.log(`[db] démarrage de PostgreSQL (port ${port})…`);run("pg_ctl",["-D",data,"-l",log,"-o",`-p ${port}`,"-w","-t","60","start"])}
  // crée la base « tablo » si besoin (connexion à la base système « postgres »)
  const {Client}=require("pg");const u=new URL(process.env.DATABASE_URL);const c=new Client({host:u.hostname,port:+u.port,user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),database:"postgres"});
  await c.connect();try{const r=await c.query("SELECT 1 FROM pg_database WHERE datname='tablo'");if(!r.rowCount)await c.query("CREATE DATABASE tablo ENCODING 'UTF8' TEMPLATE template0")}finally{await c.end()}
  console.log(`[db] PostgreSQL du projet prêt sur le port ${port}`);
}
module.exports={ensureLocalDb};
