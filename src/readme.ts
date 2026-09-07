/*
 * LE README, ÉCRIT PAR LE MODÈLE.
 *
 * Les chiffres d'un README se périment en silence : personne ne relit une page qu'il a
 * écrite. Les blocs entre `<!-- figures:… -->` sont donc produits ici, et `--check` refuse
 * de passer s'ils ont divergé. Ce qui est autour est de la prose, et la prose se tient
 * autrement — voir la marque de provenance dans le dépôt vitrine.
 */

import { figures, table, type Blocks } from "./figures.ts";
import { CAS, INVENTAIRE } from "./situation.ts";
import { arbitrer, bascule, ceQuiTrancherait, clientsGagnes, desaccordReel, ecartConversion } from "./arbitrage.ts";
import { MEANING, ORDER } from "./provenance.ts";
import { fileURLToPath } from "node:url";
import { isMain } from "./cli.ts";

const dollars = (x: number) => (x < 0 ? "−" : "") + "$" + Math.round(Math.abs(x)).toLocaleString("en-GB");
const pc = (x: number, d = 2) => (x * 100).toFixed(d) + " %";
const nb = (x: number) => Math.round(x).toLocaleString("en-GB");

const v = arbitrer(CAS);
const e = ecartConversion(CAS);
const d = desaccordReel(CAS);

const finding = (() => {
  const sens = v.sens === "croissance" ? "growth" : "the controls";
  return `**The finding.** The A/B test settles that conversion rises: ${pc(e.centre)} ` +
    `[${pc(e.bas)} … ${pc(e.haut)}]. It does **not** settle the decision. The sign of the net ` +
    `is set by an assumption nobody measures, and it flips at an undetected-risk share of ` +
    `**${pc(d.bascule)}**, inside the range both functions are prepared to defend. ` +
    `Running the test larger cannot settle it; measuring that share can.`;
})();

const decision = table(
  ["", "A year", "Interval"],
  [
    ["What growth gains", dollars(v.croissance.centre), `${dollars(v.croissance.bas)} … ${dollars(v.croissance.haut)}`],
    ["What controls cost", dollars(-v.controle.centre), `${dollars(-v.controle.haut)} … ${dollars(-v.controle.bas)}`],
    [`**Net**`, `**${dollars(v.net.centre)}**`, `**${dollars(v.net.bas)} … ${dollars(v.net.haut)}**`],
  ],
) + `\n\nThe sign ${v.tranchable ? "holds across the interval" : "is not established"}, and it is decided by ` +
  `**${v.signeDecidePar === "le test" ? "the test" : "the assumptions"}**, not the other one.`;

const marche = (() => {
  const c = clientsGagnes(CAS);
  return `Customers gained lie between **${nb(c.bas)}** and **${nb(c.haut)}** a year. Analysts to hire ` +
    `across that interval: **${v.analystes.bas}** at the low end, **${v.analystes.haut}** at the high end.` +
    (v.enjambeUneMarche
      ? ` The same test therefore says both "costs nothing extra" and "costs a whole salary": not a contradiction, a step. Capacity is bought whole.`
      : ` The interval sits inside a single step, so capacity is not the question in this case.`);
})();

const leviers = table(
  ["Effort", "Interval width left", "Settles it?"],
  ceQuiTrancherait(CAS).map((l) => [l.quoi, dollars(l.largeurRestante), l.utile ? "**yes**" : "no"]),
);

const provenance = (() => {
  const lignes = ORDER.flatMap((p) =>
    INVENTAIRE.filter((f) => f.provenance === p).map((f) => [p, "`" + f.name + "`", f.what, f.note ?? ""]));
  return table(["", "Input", "What it is", "Why it is that kind"], lignes) +
    `\n\n${ORDER.map((p) => `**${p}**: ${MEANING[p].means}`).join("  \n")}`;
})();

const blocs: Blocks = { finding, decision, marche, leviers, provenance };

if (isMain(import.meta)) {
  const mode = process.argv.includes("--check") ? "check" : "write";
  const chemin = fileURLToPath(new URL("../README.md", import.meta.url));
  const r = figures(chemin, blocs, mode);
  if (mode === "check" && r.stale.length) {
    console.error(`${chemin} is stale: ${r.stale.join(", ")}`);
    console.error("Run: npm run figures");
    process.exit(1);
  }
  console.log(mode === "check" ? `${chemin} is up to date.` : `${chemin} written.`);
}
