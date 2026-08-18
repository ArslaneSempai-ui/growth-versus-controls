/*
 * CE QUE CET OUTIL N'A PAS LE DROIT DE DIRE.
 *
 * Il produit un verdict sur une décision contestée, à partir d'un test mesuré et d'une
 * poignée d'hypothèses. Trois façons de le rendre malhonnête, dans l'ordre de ce qui
 * coûterait le plus cher :
 *
 *  1. **Faire passer une hypothèse pour une mesure.** Le signe du net vient de la marge par
 *     client, qui est supposée. Si l'outil laisse croire que le test A/B l'établit, il donne
 *     à une opinion l'autorité d'une expérience.
 *  2. **Promettre qu'un test plus grand tranchera.** C'est ce que la salle réclame toujours,
 *     et c'est faux ici par construction. Un outil qui ne le dit pas fait perdre six semaines.
 *  3. **Élargir l'intervalle par confort.** La différence de deux intervalles de Wilson est
 *     plus large que le vrai intervalle de la différence : elle conclut « rien n'est prouvé »
 *     trop souvent, ce qui a l'air prudent et ne l'est pas.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { arbitrer, bascule, ceQuiTrancherait, clientsGagnes, coutControle, coutParClient, desaccordReel, ecartConversion } from "./arbitrage.ts";
import { CAS, type Situation } from "./situation.ts";
import { wilson } from "./interval.ts";

test("l'écart de conversion contient son estimation ponctuelle et n'est pas nul", () => {
  const e = ecartConversion(CAS);
  assert.ok(e.bas < e.centre && e.centre < e.haut, JSON.stringify(e));
  assert.ok(e.bas > 0, "sur ce test l'écart est établi : l'intervalle doit exclure zéro");
});

test("l'intervalle de la différence est plus étroit que la différence des intervalles", () => {
  /*
   * Le contrôle qui protège du confort. La méthode naïve — soustraire les bornes de deux
   * intervalles de Wilson — donne un intervalle strictement plus large, donc un « on ne peut
   * pas conclure » plus fréquent. Prudent en apparence, faux en fait.
   */
  const [lt, ut] = wilson(CAS.test.convertis.temoin, CAS.test.vus.temoin);
  const [lv, uv] = wilson(CAS.test.convertis.variante, CAS.test.vus.variante);
  const naif = (uv - lt) - (lv - ut);
  const e = ecartConversion(CAS);
  assert.ok(e.haut - e.bas < naif, `Newcombe ${(e.haut - e.bas).toFixed(4)} contre naïf ${naif.toFixed(4)}`);
});

test("le signe du net vient des hypothèses, pas du test", () => {
  const v = arbitrer(CAS);
  assert.equal(v.signeDecidePar, "les hypothèses");
  /* Et la raison est vérifiable : l'intervalle des clients ne change pas de signe. */
  const c = clientsGagnes(CAS);
  assert.ok(c.bas > 0 && c.haut > 0);
});

test("agrandir le test ne change jamais le signe", () => {
  /*
   * La promesse que la salle réclame, mise à l'épreuve : à effet observé constant, un test
   * quatre fois plus grand resserre l'intervalle et laisse le signe où il était.
   */
  const v = arbitrer(CAS);
  const plusGrand: Situation = {
    ...CAS,
    test: {
      vus: { temoin: CAS.test.vus.temoin * 4, variante: CAS.test.vus.variante * 4 },
      convertis: { temoin: CAS.test.convertis.temoin * 4, variante: CAS.test.convertis.variante * 4 },
    },
  };
  const w = arbitrer(plusGrand);
  assert.equal(Math.sign(w.net.centre), Math.sign(v.net.centre));
  assert.ok(w.net.haut - w.net.bas < v.net.haut - v.net.bas, "un test plus grand doit resserrer");
  assert.equal(ceQuiTrancherait(CAS)[0]!.utile, false, "l'outil doit dire que ça ne tranche pas");
});

test("la bascule est bien l'endroit où le net change de signe", () => {
  const b = bascule(CAS)!;
  assert.ok(b > 0);
  const juste = arbitrer(CAS, b * 0.99).net.centre;
  const apres = arbitrer(CAS, b * 1.01).net.centre;
  assert.ok(juste > 0 && apres < 0, `${juste} puis ${apres}`);
});

test("un désaccord est déclaré réel quand la bascule tombe dans la fourchette défendue", () => {
  const d = desaccordReel(CAS);
  assert.equal(d.dedans, true);
  /* Et il cesse de l'être si une des deux fonctions révise sa position. */
  const convaincue: Situation = { ...CAS, croyance: { bas: 0.001, haut: 0.004 } };
  assert.equal(desaccordReel(convaincue).dedans, false);
  assert.match(desaccordReel(convaincue).qui, /favours the change/);
});

test("un contrôle qui n'arrêtait rien ne coûte que du temps d'analyste", () => {
  /*
   * Le cas dégénéré qui garde le modèle honnête : si la part non détectée est nulle, il ne
   * reste que les heures, et le changement se justifie tout seul. Un modèle qui trouverait
   * autre chose ici aurait un coût caché quelque part.
   */
  const sansRisque = arbitrer(CAS, 0);
  assert.ok(sansRisque.net.centre > 0);
  assert.ok(coutParClient(CAS, 0) < coutParClient(CAS));
});

test("aucun montant ne sort sans son intervalle", () => {
  const v = arbitrer(CAS);
  for (const [nom, p] of Object.entries({ clients: v.clients, croissance: v.croissance, controle: v.controle, net: v.net })) {
    assert.ok(p.bas <= p.centre && p.centre <= p.haut, `${nom} : bornes incohérentes`);
    assert.ok(p.haut - p.bas > 0, `${nom} : intervalle nul, donc une incertitude perdue en route`);
  }
});

test("la capacité s'achète entière, et l'intervalle peut enjamber une embauche", () => {
  /*
   * Le défaut du premier modèle, tenu pour qu'il ne revienne pas : facturer des heures au
   * taux horaire revient à embaucher trois dixièmes d'analyste. Ici la charge sous la
   * capacité libre est gratuite, et la marche suivante coûte un salaire entier.
   */
  const v = arbitrer(CAS);
  assert.equal(v.analystes.bas, 0, "sous la capacité libre, rien à payer de plus");
  assert.ok(v.analystes.haut >= 1, "au haut de l'intervalle, la marche est franchie");
  assert.equal(v.enjambeUneMarche, true);

  /* Et le coût est bien discret : doubler les clients ne double pas la facture. */
  const un = coutControle(CAS, 6_000, 0);
  const deux = coutControle(CAS, 12_000, 0);
  assert.notEqual(deux, un * 2);
});

test("deux équipes identiques peuvent décider l'inverse selon leur capacité libre", () => {
  /*
   * La conséquence qu'aucun modèle linéaire ne peut produire, et la raison d'être de la
   * marche : même mesure, mêmes hypothèses, place différente sur l'escalier.
   */
  const serree: Situation = { ...CAS, heuresLibres: 0 };
  const large: Situation = { ...CAS, heuresLibres: 5_000 };
  assert.ok(arbitrer(large).net.centre > arbitrer(serree).net.centre);
  assert.ok(arbitrer(serree).analystes.centre > arbitrer(large).analystes.centre);
});

test("la part de la fourchette qui penche pour le changement est bornée et orientée", () => {
  const d = desaccordReel(CAS);
  assert.ok(d.partPourLeChangement > 0 && d.partPourLeChangement < 1);
  /* Une conformité plus inquiète déplace la part vers zéro, jamais au-delà. */
  const inquiete: Situation = { ...CAS, croyance: { bas: 0.02, haut: 0.05 } };
  assert.equal(desaccordReel(inquiete).partPourLeChangement, 0);
  const confiante: Situation = { ...CAS, croyance: { bas: 0.0001, haut: 0.0005 } };
  assert.equal(desaccordReel(confiante).partPourLeChangement, 1);
});

test("l'intervalle tient sa promesse de couverture", () => {
  /*
   * La vérification qui compte : pas un exemple publié dont je me souviendrais, mais la
   * couverture mesurée. Graine fixe, donc le test ne clignote pas.
   */
  let g = 20260818;
  const rnd = () => { g = (g * 1664525 + 1013904223) >>> 0; return g / 4294967296; };
  const tirer = (n: number, p: number) => { let k = 0; for (let i = 0; i < n; i++) if (rnd() < p) k++; return k; };
  const pt = 0.26, pv = 0.281, n = 4_000, N = 600;
  let dedans = 0;
  for (let i = 0; i < N; i++) {
    const e = ecartConversion({
      ...CAS,
      test: { vus: { temoin: n, variante: n }, convertis: { temoin: tirer(n, pt), variante: tirer(n, pv) } },
    });
    if (e.bas <= pv - pt && pv - pt <= e.haut) dedans++;
  }
  const couverture = dedans / N;
  assert.ok(couverture > 0.92 && couverture < 0.98, `couverture ${(couverture * 100).toFixed(1)} % pour 95 % visés`);
});
