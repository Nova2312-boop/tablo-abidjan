/* Tablô Abidjan — données d'exemple (restaurants, menus, expériences, avis).
   Remplace ce fichier par des appels à ton API / base de données. */
"use strict";
/* ---------- DATA (fictional sample) ---------- */
const COMMUNES={
 "Cocody":{x:540,y:190,q:["Riviera","II Plateaux","Angré","Vallon","Danga","Blockhauss"],lm:["Campus Vatel","Université FHB","Hôtel Ivoire","Sofitel"]},
 "Plateau":{x:360,y:250,q:["Centre","Indénié"],lm:["Cathédrale St-Paul","Pyramide","Cité administrative"]},
 "Marcory":{x:470,y:335,q:["Zone 4","Biétry","Anoumabo"],lm:["Cap Sud","Palais de la Culture"]},
 "Treichville":{x:375,y:330,q:["Avenue 16","Arras"],lm:["Port autonome","Palais des sports"]},
 "Yopougon":{x:170,y:175,q:["Rue Princesse","Niangon","Selmer"],lm:["Parc des sports","Banco"]},
 "Koumassi":{x:570,y:345,q:["Remblais","Grand Campement"],lm:["Marché de Koumassi"]},
 "Port-Bouët":{x:470,y:445,q:["Vridi","Gonzagueville"],lm:["Aéroport FHB","Plage de Vridi"]},
 "Adjamé":{x:360,y:160,q:["Liberté","220 Logements"],lm:["Gare routière","Forum des marchés"]},
 "Abobo":{x:380,y:60,q:["Avocatier","Gare"],lm:["Mairie d'Abobo"]},
 "Bingerville":{x:740,y:180,q:["Centre"],lm:["Jardin botanique","Palais du gouverneur"]},
 "Grand-Bassam":{x:760,y:450,q:["Quartier France","Moossou"],lm:["Quartier colonial UNESCO","Plage"]}
};
const CN=Object.keys(COMMUNES);
const TYPES=["Maquis","Restaurant","Gastronomique","Lounge","Garba & rapide"];
const BUDGETS=[{id:1,l:"− 5 000 F"},{id:2,l:"5 – 15 000 F"},{id:3,l:"15 – 30 000 F"},{id:4,l:"30 000 F +"}];
const BUD_AVG=[0,3500,10000,22000,42000];
const TAGS=["Poisson braisé","Garba","Bord de lagune","Terrasse","Grillades","Vue","Brunch","Végétarien","Groupe","Live music","Climatisé","Parking","Wi-Fi","Wave / OM"];
const CUIS=["Ivoirienne","Grillades","Fruits de mer","Franco-ivoirienne","Africaine","Libanaise","Café & brunch"];
const HUES=[["#2D333F","#DA3743"],["#1F4D5C","#DA3743"],["#5A1E26","#E8742C"],["#2D333F","#1F4D5C"],["#4A2A8A","#B2305F"],["#1F4D5C","#3E8FA6"],["#7A1F2B","#DA3743"]];
/* Offres restaurateurs, tarifs validés. Facturation non automatisée. */
const PLANS={
 essentiel:{l:"Essentiel",prix:15000,couvert:200,d:"Pour démarrer",f:["Fiche, photos et menu","Réservations et plan de salle","Services et disponibilités"]},
 pro:{l:"Pro",prix:35000,couvert:150,d:"Pour remplir la salle",f:["Tout Essentiel","Pré-commandes et anti-gaspillage","Statistiques et réponses aux avis"]},
 premium:{l:"Premium",prix:60000,couvert:100,d:"Pour les groupes",f:["Tout Pro","Plusieurs établissements","Accompagnement prioritaire"]}
};
const R=[
 {id:"akissi",n:"Chez Tantie Akissi",c:"Yopougon",q:"Rue Princesse",t:"Maquis",cu:"Ivoirienne",m:"ivoir",b:1,note:4.7,avis:1284,tags:["Poisson braisé","Grillades","Groupe","Live music","Wave / OM"],h:"12h – 02h",d:"Le maquis de quartier qui ne désemplit pas : braise, zouglou le week-end et service rapide.",nouv:false,tables:14},
 {id:"lagune-bleue",n:"La Lagune Bleue",c:"Marcory",q:"Zone 4",t:"Restaurant",cu:"Fruits de mer",m:"mer",b:3,note:4.6,avis:642,tags:["Bord de lagune","Terrasse","Poisson braisé","Climatisé","Vue","Parking"],h:"11h – 23h",d:"Terrasse sur pilotis face à l'eau, idéale pour un dîner au coucher du soleil.",nouv:false,tables:20},
 {id:"kaya",n:"Maison Kaya",c:"Cocody",q:"Riviera",t:"Gastronomique",cu:"Franco-ivoirienne",m:"gastro",b:4,note:4.8,avis:311,tags:["Vue","Climatisé","Végétarien","Wave / OM","Parking"],h:"19h – 23h30",d:"Menu dégustation en six temps qui réinterprète les classiques ivoiriens avec des produits du terroir.",nouv:true,tables:10},
 {id:"garba-royal",n:"Garba Royal",c:"Adjamé",q:"Liberté",t:"Garba & rapide",cu:"Ivoirienne",m:"rapide",b:1,note:4.4,avis:2210,tags:["Garba","Wave / OM","Groupe"],h:"07h – 22h",d:"Le garba propre et rapide, commande à table par QR code et paiement mobile.",nouv:false,tables:12},
 {id:"toit-plateau",n:"Le Toit du Plateau",c:"Plateau",q:"Centre",t:"Lounge",cu:"Grillades",m:"lounge",b:4,note:4.5,avis:487,tags:["Vue","Terrasse","Live music","Climatisé","Wi-Fi"],h:"17h – 02h",d:"Rooftop avec vue sur la baie de Cocody, DJ du jeudi au samedi.",nouv:false,tables:16},
 {id:"cafe-nere",n:"Café Néré",c:"Cocody",q:"Vallon",t:"Restaurant",cu:"Café & brunch",m:"brunch",b:2,note:4.6,avis:530,tags:["Brunch","Végétarien","Terrasse","Climatisé","Wave / OM","Wi-Fi"],h:"07h30 – 18h",d:"Brunch du samedi, coin calme pour travailler, à deux pas du campus Vatel.",nouv:true,tables:11},
 {id:"saveurs-treich",n:"Saveurs de Treich",c:"Treichville",q:"Avenue 16",t:"Maquis",cu:"Grillades",m:"ivoir",b:1,note:4.3,avis:890,tags:["Grillades","Groupe","Wave / OM"],h:"16h – 01h",d:"Choukouya réputé et ambiance de quartier, tables longues pour les groupes.",nouv:false,tables:15},
 {id:"bassam-plage",n:"Bassam Plage Club",c:"Grand-Bassam",q:"Quartier France",t:"Restaurant",cu:"Fruits de mer",m:"mer",b:3,note:4.5,avis:402,tags:["Bord de lagune","Vue","Poisson braisé","Terrasse","Groupe","Parking"],h:"10h – 22h",d:"Les pieds dans le sable, à 45 minutes d'Abidjan. Parfait pour le dimanche.",nouv:false,tables:18},
 {id:"allocodrome-sud",n:"Allocodrome Sud",c:"Koumassi",q:"Remblais",t:"Maquis",cu:"Ivoirienne",m:"rapide",b:1,note:4.2,avis:760,tags:["Garba","Grillades","Wave / OM"],h:"17h – 00h",d:"Une dizaine de cuisinières, une seule commande groupée via Tablô.",nouv:true,tables:10},
 {id:"phare-abobo",n:"Le Phare d'Abobo",c:"Abobo",q:"Avocatier",t:"Restaurant",cu:"Africaine",m:"ivoir",b:2,note:4.3,avis:345,tags:["Groupe","Climatisé","Wave / OM","Grillades","Parking"],h:"11h – 23h",d:"Grande salle climatisée pour les anniversaires et repas de famille.",nouv:false,tables:22},
 {id:"port-pecheurs",n:"Port des Pêcheurs",c:"Port-Bouët",q:"Vridi",t:"Maquis",cu:"Fruits de mer",m:"mer",b:2,note:4.6,avis:670,tags:["Poisson braisé","Bord de lagune","Terrasse","Groupe"],h:"12h – 00h",d:"Poisson pêché le matin, braisé devant toi, vent de mer en prime.",nouv:false,tables:16},
 {id:"jardin-binger",n:"Jardin de Bingerville",c:"Bingerville",q:"Centre",t:"Restaurant",cu:"Africaine",m:"ivoir",b:2,note:4.4,avis:215,tags:["Terrasse","Végétarien","Brunch","Groupe","Parking"],h:"10h – 21h",d:"Sous les manguiers, cuisine de saison avec les légumes du potager voisin.",nouv:true,tables:12},
 {id:"bistrot-vallon",n:"Le Bistrot Vallon",c:"Cocody",q:"Vallon",t:"Restaurant",cu:"Franco-ivoirienne",m:"gastro",b:3,note:4.5,avis:398,tags:["Terrasse","Climatisé","Live music","Wave / OM","Wi-Fi"],h:"12h – 00h",d:"Cuisine franco-ivoirienne et jazz le vendredi soir.",nouv:false,tables:14},
 {id:"grill-house",n:"Marcory Grill House",c:"Marcory",q:"Biétry",t:"Restaurant",cu:"Grillades",m:"lounge",b:3,note:4.4,avis:509,tags:["Grillades","Climatisé","Groupe","Terrasse","Parking"],h:"12h – 23h30",d:"La grillade version chic, viande maturée et sauces maison.",nouv:false,tables:18},
 {id:"cedre-angre",n:"Le Cèdre d'Angré",c:"Cocody",q:"Angré",t:"Restaurant",cu:"Libanaise",m:"liban",b:2,note:4.5,avis:812,tags:["Végétarien","Climatisé","Groupe","Wave / OM","Parking"],h:"11h – 00h",d:"Mezzés, chawarma et grillades libanaises, une institution à Angré.",nouv:false,tables:20},
 {id:"niangon-braise",n:"Niangon Braise",c:"Yopougon",q:"Niangon",t:"Maquis",cu:"Grillades",m:"ivoir",b:1,note:4.1,avis:433,tags:["Grillades","Poisson braisé","Wave / OM","Groupe"],h:"15h – 01h",d:"Poulet braisé et poisson au feu de bois, terrasse animée.",nouv:true,tables:13},
 {id:"indenie-lunch",n:"Indénié Lunch",c:"Plateau",q:"Indénié",t:"Restaurant",cu:"Africaine",m:"ivoir",b:2,note:4.3,avis:298,tags:["Climatisé","Wi-Fi","Wave / OM"],h:"11h30 – 16h",d:"Le déjeuner d'affaires rapide du Plateau : plat du jour servi en 15 minutes.",nouv:false,tables:15},
 {id:"vridi-sunset",n:"Vridi Sunset",c:"Port-Bouët",q:"Gonzagueville",t:"Lounge",cu:"Fruits de mer",m:"lounge",b:3,note:4.2,avis:186,tags:["Vue","Live music","Terrasse","Bord de lagune"],h:"16h – 02h",d:"Cocktails au coucher du soleil face à l'océan, concerts le dimanche.",nouv:true,tables:14}
];
const MENUS={
 ivoir:{"Entrées":[["Alloco piment",1500],["Aloko-œuf",2000]],"Plats":[["Poisson braisé + attiéké",4500,"Carpe ou capitaine selon arrivage"],["Poulet bicyclette braisé",5000],["Kédjénou de poulet",5500],["Sauce graine + foutou",4000]],"Boissons":[["Bissap maison",1000],["Gnamakoudji",1000],["Bière locale 65cl",1500]]},
 mer:{"Entrées":[["Salade de papaye verte",3500],["Crevettes sautées à l'ail",7000]],"Plats":[["Capitaine braisé, attiéké",12000,"Pour 2 personnes"],["Langouste grillée",22000],["Crabe farci",9000],["Brochettes de lotte",11000]],"Desserts":[["Ananas rôti",3000]],"Boissons":[["Jus de coco frais",2000],["Cocktail maison",5000]]},
 gastro:{"Menu dégustation":[["Menu Kaya, 6 temps",45000,"Accord vins +20 000 F"],["Menu découverte, 4 temps",32000]],"À la carte":[["Foutou revisité, sauce graine fumée",14000],["Bar de ligne, beurre d'arachide",16000],["Agneau confit au soumbala",18000]],"Desserts":[["Fondant cacao de Soubré",6000],["Glace bissap-gingembre",4500]]},
 rapide:{"Garba":[["Garba thon frit",1000],["Garba thon + œuf",1500],["Attiéké-alloco-poisson",2500]],"Extras":[["Piment frais",0],["Oignons-tomates",200]],"Boissons":[["Jus de gingembre",500],["Eau 1,5 L",500]]},
 lounge:{"À partager":[["Brochettes mixtes",9000],["Ailes de poulet épicées",7000],["Plateau de grillades",25000,"Pour 4 personnes"]],"Plats":[["Côte de bœuf maturée",28000],["Agouti braisé",15000]],"Cocktails":[["Bissap spritz",6000],["Gingembre mule",6000]]},
 brunch:{"Brunch":[["Formule brunch du samedi",12000,"Boisson chaude, jus, plat, dessert"],["Pancakes banane plantain",5000],["Bowl attiéké-avocat",6000],["Œufs brouillés, pain de Dabou",4500]],"Boissons":[["Café torréfié à Abidjan",2000],["Smoothie mangue-passion",3000]]},
 liban:{"Mezzés":[["Houmous",3500],["Taboulé",3500],["Falafels",4000]],"Grillades":[["Chawarma poulet",3000],["Kafta",6500],["Mixte grill pour 2",16000]],"Desserts":[["Baklava",3000]]}
};
const EXPS=[
 {id:"e1",rid:"akissi",t:"Soirée zouglou live",w:"Vendredis · 21h",p:0,d:"Orchestre en live et brochettes à volonté jusqu'à minuit."},
 {id:"e2",rid:"kaya",t:"Dîner à quatre mains",w:"Sam. 28 nov. · 20h",p:60000,d:"Le chef de Maison Kaya reçoit un chef dakarois pour un menu unique."},
 {id:"e3",rid:"cafe-nere",t:"Brunch des familles",w:"Dimanches · 10h",p:12000,d:"Atelier dessin pour les enfants pendant que les parents brunchent."},
 {id:"e4",rid:"bassam-plage",t:"Langouste au coucher du soleil",w:"Week-ends · 17h",p:30000,d:"Langouste, cocktail et transat face à l'océan."},
 {id:"e5",rid:"toit-plateau",t:"Afterwork du jeudi",w:"Jeudis · 18h",p:8000,d:"Deux cocktails et une planche à partager, DJ dès 19h."},
 {id:"e6",rid:"bistrot-vallon",t:"Jazz & kédjénou",w:"Vendredis · 20h30",p:15000,d:"Trio jazz et menu trois plats autour du kédjénou."}
];
const FIRST=["Aya","Koffi","Mariam","Serge","Fatou","Jean-Marc","Awa","Ibrahim","Christelle","Yao","Adjoua","Moussa","Nadia","Kouamé","Sarah"];
const REV=["Service rapide et souriant, le poisson était parfaitement braisé.","Cadre magnifique, on reviendra pour l'anniversaire de ma sœur.","Un peu d'attente le samedi soir mais la table réservée était prête à l'heure.","Le meilleur rapport qualité-prix du quartier.","Ambiance au top, musique un peu forte pour discuter.","Réservation via Tablô sans souci, accueil chaleureux.","Les portions sont généreuses, l'attiéké est frais.","Parfait pour un repas d'affaires, calme et climatisé.","On a pré-commandé, les plats sont arrivés dix minutes après notre installation.","Belle découverte, les desserts valent le détour."];
