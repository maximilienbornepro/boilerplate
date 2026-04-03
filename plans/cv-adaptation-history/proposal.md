## Why

L'utilisateur peut adapter son CV à une offre d'emploi, mais chaque adaptation écrase la précédente et il n'existe aucune trace des adaptations réalisées, de leur score ATS ni de l'offre qui les a générées. Il faut un historique dédié par CV, non destructif sur le CV original.

## What Changes

- Nouvelle table `cv_adaptations` en base de données : stocke l'adaptation générée, l'offre, le score ATS avant/après, les changements et le `jobAnalysis`
- Routes backend CRUD pour les adaptations (`/cvs/:id/adaptations`, `/adaptations/:id`)
- L'endpoint `/cv/adapt` sauvegarde automatiquement chaque adaptation générée
- Nouveau composant `AdaptationsPage` : liste toutes les adaptations d'un CV avec score, date, aperçu de l'offre
- Composant `AdaptationDetailPage` : voir, éditer et télécharger une adaptation sauvegardée
- Le CV original n'est jamais modifié par une adaptation — l'adaptation est une entité séparée
- Le bouton "Valider" dans `AdaptCVPage` crée une adaptation persistée au lieu de muter le CV de base

## Capabilities

### New Capabilities
- `cv-adaptation-history`: Historique des adaptations par CV — CRUD, consultation, édition du contenu adapté, téléchargement PDF, score ATS par adaptation

### Modified Capabilities
- (aucune modification de spec existante)

## Impact

- DB : nouveau fichier SQL `05_cv_adaptations_schema.sql`
- Backend : `mon-cv/adaptService.ts` (inchangé), nouveau `adaptationDbService.ts`, `routes.ts` (nouvelles routes)
- Frontend : `services/api.ts` (nouvelles fonctions), nouveaux composants `AdaptationsPage`, `AdaptationDetailPage`
- `AdaptCVPage` : le "Valider" persiste l'adaptation au lieu de mettre à jour le CV de base
