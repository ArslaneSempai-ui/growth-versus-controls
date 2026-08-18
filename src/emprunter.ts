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
import { isMain } from "./cli.ts";

const VOISINS = new URL("../../", import.meta.url).pathname;
const DEPOT = new URL("./emprunts/", import.meta.url).pathname;

/** Le graphe est fermé : `model.ts` n'importe rien qui ne soit pas déjà là. */
export const EMPRUNTS = [
  { depot: "economics", fichiers: ["model.ts", "alerts.ts", "regulations.ts", "calibrate.ts"] },
];
const DEJA_LA = ["cli.ts", "interval.ts"];

export function emprunter(controle: boolean) {
  const ecarts: string[] = [];
  let copies = 0;
  for (const { depot, fichiers } of EMPRUNTS) {
    const source = `${VOISINS}${depot}/src/`;
    const cible = `${DEPOT}${depot}/`;
    if (!existsSync(source)) return { copies, ecarts, absent: depot };
    if (!controle) mkdirSync(cible, { recursive: true });

    for (const outil of DEJA_LA) {
      const origine = `${VOISINS}identite/${outil}`;
      if (!existsSync(origine)) continue;
      const contenu = readFileSync(origine, "utf8");
      if (controle) {
        if (!existsSync(cible + outil) || readFileSync(cible + outil, "utf8") !== contenu) {
          ecarts.push(`${depot}/${outil} — absent ou divergent`);
        }
      } else { writeFileSync(cible + outil, contenu); copies++; }
    }
    for (const f of fichiers) {
      const contenu = readFileSync(source + f, "utf8");
      if (controle) {
        if (!existsSync(cible + f)) { ecarts.push(`${depot}/${f} — jamais emprunté`); continue; }
        if (readFileSync(cible + f, "utf8") !== contenu) ecarts.push(`${depot}/${f} — a divergé`);
        continue;
      }
      writeFileSync(cible + f, contenu); copies++;
    }
  }
  return { copies, ecarts, absent: null as string | null };
}

if (isMain(import.meta)) {
  const controle = process.argv.includes("--check");
  const { copies, ecarts, absent } = emprunter(controle);
  if (absent) { console.log(`dépôt ${absent} absent — emprunt non vérifié`); process.exit(0); }
  if (ecarts.length) {
    console.error(controle ? "des modèles empruntés ont divergé — lancer `npm run emprunter`" : "emprunt incomplet :");
    for (const e of ecarts) console.error(`  ${e}`);
    process.exit(1);
  }
  console.log(controle ? "modèles empruntés à jour" : `${copies} fichier(s) empruntés`);
}
