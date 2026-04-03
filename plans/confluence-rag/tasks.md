# Tasks: confluence-rag

## 1. Base de données

- [x] 1.1 Créer `database/init/11_confluence_rag_schema.sql` — `CREATE EXTENSION IF NOT EXISTS vector`, tables `pages`, `chunks`, `conversations`, `messages`, `user_confluence_spaces`, `documents`
- [x] 1.2 Appliquer le schema SQL au container Docker en cours d'exécution

## 2. Backend — Services (portage depuis delivery-process)

- [x] 2.1 Créer `modules/confluence-rag/services/dbService.ts` — requêtes PostgreSQL + pgvector (pool partagé)
- [x] 2.2 Créer `modules/confluence-rag/services/embeddingService.ts` — multi-provider (Anthropic/Scaleway/Ollama) avec auto-détection dimension
- [x] 2.3 Créer `modules/confluence-rag/services/confluenceService.ts` — fetch pages Confluence via REST API
- [x] 2.4 Créer `modules/confluence-rag/services/postmanParser.ts` — parse collections Postman JSON en chunks
- [x] 2.5 Créer `modules/confluence-rag/services/indexingService.ts` — indexation async en background
- [x] 2.6 Créer `modules/confluence-rag/services/ragService.ts` — retrieval + streaming LLM (SSE)

## 3. Backend — Routes et init

- [x] 3.1 Créer `modules/confluence-rag/routes/chatRoutes.ts` — conversations CRUD + POST messages (SSE)
- [x] 3.2 Créer `modules/confluence-rag/routes/indexRoutes.ts` — spaces, trigger, status, upload
- [x] 3.3 Créer `modules/confluence-rag/index.ts` — `initConfluenceRag(pool)` + `createConfluenceRagRouter()`
- [x] 3.4 Créer `modules/__tests__/confluence-rag/confluence-rag.test.ts` — tests unitaires backend (parsing, chunking, JQL)

## 4. Configuration serveur

- [x] 4.1 Modifier `apps/platform/servers/unified/src/index.ts` — importer et monter le module `confluence-rag`
- [x] 4.2 Vérifier/ajouter `ANTHROPIC_API_KEY`, `CONFLUENCE_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` dans `.env.example`

## 5. Frontend — Types et API client

- [x] 5.1 Créer `modules/confluence-rag/types/index.ts` — `Conversation`, `Message`, `Source`, `StreamEvent`, `ConfluenceSpace`, `IndexingStatus`
- [x] 5.2 Créer `modules/confluence-rag/services/api.ts` — CRUD conversations, `streamMessage()` (parse SSE), upload, index trigger/status

## 6. Frontend — Composants

- [x] 6.1 Créer `components/ConversationList/ConversationList.tsx` + `.module.css` — sidebar avec liste et bouton "Nouvelle conversation"
- [x] 6.2 Créer `components/SpaceSelector/SpaceSelector.tsx` + `.module.css` — sélection d'espaces Confluence + déclenchement indexation
- [x] 6.3 Créer `components/IndexingStatus/IndexingStatus.tsx` + `.module.css` — barre de statut avec polling toutes les 3s
- [x] 6.4 Créer `components/ChatView/ChatView.tsx` + `.module.css` — zone de chat principale avec rendu Markdown, sources, streaming cursor

## 7. Frontend — App principale

- [x] 7.1 Créer `modules/confluence-rag/App.tsx` — layout 2 colonnes (ConversationList | ChatView) + ModuleHeader avec boutons Indexer/Upload
- [x] 7.2 Créer `modules/confluence-rag/App.css` — styles spécifiques au module

## 8. Tests frontend

- [x] 8.1 Créer `modules/confluence-rag/__tests__/confluence-rag.test.ts` — tests unitaires (parse SSE, mapping types, formatTitle)

## 9. Configuration plateforme

- [x] 9.1 Modifier `apps/platform/src/router.tsx` — ajouter lazy import + Route `/confluence-rag/*`
- [x] 9.2 Modifier `apps/platform/vite.config.ts` — ajouter proxy `/confluence-rag-api`
- [x] 9.3 Modifier `packages/shared/src/components/SharedNav/constants.ts` — ajouter l'app `confluence-rag` dans `APPS`
- [x] 9.4 Modifier `apps/platform/servers/unified/src/modules/gateway.ts` — ajouter `confluence-rag` dans `AVAILABLE_APPS`
- [x] 9.5 Modifier `vitest.config.ts` — ajouter projets `server-confluence-rag` et `client-confluence-rag`
- [x] 9.6 Modifier `package.json` — ajouter `test:server:confluence-rag` et `test:client:confluence-rag`

## 10. Vérification

- [x] 10.1 Vérifier que `npm test` passe (tous les projets)
- [x] 10.2 Vérifier le démarrage du serveur sans erreur (pgvector activé, pool partagé)
- [x] 10.3 Vérifier le module dans la nav et le chat en mode dégradé (sans Confluence configuré)
