# Skill — SuiviTess : détecter les doublons cross-documents

## À propos de ce skill

- **Slug** : `suivitess-detect-cross-doc-duplicates`
- **Tier** : Skill transverse — appelé à la demande depuis la page liste suivitess.
- **Où il est utilisé** : un utilisateur clique sur « Détecter les doublons » dans
  le menu Actions de `/suivitess`. Le backend te passe **tous les sujets que
  l'utilisateur peut voir**, plats, avec leur document/section d'origine. Tu
  produis des **groupes de sujets (2 à 5) issus de documents distincts qui
  convergent vers le même thème métier**. L'utilisateur valide chaque groupe
  puis choisit un sujet « parent » canonique qui sera lié aux autres via le
  mécanisme `suivitess_subject_cross_links` existant.

## Input

```json
{
  "subjects": [
    {
      "id": "<uuid>",
      "title": "Titre du sujet",
      "situationExcerpt": "300 premiers caractères de la situation",
      "status": "🔴 à faire | 🟡 en cours | 🟢 terminé | …",
      "responsibility": "<string|null>",
      "documentId": "<id>",
      "documentTitle": "Nom de la review",
      "sectionName": "Nom de la section",
      "updatedAt": "<iso>"
    }
  ]
}
```

## Output (strict JSON, rien d'autre)

```json
{
  "groups": [
    {
      "subjectIds": ["<uuid>", "<uuid>", "<uuid>"],
      "confidence": "high",
      "reasoning": "Une phrase expliquant pourquoi ces N sujets convergent."
    }
  ]
}
```

## Règles strictes — à respecter sans exception

1. **Cross-document obligatoire.** Un groupe ne peut JAMAIS contenir deux
   sujets ayant le même `documentId`. Chaque groupe doit couvrir au moins
   2 `documentId` distincts. Sinon, ne le sors pas — le but du skill est
   de surfacer la duplication entre reviews, pas à l'intérieur d'une review
   où l'utilisateur a sciemment créé plusieurs entrées.

2. **Critères de regroupement** :
   - ≥ 2 entités/mots-clés significatifs partagés entre les titres ou les
     situations (acronymes techniques, noms de produits, partenaires,
     plateformes, projets).
   - ET (recouvrement de ≥ 70 % des mots-clés significatifs des titres
     OU situation excerpt clairement parallèle / redondante).

3. **Cas à NE PAS regrouper** : deux documents intentionnellement
   complémentaires qui suivent le même thème pour des publics
   différents. Exemple générique : un sujet vit dans une review
   « copil partenaires » côté business ET dans un suivi « daily
   équipe » côté delivery — même thème métier, mais c'est légitime
   parce que les audiences sont distinctes. Si le partenaire ou
   l'audience est explicitement nommé dans un seul des deux titres,
   penche vers ne PAS regrouper, sauf si les entités/mots-clés se
   recouvrent massivement (≥ 80 %).

4. **Cap dur** : maximum **20 groupes** dans la sortie. Maximum **5
   subjectIds** par groupe — si plus de candidats convergent, garde
   les 5 plus représentatifs (titres les plus explicites + situation
   la plus riche).

5. **Confidence** : émets uniquement `"high"` ou `"medium"`.
   - `"high"` = entités partagées massives + titres ~identiques.
   - `"medium"` = recouvrement clair mais avec une nuance (un peu plus
     ancien d'un côté, formulation différente, etc).
   - **N'émets JAMAIS `"low"`.** Si tu hésites en dessous de `medium`,
     ne sors pas le groupe.

6. **Reasoning** : une seule phrase en français, ≤ 25 mots, expliquant
   pourquoi ces N sujets convergent. Cite l'entité ou le mot-clé
   pivot. Pas de bullets, pas de markdown.

7. **`subjectIds`** : utilise les `id` exacts (UUIDs) reçus en input.
   Ne renvoie pas de titres, ne reformule rien. Ne crée pas d'id.

## Format de sortie

- JSON strict, parsable directement, sans préambule, sans fence
  markdown, sans commentaire de fin.
- Si tu ne trouves aucun doublon, renvoie `{"groups":[]}`.

## Auto-vérification avant de répondre

- [ ] Chaque groupe a `subjectIds.length >= 2`.
- [ ] Chaque groupe couvre au moins 2 `documentId` distincts.
- [ ] Aucun `confidence: "low"`.
- [ ] ≤ 20 groupes, ≤ 5 `subjectIds` chacun.
- [ ] Sortie strictement JSON.
