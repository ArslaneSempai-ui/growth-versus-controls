/*
 * UNE LIGNE DE LA LISTE QUI NE NOMME AUCUN CAS EXISTANT.
 *
 * La porte anti-ignorés compare l'ensemble EXACT des noms attendus à ceux que la suite ignore
 * vraiment. Elle attrape donc une liste qui ment — mais seulement SUR UN RUNNER, c'est-à-dire
 * après l'envoi, sur une machine où les cas de plateforme s'ignorent pour de bon. Une entrée
 * devenue fausse dort jusque-là.
 *
 * VÉCU LE 27/08/2026 DANS `cascade`, ET C'EST CE QUI A FAIT ÉCRIRE CE CAS. Un commit du soir
 * même avait remplacé le nom littéral « trois compilations simultanées… » par un gabarit
 * `${SIMULTANEES} compilations…` avec la constante à 3. Le lanceur écrivait donc « 3
 * compilations… » pendant que la liste attendait encore « trois ». Sur le runner la porte
 * aurait rougi DES DEUX CÔTÉS À LA FOIS — l'ancien nom attendu et jamais vu, le vrai vu et
 * attendu par personne — sur un dépôt qui portait neuf commits non poussés et aucune passe
 * d'intégration derrière eux. Un nom recopié à la main : juste jusqu'au jour où le code cesse
 * de l'épeler ainsi.
 *
 * Ce cas ferme la moitié qui se voit SANS runner : chaque ligne de la liste doit nommer un cas
 * qui existe. L'autre moitié — un cas qui s'ignore sans figurer dans la liste — ne se voit que
 * là-bas, et c'est la porte qui la tient. Les deux sont nécessaires, et aucune ne remplace
 * l'autre.
 *
 * LES NOMS CONSTRUITS FONT REFUSER, ILS NE SONT PAS ÉCARTÉS. Ce dépôt n'en porte aucun
 * aujourd'hui, et rien ici ne cherche à les résoudre — ce serait de la machinerie pour un cas
 * qui ne se présente pas. Mais un extracteur qui laisserait tomber en silence ce qu'il ne sait
 * pas lire finirait par ne regarder que les noms commodes, et c'est exactement le défaut du
 * jour. Donc s'il en rencontre un, il s'arrête et le dit.
 *
 * L'EXIGENCE PORTE SUR LE FICHIER, PAS SUR LE NOM. Un nom construit n'a besoin d'être lisible
 * que dans un fichier où un cas peut s'ignorer : seul un tel fichier peut fournir une entrée à
 * la liste. Ailleurs, un nom illisible est sans conséquence — et une entrée qui le nommerait
 * serait fautive de toute façon, puisqu'elle nommerait un cas qui ne s'ignore jamais.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function nomsDesCas(dossier: string): { noms: Set<string>; construits: string[] } {
  const noms = new Set<string>();
  const construits: string[] = [];
  for (const f of readdirSync(dossier).filter((n) => /\.test\.(ts|mjs)$/.test(n))) {
    const src = readFileSync(join(dossier, f), "utf8");
    /* Seul un fichier portant un point d'ignorance peut alimenter la liste. */
    const peutIgnorer = /\.skip\(/.test(src);
    for (const m of src.matchAll(/^test\(\s*(?:"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`)/gm)) {
      const nom = (m[1] ?? m[2] ?? "").replace(/\\(.)/g, "$1");
      if (/\$\{/.test(nom)) {
        if (peutIgnorer) construits.push(`${f} : ${nom}`);
        continue;
      }
      noms.add(nom);
    }
  }
  return { noms, construits };
}

test("chaque ligne de la liste des ignorés attendus nomme un cas qui existe", () => {
  const dossier = fileURLToPath(new URL(".", import.meta.url));
  const { noms, construits } = nomsDesCas(dossier);

  /* REFUS PLUTÔT QU'OUBLI : un nom construit non lu serait retiré de la comparaison, et
     l'entrée correspondante paraîtrait fausse alors qu'elle est seulement illisible ici. */
  assert.deepEqual(construits, [],
    `${construits.length} nom(s) de cas construits, dans des fichiers où un cas peut s'ignorer :\n  `
    + construits.join("\n  ")
    + "\n  Ce contrôle ne les résout pas — il n'y en avait aucun quand il a été écrit — et il\n"
    + "  refuse plutôt que de les écarter en silence.\n"
    + "  → écrire le nom en clair, ou apprendre à ce cas à résoudre la constante.");

  /*
   * TÉMOINS DE NON-VACUITÉ, AVANT LE VERDICT. Un extracteur cassé rendrait un ensemble vide, et
   * toutes les entrées paraîtraient fausses ; un extracteur qui ne lirait qu'un fichier
   * laisserait passer une entrée périmée qui nomme un cas d'ailleurs.
   */
  assert.ok(noms.size >= 30,
    `${noms.size} nom(s) de cas extraits : la lecture des fichiers de cas a échoué, et la `
    + "comparaison ci-dessous porterait sur presque rien.");
  assert.ok(noms.has("chaque ligne de la liste des ignorés attendus nomme un cas qui existe"),
    "l'extracteur ne retrouve même pas ce cas-ci : il ne lit pas ce qu'il prétend lire.");

  const liste = fileURLToPath(new URL("../.github/cas-ignores-attendus.txt", import.meta.url));
  const attendus = readFileSync(liste, "utf8").split("\n")
    .filter((l) => l.trim() !== "" && !l.startsWith("#"));

  /* Une liste vide rendrait ce cas vert sans rien regarder. Ce dépôt en a ; le jour où elle se
     viderait légitimement, c'est ce plancher qu'il faudrait rouvrir, pas le contourner. */
  assert.ok(attendus.length >= 1,
    "la liste des ignorés attendus ne porte aucune entrée : ce cas passerait sans rien comparer.");

  const fantomes = attendus.filter((a) => !noms.has(a));
  assert.deepEqual(fantomes, [],
    `${fantomes.length} entrée(s) de la liste ne nomment aucun cas de la suite :\n  `
    + fantomes.join("\n  ")
    + "\n  La porte compare l'ensemble EXACT des noms : sur le runner, celle-ci serait attendue\n"
    + "  et jamais vue, pendant que le cas réel s'ignorerait sous un nom que rien n'attend —\n"
    + "  un rouge des deux côtés à la fois, découvert après l'envoi.\n"
    + "  → recopier le nom EXACT tel que le lanceur l'écrit.");
});
