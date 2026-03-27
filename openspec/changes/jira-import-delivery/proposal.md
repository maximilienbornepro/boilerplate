## Pourquoi

Le module Delivery Board permet de suivre les tâches d'un incrément. Actuellement, les tâches sont créées manuellement. Or, les équipes utilisent Jira pour gérer leurs sprints. Il faut pouvoir importer les tickets Jira directement dans le board pour éviter la double saisie et garder la cohérence entre les deux outils.

## Ce qui change

- **Bouton "Importer depuis Jira"** dans l'en-tête du board, visible uniquement si le connecteur Jira est actif (OAuth ou Basic Auth)
- **Modale d'import Jira** en 2 étapes :
  - Étape 1 : Sélection des sprints (liste des projets Jira → sélection de sprints actifs/récents)
  - Étape 2 : Sélection des tickets (liste tous les tickets des sprints choisis, avec filtres)
- **Import en masse** : les tickets sélectionnés sont créés comme `Task` dans le delivery board
- **Endpoint backend** : proxy vers l'API Jira (projets, sprints, tickets) via `jiraAuth` (OAuth ou Basic)

## Existant (à réutiliser)

| Élément | Source | Usage |
|---------|--------|-------|
| `jiraAuth.ts` | `modules/jiraAuth.ts` | Auth headers (OAuth Bearer ou Basic) |
| `POST /delivery/api/tasks` | `delivery/routes.ts` | Créer les tâches importées |
| `Task` type | `delivery/types/index.ts` | Type cible pour les tickets importés |
| `Modal` | `@boilerplate/shared/components` | Base de la modale |
| `/api/connectors/jira/oauth-available` + `/api/auth/jira/status` | gateway | Vérifier si Jira est connecté |

## Scope (à implémenter)

**Fichiers à créer :**
- `delivery/components/JiraImportModal.tsx` — modale 2 étapes
- `delivery/components/JiraImportModal.module.css` — styles

**Fichiers à modifier :**
- `delivery/routes.ts` — 3 nouveaux endpoints proxy Jira
- `delivery/App.tsx` — ajouter le bouton + état connecteur Jira
- `delivery/services/api.ts` — fonctions d'appel aux nouveaux endpoints

## Hors scope

| Élément | Raison |
|---------|--------|
| Synchronisation bidirectionnelle | Complexité trop élevée pour une v1 |
| Mise à jour des tickets Jira depuis le board | Out of scope v1 |
| Import automatique / webhooks | Phase suivante |
| Mapping des statuts Jira → delivery | Mapping simple : tout importé en `todo` |

## Règles UI

- Le bouton "Importer depuis Jira" utilise le style existant du board (même famille que les boutons de snapshot)
- La modale utilise le composant `Modal` du shared design system
- Les tickets affichés dans la modale ont un style compact (ligne, pas de carte)
- Indicateur de chargement pendant les appels Jira
