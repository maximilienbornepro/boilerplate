## Pourquoi

Le boilerplate a besoin d'un module standalone de roadmap/planification avec diagramme de Gantt interactif. Permet à n'importe quelle équipe de créer des plannings, organiser des tâches hiérarchiques avec dépendances, et visualiser l'avancement sur une timeline. Module marque blanche, autonome, sans Jira ni référence de marque.

## Ce qui change

- **Nouveau module frontend** `roadmap` avec Gantt interactif (drag, resize, dépendances)
- **Nouveau module backend** `roadmap` avec API REST pour plannings, tâches, dépendances et marqueurs
- **Nouveau schéma base de données** pour plannings, tâches hiérarchiques, dépendances et marqueurs
- **Réutilisation du pattern calendrier** du module congés (colonne fixe, grille scrollable, scroll sync, today marker)
- **Tâches hiérarchiques** — parent/enfants avec calcul automatique des dates parent
- **Dépendances** — liens entre tâches avec rendu SVG (flèches)
- **Drag & drop** — déplacement et redimensionnement des barres de tâches
- **Marqueurs** — jalons positionnables sur la timeline (MEP, FAI, deadlines)
- **Mode embed** — vue publique en lecture seule d'un planning
- **3 modes de vue** — Mois, Trimestre, Année (pill selector comme congés)

## Capacités

### Nouvelles capacités
- `gantt-board` : Diagramme de Gantt interactif avec timeline scrollable, barres de tâches colorées, drag/resize, dépendances SVG, marqueurs et today marker
- `planning-management` : CRUD des plannings avec liste, sélection et navigation
- `task-management` : CRUD des tâches avec hiérarchie parent/enfants, couleurs, progression, tri
- `dependency-management` : Création/suppression de dépendances entre tâches avec rendu visuel
- `marker-management` : Jalons positionnables sur la timeline (drag & drop)

### Capacités modifiées
<!-- Aucune — nouveau module -->

## Existant (à réutiliser)

| Élément | Fichier/Source | Usage dans ce module |
|---------|---------------|----------------------|
| Layout | `@boilerplate/shared/components` | Wrapper de page |
| ModuleHeader | `@boilerplate/shared/components` | Header avec bouton retour |
| Modal, ConfirmModal | `@boilerplate/shared/components` | Formulaires et confirmations |
| Toast, ToastContainer | `@boilerplate/shared/components` | Notifications |
| LoadingSpinner | `@boilerplate/shared/components` | Chargement |
| useGatewayUser | `@boilerplate/shared/components` | Utilisateur courant |
| authMiddleware | `middleware/` | Protection des routes API |
| Architecture calendrier | Module congés | Pattern colonne fixe + grille scrollable + scroll sync |
| ViewControls (pill) | Module congés (pattern) | Sélecteur Mois/Trim./Année |

## Scope (à implémenter)

### Fichiers à créer

| Fichier | Description |
|---------|-------------|
| `database/init/05_roadmap_schema.sql` | Schéma SQL (4 tables) |
| Backend `modules/roadmap/index.ts` | Init + router exports |
| Backend `modules/roadmap/routes.ts` | Routes Express (plannings, tâches, dépendances, marqueurs) |
| Backend `modules/roadmap/dbService.ts` | Requêtes PostgreSQL |
| Frontend `modules/roadmap/App.tsx` | Composant principal |
| Frontend `modules/roadmap/types/index.ts` | Types TypeScript |
| Frontend `modules/roadmap/services/api.ts` | Appels API |
| Frontend `modules/roadmap/utils/dateUtils.ts` | Calculs de dates, positions, colonnes |
| Frontend `modules/roadmap/utils/taskUtils.ts` | Hiérarchie tâches, couleurs |
| Frontend `components/GanttBoard/GanttBoard.tsx` | Gantt principal (grille + tâches) |
| Frontend `components/GanttBoard/TaskBar.tsx` | Barre de tâche (drag/resize) |
| Frontend `components/GanttBoard/DependencyLines.tsx` | Flèches SVG entre tâches |
| Frontend `components/GanttBoard/TodayMarker.tsx` | Ligne verticale aujourd'hui |
| Frontend `components/PlanningList/PlanningList.tsx` | Liste/sélection des plannings |
| Frontend `components/TaskForm/TaskForm.tsx` | Formulaire création/édition tâche |
| Frontend `components/ViewSelector/ViewSelector.tsx` | Sélecteur de vue (pill) |
| Frontend `hooks/useDragTask.ts` | Hook drag horizontal des tâches |
| Frontend `hooks/useResizeTask.ts` | Hook resize gauche/droite |
| Frontend `hooks/useDependencyDraw.ts` | Hook dessin de dépendances |
| Frontend `hooks/useDragMarker.ts` | Hook drag des marqueurs |

### Fichiers à modifier

| Fichier | Modification |
|---------|--------------|
| `router.tsx` | Ajouter lazy import + route `/roadmap/*` |
| `vite.config.ts` | Ajouter proxy `/roadmap-api` |
| `SharedNav/constants.ts` | Ajouter app "Roadmap" |
| `gateway.ts` | Ajouter `roadmap` à AVAILABLE_APPS |
| `index.ts` (serveur) | Monter initRoadmap + createRoadmapRouter |
| `vitest.config.ts` | Ajouter projets de test |
| `package.json` | Ajouter scripts de test |

## Hors scope (exclus volontairement)

| Élément | Raison de l'exclusion |
|---------|----------------------|
| Intégration Jira | Retiré — module standalone sans dépendance externe |
| ReleaseBoard (versions MEP) | Spécifique Jira — retiré |
| GanttMepMarker / GanttFaiMarker | Spécifiques Jira — remplacés par des marqueurs génériques |
| Configuration Jira (rules) | Retiré |
| Prévisualisation HTML statique | Non nécessaire pour le boilerplate |

## Règles UI

- [x] `ModuleHeader` utilisé pour le header (JAMAIS de header custom)
- [x] Bouton "Retour" dans ModuleHeader via `onBack`
- [x] Boutons d'action dans ModuleHeader (+ Nouvelle tâche, Plannings, etc.)
- [x] ViewSelector style pill (comme module congés)
- [x] Tous les tokens CSS du design system (`--accent-primary`, `--border-color`, etc.)

## Impact

- **Frontend** : Nouveau module dans `apps/platform/src/modules/roadmap/`
- **Backend** : Nouveau module dans `apps/platform/servers/unified/src/modules/roadmap/`
- **Base de données** : `database/init/05_roadmap_schema.sql` (4 tables)
- **Configuration** : Mises à jour router, vite, nav, gateway, vitest, package.json
- **Dépendances** : Aucune externe — utilise uniquement les composants partagés du boilerplate et PostgreSQL

## Critères d'acceptation

1. Le Gantt affiche les tâches sur une timeline avec barres colorées
2. Drag & drop des tâches pour changer les dates
3. Resize des barres (bord gauche/droit) pour ajuster durée
4. Dépendances entre tâches avec flèches SVG
5. Tâches hiérarchiques (parent/enfants)
6. Marqueurs (jalons) positionnables
7. CRUD complet plannings + tâches + dépendances + marqueurs
8. Mode embed public en lecture seule
9. Aucune référence à `delivery-process`, `france-tv`, `francetv`, `ftv`, `jira`
10. Tous les imports utilisent `@boilerplate/shared`
11. CSS utilise uniquement les design tokens du boilerplate
12. Tests unitaires présents (backend + frontend)
13. `npm test` passe
