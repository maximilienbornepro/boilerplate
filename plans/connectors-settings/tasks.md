## 1. Base de données

- [x] 1.1 Créer `database/init/09_connectors_schema.sql` avec table `user_connectors`

## 2. Backend

- [x] 2.1 Créer `modules/connectors/dbService.ts` — CRUD + sanitization des tokens
- [x] 2.2 Créer `modules/connectors/routes.ts` — GET, PUT, DELETE, POST test
- [x] 2.3 Créer `modules/connectors/index.ts` — init + router
- [x] 2.4 Monter sur `/api/connectors` dans index.ts serveur

## 3. Frontend

- [x] 3.1 Créer `ConnectorsPage.tsx` + CSS — cards Jira/Notion/ClickUp, formulaire Jira
- [x] 3.2 Ajouter route `/settings/connectors` dans router.tsx
- [x] 3.3 Ajouter bouton "Connecteurs" dans la navigation

## 4. Tests

- [x] 4.1 Tests backend connectors
- [x] 4.2 Tests frontend connectors
- [x] 4.3 Config vitest + package.json

## 5. Vérification

- [x] 5.1 `npm test` passe (299/299)
