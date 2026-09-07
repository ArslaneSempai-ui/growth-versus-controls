/*
 * METTRE LES DEUX FONCTIONS SUR LE MÊME AXE.
 *
 * La croissance apporte un test A/B, la conformité apporte une projection d'alertes, et les
 * deux sont vraies. Ce fichier les convertit toutes les deux en dollars par an, propage
 * l'incertitude du test jusqu'au bout, et répond à une question que la réunion ne pose
 * jamais : **cette décision est-elle tranchable avec les preuves apportées ?**
 *
 * Trois sorties, dans cet ordre d'importance :
 *
 *  1. **Le net, avec son intervalle.** S'il contient zéro, la décision n'est pas tranchable
 *     avec ces données — et c'est le cas le plus fréquent.
 *  2. **Le point de bascule** sur la part non détectée, le seul nombre que personne ne
 *     mesure. Plutôt que de le supposer, on dit à partir de quelle valeur le signe change.
 *  3. **Ce qui trancherait.** Élargir le test, ou mesurer l'hypothèse ? Les deux ne coûtent
 *     pas la même chose, et l'un des deux ne sert souvent à rien. C'est la sortie la plus
 *     utile et personne ne la produit.
 */

import { wilson } from "./interval.ts";
import { CAS, type Situation } from "./situation.ts";
import { ASSUMPTIONS as CAPACITE } from "./emprunts/economics/model.ts";
import { isMain } from "./cli.ts";

export type Plage = { bas: number; centre: number; haut: number };

const dollars = (x: number) => (x < 0 ? "−" : "") + "$" + Math.round(Math.abs(x)).toLocaleString("en-GB");

/**
 * L'écart de conversion, avec son intervalle.
 *
 * Pas la différence de deux intervalles de Wilson — ce serait faux, et faux dans le sens
 * confortable : trop large, donc « rien n'est prouvé » trop souvent. C'est la méthode
 * hybride de Newcombe, construite *sur* les deux intervalles de Wilson, qui est la bonne
 * réponse à cette question précise.
 */
export function ecartConversion(s: Situation): Plage {
  const { vus, convertis } = s.test;
  const pt = convertis.temoin / vus.temoin;
  const pv = convertis.variante / vus.variante;
  const [lt, ut] = wilson(convertis.temoin, vus.temoin);
  const [lv, uv] = wilson(convertis.variante, vus.variante);
  return {
    bas: pv - pt - Math.hypot(pv - lv, ut - pt),
    centre: pv - pt,
    haut: pv - pt + Math.hypot(uv - pv, pt - lt),
  };
}

/** Les clients gagnés par an, avec l'incertitude du test propagée telle quelle. */
export function clientsGagnes(s: Situation): Plage {
  const e = ecartConversion(s);
  const n = (x: number) => x * s.visiteursParAn;
  return { bas: n(e.bas), centre: n(e.centre), haut: n(e.haut) };
}

/** Les heures d'analyste qu'un client gagné consomme dans l'année. */
export function heuresParClient(s: Situation): number {
  return s.partAlertante * s.alertesParClientAlertant * (s.minutesParAlerte / 60);
}

/**
 * Le coût du contrôle, acheté en marches et non à l'unité.
 *
 * Premier modèle, et il était faux : les heures d'analyste multipliées par un taux horaire.
 * Ça revient à embaucher trois dixièmes d'analyste, ce qui n'existe pas. Un établissement a
 * une capacité déjà payée ; en dessous, la charge supplémentaire ne coûte rien de plus, et à
 * la marche suivante elle coûte un salaire entier.
 *
 * Conséquence, et c'est ce qui rend le verdict utile plutôt que joli : **le même changement
 * est rentable ou ruineux selon l'endroit de la marche où l'équipe se trouve déjà**. Deux
 * établissements identiques, avec la même mesure et les mêmes hypothèses, peuvent décider
 * l'inverse à bon droit. Aucun modèle linéaire ne peut dire ça.
 *
 * Les hypothèses de capacité sont empruntées à `alert-triage-economics`, pas réécrites.
 */
export function coutControle(s: Situation, clients: number, partNonDetectee = s.partNonDetectee): number {
  const heuresSupp = clients * heuresParClient(s);
  const heuresParAnalyste = CAPACITE.productiveHoursPerDay * CAPACITE.workingDaysPerYear;

  /* La capacité déjà payée et encore libre absorbe la charge sans rien coûter. */
  const libres = Math.max(0, s.heuresLibres);
  const aFinancer = Math.max(0, heuresSupp - libres);
  const analystesEnPlus = Math.ceil(aFinancer / heuresParAnalyste);

  return analystesEnPlus * CAPACITE.loadedCostPerAnalyst
    + clients * partNonDetectee * s.coutRisqueNonDetecte;
}

/** Gardé pour ce qu'il éclaire : le coût moyen par client, une fois la marche payée. */
export function coutParClient(s: Situation, partNonDetectee = s.partNonDetectee): number {
  const c = clientsGagnes(s).centre;
  return c === 0 ? 0 : coutControle(s, c, partNonDetectee) / c;
}

export type Verdict = {
  clients: Plage;
  croissance: Plage;
  controle: Plage;
  net: Plage;
  /** Vrai si l'intervalle du net exclut zéro. */
  tranchable: boolean;
  /** Le signe, quand il est établi. */
  sens: "croissance" | "contrôle" | null;
  /**
   * Combien d'analystes il faut embaucher, à chaque borne de l'intervalle.
   *
   * Rendu visible parce que c'est le fait le plus actionnable de la sortie : quand le bas de
   * l'intervalle n'embauche personne et le haut embauche quelqu'un, le même test dit à la fois
   * « ça ne coûte rien de plus » et « ça coûte un salaire ». Ce n'est pas une contradiction,
   * c'est une marche, et ça ne se voit nulle part ailleurs.
   */
  analystes: { bas: number; centre: number; haut: number };
  /** Vrai si l'intervalle du test enjambe une embauche. */
  enjambeUneMarche: boolean;
  /**
   * Qui décide du signe — et c'est la trouvaille de cet outil.
   *
   * Tant que le test établit que la conversion monte, l'intervalle du nombre de clients est
   * entièrement positif. Le net est ce nombre multiplié par la marge par client : son signe
   * est donc **celui de la marge**, et la marge est faite d'hypothèses. L'incertitude du test
   * fixe l'ampleur, jamais le sens.
   *
   * Conséquence pratique, et elle est contre-intuitive : agrandir le test A/B ne peut pas
   * trancher ce désaccord. Six semaines de trafic supplémentaire resserrent un intervalle
   * dont le signe n'a jamais été en jeu. Ce qui tranche est de mesurer l'hypothèse.
   */
  signeDecidePar: "le test" | "les hypothèses";
};

export function arbitrer(s: Situation, partNonDetectee = s.partNonDetectee): Verdict {
  const clients = clientsGagnes(s);
  const val = (c: number) => c * s.revenuParClient;
  const cout = (c: number) => coutControle(s, c, partNonDetectee);
  const netDe = (c: number) => val(c) - cout(c);

  /* Le net n'est plus proportionnel : la marche fait qu'il peut décroître quand les clients
   * augmentent. On prend donc les bornes par calcul, pas par multiplication. */
  const heuresParAnalyste = CAPACITE.productiveHoursPerDay * CAPACITE.workingDaysPerYear;
  const embauches = (c: number) =>
    Math.ceil(Math.max(0, c * heuresParClient(s) - Math.max(0, s.heuresLibres)) / heuresParAnalyste);
  const analystes = {
    bas: embauches(clients.bas), centre: embauches(clients.centre), haut: embauches(clients.haut),
  };
  const bornes = [netDe(clients.bas), netDe(clients.haut)];
  const net: Plage = {
    bas: Math.min(...bornes),
    centre: netDe(clients.centre),
    haut: Math.max(...bornes),
  };
  /*
   * « Tranchable » veut dire que l'intervalle ne contient pas zéro. Rien de plus. Une
   * décision peut être tranchable et mauvaise ; elle ne peut pas être bonne si le signe
   * lui-même n'est pas établi.
   */
  const tranchable = net.bas > 0 || net.haut < 0;
  /* Si l'intervalle des clients ne change pas de signe, celui du net non plus : c'est la
   * marge qui commande, et elle ne vient pas du test. */
  const testDecide = clients.bas <= 0 && clients.haut >= 0;
  return {
    clients,
    croissance: { bas: val(clients.bas), centre: val(clients.centre), haut: val(clients.haut) },
    controle: { bas: cout(clients.bas), centre: cout(clients.centre), haut: cout(clients.haut) },
    net,
    tranchable,
    sens: !tranchable ? null : net.centre > 0 ? "croissance" : "contrôle",
    analystes,
    enjambeUneMarche: analystes.bas !== analystes.haut,
    signeDecidePar: testDecide ? "le test" : "les hypothèses",
  };
}

/**
 * Le point de bascule sur la part non détectée.
 *
 * C'est le seul nombre de tout le modèle que personne n'observe — ce sont les dossiers qu'on
 * n'a pas ouverts. Le supposer, c'est décider en cachant la décision dans une constante. On
 * le balaie, et on rend la valeur à partir de laquelle le signe change : la question passe de
 * « quelle est cette part ? » à « est-elle plus grande ou plus petite que ça ? », à laquelle
 * un responsable conformité *peut* répondre.
 */
export function bascule(s: Situation): number | null {
  /* Avec une marche, le net n'est plus linéaire en la part non détectée à travers le nombre
   * de clients — mais à nombre de clients fixé il l'est, et c'est la question posée : à
   * combien de risque non détecté ce changement cesse-t-il de payer ? */
  const c = clientsGagnes(s).centre;
  if (c <= 0) return null;
  const marge = val0(s, c);
  if (marge <= 0) return 0;
  return marge / (c * s.coutRisqueNonDetecte);
}

/** La valeur du changement avant tout risque non détecté : revenu moins la marche payée. */
function val0(s: Situation, clients: number): number {
  return clients * s.revenuParClient - coutControle(s, clients, 0);
}

/**
 * Le désaccord est-il réel ?
 *
 * Si la bascule tombe **dans** la fourchette que les deux fonctions défendent, chacune a une
 * position cohérente et le désaccord porte sur une croyance, pas sur un calcul : aucune
 * quantité de réunions ne le résoudra, seule une mesure le fera. Si elle tombe **dehors**,
 * l'une des deux se trompe sur ses propres termes, et on peut le dire poliment mais
 * clairement — ce qui est beaucoup plus utile qu'un compromis à mi-chemin.
 */
export function desaccordReel(s: Situation): {
  bascule: number; dedans: boolean; partPourLeChangement: number; qui: string;
} {
  const b = bascule(s) ?? 0;
  const dedans = b > s.croyance.bas && b < s.croyance.haut;
  /*
   * Combien de la fourchette défendue penche pour le changement.
   *
   * « Nous sommes en désaccord » ne décide rien. « Quatre-vingts pour cent de ce que vous
   * êtes tous les deux prêts à défendre penche du même côté » est une phrase sur laquelle une
   * réunion peut finir — et elle demande la même arithmétique.
   */
  const largeur = s.croyance.haut - s.croyance.bas;
  const partPourLeChangement = largeur <= 0 ? (b > s.croyance.bas ? 1 : 0)
    : Math.min(1, Math.max(0, (b - s.croyance.bas) / largeur));
  return {
    bascule: b,
    dedans,
    partPourLeChangement,
    qui: dedans ? "both positions are coherent: this needs a measurement, not a meeting"
      : b <= s.croyance.bas ? "even the most optimistic reading favours the controls"
      : "even the most cautious reading favours the change",
  };
}

export type Levier = { quoi: string; largeurRestante: number; utile: boolean };

/**
 * Ce qui trancherait, et ce qui ne trancherait pas.
 *
 * Deux façons de réduire l'incertitude : agrandir le test (la croissance sait le faire) ou
 * mesurer la part non détectée (la conformité sait le faire). Elles ne s'attaquent pas à la
 * même incertitude, et l'une des deux est souvent sans effet — ce qui n'empêche personne de
 * la réclamer pendant six semaines.
 */
export function ceQuiTrancherait(s: Situation, facteur = 4): Levier[] {
  const v = arbitrer(s);
  const largeurActuelle = v.net.haut - v.net.bas;

  /* Un test `facteur` fois plus grand, au même effet observé. */
  const plusGrand: Situation = {
    ...s,
    test: {
      vus: { temoin: s.test.vus.temoin * facteur, variante: s.test.vus.variante * facteur },
      convertis: {
        temoin: Math.round(s.test.convertis.temoin * facteur),
        variante: Math.round(s.test.convertis.variante * facteur),
      },
    },
  };
  const apresTest = arbitrer(plusGrand);

  /*
   * L'autre incertitude ne se voit pas dans l'intervalle : elle est *hors* du modèle, dans
   * une constante supposée. On la matérialise en balayant une plage plausible et en
   * mesurant de combien le net se déplace.
   */
  const plage = [s.partNonDetectee / 3, s.partNonDetectee * 3];
  const nets = plage.map((p) => arbitrer(s, p).net.centre);
  const largeurHypothese = Math.abs(nets[0]! - nets[1]!);

  return [
    {
      quoi: `run the test ${facteur}× larger`,
      largeurRestante: apresTest.net.haut - apresTest.net.bas,
      utile: apresTest.tranchable && !v.tranchable,
    },
    {
      quoi: "measure the undetected share instead of assuming it",
      largeurRestante: largeurActuelle - Math.min(largeurActuelle, largeurHypothese),
      utile: largeurHypothese > largeurActuelle,
    },
  ];
}

if (isMain(import.meta)) {
  const s = CAS;
  const v = arbitrer(s);
  const e = ecartConversion(s);
  const pc = (x: number) => (x * 100).toFixed(2) + " pts";

  console.log(`\n${s.nom}\n${"─".repeat(s.nom.length)}\n`);
  console.log(`  conversion lift        ${pc(e.centre)}  [${pc(e.bas)} … ${pc(e.haut)}]`);
  console.log(`  customers gained / yr  ${Math.round(v.clients.centre).toLocaleString("en-GB")}` +
    `  [${Math.round(v.clients.bas).toLocaleString("en-GB")} … ${Math.round(v.clients.haut).toLocaleString("en-GB")}]`);
  console.log(`\n  growth says            ${dollars(v.croissance.centre)} a year`);
  console.log(`  controls say           ${dollars(-v.controle.centre)} a year`);
  console.log(`  net                    ${dollars(v.net.centre)}  [${dollars(v.net.bas)} … ${dollars(v.net.haut)}]`);
  console.log(`\n  ${v.tranchable
    ? `settled: the sign holds across the interval; ${v.sens} wins`
    : "NOT settled: the interval spans zero. This evidence cannot decide the sign."}`);

  const b = bascule(s);
  if (b !== null) {
    console.log(`\n  the whole thing turns on one unobserved number:`);
    console.log(`  undetected-risk share assumed  ${(s.partNonDetectee * 100).toFixed(3)} %`);
    console.log(`  sign flips at                  ${(b * 100).toFixed(3)} %`);
    console.log(`  → the answerable question is not "what is it" but "is it above ${(b * 100).toFixed(3)} %"`);
  }

  const d = desaccordReel(s);
  console.log(`  the two sides defend  ${(s.croyance.bas * 100).toFixed(1)} % … ${(s.croyance.haut * 100).toFixed(1)} %`);
  console.log(`  → ${(d.partPourLeChangement * 100).toFixed(0)} % of that range favours the change`);
  console.log(`  → ${d.qui}`);

  console.log(`\n  analysts to hire       ${v.analystes.bas} at the low end, ${v.analystes.haut} at the high end`);
  if (v.enjambeUneMarche) {
    console.log(`  → the same test says both "costs nothing extra" and "costs a whole salary".`);
    console.log(`    Not a contradiction: capacity is bought whole, and the interval straddles a hire.`);
  }

  console.log(`\n  what would settle it:`);
  for (const l of ceQuiTrancherait(s)) {
    console.log(`    ${l.utile ? "→" : "×"} ${l.quoi.padEnd(46)} ${l.utile ? "settles it" : "does not settle it"}`);
  }
  console.log();
}
