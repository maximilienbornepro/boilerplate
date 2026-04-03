## Pourquoi

Les équipes utilisent Confluence comme base documentaire principale et Teams/Postman pour les APIs. Retrouver une information précise dans des centaines de pages Confluence est lent et frustrant. Un assistant RAG (Retrieval-Augmented Generation) permet de poser des questions en langage naturel et d'obtenir des réponses sourcées depuis la documentation interne.

Le projet `delivery-process` contient déjà une implémentation complète et éprouvée de ce RAG. Il faut le porter dans le boilerplate comme module de première classe — pas comme widget flottant, mais comme page dédiée en plein écran, accessible depuis la navigation principale.

## Ce qui change

- **Nouveau module `confluence-rag`** : chat full-screen avec historique de conversations dans la sidebar
- **Recherche sémantique** via pgvector sur des chunks Confluence + collections Postman
- **Streaming SSE** des réponses LLM (Claude / Scaleway / Ollama configurable)
- **Indexation par espace** : chaque utilisateur sélectionne ses espaces Confluence à indexer
- **Upload de collections Postman** : enrichit la base de connaissance avec la doc API
- **Gestion du statut d'indexation** : progress bar et déclenchement manuel

## Existant (à réutiliser)

| Élément | Source | Usage |
|---------|--------|-------|
| `confluence-rag/services/ragService.ts` | `delivery-process` | Retrieval + streaming LLM |
| `confluence-rag/services/embeddingService.ts` | `delivery-process` | Génération d'embeddings multi-provider |
| `confluence-rag/services/confluenceService.ts` | `delivery-process` | Appels API Confluence |
| `confluence-rag/services/indexingService.ts` | `delivery-process` | Indexation des documents |
| `confluence-rag/services/dbService.ts` | `delivery-process` | Requêtes PostgreSQL + pgvector |
| `confluence-rag/services/postmanParser.ts` | `delivery-process` | Parsing collections Postman |
| `confluence-rag/routes/chatRoutes.ts` | `delivery-process` | Endpoints chat + SSE |
| `confluence-rag/routes/indexRoutes.ts` | `delivery-process` | Endpoints indexation |
| `ChatView` component | `delivery-process` | Interface chat full-page |
| `ConversationList` component | `delivery-process` | Sidebar historique |
| `SpaceSelector` component | `delivery-process` | Sélection espaces Confluence |
| `IndexingStatus` component | `delivery-process` | Statut d'indexation |
| `10_confluence_rag_schema.sql` | `delivery-process` | Schema SQL + pgvector |
| `Layout`, `ModuleHeader` | `@boilerplate/shared/components` | Structure page |

## Scope (à implémenter)

**Fichiers à créer (backend) :**
- `modules/confluence-rag/index.ts` — init + router exports
- `modules/confluence-rag/routes/chatRoutes.ts` — chat + SSE (porté)
- `modules/confluence-rag/routes/indexRoutes.ts` — indexation (porté)
- `modules/confluence-rag/services/ragService.ts` — retrieval + LLM (porté)
- `modules/confluence-rag/services/embeddingService.ts` — embeddings (porté)
- `modules/confluence-rag/services/confluenceService.ts` — API Confluence (porté)
- `modules/confluence-rag/services/indexingService.ts` — indexation (porté)
- `modules/confluence-rag/services/dbService.ts` — DB queries (porté)
- `modules/confluence-rag/services/postmanParser.ts` — parser (porté)
- `modules/__tests__/confluence-rag/confluence-rag.test.ts` — tests unitaires

**Fichiers à créer (frontend) :**
- `modules/confluence-rag/App.tsx` — module principal
- `modules/confluence-rag/App.css` — styles module
- `modules/confluence-rag/types/index.ts` — types TypeScript
- `modules/confluence-rag/services/api.ts` — appels API + SSE
- `modules/confluence-rag/components/ChatView/ChatView.tsx` + `.module.css`
- `modules/confluence-rag/components/ConversationList/ConversationList.tsx` + `.module.css`
- `modules/confluence-rag/components/SpaceSelector/SpaceSelector.tsx` + `.module.css`
- `modules/confluence-rag/components/IndexingStatus/IndexingStatus.tsx` + `.module.css`
- `modules/confluence-rag/__tests__/confluence-rag.test.ts` — tests unitaires

**Fichiers SQL :**
- `database/init/11_confluence_rag_schema.sql` — tables + extension pgvector

**Fichiers à modifier :**
- `apps/platform/src/router.tsx` — ajouter la route `/confluence-rag`
- `apps/platform/vite.config.ts` — ajouter le proxy `/confluence-rag-api`
- `apps/platform/servers/unified/src/index.ts` — monter le module
- `packages/shared/src/components/SharedNav/constants.ts` — ajouter l'app dans la nav
- `apps/platform/servers/unified/src/modules/gateway.ts` — ajouter `confluence-rag` dans `AVAILABLE_APPS`
- `vitest.config.ts` — ajouter projets `server-confluence-rag` et `client-confluence-rag`
- `package.json` — ajouter scripts de test

## Hors scope

| Élément | Raison |
|---------|--------|
| Widget flottant (`WikiChatWidget`) | Remplacé par le module full-screen |
| Synchronisation automatique (webhook Confluence) | Phase 2 |
| Indexation multi-utilisateurs simultanée | Complexité, phase 2 |
| Support d'autres sources (Notion, SharePoint) | Phase 2 |
| Interface d'administration des embeddings | Hors scope v1 |

## Règles UI

- `ModuleHeader` avec titre "Assistant documentaire" + boutons d'action (Indexer, Uploader)
- Chat en layout 2 colonnes : sidebar conversations (gauche) + zone de chat (droite)
- Pas de modal pour le chat — tout est dans la page principale
- Indicateur de streaming (cursor animé pendant la génération)
- Sources affichées sous chaque réponse (liens cliquables vers Confluence)
- Markdown rendu dans les réponses de l'assistant
