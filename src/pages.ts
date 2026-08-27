/*
 * LA DÉMO PUBLIÉE.
 *
 * « Clone ça et lance `npm start` » est une demande que la plupart des lecteurs déclinent.
 * Un lien qu'ils cliquent, non. Le même `ui.html` sert ici et en local : ce qui change est
 * un shim qui répond aux mêmes routes avec les mêmes formes, installé avant le script de
 * l'écran. Deux écrans divergeraient au premier correctif.
 *
 * Le modèle est de l'arithmétique — pas de modèle de langue, pas de serveur — donc tout
 * tourne réellement dans le navigateur du visiteur. Rien n'est mis en conserve.
 */

import { readFileSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isMain } from "./cli.ts";

const root = fileURLToPath(new URL("..", import.meta.url));

const SHIM = `<script>window.LOCAL_PRET = new Promise((r) => { window.LOCAL_POSE = r; });</script>\n<script type="module">
import { CAS } from "./js/situation.js";
import { arbitrer, bascule, ceQuiTrancherait, desaccordReel, ecartConversion } from "./js/arbitrage.js";

/* Les mêmes bornes que le serveur : une saisie absurde produit un verdict qui a l'air de
 * sortir du modèle alors qu'il sort de la saisie. */
const BORNES = {
  partNonDetectee: [0, 0.06],
  heuresLibres: [0, 8000],
  coutRisqueNonDetecte: [20000, 600000],
};

let situation = structuredClone(CAS);

const RESOLUTION = { x: 46, y: 29 };
function champ(s) {
  const [px0, px1] = BORNES.partNonDetectee;
  const [py0, py1] = BORNES.coutRisqueNonDetecte;
  const out = [];
  for (let j = 0; j < RESOLUTION.y; j++) {
    const cout = py0 + ((j + 0.5) / RESOLUTION.y) * (py1 - py0);
    for (let i = 0; i < RESOLUTION.x; i++) {
      const part = px0 + ((i + 0.5) / RESOLUTION.x) * (px1 - px0);
      out.push(arbitrer({ ...s, coutRisqueNonDetecte: cout }, part).net.centre >= 0);
    }
  }
  return out;
}

const etat = () => ({
  situation,
  bornes: BORNES,
  ecart: ecartConversion(situation),
  verdict: arbitrer(situation),
  bascule: bascule(situation),
  desaccord: desaccordReel(situation),
  leviers: ceQuiTrancherait(situation),
  champ: champ(situation),
  resolution: RESOLUTION,
});

/*
 * « PAS DE VALEUR » NE SE LIT PAS ZÉRO — la même garde que le serveur, ici aussi.
 *
 * Le serveur porte cette garde depuis le 23 août 2026, avec son explication. Le shim ne l'a
 * pas reçue, et c'est LUI que le lecteur exécute en cliquant le lien : la porte corrigée
 * n'était pas la porte ouverte. Number(null), Number(""), Number([]) et Number(false) valent
 * tous 0, 0 est dans toutes les bornes, et Number.isFinite disait oui aux quatre — chaque
 * façon d'écrire « pas de valeur » posait le réglage au bas de sa plage, et la page publiée
 * rendait un verdict correctement mis en forme calculé dessus.
 *
 * La conversion était posée AVANT la garde. On demande un nombre au lieu d'en fabriquer un.
 *
 * (Aucun accent grave dans ce bloc : il vit dans un gabarit, et le premier accent grave
 * refermerait la chaîne quinze lignes avant sa fin.)
 */
const nombre = (x) => (typeof x === "number" && Number.isFinite(x)) ? x : undefined;

window.LOCAL = async (chemin, corps) => {
  if (chemin === "/api/etat") return etat();
  if (chemin === "/api/remise") { situation = structuredClone(CAS); return etat(); }
  if (chemin === "/api/reglage") {
    for (const [cle, [bas, haut]] of Object.entries(BORNES)) {
      const v = nombre(corps?.[cle]);
      if (v !== undefined) situation[cle] = Math.min(haut, Math.max(bas, v));
    }
    const cb = nombre(corps?.croyanceBas), ch = nombre(corps?.croyanceHaut);
    if (cb !== undefined) situation.croyance.bas = Math.min(Math.max(0, cb), situation.croyance.haut);
    if (ch !== undefined) situation.croyance.haut = Math.max(Math.min(BORNES.partNonDetectee[1], ch), situation.croyance.bas);
    return etat();
  }
  return {};
};

/* Le shim est en place : l'écran peut partir. La balise classique qui a créé la promesse
 * s'exécute avant tout module, donc personne ne peut la manquer. */
window.LOCAL_POSE && window.LOCAL_POSE();
` + "</" + "script>\n";

const BANNIERE = `<p class="renvoi" style="margin-bottom:1.5rem">
This is the whole model, running in your browser — no server, nothing uploaded.
<b>Grab the point on the map</b> and read the verdict where you put it: its two axes are
the numbers nobody measures, and the whole argument turns on them.
<a href="https://github.com/ArslaneSempai-ui/growth-versus-controls">Source and method</a>.
</p>`;

/*
 * LES RESSOURCES DE LA PAGE SE DÉRIVENT DE L'ÉCRAN, ELLES NE SE RÉCITENT PAS.
 *
 * Cette liste était écrite à la main — `["graphes.js", "registre.css"]` — et son jumeau, la
 * réécriture des chemins absolus en chemins relatifs, l'était aussi, quatre lignes plus bas.
 * Deux copies de la même affirmation, qu'aucune commande ne confrontait à `ui.html`.
 *
 * Le mode de panne est asymétrique, et c'est ce qui le rend cher. Un fichier RENOMMÉ fait
 * lever `cpSync` au premier lancement : bruyant, donc sans danger. Un fichier AJOUTÉ à
 * `ui.html` ne fait rien du tout — il n'est pas copié dans `docs/`, son chemin reste absolu,
 * GitHub Pages répond 404 depuis la racine du site, et la démo publiée perd une feuille de
 * style ou une figure sans qu'une seule commande devienne rouge. En local tout marche : la
 * page y est servie par `server.ts`, qui lit les fichiers dans `src/`.
 *
 * On lit donc la source qui détermine la liste, et on refuse de construire si la dérivation
 * cesse de lire la page. Le plancher n'est pas un nombre choisi : l'écran a nécessairement
 * une feuille de style et un module, sinon ce n'est pas cet écran-là qu'on vient de lire.
 */
export function ressources(html: string): string[] {
  const noms = [...new Set(
    [...html.matchAll(/["'](\/[A-Za-z0-9_.-]+\.(?:js|css))["']/g)].map((m) => m[1]!.slice(1)),
  )];
  const manque = ["js", "css"].filter((ext) => !noms.some((n) => n.endsWith("." + ext)));
  if (manque.length) {
    throw new Error(
      `src/ui.html : aucune ressource ${manque.join(" ni ")} à la racine parmi ${noms.length} trouvée(s)`
      + `${noms.length ? ` (${noms.join(", ")})` : ""} — la dérivation ne lit plus la page.`
      + ` Ce n'est pas une page sans ressource : c'est un motif périmé, et il rendrait une `
      + `démo publiée à laquelle il manque des fichiers, sans que rien ne devienne rouge.`);
  }
  return noms;
}

export function construire(): void {
  const docs = root + "docs/";
  mkdirSync(docs, { recursive: true });

  let html = readFileSync(root + "src/ui.html", "utf8");
  const assets = ressources(html);
  for (const f of assets) cpSync(root + "src/" + f, docs + f);
  writeFileSync(docs + ".nojekyll", "");

  /* Les chemins absolus deviennent relatifs : GitHub Pages sert depuis un sous-dossier. La
     MÊME liste dérivée sert aux deux — copier un fichier sans réécrire son chemin, ou
     l'inverse, sont les deux moitiés du même oubli. */
  for (const f of assets) html = html.split(`"/${f}"`).join(`"./${f}"`);
  html = html.replace('<div class="renvoi" id="bandeau"></div>', BANNIERE + '\n  <div class="renvoi" id="bandeau"></div>');
  html = html.replace('<script type="module">', SHIM + '<script type="module">');
  writeFileSync(docs + "index.html", html);

  console.log(`docs/ built — ${assets.length} ressource(s) dérivée(s) de src/ui.html : ${assets.join(", ")}`);
}

if (isMain(import.meta)) construire();
