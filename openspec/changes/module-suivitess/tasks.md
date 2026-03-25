## 1. Schéma base de données

- [ ] 1.1 Créer `database/init/06_suivitess_schema.sql` avec les tables `suivitess_documents`, `suivitess_sections`, `suivitess_subjects`, `suivitess_snapshots`

## 2. Module backend

- [ ] 2.1 Créer `modules/suivitess/dbService.ts` — requêtes PostgreSQL (documents CRUD, sections CRUD + reorder, sujets CRUD + reorder + move, snapshots CRUD + restore, diff)
- [ ] 2.2 Créer `modules/suivitess/routes.ts` — routes Express (18 endpoints, sans Jira ni IA)
- [ ] 2.3 Créer `modules/suivitess/index.ts` — init + router exports
- [ ] 2.4 Monter le module dans `servers/unified/src/index.ts`

## 3. Types et services frontend

- [ ] 3.1 Créer `modules/suivitess/types/index.ts` — Document, Section, Subject, Snapshot, DiffChange, STATUS_OPTIONS
- [ ] 3.2 Créer `modules/suivitess/services/api.ts` — toutes les fonctions API (sans Jira ni IA)

## 4. Composants frontend

- [ ] 4.1 Porter `DocumentSelector` — liste et sélection des documents, création
- [ ] 4.2 Porter `ReviewWizard` — wizard multi-étapes avec édition inline des sujets
- [ ] 4.3 Porter `SubjectReview` — composant d'édition d'un sujet (retirer boutons Jira et IA)
- [ ] 4.4 Porter `Preview` — prévisualisation des modifications (retirer onglet résumé IA)
- [ ] 4.5 Porter `TableOfContents` — navigation et drag & drop
- [ ] 4.6 Porter `HistoryPanel` — snapshots et restauration

## 5. App principale

- [ ] 5.1 Créer `modules/suivitess/App.tsx` — composant principal avec gestion d'état
- [ ] 5.2 Créer `modules/suivitess/index.css` — styles globaux du module
- [ ] 5.3 Porter `hooks/useScrollFade.ts` si nécessaire

## 6. Intégration boilerplate

- [ ] 6.1 Ajouter lazy import + route dans `router.tsx`
- [ ] 6.2 Ajouter proxy `/suivitess-api` dans `vite.config.ts`
- [ ] 6.3 Ajouter `suivitess` aux `APPS` dans `SharedNav/constants.ts`
- [ ] 6.4 Ajouter `suivitess` à `AVAILABLE_APPS` dans `gateway.ts`

## 7. Tests

- [ ] 7.1 Créer tests backend `modules/__tests__/suivitess/suivitess.test.ts`
- [ ] 7.2 Créer tests frontend `modules/suivitess/__tests__/suivitess.test.ts`
- [ ] 7.3 Ajouter projets `server-suivitess` et `client-suivitess` dans `vitest.config.ts`
- [ ] 7.4 Ajouter scripts dans `package.json`
- [ ] 7.5 Lancer `npm test` — tous les tests doivent passer

## 8. Nettoyage et vérification

- [ ] 8.1 Vérifier zéro référence à delivery-process, france-tv, francetv, ftv, jira, anthropic
- [ ] 8.2 Vérifier imports `@boilerplate/shared`
- [ ] 8.3 Vérifier CSS design tokens
