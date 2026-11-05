/* Tablô : calcul des disponibilités, partagé entre le navigateur et le serveur.
   Un créneau est libre si le restaurant a un service à cette heure et s'il reste une table
   (ou plusieurs tables de la même zone pour un groupe) qui n'est pas prise pendant la durée du repas. */
(function(root){
  "use strict";
  const toMin=t=>{const [h,m]=String(t).split(":").map(Number);return h*60+(m||0)};
  const fromH=s=>{const m=String(s).match(/(\d{1,2})h(\d{2})?/);return m?m[1].padStart(2,"0")+":"+(m[2]||"00"):"12:00"};
  const TOUS=[0,1,2,3,4,5,6];

  /* Tables : celles configurées par le gérant, sinon une salle type déduite du nombre de tables */
  function salle(r){
    if(Array.isArray(r.salle)&&r.salle.length)return r.salle;
    const caps=[2,4,4,6,2,4,8,4],terrasse=(r.tags||[]).includes("Terrasse");
    return Array.from({length:Math.max(1,+r.tables||10)},(_,i)=>({n:i+1,cap:caps[i%caps.length],zone:terrasse&&i%3===2?"Terrasse":"Salle"}));
  }
  /* Services : ceux configurés par le gérant, sinon un service unique sur les horaires de la fiche */
  function services(r){
    if(Array.isArray(r.services)&&r.services.length)return r.services;
    const [de,a]=String(r.h||"12h – 23h").split("–").map(fromH);
    return [{nom:"Service",de,a,jours:TOUS,zones:null}];
  }
  const duree=r=>+r.duree||90;
  const maxPers=r=>+r.maxPers||20;
  const jourDe=date=>new Date(date+"T12:00:00").getDay();

  function serviceA(r,date,time){
    const j=jourDe(date);let x=toMin(time);
    return services(r).find(s=>{
      if(!(s.jours||TOUS).includes(j))return false;
      const d=toMin(s.de);let f=toMin(s.a),y=x;
      if(f<=d){f+=1440;if(y<d)y+=1440}
      return y>=d&&y<f;
    })||null;
  }
  /* occ = réservations de ce restaurant ce jour-là : [{t:[numéros de tables],time:"20:00"}] */
  function tablesPrises(r,time,occ,ignore){
    const x=toMin(time),D=duree(r),pris=new Set();
    (occ||[]).forEach(o=>{
      if(ignore&&o.time===ignore.time&&String(o.t)===String(ignore.tables))return;
      let d=Math.abs(toMin(o.time)-x);d=Math.min(d,1440-d);
      if(d<D)(o.t||[]).forEach(n=>pris.add(n));
    });
    return pris;
  }
  /* Renvoie les numéros de tables à attribuer, ou null si ce n'est pas possible */
  function choisir(r,date,time,pers,occ,ignore){
    pers=+pers;if(!(pers>=1)||pers>maxPers(r))return null;
    const s=serviceA(r,date,time);if(!s)return null;
    const pris=tablesPrises(r,time,occ,ignore);
    const libres=salle(r).filter(t=>!pris.has(t.n)&&(!Array.isArray(s.zones)||!s.zones.length||s.zones.includes(t.zone)));
    const seule=libres.filter(t=>t.cap>=pers).sort((a,b)=>a.cap-b.cap)[0];
    if(seule)return [seule.n];
    let best=null;
    [...new Set(libres.map(t=>t.zone))].forEach(z=>{
      let total=0;const pick=[];
      libres.filter(t=>t.zone===z).sort((a,b)=>b.cap-a.cap).some(t=>{pick.push(t.n);total+=t.cap;return total>=pers});
      if(total>=pers&&(!best||pick.length<best.length))best=pick;
    });
    return best;
  }
  const api={salle,services,duree,maxPers,serviceA,choisir,toMin,TOUS};
  if(typeof module!=="undefined"&&module.exports)module.exports=api;else root.SLOTS=api;
})(typeof globalThis!=="undefined"?globalThis:this);
