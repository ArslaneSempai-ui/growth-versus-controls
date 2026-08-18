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
import { isMain } from "./cli.ts";

const root = new URL("..", import.meta.url).pathname;

const SHIM = `<script type="module">
import { CAS } from "./js/situation.js";
import { arbitrer, bascule, ceQuiTrancherait, clientsGagnes, desaccordReel, ecartConversion, heuresParClient } from "./js/arbitrage.js";
import { ASSUMPTIONS as CAPACITE } from "./js/emprunts/economics/model.js";

/* Les mêmes bornes que le serveur : une saisie absurde produit un verdict qui a l'air de
 * sortir du modèle alors qu'il sort de la saisie. */
const BORNES = {
  partNonDetectee: [0, 0.06],
  heuresLibres: [0, 8000],
  coutRisqueNonDetecte: [20000, 600000],
};

let situation = structuredClone(CAS);

function escalier(s) {
  const c = clientsGagnes(s);
  const heuresParAnalyste = CAPACITE.productiveHoursPerDay * CAPACITE.workingDaysPerYear;
  const clientsParAnalyste = heuresParAnalyste / Math.max(heuresParClient(s), 1e-9);
  const clientsGratuits = Math.max(0, s.heuresLibres) / Math.max(heuresParClient(s), 1e-9);
  const haut = Math.max(c.haut, 1);
  const marches = [];
  let de = 0;
  for (let n = 0; de < haut && n < 40; n++) {
    const a = n === 0 ? clientsGratuits : clientsGratuits + n * clientsParAnalyste;
    marches.push({ de, a: Math.min(a, haut * 1.15), valeur: n * CAPACITE.loadedCostPerAnalyst,
      ici: c.centre >= de && c.centre < a, gratuite: n === 0 });
    de = a;
  }
  return { marches, clientsParAnalyste, clientsGratuits };
}

const etat = () => ({
  situation,
  bornes: BORNES,
  inventaire: [],
  ecart: ecartConversion(situation),
  verdict: arbitrer(situation),
  bascule: bascule(situation),
  desaccord: desaccordReel(situation),
  leviers: ceQuiTrancherait(situation),
  escalier: escalier(situation),
  capacite: { coutAnalyste: CAPACITE.loadedCostPerAnalyst,
    heuresParAnalyste: CAPACITE.productiveHoursPerDay * CAPACITE.workingDaysPerYear },
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
` + "</" + "script>\n";

const BANNIERE = `<p class="renvoi" style="margin-bottom:1.5rem">
This is the whole model, running in your browser — no server, nothing uploaded. Move the
three sliders: they are the three things the two functions actually disagree about.
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
