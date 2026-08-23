/*
 * L'ÉCRAN SERVI DEPUIS UN CHEMIN QUI N'EST PAS SAGE.
 *
 * Two failures met here on 23 August 2026 and killed the process on the first request:
 * `new URL(…, import.meta.url).pathname` does not decode `%20`, so a repository cloned
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
import { cpSync, mkdtempSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { emprunter, A_COMPARER } from "./emprunter.ts";

const SRC = fileURLToPath(new URL(".", import.meta.url));

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
