/*
 * L'ÉCRAN, SERVI DEPUIS LES SOURCES.
 *
 * Une seule page. Les réglages qu'on peut bouger sont ceux sur lesquels les deux fonctions
 * se disputent réellement — la part de risque non détecté, la capacité déjà libre, le prix
 * d'un incident — et pas les vingt paramètres du modèle. Un curseur par désaccord.
 *
 * Le même fichier `ui.html` sert ici et dans la démo publiée : ce qui change là-bas est un
 * shim qui répond aux mêmes routes avec les mêmes formes. Deux écrans divergeraient au
 * premier correctif.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { CAS, INVENTAIRE, type Situation } from "./situation.ts";
import { arbitrer, bascule, ceQuiTrancherait, clientsGagnes, desaccordReel, ecartConversion, heuresParClient } from "./arbitrage.ts";
import { ASSUMPTIONS as CAPACITE } from "./emprunts/economics/model.ts";

const PORT = Number(process.env.PORT ?? 4600);

/* L'état vit en mémoire : rien de ce qu'un visiteur bouge n'est écrit sur le disque. */
let situation: Situation = structuredClone(CAS);

function json(res: ServerResponse, corps: unknown, code = 200): void {
  const load = JSON.stringify(corps);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(load),
  });
  res.end(load);
}

function corps(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resoudre, rejeter) => {
    let brut = "";
    req.on("data", (b) => { brut += b; if (brut.length > 50_000) rejeter(new Error("request too large")); });
    req.on("end", () => { try { resoudre(brut ? JSON.parse(brut) : {}); } catch (e) { rejeter(e); } });
    req.on("error", rejeter);
  });
}

/*
 * Les bornes des réglages.
 *
 * Elles ne sont pas décoratives : une part de risque non détecté à 50 % ou un incident à
 * zéro dollar produisent des verdicts qui ont l'air de sortir du modèle alors qu'ils sortent
 * d'une saisie absurde. On borne, et on le dit à l'écran.
 */
export const BORNES = {
  partNonDetectee: [0, 0.06],
  heuresLibres: [0, 8_000],
  coutRisqueNonDetecte: [20_000, 600_000],
} as const;

/** L'escalier de capacité, calculé sur la plage de clients que le test rend plausible. */
function escalier(s: Situation) {
  const c = clientsGagnes(s);
  const heuresParAnalyste = CAPACITE.productiveHoursPerDay * CAPACITE.workingDaysPerYear;
  const marches: { de: number; a: number; valeur: number; ici: boolean; gratuite: boolean }[] = [];
  const haut = Math.max(c.haut, 1);
  /* Une marche par embauche, plus la première qui est gratuite parce que déjà payée. */
  const clientsParAnalyste = heuresParAnalyste / Math.max(heuresParClient(s), 1e-9);
  const clientsGratuits = Math.max(0, s.heuresLibres) / Math.max(heuresParClient(s), 1e-9);
  let de = 0;
  for (let n = 0; de < haut && n < 40; n++) {
    const a = n === 0 ? clientsGratuits : clientsGratuits + n * clientsParAnalyste;
    marches.push({
      de, a: Math.min(a, haut * 1.15),
      valeur: n * CAPACITE.loadedCostPerAnalyst,
      ici: c.centre >= de && c.centre < a,
      gratuite: n === 0,
    });
    de = a;
  }
  return { marches, clientsParAnalyste, clientsGratuits };
}

export function etat() {
  const v = arbitrer(situation);
  return {
    situation,
    bornes: BORNES,
    inventaire: INVENTAIRE,
    ecart: ecartConversion(situation),
    verdict: v,
    bascule: bascule(situation),
    desaccord: desaccordReel(situation),
    leviers: ceQuiTrancherait(situation),
    escalier: escalier(situation),
    capacite: { coutAnalyste: CAPACITE.loadedCostPerAnalyst, heuresParAnalyste: CAPACITE.productiveHoursPerDay * CAPACITE.workingDaysPerYear },
  };
}

const serveur = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  try {
    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(readFileSync(new URL("./ui.html", import.meta.url).pathname, "utf8"));
      return;
    }
    for (const [chemin, type] of [["/graphes.js", "text/javascript"], ["/registre.css", "text/css"]] as const) {
      if (url.pathname === chemin) {
        res.writeHead(200, { "content-type": `${type}; charset=utf-8`, "cache-control": "no-store" });
        res.end(readFileSync(new URL("." + chemin, import.meta.url).pathname, "utf8"));
        return;
      }
    }
    if (url.pathname === "/api/etat") return json(res, etat());

    if (url.pathname === "/api/reglage" && req.method === "POST") {
      const recu = await corps(req);
      for (const [cle, [bas, haut]] of Object.entries(BORNES)) {
        const v = Number(recu[cle]);
        if (Number.isFinite(v)) (situation as any)[cle] = Math.min(haut, Math.max(bas, v));
      }
      /* La fourchette de croyance se règle aussi, et elle doit rester ordonnée. */
      const cb = Number(recu.croyanceBas), ch = Number(recu.croyanceHaut);
      if (Number.isFinite(cb)) situation.croyance.bas = Math.min(Math.max(0, cb), situation.croyance.haut);
      if (Number.isFinite(ch)) situation.croyance.haut = Math.max(Math.min(BORNES.partNonDetectee[1], ch), situation.croyance.bas);
      return json(res, etat());
    }

    if (url.pathname === "/api/remise" && req.method === "POST") {
      situation = structuredClone(CAS);
      return json(res, etat());
    }

    res.writeHead(404).end("introuvable");
  } catch (e) {
    json(res, { erreur: String((e as Error).message ?? e) }, 400);
  }
});

serveur.listen(PORT, () => console.log(`Growth versus controls → http://localhost:${PORT}`));
