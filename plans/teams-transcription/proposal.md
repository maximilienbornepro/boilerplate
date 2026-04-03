## Why

Pendant une réunion Teams, l'utilisateur prend des notes dans suivitess mais rate inévitablement des informations. En envoyant un agent enregistreur au call via son lien, le système peut produire une transcription complète et proposer automatiquement des compléments aux notes de l'utilisateur — sans interrompre sa prise de notes.

## What Changes

- Ajout d'un champ "Lien Teams" et d'un bouton **"Enregistrer le call"** dans l'en-tête du document suivitess
- Envoi d'un agent (via Recall.ai) au meeting Teams : l'agent rejoint le call, enregistre et transcrit
- Badge de statut en temps réel dans suivitess (en attente, en cours, terminé)
- Après le call : comparaison IA entre la transcription et les notes prises dans suivitess
- Affichage des **propositions de complétion** par l'IA : sujets manquants, points à ajouter, décisions oubliées
- L'utilisateur accepte ou rejette chaque proposition — les acceptées sont ajoutées au document

## Capabilities

### New Capabilities

- `meeting-recorder` : Enregistrement d'un call Teams via lien — l'utilisateur colle un lien Teams dans le document suivitess courant, un agent rejoint le call via Recall.ai, enregistre et transcrit en temps réel, notifie le backend via webhook à la fin
- `transcript-ai-suggestions` : Comparaison IA entre transcription et notes suivitess — après réception de la transcription, Claude compare le contenu du document avec le transcript et génère des propositions de mise à jour (sujets manquants, situations à compléter, décisions à ajouter)
- `suggestions-review` : Interface de révision des suggestions IA — panneau latéral affichant les propositions, bouton Accepter/Rejeter par suggestion, application des acceptées dans le document

### Modified Capabilities

_(aucun changement dans les specs existantes)_

## Impact

**Frontend :**
- `apps/platform/src/modules/suivitess/` — champ lien Teams + bouton enregistrement + badge statut + panneau suggestions dans l'interface du document

**Backend :**
- Nouvelles routes dans `/suivitess-api/` :
  - `POST /documents/:docId/recorder/start` — démarre l'enregistrement via Recall.ai
  - `GET /documents/:docId/recorder/status` — statut de l'enregistrement
  - `POST /suivitess-api/recorder/webhook` — endpoint public pour le callback Recall.ai (signature vérifiée)
  - `GET /documents/:docId/suggestions` — récupère les suggestions IA générées post-call
  - `POST /documents/:docId/suggestions/:id/accept` — applique une suggestion dans le document
  - `POST /documents/:docId/suggestions/:id/reject` — marque la suggestion comme rejetée
- Nouvelle table SQL `suivitess_recordings` — historique des enregistrements et leur statut
- Nouvelle table SQL `suivitess_suggestions` — suggestions IA en attente de révision

**Dépendances :**
- Service Recall.ai (API SaaS, ~50$/mois) — aucun package npm, appels REST directs
- Claude API (déjà utilisée dans le module RAG) — pour la comparaison IA

**Variables d'environnement :**
- `RECALL_AI_API_KEY` — clé API Recall.ai
- `RECALL_AI_WEBHOOK_SECRET` — pour vérifier la signature des webhooks

**Out of Scope :**
- Support Zoom, Google Meet (Recall.ai le supporte mais hors V1)
- Synchronisation en temps réel de la transcription pendant le call (V2)
- Résumé automatique complet sans révision (l'humain garde le contrôle)
- Support des comptes Microsoft/OAuth Teams (pas nécessaire avec Recall.ai)
