# Règles de placement — Delivery Layout Engine

> Ce document est la **vue humaine** des règles déterministes appliquées par
> le layout engine du module delivery. Il accompagne le code
> `servers/unified/src/modules/delivery/deliveryLayoutEngine.ts` et est
> tenu à jour à la main ; les tests unitaires
> (`deliveryLayoutEngine.test.ts`) sont le filet de sécurité contre la
> désynchro.
>
> **Source de vérité** : le code. Si une ligne de ce doc contredit
> le code, c'est le doc qui a tort — signaler au reviewer.
>
> **Quand l'IA intervient / quand elle n'intervient pas** :
> - **Tier 1 (LLM)** — évalue la qualité de chaque ticket (estimation
>   présente, description utile, prêt à être travaillé) → ne décide
>   d'aucun placement.
> - **Layout engine (ce document)** — pur TypeScript, décide du placement
>   colonne / ligne pour tous les tickets, en se basant sur statut +
>   version cible + estimation + position actuelle.
> - **Tier 2 (LLM)** — rédige une phrase de justification par ticket
>   déplacé → ne décide d'aucun placement.

---

## Vue d'ensemble — ordre d'application

Pour chaque ticket, dans cet ordre :

1. **Filtre abandonnés** → si le statut est abandonné/annulé, le ticket
   est exclu du board (cf. §1).
2. **Règle passé-seulement pour review/livraison** → si le statut est
   « En revue » / « En livraison » / QA / Test / Validation, placement
   forcé avant la barre aujourd'hui (cf. §2).
3. **Sinon, placement par catégorie de statut** (done / in_progress /
   blocked / todo) + catégorie de version (cf. §3-5).
4. **Contrainte in_progress couvre aujourd'hui** → si in_progress ou
   blocked, on garantit que le ticket chevauche la barre aujourd'hui
   (cf. §6).
5. **Largeur** calculée depuis l'estimation (cf. §7).
6. **Empilement des lignes** dans chaque colonne cible (cf. §8).
7. **Skip no-op** → si la cible calculée = position actuelle, pas de
   proposition de déplacement (cf. §9).

---

## §1 · Filtre tickets abandonnés

**Fonction TS** : `isAbandonedStatus(status)`

Un ticket avec l'un de ces statuts **n'apparaît jamais** sur un board
delivery (ni en reposition, ni en addition depuis le sprint) :

- `Abandoned`, `Abandonné`, `Abandonne`
- `Cancelled`, `Canceled`, `Annulé`, `Annule`
- `Won't Do`, `Wont Do`, `Won't Fix`, `Wont Fix`
- `Obsolete`
- `Rejected`, `Rejeté`, `Rejete`
- `Duplicate`, `Dupliqué`, `Duplique`

**Pourquoi strict** : un faux-positif fait disparaître du travail
silencieusement. On privilégie la liste explicite à un regex permissif.

**Où c'est appliqué** : à deux niveaux.
1. Dans `routes.ts`, au moment où on va chercher les tickets du sprint →
   les abandonnés ne sont même pas candidats à l'addition.
2. Dans `computeBoardPlan()`, en ceinture → si un ticket déjà sur le
   board devient abandonné côté Jira, il est retiré des propositions.

---

## §2 · Règle passé-seulement — review / livraison

**Fonction TS** : `isReviewOrDeliveryStatus(status)`

Un ticket avec l'un de ces statuts est considéré **essentiellement
terminé** et ne peut donc jamais se retrouver dans le futur :

- `Review`, `Code Review`, `En revue`, `Revue`
- `Livraison`, `En livraison`, `Delivery`
- `QA`
- `Testing`, `Test`, `En test`, `In Test`
- `Validation`, `En validation`, `Validated`
- `Verified`, `Vérifié`, `Verifie`
- `UAT`
- `Staging`, `Pré-prod`, `Pre-prod`
- `Ready to deploy`, `Prêt à déployer`

**Règles de placement** :

| État actuel du ticket | Action |
|---|---|
| `endCol ≤ todayCol` (strictement avant la barre aujourd'hui) | **Aucun déplacement** — on le laisse là où il est. |
| `endCol > todayCol` (sur la barre aujourd'hui ou au-delà) | **Snap** à la semaine juste avant la barre — `endCol = todayCol`, largeur préservée depuis l'estimation. |

**S'applique à** :
- Tickets déjà sur le board (reposition).
- Tickets ajoutés depuis le sprint (additions) — placement direct.

---

## §3 · Catégorie de statut

**Fonction TS** : `statusCategory(status)`

Mapping des libellés Jira / ClickUp / Linear vers 4 buckets :

| Catégorie | Regex |
|---|---|
| `done` | `done`, `terminé`, `termine`, `closed`, `resolved`, `fini` |
| `blocked` | `blocked`, `bloqué`, `bloque`, `blocker`, `impediment` |
| `in_progress` | `progress`, `en cours`, `doing`, `review`, `qa`, `testing`, `test` |
| `todo` | par défaut (tout label inconnu) |

**Note** : `review`, `qa`, `testing` sont *aussi* dans `in_progress`
mais le §2 les capture **avant** — la règle passé-seulement prime.

---

## §4 · Catégorie de version cible

**Fonctions TS** : `categorizeVersions()` / `categoryOf()`
(dans `deliveryAISanityService.ts`)

Chaque ticket a une version cible (ex : « v1.42 ») classée en :

| Catégorie | Sens | Critère |
|---|---|---|
| `next` | version la plus proche dans le futur | la release date la plus proche ≥ aujourd'hui |
| `later` | versions suivantes | release dates après `next` |
| `past` | déjà sortie | release date passée |
| `none` | pas de version | champ vide |

Utilisé par §5 pour placer les tickets `todo`.

---

## §5 · Choix de la colonne cible

**Fonction TS** : `chooseStartCol(statusCat, versionCat, todayCol, totalCols, width)`

Pour les tickets qui n'ont **pas** été captés par §1 ou §2 :

| Catégorie statut | Colonne cible |
|---|---|
| `done` | `todayCol - 1` (juste avant la barre aujourd'hui) |
| `in_progress` / `blocked` | Centré autour de `todayCol` (§6 garantit l'overlap) |
| `todo` + version `next` | Juste après la barre aujourd'hui |
| `todo` + version `later` | Vers la droite (semaines futures) |
| `todo` + version `past` | `todayCol - 1` (à traiter d'urgence, normalement impossible) |
| `todo` + version `none` | Dernière colonne visible |

Toujours clampé dans `[0, totalCols - width]`.

---

## §6 · Contrainte « in_progress couvre aujourd'hui »

**Fonction TS** : `ensureOverlapsToday(startCol, width, todayCol, totalCols)`

Tout ticket `in_progress` ou `blocked` **DOIT** chevaucher la colonne
`todayCol`, quelle que soit sa largeur :

- Si `endCol ≤ todayCol` → décalé à droite pour que `endCol = todayCol + 1`.
- Si `startCol > todayCol` → décalé à gauche pour que `startCol = todayCol`.
- Sinon → laissé tel quel.

Toujours clampé dans la grille.

**Pourquoi cette règle** : un ticket marqué « en cours » ne peut pas
visuellement être « plus tard » ou « déjà fait » — il est, par
définition, aujourd'hui.

---

## §7 · Largeur depuis l'estimation

**Fonction TS** : `widthFromEstimation(estimatedDays, storyPoints)`

| Estimation (jours) | Largeur (colonnes) |
|---|---|
| 0.5 – 5 | 1 |
| 5.1 – 10 | 2 |
| 10.1 – 15 | 3 |
| 15.1 – 20 | 4 |
| … | `ceil(days / 5)` |

**Fallback** : si pas de jours, on prend les story points comme
équivalent (1 SP ≈ 1 jour). Si ni jours ni SP, on **garde la largeur
actuelle** du ticket (pas de proposition de largeur).

Toujours clampé à `totalCols`.

---

## §8 · Empilement des lignes dans une colonne

**Fonction TS** : `packRows(bucket)`

Plusieurs tickets visent la même colonne cible → on les empile :

1. Trier par : `ready` en premier (prêts à travailler), puis par
   estimation croissante.
2. Affecter `row = 0` au premier, puis incrémenter pour chaque
   conflit d'overlap (tickets qui se chevauchent en colonnes).

Les additions venant du sprint sont placées **après** tous les tickets
repositionnés de la même colonne (baseRow = max des rows existantes + 1).

---

## §9 · Skip no-op

**Fonction TS** : `computeBoardPlan` — bloc « no-op moves »

Si la cible calculée (`startCol`, `endCol`, `row`) est **identique** à
la position actuelle, on ne produit pas de proposition de déplacement
et on ajoute le ticket à `skipped` avec la raison `'already well placed'`.

**Pourquoi** : éviter le bruit dans la modale — l'utilisateur ne voit
que les tickets qui doivent vraiment bouger.

---

## §10 · Plafonds de sécurité

**Dans `reorganizeBoardPipeline.ts`** :

| Limite | Valeur | Ce qui est plafonné |
|---|---|---|
| `MAX_TASKS` | 50 | Tickets existants analysés (tri trivial : ordre du board) |
| `MAX_MOVES` | 25 | Repositionnements retournés à l'UI |
| `MAX_ADDITIONS` | 15 | Tickets ajoutés depuis le sprint |
| `MAX_MISSING` | 30 | Tickets candidats à l'addition depuis le sprint |

Les tickets rejetés par plafond ne sont pas supprimés — ils ne sont
juste pas inclus dans la proposition actuelle. Relancer la vérif après
avoir appliqué une partie des déplacements traitera le reste.

---

## Évolution des règles

Quand tu modifies une règle :

1. Modifier la fonction TS dans `deliveryLayoutEngine.ts`.
2. Mettre à jour **ce document** (même commit).
3. Ajouter / ajuster un test unitaire dans `deliveryLayoutEngine.test.ts`.
4. Les tests servent de filet — si un test pin une valeur (ex :
   `widthFromEstimation(5, null) === 1`), changer le seuil sans
   toucher le test **cassera la build**. Tu verras l'incohérence.

Les changements qui n'ont pas de test correspondant devraient en avoir un.
