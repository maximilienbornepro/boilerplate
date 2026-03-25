## 1. Schéma base de données

- [ ] 1.1 Créer `database/init/05_roadmap_schema.sql` avec les tables `roadmap_plannings`, `roadmap_tasks`, `roadmap_dependencies`, `roadmap_markers`

## 2. Module backend

- [ ] 2.1 Créer `modules/roadmap/dbService.ts` avec requêtes PostgreSQL (plannings CRUD, tâches CRUD avec hiérarchie, dépendances, marqueurs)
- [ ] 2.2 Créer `modules/roadmap/routes.ts` avec toutes les routes Express (plannings, tâches, dépendances, marqueurs, embed public)
- [ ] 2.3 Créer `modules/roadmap/index.ts` avec `initRoadmap()` et `createRoadmapRouter()`
- [ ] 2.4 Monter le module dans `servers/unified/src/index.ts` (initRoadmap + createRoadmapRouter sur `/roadmap/api`)

## 3. Types et utilitaires frontend

- [ ] 3.1 Créer `modules/roadmap/types/index.ts` avec Planning, Task, Dependency, Marker, ViewMode, TimeColumn, TaskPosition
- [ ] 3.2 Créer `modules/roadmap/utils/dateUtils.ts` — calculs de dates, positions, colonnes, business days (porté depuis delivery-process sans Jira)
- [ ] 3.3 Créer `modules/roadmap/utils/taskUtils.ts` — hiérarchie tâches, couleurs, flatten/collapse
- [ ] 3.4 Créer `modules/roadmap/services/api.ts` — toutes les fonctions API (plannings, tâches, dépendances, marqueurs)

## 4. Hooks d'interaction

- [ ] 4.1 Porter `hooks/useDragTask.ts` — drag horizontal des tâches (adapter imports/types)
- [ ] 4.2 Porter `hooks/useResizeTask.ts` — resize gauche/droite des tâches
- [ ] 4.3 Porter `hooks/useDependencyDraw.ts` — dessin de dépendances entre tâches
- [ ] 4.4 Porter `hooks/useDragMarker.ts` — drag des marqueurs sur la timeline

## 5. Composants frontend — Gantt

- [ ] 5.1 Créer `components/GanttBoard/GanttBoard.tsx` + CSS module — grille principale (colonne fixe + timeline scrollable + scroll sync)
- [ ] 5.2 Créer `components/GanttBoard/TaskBar.tsx` + CSS module — barre de tâche avec drag/resize handles
- [ ] 5.3 Créer `components/GanttBoard/DependencyLines.tsx` + CSS module — flèches SVG entre tâches
- [ ] 5.4 Créer `components/GanttBoard/TodayMarker.tsx` — ligne verticale aujourd'hui

## 6. Composants frontend — UI

- [ ] 6.1 Créer `components/PlanningList/PlanningList.tsx` + CSS module — liste et sélection des plannings
- [ ] 6.2 Créer `components/TaskForm/TaskForm.tsx` + CSS module — formulaire création/édition tâche
- [ ] 6.3 Créer `components/ViewSelector/ViewSelector.tsx` + CSS module — sélecteur pill Mois/Trim./Année

## 7. App principale

- [ ] 7.1 Créer `modules/roadmap/App.tsx` — composant principal avec mode embed, gestion d'état, tous les handlers
- [ ] 7.2 Créer `modules/roadmap/index.css` — styles globaux du module

## 8. Intégration boilerplate

- [ ] 8.1 Ajouter lazy import + route dans `router.tsx`
- [ ] 8.2 Ajouter le proxy `/roadmap-api` dans `vite.config.ts`
- [ ] 8.3 Ajouter `roadmap` aux `APPS` dans `SharedNav/constants.ts` (nom : "Roadmap")
- [ ] 8.4 Ajouter `roadmap` à `AVAILABLE_APPS` dans `gateway.ts`

## 9. Tests

- [ ] 9.1 Créer tests backend `modules/__tests__/roadmap/roadmap.test.ts`
- [ ] 9.2 Porter/adapter tests frontend `modules/roadmap/__tests__/dateUtils.test.ts`
- [ ] 9.3 Porter/adapter tests frontend `modules/roadmap/__tests__/taskUtils.test.ts`
- [ ] 9.4 Ajouter projets `server-roadmap` et `client-roadmap` dans `vitest.config.ts`
- [ ] 9.5 Ajouter scripts `test:server:roadmap` et `test:client:roadmap` dans `package.json`
- [ ] 9.6 Lancer `npm test` — tous les tests doivent passer

## 10. Nettoyage et vérification

- [ ] 10.1 Vérifier zéro référence à `delivery-process`, `france-tv`, `francetv`, `ftv`, `jira` dans tous les nouveaux fichiers
- [ ] 10.2 Vérifier que tous les imports utilisent `@boilerplate/shared` (pas `@delivery-process/shared`)
- [ ] 10.3 Vérifier que le CSS utilise uniquement les design tokens exacts de theme.css (`--accent-primary`, `--border-color`, `--border-light`, `--font-family-mono`, etc.)
