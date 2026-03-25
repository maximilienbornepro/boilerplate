## Pourquoi

Le boilerplate a besoin d'un module standalone de suivi de sujets/points structurés par documents, sections et sujets. Permet de gérer des documents vivants avec historique (snapshots), diff entre versions, et workflow de revue. Module marque blanche, sans Jira ni IA externe.

## Ce qui change

- **Nouveau module frontend** `suivitess` avec gestion de documents structurés (sections/sujets)
- **Nouveau module backend** `suivitess` avec API REST complète (documents, sections, sujets, snapshots, diff)
- **Nouveau schéma base de données** pour documents, sections, sujets et snapshots
- **Système de snapshots** — versioning complet avec sauvegarde JSONB et restauration
- **Moteur de diff** — comparaison entre état courant et dernier snapshot
- **Workflow de revue** — wizard multi-étapes (sélection → édition → prévisualisation)
- **Table des matières** — navigation avec drag & drop pour réordonner sections et sujets
- **Panel historique** — liste des snapshots avec restauration

## Capacités

### Nouvelles capacités
- `document-management` : CRUD documents avec sections imbriquées et sujets, statuts emoji, responsabilités, réordonnement drag & drop
- `snapshot-versioning` : Création de snapshots manuels, historique, restauration, diff entre versions
- `review-workflow` : Wizard de revue multi-étapes avec édition en temps réel, prévisualisation et table des matières

### Capacités modifiées
<!-- Aucune — nouveau module -->

## Existant (à réutiliser)

| Élément | Fichier/Source | Usage |
|---------|---------------|-------|
| Layout | `@boilerplate/shared/components` | Wrapper de page |
| ModuleHeader | `@boilerplate/shared/components` | Header avec bouton retour |
| Toast, ToastContainer | `@boilerplate/shared/components` | Notifications |
| authMiddleware | `middleware/` | Protection des routes API |

## Hors scope (exclus volontairement)

| Élément | Raison |
|---------|--------|
| Intégration Jira | Module standalone, pas de dépendance externe |
| IA (reformulation, réécriture) | Dépendance Anthropic SDK retirée — pourra être ajoutée plus tard comme capacité optionnelle |
| Génération de résumé IA | Idem |
| Tables legacy (review_sessions, subject_changes, new_subjects) | Nettoyage — seuls documents/sections/subjects/snapshots sont nécessaires |

## Règles UI

- [x] `ModuleHeader` utilisé pour le header
- [x] Bouton "Retour" dans ModuleHeader via `onBack`
- [x] Tous les tokens CSS du design system

## Impact

- **Frontend** : `apps/platform/src/modules/suivitess/`
- **Backend** : `apps/platform/servers/unified/src/modules/suivitess/`
- **Base de données** : `database/init/06_suivitess_schema.sql` (4 tables)
- **Configuration** : router, vite, nav, gateway, vitest, package.json

## Critères d'acceptation

1. CRUD complet documents/sections/sujets
2. Snapshots avec restauration
3. Diff entre versions
4. Workflow de revue multi-étapes
5. Table des matières avec drag & drop
6. Panel historique
7. Aucune référence à delivery-process, france-tv, jira, anthropic
8. Tests unitaires
9. `npm test` passe
