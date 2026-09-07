/*
 * CE QUE CET OUTIL EMPRUNTE, ET POURQUOI IL NE LE RECOPIE PAS À LA MAIN.
 *
 * Le coût du contrôle n'est pas proportionnel au nombre de clients gagnés. Un analyste
 * s'achète entier : entre deux embauches, la charge supplémentaire est gratuite, et à la
 * marche suivante elle coûte un salaire complet. C'est exactement la trouvaille du dépôt
 * `alert-triage-economics`, et la réécrire ici de mémoire produirait deux modèles qui
 * divergeraient au premier ajustement.
 *
 * On emprunte donc ses hypothèses de capacité, et `--check` compare octet pour octet. Une
 * copie surveillée est une dépendance ; une copie oubliée est un mensonge qui vieillit.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isMain } from "./cli.ts";

const VOISINS = fileURLToPath(new URL("../../", import.meta.url));
const DEPOT = fileURLToPath(new URL("./emprunts/", import.meta.url));

/** Le graphe est fermé : `model.ts` n'importe rien qui ne soit pas déjà là. */
export const EMPRUNTS = [
  { depot: "economics", fichiers: ["model.ts", "alerts.ts", "regulations.ts", "calibrate.ts"] },
];
const DEJA_LA = ["cli.ts", "interval.ts"];

/*
 * WHAT WAS COMPARED, NOT ONLY WHAT DIVERGED.
 *
 * `--check` used to answer "modèles empruntés à jour" in two situations that are not the
 * same: everything was compared and matched, and *some files were never compared at all*.
 * A shared tool whose source is missing was skipped by a bare `continue` — no count, no
 * name, no trace — and the success line was printed anyway.
 *
 * Measured on 23 August 2026 with `identite/` removed and `economics/` in place: two of the
 * six borrowed files went unchecked and the command still said they were up to date, exit 0.
 * The missing-repository path twelve lines above gets this right and says so out loud; the
 * missing-tool path did not. The same file was both careful and careless about the same
 * question.
 *
 * `compares` now carries what was actually examined, and `ignores` names what was not, so
 * the caller can tell a clean comparison from an empty one. An unexamined file is not a
 * matching file.
 */
export function emprunter(controle: boolean, racines: { voisins: string; depot: string } = { voisins: VOISINS, depot: DEPOT }) {
  const { voisins, depot: local } = racines;
  const ecarts: string[] = [];
  const ignores: string[] = [];
  let copies = 0, compares = 0;
  for (const { depot, fichiers } of EMPRUNTS) {
    const source = `${voisins}${depot}/src/`;
    const cible = `${local}${depot}/`;
    if (!existsSync(source)) return { copies, compares, ecarts, ignores, absent: depot };
    if (!controle) mkdirSync(cible, { recursive: true });

    for (const outil of DEJA_LA) {
      const origine = `${voisins}identite/${outil}`;
      if (!existsSync(origine)) { ignores.push(`${depot}/${outil}, source absente (${origine})`); continue; }
      const contenu = readFileSync(origine, "utf8");
      if (controle) {
        compares++;
        if (!existsSync(cible + outil) || readFileSync(cible + outil, "utf8") !== contenu) {
          ecarts.push(`${depot}/${outil} : absent ou divergent`);
        }
      } else { writeFileSync(cible + outil, contenu); copies++; }
    }
    for (const f of fichiers) {
      const contenu = readFileSync(source + f, "utf8");
      if (controle) {
        compares++;
        if (!existsSync(cible + f)) { ecarts.push(`${depot}/${f} : jamais emprunté`); continue; }
        if (readFileSync(cible + f, "utf8") !== contenu) ecarts.push(`${depot}/${f} : a divergé`);
        continue;
      }
      writeFileSync(cible + f, contenu); copies++;
    }
  }
  return { copies, compares, ecarts, ignores, absent: null as string | null };
}

/** How many files a full `--check` examines when every source is present. */
export const A_COMPARER = EMPRUNTS.reduce((n, e) => n + e.fichiers.length, 0) + EMPRUNTS.length * DEJA_LA.length;

if (isMain(import.meta)) {
  const controle = process.argv.includes("--check");
  const { copies, compares, ecarts, ignores, absent } = emprunter(controle);
  if (absent) { console.log(`dépôt ${absent} absent : emprunt non vérifié`); process.exit(0); }
  for (const i of ignores) console.error(`  non comparé : ${i}`);
  if (ecarts.length) {
    console.error(controle ? "des modèles empruntés ont divergé. Lancer `npm run emprunter`" : "emprunt incomplet :");
    for (const e of ecarts) console.error(`  ${e}`);
    process.exit(1);
  }
  console.log(controle
    ? `modèles empruntés à jour : ${compares}/${A_COMPARER} fichier(s) comparés`
    : `${copies} fichier(s) empruntés`);
}
