/* Envoi réel des SMS (LeTexto) et des e-mails (Resend) — mêmes fournisseurs que le projet AUKAZ.
   Configuration dans .env :
     SMS_PROVIDER=letexto        LETEXTO_API_KEY=...   LETEXTO_SENDER_NAME=... (11 caractères max)
     RESEND_API_KEY=...          EMAIL_EXPEDITEUR="Tablô <adresse@domaine-vérifié>"
   Sans configuration, rien n'est envoyé : le message est seulement journalisé dans la console.
   Une erreur d'envoi est journalisée mais ne bloque jamais la réservation ni la connexion. */
"use strict";
const env=k=>(process.env[k]||"").trim();
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

const smsOn=()=>env("SMS_PROVIDER").toLowerCase()==="letexto"&&!!env("LETEXTO_API_KEY");
const mailOn=()=>!!env("RESEND_API_KEY")&&!!env("EMAIL_EXPEDITEUR");

/* Numéro ivoirien 0XXXXXXXXX → 2250XXXXXXXXX (format attendu par LeTexto, sans "+") */
const toIntl=tel=>{const d=String(tel||"").replace(/\D/g,"");if(/^0\d{9}$/.test(d))return "225"+d;if(/^2250\d{9}$/.test(d))return d;return null};

async function sendSms(tel,content){
  const to=toIntl(tel);if(!to)return {ok:false,reason:"numéro invalide"};
  if(to==="2250700000000"){console.log(`[sms ignoré, numéro de démo] ${content}`);return {ok:false,reason:"numéro de démo"}}
  if(!smsOn()){console.log(`[sms simulé] ${to} : ${content}`);return {ok:false,reason:"non configuré"}}
  try{const r=await fetch("https://apis.letexto.com/v1/messages/send",{method:"POST",
      headers:{"Content-Type":"application/json",Authorization:`Bearer ${env("LETEXTO_API_KEY")}`},
      body:JSON.stringify({from:(env("LETEXTO_SENDER_NAME")||"TABLO").slice(0,11),to,content})});
    if(!r.ok)throw new Error(`LeTexto ${r.status} : ${(await r.text()).slice(0,200)}`);
    console.log(`[sms] envoyé à ${to}`);return {ok:true}}
  catch(e){console.error(`[sms] échec vers ${to} : ${e.message}`);return {ok:false,reason:e.message}}
}

async function sendMail(to,subject,html){
  if(!to)return {ok:false,reason:"pas d'adresse"};
  if(!mailOn()){console.log(`[e-mail simulé] ${to} : ${subject}`);return {ok:false,reason:"non configuré"}}
  try{const r=await fetch("https://api.resend.com/emails",{method:"POST",
      headers:{"Content-Type":"application/json",Authorization:`Bearer ${env("RESEND_API_KEY")}`},
      body:JSON.stringify({from:env("EMAIL_EXPEDITEUR"),to,subject,html:layout(html)})});
    if(!r.ok)throw new Error(`Resend ${r.status} : ${(await r.text()).slice(0,200)}`);
    console.log(`[e-mail] envoyé à ${to} : ${subject}`);return {ok:true}}
  catch(e){console.error(`[e-mail] échec vers ${to} : ${e.message}`);return {ok:false,reason:e.message}}
}
const layout=body=>`<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#2D333F">
  <p style="font-size:22px;font-weight:800;color:#DA3743;margin:0 0 16px">Tablô</p>${body}
  <p style="font-size:12px;color:#6F737B;margin-top:28px">Tablô · Réserve ta table à Abidjan</p></div>`;

const fmtDate=d=>new Date(d+"T12:00").toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"});
const hm=t=>String(t).replace(":","h");

/* ---------- Messages métier ---------- */
const msg={
  otp(ident,code){
    return /^0\d{9}$/.test(ident)
      ?sendSms(ident,`Ton code Tablô : ${code}. Il expire dans 10 minutes. Ne le partage avec personne.`)
      :sendMail(ident,"Ton code de connexion Tablô",`<p>Voici ton code pour te connecter à Tablô :</p>
        <p style="font-size:30px;font-weight:bold;letter-spacing:6px">${esc(code)}</p><p>Il expire dans 10 minutes. Si tu n'es pas à l'origine de cette demande, ignore cet e-mail.</p>`);
  },
  booked(r,rname,mail){
    const line=`${rname}, ${fmtDate(r.date)} à ${hm(r.time)}, ${r.pers} pers.`;
    const jobs=[sendSms(r.tel,`Tablô : table confirmée ! ${line} Code ${r.code}. A présenter à l'accueil.`)];
    if(mail)jobs.push(sendMail(mail,`Réservation confirmée · ${rname}`,`<p>C'est réservé !</p>
      <p><b>${esc(rname)}</b><br>${esc(fmtDate(r.date))} à ${esc(hm(r.time))} · ${r.pers} pers.</p>
      <p style="font-size:26px;font-weight:bold;letter-spacing:3px">${esc(r.code)}</p><p>Présente ce code à l'accueil. +50 points crédités sur ton compte.</p>`));
    return Promise.all(jobs);
  },
  cancelled(r,rname,mail){
    const jobs=[sendSms(r.tel,`Tablô : ta réservation ${r.code} chez ${rname} (${fmtDate(r.date)} à ${hm(r.time)}) est annulée.`)];
    if(mail)jobs.push(sendMail(mail,`Réservation annulée · ${rname}`,`<p>Ta réservation <b>${esc(r.code)}</b> chez <b>${esc(rname)}</b> du ${esc(fmtDate(r.date))} à ${esc(hm(r.time))} est annulée.</p>`));
    return Promise.all(jobs);
  },
  visited(tel,rname){return sendSms(tel,`Merci pour ta visite chez ${rname} ! +100 points Tablô. Laisse un avis dans l'appli pour +30 pts.`)},
  tableReady(tel,rname){return sendSms(tel,`Tablô : ta table est prête chez ${rname}. Présente-toi à l'accueil dans les 10 minutes.`)},
  reminder(r,rname){return sendSms(r.tel,`Tablô : rappel, ta table chez ${rname} t'attend à ${hm(r.time)} (${r.pers} pers.). Code ${r.code}. Empêchement ? Annule dans Mon compte.`)},
  tableFreed(tel,rname,date,time){return sendSms(tel,`Tablô : une table s'est libérée chez ${rname}, ${fmtDate(date)} à ${hm(time)}. Réserve vite sur Tablô.`)},
  pickup(r,rname){return sendSms(r.tel,`Tablô : portion réservée chez ${rname} : ${r.plat}, ${r.prix} F à payer au retrait ce soir. Code ${r.code}.`)},
  orderPlaced(c,rname){const mode=c.mode==="livraison"?"à payer à la livraison":"à payer au retrait";return sendSms(c.tel,`Tablô : commande ${c.code} reçue par ${rname}. Total ${c.total} F, ${mode}. Suis-la dans Mon compte.`)},
  orderNew(tel,mail,c,rname){const lignes=c.items.map(i=>i.q+" x "+i.n).join(", "),mode=c.mode==="livraison"?"Livraison : "+c.adresse:"À emporter";const jobs=[];
    if(/^0[157]\d{8}$/.test(String(tel||"")))jobs.push(sendSms(tel,`Tablô : nouvelle commande ${c.code}, ${c.total} F. ${mode}. A traiter dans l'espace restaurateur.`));
    if(mail)jobs.push(sendMail(mail,`Nouvelle commande ${c.code} · ${rname}`,`<p><b>${esc(lignes)}</b></p><p>${esc(mode)}<br>Client : ${esc(c.nom)} · ${esc(c.tel)}${c.note?"<br>Note : "+esc(c.note):""}</p><p style="font-size:22px;font-weight:bold">${c.total} F</p><p>À traiter dans l'espace restaurateur, onglet « Commandes ».</p>`));
    return Promise.all(jobs)},
  orderStatus(c,rname,status){const t={"prête":`ta commande ${c.code} est prête chez ${rname}. Total ${c.total} F à payer au retrait.`,"en livraison":`ta commande ${c.code} de ${rname} est en route. Total ${c.total} F à payer à la livraison.`,"annulée":`ta commande ${c.code} chez ${rname} est annulée.`}[status];return t?sendSms(c.tel,"Tablô : "+t):Promise.resolve()},
  proReset(mail,nom,url){return sendMail(mail,"Nouveau mot de passe Tablô",`<p>Bonjour ${esc(nom)},</p><p>Clique ici pour choisir un nouveau mot de passe :</p><p><a href="${esc(url)}" style="display:inline-block;background:#DA3743;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:bold">Choisir mon mot de passe</a></p><p>Ce lien expire dans 1 heure. Si tu n'as rien demandé, ignore cet e-mail.</p>`)},
  /* Établissements */
  proLeadReceived(mail,nom,resto){return sendMail(mail,`Demande reçue · ${resto}`,`<p>Bonjour ${esc(nom)},</p>
    <p>Merci de l'intérêt que tu portes à Tablô pour <b>${esc(resto)}</b>. Un membre de notre équipe va te contacter pour un appel ou un entretien. Ton accès à Tablô sera créé après cet échange.</p>`)},
  proNewLead(to,resto,commune,gerant,tel){return sendMail(to,`Nouvelle demande à rappeler · ${resto}`,`<p><b>${esc(resto)}</b> (${esc(commune)}) souhaite rejoindre Tablô.</p>
    <p>À rappeler : ${esc(gerant)} · <a href="tel:${esc(tel)}">${esc(tel)}</a></p><p>Retrouve la demande dans l'espace restaurateur, onglet « Demandes ».</p>`)},
  proEntretien(tel,mail,nom,resto,quand,lieu,mode){const d=new Date(quand),txt=d.toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"})+" à "+hm(quand.slice(11)),appel=mode==="appel";
    return Promise.all([sendSms(tel,appel?`Tablô : nous t'appelons le ${txt} au sujet de ${resto}.`:`Tablô : entretien pour ${resto} le ${txt}, ${lieu}. Merci de venir avec les documents de ton établissement.`),
      sendMail(mail,`${appel?"Ton appel":"Ton entretien"} Tablô · ${resto}`,`<p>Bonjour ${esc(nom)},</p><p>${appel?"Nous t'appelons":"Nous te recevons"} pour parler de <b>${esc(resto)}</b> :</p><p><b>${esc(txt)}</b><br>${esc(lieu)}</p><p>${appel?"":"Merci de venir avec les documents de ton établissement. "}Ton accès à Tablô sera créé après cet échange.</p>`)])},
  proActivation(mail,nom,resto,url){return sendMail(mail,`Ton compte Tablô pour ${resto}`,`<p>Bonjour ${esc(nom)},</p>
    <p>Ton compte est prêt. Choisis ton mot de passe, puis configure ta fiche, tes photos, ton menu, ta salle et tes services.</p>
    <p><a href="${esc(url)}" style="display:inline-block;background:#DA3743;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:bold">Activer mon compte</a></p><p>Ce lien expire dans 7 jours.</p>`)},
  proSubmitted(to,resto,gerant){return sendMail(to,`Fiche à publier · ${resto}`,`<p><b>${esc(gerant)}</b> a terminé la configuration de <b>${esc(resto)}</b>.</p><p>À vérifier et publier dans l'espace restaurateur, onglet « Établissements ».</p>`)},
  proValidated(mail,nom,resto,url){return sendMail(mail,`${resto} est en ligne sur Tablô`,`<p>Bonjour ${esc(nom)},</p>
    <p>Bonne nouvelle : <b>${esc(resto)}</b> est validé et visible par les clients sur Tablô. Les réservations peuvent commencer !</p>
    <p><a href="${esc(url)}" style="display:inline-block;background:#DA3743;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:bold">Accéder à mon espace restaurateur</a></p>`)},
  proRefused(mail,nom,resto,motif){return sendMail(mail,`Ta demande pour ${resto}`,`<p>Bonjour ${esc(nom)},</p>
    <p>Nous ne pouvons pas valider <b>${esc(resto)}</b> pour le moment.${motif?` Motif : ${esc(motif)}`:""}</p><p>Tu peux corriger ta fiche et nous recontacter en répondant à cet e-mail.</p>`)},
  proSuspended(mail,nom,resto){return sendMail(mail,`${resto} est suspendu`,`<p>Bonjour ${esc(nom)},</p><p><b>${esc(resto)}</b> n'est plus visible sur Tablô pour le moment. Contacte l'équipe Tablô pour en savoir plus.</p>`)},
};
const status=()=>({sms:smsOn()?"letexto":"simulé",email:mailOn()?"resend":"simulé"});
module.exports={msg,status,sendSms,sendMail};
