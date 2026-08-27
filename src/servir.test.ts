/*
 * L'ÉCRAN SERVI DEPUIS UN CHEMIN QUI N'EST PAS SAGE.
 *
 * Two failures met here on 23 August 2026 and killed the process on the first request:
 * `fileURLToPath(new URL(…, import.meta.url))` does not decode `%20`, so a repository cloned
 * into `mes projets/` asked the filesystem for a directory that does not exist; and the
 * handler had already sent `writeHead(200)` before reading, so the catch that exists to
 * turn a read failure into a 400 raised ERR_HTTP_HEADERS_SENT instead — inside itself,
 * with nothing left to catch it.
 *
 * A guard that cannot fire in the failure it was written for is worth nothing, so both
 * halves are checked here, and the second one is checked by breaking the read on purpose.
 * A space in a directory name is not exotic: it is the default on a French desktop.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { emprunter, A_COMPARER } from "./emprunter.ts";
import { ressources } from "./pages.ts";

const SRC = fileURLToPath(new URL(".", import.meta.url));
const RACINE = fileURLToPath(new URL("..", import.meta.url));

/** A copy of `src/` under a directory whose name contains a space and an accent. */
function copieHostile(): string {
  const base = mkdtempSync(`${tmpdir()}/arbitrage-`);
  const racine = `${base}/mes projets été/arbitrage`;
  mkdirSync(`${racine}/src`, { recursive: true });
  cpSync(SRC, `${racine}/src`, { recursive: true });
  return racine;
}

/** Start the server on a free-enough port and resolve once it says it is listening. */
function demarrer(racine: string, port: number): Promise<ChildProcess> {
  const fils = spawn(process.execPath, [`${racine}/src/server.ts`], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resoudre, rejeter) => {
    const minuteur = setTimeout(() => rejeter(new Error("le serveur n'a pas démarré en 15 s")), 15_000);
    fils.stdout.on("data", (b) => {
      if (String(b).includes("http://localhost")) { clearTimeout(minuteur); resoudre(fils); }
    });
    fils.on("exit", (code) => { clearTimeout(minuteur); rejeter(new Error(`le serveur est mort au démarrage (code ${code})`)); });
  });
}

test("la page se sert depuis un chemin qui contient une espace et un accent", async () => {
  const racine = copieHostile();
  let fils: ChildProcess | undefined;
  try {
    fils = await demarrer(racine, 4681);
    const r = await fetch("http://127.0.0.1:4681/");
    assert.equal(r.status, 200);
    assert.match(await r.text(), /<html/i);
    /* Le processus doit être encore là : c'est lui qui mourait. */
    assert.equal(fils.exitCode, null);
  } finally {
    fils?.kill();
    rmSync(racine, { recursive: true, force: true });
  }
});

test("une lecture qui échoue rend 400 et laisse le serveur vivant", async () => {
  const racine = copieHostile();
  /* On enlève le fichier servi par une route : la lecture lèvera, et c'est le but. */
  rmSync(`${racine}/src/graphes.js`, { force: true });
  assert.ok(!existsSync(`${racine}/src/graphes.js`));
  let fils: ChildProcess | undefined;
  try {
    fils = await demarrer(racine, 4682);
    const casse = await fetch("http://127.0.0.1:4682/graphes.js");
    assert.equal(casse.status, 400, "une lecture impossible doit sortir par le catch, pas par un abandon");
    assert.match(String((await casse.json() as { erreur?: string }).erreur), /ENOENT|no such file/i);
    /* Le témoin qui compte : la requête suivante est encore servie. */
    const apres = await fetch("http://127.0.0.1:4682/");
    assert.equal(apres.status, 200, "le serveur doit survivre à une lecture impossible");
    assert.equal(fils.exitCode, null);
  } finally {
    fils?.kill();
    rmSync(racine, { recursive: true, force: true });
  }
});

/*
 * « À jour » ne doit jamais vouloir dire « je n'ai rien comparé ».
 *
 * Le témoin va dans les deux sens : une source absente doit être nommée et retirée du
 * compte, une arborescence complète doit comparer les six fichiers. Sans le second, la
 * correction pourrait se contenter de ne plus rien dire du tout.
 */
test("un emprunt non comparé est nommé, et ne compte pas comme comparé", () => {
  const base = mkdtempSync(`${tmpdir()}/emprunt-`);
  mkdirSync(`${base}/economics/src`, { recursive: true });
  mkdirSync(`${base}/cible/economics`, { recursive: true });
  cpSync(`${SRC}emprunts/economics`, `${base}/economics/src`, { recursive: true });
  cpSync(`${SRC}emprunts/economics`, `${base}/cible/economics`, { recursive: true });
  try {
    /* `identite/` n'existe pas ici : les outils partagés ne peuvent pas être comparés. */
    const sans = emprunter(true, { voisins: `${base}/`, depot: `${base}/cible/` });
    assert.equal(sans.absent, null, "le dépôt emprunté est là ; c'est la source partagée qui manque");
    assert.equal(sans.ecarts.length, 0);
    assert.ok(sans.ignores.length > 0, "un outil partagé introuvable doit être nommé");
    assert.ok(sans.compares < A_COMPARER, `${sans.compares} comparés sur ${A_COMPARER} : le compte doit le montrer`);

    /* Avec la source partagée en place, tout est comparé — sinon le contrôle est devenu muet. */
    mkdirSync(`${base}/identite`, { recursive: true });
    cpSync(`${SRC}cli.ts`, `${base}/identite/cli.ts`);
    cpSync(`${SRC}interval.ts`, `${base}/identite/interval.ts`);
    const avec = emprunter(true, { voisins: `${base}/`, depot: `${base}/cible/` });
    assert.deepEqual(avec.ignores, [], "rien ne manque : rien ne doit être passé");
    assert.equal(avec.compares, A_COMPARER, "tous les fichiers empruntés doivent être comparés");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

/*
 * « Rien » n'est pas « zéro ».
 *
 * `Number(null)`, `Number("")`, `Number([])` et `Number(false)` valent tous `0`, et `0` est
 * dans toutes les bornes : chaque façon d'écrire « pas de valeur » posait donc le réglage au
 * bas de sa plage, et `Number.isFinite` disait oui aux quatre. Le témoin va dans les deux
 * sens — un vrai nombre doit toujours passer, sinon la correction aurait simplement rendu
 * l'API muette.
 */
test("une valeur qui n'est pas un nombre ne remplace pas le réglage par zéro", async () => {
  const racine = copieHostile();
  let fils: ChildProcess | undefined;
  const lire = async (): Promise<number> => {
    const e = await (await fetch("http://127.0.0.1:4683/api/etat")).json() as { situation: { partNonDetectee: number } };
    return e.situation.partNonDetectee;
  };
  const poser = (corps: string) => fetch("http://127.0.0.1:4683/api/reglage",
    { method: "POST", headers: { "content-type": "application/json" }, body: corps });
  try {
    fils = await demarrer(racine, 4683);
    await poser(JSON.stringify({ partNonDetectee: 0.04 }));
    assert.equal(await lire(), 0.04, "un vrai nombre doit être accepté");

    for (const vide of ["null", '""', "[]", "false", '"0.01"']) {
      await poser(`{"partNonDetectee":${vide}}`);
      assert.equal(await lire(), 0.04, `${vide} n'est pas un nombre JSON et ne doit rien changer`);
    }

    /* Et le réglage reste réglable après coup : la garde ne doit pas geler l'API. */
    await poser(JSON.stringify({ partNonDetectee: 0.02 }));
    assert.equal(await lire(), 0.02);
  } finally {
    fils?.kill();
    rmSync(racine, { recursive: true, force: true });
  }
});

/*
 * LA DÉMO PUBLIÉE, EXÉCUTÉE — PAS RELUE.
 *
 * `servir.test.ts` éprouvait déjà la garde du serveur, et elle tient. Mais le lecteur qui
 * clique le lien du README ne lance pas le serveur : il exécute le shim de `docs/index.html`,
 * qui portait encore la faute que le serveur avait corrigée quatre jours plus tôt —
 * `Number(corps?.[cle])` avant `Number.isFinite`. Le correctif n'avait atteint qu'une porte
 * sur les deux, et rien ne regardait l'autre : les contrôles de la démo vérifient les CHAMPS
 * que le shim rend et les ROUTES qu'il connaît, jamais ce qu'il fait d'une valeur.
 *
 * Un contrôle qui lirait le texte du shim attraperait le motif d'aujourd'hui et manquerait
 * celui de demain. On extrait donc le module de la page PUBLIÉE, on le charge tel quel — ses
 * imports rendus absolus, sa `window` fournie — et on l'interroge. La couture se traverse :
 * ce qui répond ici est l'objet que GitHub Pages sert.
 */
async function shimPublie(): Promise<(chemin: string, corps?: unknown) => Promise<any>> {
  const page = RACINE + "docs/index.html";
  assert.ok(existsSync(page),
    `${page} absent — c'est la page que le lecteur exécute ; sans elle il n'y a rien à éprouver.`
    + ` Reconstruire avec \`npm run pages\` ; un saut ici serait un vert vide.`);
  const html = readFileSync(page, "utf8");
  const m = /<script type="module">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(m, `aucun <script type="module"> dans ${page} : le shim ne se lit plus. Refus, pas zéro.`);
  let corps = m[1]!;
  assert.match(corps, /window\.LOCAL\s*=/,
    "le premier module de la page publiée n'est pas le shim — le motif d'extraction est périmé,"
    + " et il regarderait le mauvais bloc en rendant vert.");

  /* Les imports du shim sont relatifs à `docs/` ; on les rend absolus pour l'exécuter hors page. */
  const base = pathToFileURL(RACINE + "docs/").href;
  corps = corps.replace(/(["'])\.\/js\//g, `$1${base}js/`);
  assert.doesNotMatch(corps, /["']\.\/js\//, "un import du shim n'a pas été rendu absolu");

  const bac = mkdtempSync(`${tmpdir()}/shim-arbitrage-`);
  const fenetre: Record<string, any> = {};
  const avant = (globalThis as any).window;
  (globalThis as any).window = fenetre;
  try {
    const fichier = `${bac}/shim.mjs`;
    writeFileSync(fichier, corps);
    await import(pathToFileURL(fichier).href);
  } finally {
    (globalThis as any).window = avant;
    rmSync(bac, { recursive: true, force: true });
  }
  assert.equal(typeof fenetre.LOCAL, "function", "le shim publié n'a pas posé window.LOCAL");
  return fenetre.LOCAL;
}

/*
 * « Rien » n'est pas « zéro », côté démo publiée.
 *
 * Zéro est une valeur légitime et le bas de chaque plage : il n'est donc PAS dans la liste
 * ci-dessous. Ce qui est éprouvé est que chaque façon d'écrire « pas de valeur » ne se
 * transforme plus en ce zéro-là. Et le témoin va dans les deux sens — un vrai nombre doit
 * toujours passer, sinon la correction aurait simplement rendu la démo inerte, ce qu'aucun
 * des contrôles existants ne verrait.
 */
test("la démo publiée ne lit pas « pas de valeur » comme un zéro", async () => {
  const LOCAL = await shimPublie();
  const part = async () => (await LOCAL("/api/etat")).situation.partNonDetectee;

  await LOCAL("/api/reglage", { partNonDetectee: 0.04 });
  assert.equal(await part(), 0.04, "un vrai nombre doit être accepté");

  for (const vide of [null, undefined, "", "   ", [], false, "0.01"]) {
    await LOCAL("/api/reglage", { partNonDetectee: vide });
    assert.equal(await part(), 0.04,
      `${JSON.stringify(vide) ?? "undefined"} n'est pas un nombre et ne doit pas poser le réglage au bas de sa plage`);
  }

  /* La fourchette de croyance passait par la même porte, et son bas est zéro lui aussi. */
  const bas = async () => (await LOCAL("/api/etat")).situation.croyance.bas;
  const depart = await bas();
  assert.ok(depart > 0, "le cas de référence doit défendre un bas non nul, sinon ce témoin ne prouve rien");
  for (const vide of [null, "", [], false]) {
    await LOCAL("/api/reglage", { croyanceBas: vide });
    assert.equal(await bas(), depart,
      `${JSON.stringify(vide)} ne doit pas ramener le bas de la fourchette à zéro`);
  }

  /* Et la démo reste réglable : une garde qui ferme la route n'a rien corrigé. */
  await LOCAL("/api/reglage", { partNonDetectee: 0.02 });
  assert.equal(await part(), 0.02, "la garde ne doit pas geler le réglage");
});

/*
 * CE QUE LA PAGE PUBLIÉE DEMANDE, ET CE QUE `docs/` PORTE.
 *
 * La liste des fichiers copiés dans `docs/` était écrite à la main, en double avec la
 * réécriture des chemins absolus. Une ressource AJOUTÉE à `ui.html` n'aurait rien cassé :
 * non copiée, chemin laissé absolu, 404 depuis la racine du site — et vert partout, parce
 * qu'en local la page est servie par `server.ts`, qui lit dans `src/`.
 *
 * Les deux sens sont éprouvés : la dérivation couvre ce que l'écran demande, et elle REFUSE
 * quand elle cesse de lire la page au lieu de rendre une liste vide qu'on copierait sans un mot.
 */
test("les ressources de la démo publiée sont dérivées de l'écran, et la dérivation sait refuser", () => {
  const ui = readFileSync(SRC + "ui.html", "utf8");
  const attendues = ressources(ui);

  const manquantes = attendues.filter((f) => !existsSync(RACINE + "docs/" + f));
  assert.deepEqual(manquantes, [],
    `${manquantes.join(", ")} : demandé par src/ui.html, absent de docs/ — 404 en ligne, invisible en local`);

  const page = readFileSync(RACINE + "docs/index.html", "utf8");
  const absolus = attendues.filter((f) => page.includes(`"/${f}"`));
  assert.deepEqual(absolus, [],
    `${absolus.join(", ")} : chemin absolu resté dans docs/index.html — GitHub Pages sert un sous-dossier`);

  assert.throws(() => ressources(ui.replace(/"\/[A-Za-z0-9_.-]+\.css"/g, '"./ailleurs.css"')),
    /no css resource/,
    "une dérivation qui ne trouve plus la feuille de style doit refuser, pas rendre une liste courte");
  assert.throws(() => ressources("<html></html>"), /no js or css resource/,
    "une page sans ressource reconnue est un motif périmé, pas une page sans ressource");
});

/*
 * LA BOUCLE LOCALE N'EST PAS UNE FRONTIÈRE.
 *
 * `liaison.test.ts` garde l'adresse d'écoute, et elle tient : ce serveur ne parle qu'à la
 * machine. Cela le met hors de portée du RÉSEAU, pas hors de portée du NAVIGATEUR — n'importe
 * quelle page ouverte par ailleurs pouvait poster sur `/api/reglage`, sans requête préalable,
 * et poser la part de risque non détectée, le prix d'un incident et la fourchette défendue.
 * L'absence d'en-têtes CORS empêche seulement l'attaquant de LIRE la réponse ; l'état a déjà
 * changé, et le lecteur revient à son onglet devant un verdict calculé sur des entrées qu'il
 * n'a pas choisies.
 *
 * Le témoin va dans QUATRE sens, parce qu'une garde d'origine se casse aussi bien en laissant
 * passer qu'en refusant tout le monde — et le second se paie par un retrait, pas par un bug.
 */
test("une page étrangère ne peut pas poser les réglages de ce serveur", async () => {
  const racine = copieHostile();
  let fils: ChildProcess | undefined;
  const HOTE = "http://127.0.0.1:4684";
  const lire = async (): Promise<number> => {
    const e = await (await fetch(HOTE + "/api/etat")).json() as { situation: { partNonDetectee: number } };
    return e.situation.partNonDetectee;
  };
  const poser = (valeur: number, origine?: string) => fetch(HOTE + "/api/reglage", {
    method: "POST",
    headers: { "content-type": "application/json", ...(origine ? { origin: origine } : {}) },
    body: JSON.stringify({ partNonDetectee: valeur }),
  });
  try {
    fils = await demarrer(racine, 4684);

    /* 1 — sans Origin : curl, un cas de test, un formulaire de même origine. Doit passer. */
    await poser(0.04);
    assert.equal(await lire(), 0.04, "une requête sans Origin doit passer — sinon la garde ferme l'outil");

    /* 2 — l'écran servi PAR ce serveur porte le même hôte que la requête. Doit passer. */
    await poser(0.03, HOTE);
    assert.equal(await lire(), 0.03, "l'écran de ce serveur doit rester accepté sous son propre hôte");

    /* 3 — une page ouverte ailleurs. Doit être refusée, ET ne rien avoir changé. */
    const refus = await poser(0.055, "https://page-hostile.example");
    assert.equal(refus.status, 403, "une origine étrangère doit être refusée");
    assert.equal((await refus.json() as { erreur?: string }).erreur, "origine_etrangere");
    assert.equal(await lire(), 0.03, "le refus doit arriver AVANT l'écriture, pas après");

    /* 4 — la remise à zéro écrit elle aussi : elle passe par la même porte. */
    const remise = await fetch(HOTE + "/api/remise", {
      method: "POST", headers: { origin: "https://page-hostile.example" },
    });
    assert.equal(remise.status, 403, "/api/remise écrit l'état : elle est gardée comme /api/reglage");
    assert.equal(await lire(), 0.03, "une remise étrangère ne doit pas avoir eu lieu");

    /* 5 — et la lecture reste ouverte : un GET inter-origine n'est pas relisable sans CORS,
       le refuser casserait l'inclusion de l'écran sans rien fermer. */
    const lecture = await fetch(HOTE + "/api/etat", { headers: { origin: "https://page-hostile.example" } });
    assert.equal(lecture.status, 200, "un GET inter-origine ne doit pas être refusé");
  } finally {
    fils?.kill();
    rmSync(racine, { recursive: true, force: true });
  }
});
