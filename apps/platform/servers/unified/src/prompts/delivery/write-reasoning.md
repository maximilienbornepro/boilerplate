# Skill — Delivery : rédiger les justifications de placement

## À propos de ce skill

- **Slug** : `delivery-write-reasoning`
- **Tier** : 2 du pipeline modulaire delivery (après le layout engine)
- **Rôle** : pour chaque mouvement décidé par le layout engine, écrire **une
  phrase ≤ 200 caractères** qui justifie le placement en citant explicitement
  les critères. Un seul appel LLM pour tout le lot.
- **Input** : un `plan` = tableau de mouvements avec **tous les faits déjà
  décidés** (statut, version, qualityFlags, from/to, isAddition).
- **Output** : tableau de `{taskId, reasoning}` dans le même ordre.
- **Aucune décision de placement ici** — le layout engine a déjà choisi.

## Ce que ta phrase DOIT citer (obligatoire)

Chaque `reasoning` doit **explicitement mentionner** les 4 critères suivants :

1. Le **statut** (`Done` / `En cours` / `Bloqué` / `À faire`, ou leur version
   traduite selon le `status` reçu).
2. La **version cible** et sa **catégorie** (`next` / `later` / `past` /
   `none`). Si `version: null` et `versionCategory: "none"`, dis-le explicitement
   (« sans version cible »).
3. La **qualité** : estimation présente/absente, description présente/absente.
4. La **raison du déplacement** : pourquoi la colonne `to.col` est meilleure
   que `from.col` (ex. « colle à aujourd'hui », « regroupe avec la release
   next », « repoussé en fin de board car aucun engagement »).

## Contraintes de forme

- **Longueur maximum : 200 caractères** par reasoning. Compte bien.
- **Une seule phrase** (évite les ruptures ou listes à puces).
- Vocabulaire **neutre** : pas « sprint Jira », préfère « itération active »
  ou le terme déjà présent dans `version`.
- **Varier la prose** entre tickets — ne répète pas exactement la même
  structure 10 fois de suite.

## Règle stricte : aucune invention

**Tous les faits** cités dans la phrase doivent provenir **exclusivement** de
l'objet d'entrée. Tu ne connais pas le titre détaillé, le responsable, ni
aucun autre champ que ceux présents dans le payload. Si un champ est `null`,
mentionne-le explicitement ou contourne.

Si `isAddition: true`, ouvre la phrase par « Ticket absent du board » ou
« Importé depuis l'itération active » pour clarifier que c'est une addition
(pas un repositionnement).

## Exemples

**Input** (1 entrée du `plan`) :
```json
{
  "taskId": "abc-1",
  "title": "Refactor login form",
  "status": "in_progress",
  "version": "v2.5",
  "versionCategory": "next",
  "qualityFlags": { "hasEstimation": true, "hasMeaningfulDescription": true },
  "from": { "col": 4 },
  "to": { "col": 1, "row": 0 },
  "isAddition": false
}
```

**Output** :
> `Statut "En cours" sur v2.5 (next), estimation + description renseignées — je l'ancre en S1 (aujourd'hui) pour refléter l'avancement, alors qu'elle était en S4.`

**Autre input** (addition sans version) :
```json
{
  "taskId": "DEV-42",
  "status": "todo",
  "version": null,
  "versionCategory": "none",
  "qualityFlags": { "hasEstimation": false, "hasMeaningfulDescription": false },
  "from": null,
  "to": { "col": 11, "row": 3 },
  "isAddition": true
}
```

**Output** :
> `Ticket absent du board, statut "À faire" sans version (none), ni estimation ni description — je l'ajoute en fin de board (S11) faute d'engagement de livraison proche.`

## Format de sortie (JSON strict, rien hors JSON)

```json
[
  { "taskId": "abc-1", "reasoning": "Statut …" },
  { "taskId": "DEV-42", "reasoning": "Ticket absent du board …" }
]
```

Retourne **une entrée par entrée du plan**, dans le **même ordre**. Si le
plan est vide, retourne `[]`.
