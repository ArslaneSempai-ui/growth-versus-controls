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

window.LOCAL = async (chemin, corps) => {
  if (chemin === "/api/etat") return etat();
  if (chemin === "/api/remise") { situation = structuredClone(CAS); return etat(); }
  if (chemin === "/api/reglage") {
    for (const [cle, [bas, haut]] of Object.entries(BORNES)) {
      const v = Number(corps?.[cle]);
      if (Number.isFinite(v)) situation[cle] = Math.min(haut, Math.max(bas, v));
    }
    const cb = Number(corps?.croyanceBas), ch = Number(corps?.croyanceHaut);
    if (Number.isFinite(cb)) situation.croyance.bas = Math.min(Math.max(0, cb), situation.croyance.haut);
    if (Number.isFinite(ch)) situation.croyance.haut = Math.max(Math.min(BORNES.partNonDetectee[1], ch), situation.croyance.bas);
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

export function construire(): void {
  const docs = root + "docs/";
  mkdirSync(docs, { recursive: true });
  for (const f of ["graphes.js", "registre.css"]) cpSync(root + "src/" + f, docs + f);
  writeFileSync(docs + ".nojekyll", "");

  let html = readFileSync(root + "src/ui.html", "utf8");
  /* Les chemins absolus deviennent relatifs : GitHub Pages sert depuis un sous-dossier. */
  html = html.replace(/"\/graphes\.js"/g, '"./graphes.js"').replace(/"\/registre\.css"/g, '"./registre.css"');
  html = html.replace('<div class="renvoi" id="bandeau"></div>', BANNIERE + '\n  <div class="renvoi" id="bandeau"></div>');
  html = html.replace('<script type="module">', SHIM + '<script type="module">');
  writeFileSync(docs + "index.html", html);
  console.log("docs/ built");
}

if (isMain(import.meta)) construire();
