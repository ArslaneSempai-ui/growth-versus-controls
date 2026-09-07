/*
 * LA SITUATION, ET POURQUOI C'EST TOUJOURS CELLE-LÀ.
 *
 * Une équipe produit veut retirer une pièce justificative à l'entrée en relation. La
 * conversion monte — c'est mesuré, par un test. Les alertes montent aussi, et une part des
 * clients ainsi gagnés sont exactement ceux que la pièce écartait.
 *
 * Les deux fonctions ont raison. Elles n'optimisent simplement pas la même chose, et
 * chacune arrive en réunion avec ses chiffres à elle : la croissance apporte un test A/B,
 * la conformité apporte une projection d'alertes. Personne n'a jamais mis les deux sur le
 * même axe, et la décision se prend au volume sonore.
 *
 * Ce fichier tient les entrées, séparées par provenance, parce que c'est la seule façon de
 * voir d'où vient l'incertitude du verdict. Un test A/B est *mesuré*. La part de mauvais
 * acteurs parmi les clients gagnés est *supposée* — personne ne l'observe, par construction :
 * ce sont les dossiers qu'on n'a pas ouverts. Ne pas distinguer les deux revient à donner à
 * une opinion le poids d'une mesure.
 */

import type { Inventory } from "./provenance.ts";

/** Ce qu'un test A/B a réellement produit : des comptes, pas un taux. */
export type Test = {
  /** Combien de personnes ont vu chaque version. */
  vus: { temoin: number; variante: number };
  /** Combien ont converti. */
  convertis: { temoin: number; variante: number };
};

export type Situation = {
  nom: string;
  /** Ce que le changement retire ou ajoute, en une phrase. */
  changement: string;
  test: Test;
  /** Visiteurs par an sur l'étape touchée. */
  visiteursParAn: number;
  /** Revenu annuel moyen par client retenu. */
  revenuParClient: number;

  /*
   * Le côté contrôle. Ces trois-là sont supposés, et le verdict y est très sensible —
   * c'est le résultat le plus utile de l'outil, pas une faiblesse à cacher.
   */
  /** Part des clients gagnés qui déclencheront au moins une alerte. */
  partAlertante: number;
  /** Alertes par an et par client alertant. */
  alertesParClientAlertant: number;
  /** Minutes d'analyste par alerte. */
  minutesParAlerte: number;
  /** Coût chargé d'une heure d'analyste. */
  coutHoraire: number;
  /**
   * Les heures d'analyste déjà payées et encore libres, par an.
   *
   * C'est l'entrée qui fait qu'un même changement se décide différemment dans deux
   * établissements identiques : sous la marche, la charge supplémentaire ne coûte rien ;
   * au-dessus, elle coûte un salaire entier. Le dépôt `alert-triage-economics` mesure
   * précisément cette capacité oisive.
   */
  heuresLibres: number;
  /**
   * Part des clients gagnés qui sont de vrais risques et ne seront pas détectés.
   *
   * Attention au piège, et c'est le cœur du modèle : ce n'est **pas** le taux du livre. Les
   * clients gagnés sont exactement ceux que le contrôle écartait. Leur taux de risque est
   * celui de la population marginale, pas celui de la moyenne — un contrôle qui ne filtrait
   * rien n'aurait pas été mis en place. Prendre le taux du livre ici, c'est supposer que le
   * contrôle qu'on retire ne servait à rien, ce qui est la conclusion, pas l'hypothèse.
   *
   * Personne ne l'observe : ce sont les dossiers qu'on n'a pas ouverts. On ne le devine donc
   * pas — on balaie, et on rend la valeur à partir de laquelle le verdict change de signe.
   */
  partNonDetectee: number;
  /**
   * La fourchette de croyance des deux fonctions sur ce nombre.
   *
   * Pas un intervalle de confiance : personne n'a mesuré. C'est ce que la conformité et la
   * croissance sont prêtes à défendre, et c'est utilisable — si la bascule tombe dedans, le
   * désaccord est réel ; si elle tombe dehors, l'une des deux se trompe et on peut le dire.
   */
  croyance: { bas: number; haut: number };
  /** Ce que coûte un risque non détecté, en moyenne, tout compris. */
  coutRisqueNonDetecte: number;
};

/**
 * Le cas de référence.
 *
 * Les volumes et les prix sont ceux d'un établissement de taille moyenne. Le test A/B est
 * dimensionné comme le sont les vrais : assez grand pour publier un chiffre, trop petit
 * pour trancher ce qu'on lui demande de trancher.
 */
export const CAS: Situation = {
  nom: "Retirer le justificatif de domicile à l'inscription",
  changement: "one fewer document at signup",
  test: {
    vus: { temoin: 4_000, variante: 4_000 },
    convertis: { temoin: 1_040, variante: 1_124 },
  },
  visiteursParAn: 240_000,
  revenuParClient: 2_400,

  partAlertante: 0.11,
  alertesParClientAlertant: 2.4,
  minutesParAlerte: 22,
  coutHoraire: 48,
  heuresLibres: 900,

  partNonDetectee: 0.012,
  croyance: { bas: 0.005, haut: 0.030 },
  coutRisqueNonDetecte: 180_000,
};

/** D'où vient chaque nombre. Publié tel quel dans le README. */
export const INVENTAIRE: Inventory = [
  { provenance: "measured", name: "test", what: "conversion lift, from the A/B test",
    note: "counts, not a rate: the interval comes from the sample size" },
  { provenance: "assumed", name: "visiteursParAn", what: "annual traffic on the touched step",
    note: "a planning figure, stable within a quarter" },
  { provenance: "assumed", name: "revenuParClient", what: "annual revenue per retained customer" },
  { provenance: "assumed", name: "partAlertante", what: "share of gained customers that will alert",
    note: "observable after the fact, never before" },
  { provenance: "assumed", name: "minutesParAlerte", what: "analyst minutes per alert",
    note: "the one control-side figure a team usually does know" },
  { provenance: "assumed", name: "partNonDetectee",
    what: "share of gained customers who are a real risk and go undetected",
    note: "the marginal population, not the book: these are the customers the control was stopping. Swept, not guessed." },
  { provenance: "assumed", name: "croyance",
    what: "the range the two functions will each defend for that share",
    note: "not a confidence interval; nobody measured. It is what each side is prepared to argue." },
  { provenance: "chosen", name: "coutRisqueNonDetecte", what: "cost of one undetected risk",
    note: "fines, remediation and exit, averaged; a choice, and the verdict moves with it" },
];
