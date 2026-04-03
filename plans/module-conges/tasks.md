## 1. Schéma base de données

- [ ] 1.1 Créer `database/init/04_conges_schema.sql` avec les tables `conges_user_preferences` et `conges_leaves` (dans la base `app`)

## 2. Module backend

- [ ] 2.1 Créer `modules/conges/index.ts` avec les exports `initConges()` et `createCongesRouter()`
- [ ] 2.2 Créer `modules/conges/dbService.ts` avec les requêtes PostgreSQL (membres depuis gateway users + préférences, CRUD congés)
- [ ] 2.3 Créer `modules/conges/routes.ts` avec les routes Express : GET /members, PUT /members/:id, GET /leaves, POST /leaves, PUT /leaves/:id, DELETE /leaves/:id
- [ ] 2.4 Monter le module dans `servers/unified/src/index.ts` (initConges + createCongesRouter sur `/conges/api`)

## 3. Types et services frontend

- [ ] 3.1 Créer `modules/conges/types/index.ts` avec les types Member, Leave, LeaveFormData et ViewMode
- [ ] 3.2 Créer `modules/conges/services/api.ts` avec fetchMembers, updateMember, fetchLeaves, createLeave, updateLeave, deleteLeave

## 4. Composants frontend

- [ ] 4.1 Porter `LeaveCalendar` et `LeaveBar` — adapter le CSS aux design tokens du boilerplate
- [ ] 4.2 Porter `LeaveForm` — adapter aux composants Modal/shared du boilerplate
- [ ] 4.3 Porter `MemberList` — adapter au style Modal du boilerplate
- [ ] 4.4 Porter `ViewControls` — adapter le styling
- [ ] 4.5 Créer `modules/conges/App.tsx` composant principal avec Layout, imports depuis `@boilerplate/shared`
- [ ] 4.6 Créer `modules/conges/index.css` — tous les styles avec design tokens du boilerplate, aucune couleur en dur

## 5. Intégration boilerplate

- [ ] 5.1 Ajouter lazy import + route dans `router.tsx`
- [ ] 5.2 Ajouter le proxy `/conges-api` dans `vite.config.ts`
- [ ] 5.3 Ajouter `conges` aux `APPS` dans `SharedNav/constants.ts` (nom : "Congés")
- [ ] 5.4 Ajouter `conges` à `AVAILABLE_APPS` dans `gateway.ts`

## 6. Tests

- [ ] 6.1 Créer les tests backend `modules/__tests__/conges/conges.test.ts`
- [ ] 6.2 Créer les tests frontend `modules/conges/__tests__/conges.test.ts`
- [ ] 6.3 Ajouter les projets `server-conges` et `client-conges` dans `vitest.config.ts`
- [ ] 6.4 Ajouter les scripts `test:server:conges` et `test:client:conges` dans `package.json`
- [ ] 6.5 Lancer `npm test` — tous les tests doivent passer

## 7. Nettoyage et vérification

- [ ] 7.1 Vérifier zéro référence à `delivery-process`, `france-tv`, `francetv`, `ftv` dans tous les nouveaux fichiers
- [ ] 7.2 Vérifier que tous les imports utilisent `@boilerplate/shared` (pas `@delivery-process/shared`)
- [ ] 7.3 Vérifier que le CSS utilise uniquement les design tokens `var(--*)` de theme.css
