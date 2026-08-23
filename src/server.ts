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
import { fileURLToPath } from "node:url";
import { CAS, type Situation } from "./situation.ts";
import { arbitrer, bascule, ceQuiTrancherait, desaccordReel, ecartConversion } from "./arbitrage.ts";

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

/*
 * A SETTING THAT WAS NOT SENT MUST NOT BE READ AS ZERO.
 *
 * The guard here used to be `const v = Number(recu[cle]); if (Number.isFinite(v))`, which
 * cannot do the job it was written for: the coercion runs before the test. `Number(null)`,
 * `Number("")`, `Number([])` and `Number(false)` are all `0`, `0` is inside every bound
 * below, and so every spelling of "no value" silently pinned a setting to the bottom of its
 * range. `Number.isFinite` then said yes to all four.
 *
 * This is not only a hostile-client story. The page sends `Number(el.value)`, which is `NaN`
 * on an empty field, and `JSON.stringify` writes `NaN` as `null` — so the tool's own screen
 * could set the undetected-risk share to zero and read back a verdict computed from it. A
 * wrong verdict, correctly formatted, is the worst output this tool can produce.
 *
 * JSON has a number type; the screen sends numbers. Ask for one.
 */
const nombre = (x: unknown): number | undefined =>
  (typeof x === "number" && Number.isFinite(x)) ? x : undefined;

/*
 * Le champ du verdict, calculé une fois par le modèle.
 *
 * La carte demande « de quel côté est ce point ? » un millier de fois par rendu. Réécrire
 * l'arithmétique dans la page pour répondre vite serait le piège classique : deux modèles
 * qui divergent au premier correctif, et celui que le lecteur voit n'est pas celui qui est
 * testé. On envoie donc une grille de booléens produite par `arbitrer`, et la page se
 * contente de lire.
 */
export const RESOLUTION = { x: 46, y: 29 };

function champ(s: Situation): boolean[] {
  const [px0, px1] = BORNES.partNonDetectee;
  const [py0, py1] = BORNES.coutRisqueNonDetecte;
  const out: boolean[] = [];
  for (let j = 0; j < RESOLUTION.y; j++) {
    const cout = py0 + ((j + 0.5) / RESOLUTION.y) * (py1 - py0);
    for (let i = 0; i < RESOLUTION.x; i++) {
      const part = px0 + ((i + 0.5) / RESOLUTION.x) * (px1 - px0);
      out.push(arbitrer({ ...s, coutRisqueNonDetecte: cout }, part).net.centre >= 0);
    }
  }
  return out;
}

export function etat() {
  const v = arbitrer(situation);
  return {
    situation,
    bornes: BORNES,
    ecart: ecartConversion(situation),
    verdict: v,
    bascule: bascule(situation),
    desaccord: desaccordReel(situation),
    leviers: ceQuiTrancherait(situation),
    champ: champ(situation),
    resolution: RESOLUTION,
  };
}

/*
 * Read the file first, then answer. Never the other way round.
 *
 * `writeHead` followed by `readFileSync` looks harmless and is not. When the read throws,
 * the catch at the bottom of the handler tries to answer 400 on a response whose headers
 * have already gone out; `writeHead` then raises ERR_HTTP_HEADERS_SENT *inside the catch*,
 * where nothing is left to handle it, and the process exits on the very first request.
 * The guard was written for precisely this failure and was unable to fire in it.
 *
 * Measured on 23 August 2026: this repository cloned into `mes projets/` — one space —
 * killed the server on the first page load, and again under an accented directory name.
 * Two defects had to meet for that: `.pathname` does not decode `%20` (fixed below with
 * `fileURLToPath`), and the headers had already left. Either one alone is survivable.
 */
function fichier(res: ServerResponse, relatif: string, type: string): void {
  const corps = readFileSync(fileURLToPath(new URL(relatif, import.meta.url)), "utf8");
  res.writeHead(200, { "content-type": `${type}; charset=utf-8`, "cache-control": "no-store" });
  res.end(corps);
}

const serveur = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  try {
    if (url.pathname === "/") return fichier(res, "./ui.html", "text/html");
    for (const [chemin, type] of [["/graphes.js", "text/javascript"], ["/registre.css", "text/css"]] as const) {
      if (url.pathname === chemin) return fichier(res, "." + chemin, type);
    }
    if (url.pathname === "/api/etat") return json(res, etat());

    if (url.pathname === "/api/reglage" && req.method === "POST") {
      const recu = await corps(req);
      for (const [cle, [bas, haut]] of Object.entries(BORNES)) {
        const v = nombre(recu[cle]);
        if (v !== undefined) (situation as any)[cle] = Math.min(haut, Math.max(bas, v));
      }
      /* La fourchette de croyance se règle aussi, et elle doit rester ordonnée. */
      const cb = nombre(recu.croyanceBas), ch = nombre(recu.croyanceHaut);
      if (cb !== undefined) situation.croyance.bas = Math.min(Math.max(0, cb), situation.croyance.haut);
      if (ch !== undefined) situation.croyance.haut = Math.max(Math.min(BORNES.partNonDetectee[1], ch), situation.croyance.bas);
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

/*
 * `127.0.0.1` en second argument, et ce n'est pas une décoration.
 *
 * `listen(PORT)` sans hôte écoute sur **toutes les interfaces** : ce serveur de démonstration
 * était offert à tout le réseau local pendant qu'il tournait. L'URL affichée disait
 * `localhost`, ce qui donnait toutes les apparences d'un serveur local — le même piège que
 * `python3 -m http.server` sans `--bind`, corrigé dans la couche partagée le 21 août 2026.
 *
 * Les neuf autres dépôts du portfolio nommaient déjà leur hôte. Celui-ci était le seul à ne
 * pas le faire, et rien ne le disait : le contrôle qui garde cette règle ne balayait que les
 * fichiers d'`identite`. Il vit maintenant dans `liaison.test.ts`, recopié dans chaque dépôt,
 * et il regarde le dépôt où il tourne.
 */
serveur.listen(PORT, "127.0.0.1", () => console.log(`Growth versus controls → http://localhost:${PORT}`));
