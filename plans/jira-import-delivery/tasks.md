# Tasks: jira-import-delivery

## 1. Backend — Endpoints proxy Jira

- [x] 1.1 Ajouter `GET /jira/projects` dans `delivery/routes.ts` — proxy vers l'API Jira via `jiraAuth`
- [x] 1.2 Ajouter `GET /jira/sprints?projectKey=XXX` dans `delivery/routes.ts` — proxy vers l'API Agile Jira
- [x] 1.3 Ajouter `GET /jira/issues?sprintIds=1,2` dans `delivery/routes.ts` — proxy JQL vers l'API Jira
- [x] 1.4 Gérer le cas `getJiraContext()` retourne `null` → répondre `401` avec message explicite

## 2. Frontend — Fonctions API

- [x] 2.1 Ajouter `checkJiraConnected()` dans `delivery/services/api.ts` — agrège statut OAuth + Basic
- [x] 2.2 Ajouter `fetchJiraProjects()` dans `delivery/services/api.ts`
- [x] 2.3 Ajouter `fetchJiraSprints(projectKey)` dans `delivery/services/api.ts`
- [x] 2.4 Ajouter `fetchJiraIssues(sprintIds)` dans `delivery/services/api.ts`

## 3. Frontend — Composant JiraImportModal

- [x] 3.1 Créer `delivery/components/JiraImportModal.tsx` — structure modale 2 étapes
- [x] 3.2 Implémenter l'étape 1 : liste des projets + sélection des sprints
- [x] 3.3 Implémenter l'étape 2 : liste des tickets avec cases à cocher + filtres
- [x] 3.4 Implémenter la logique d'import : `Promise.all` sur `createTask()` pour les tickets sélectionnés
- [x] 3.5 Créer `delivery/components/JiraImportModal.module.css` — styles compacts (ligne, pas de carte)

## 4. Frontend — Intégration dans App.tsx

- [x] 4.1 Ajouter l'état `jiraConnected` dans `delivery/App.tsx`
- [x] 4.2 Appeler `checkJiraConnected()` au mount et stocker dans le state
- [x] 4.3 Afficher le bouton "Importer depuis Jira" dans l'en-tête conditionnel à `jiraConnected`
- [x] 4.4 Connecter le bouton à l'ouverture de `JiraImportModal`

## 5. Tests

- [x] 5.1 Ajouter les tests backend dans `__tests__/delivery/jira-proxy.test.ts` — 3 endpoints, cas d'erreur 401
- [x] 5.2 Ajouter les tests frontend dans `__tests__/delivery.test.ts` — mapping des types, logique de visibilité du bouton
- [x] 5.3 Vérifier que `npm test` passe (tous les projets vitest)
