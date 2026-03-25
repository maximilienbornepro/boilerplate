## Pourquoi

Le boilerplate a besoin d'un module standalone de gestion des congés/absences permettant à n'importe quelle équipe de suivre la disponibilité de ses membres sur un calendrier visuel. Module marque blanche, autonome, sans dépendance externe (pas de Jira, aucune référence de marque), portable vers tout projet basé sur le boilerplate.

## Ce qui change

- **Nouveau module frontend** `conges` avec vue calendrier montrant les congés par membre sous forme de barres colorées
- **Nouveau module backend** `conges` avec API REST pour le CRUD des membres et congés
- **Nouveau schéma base de données** pour les congés et les préférences de couleur utilisateur
- **Membres dérivés du gateway** — pas de gestion séparée, les membres sont les utilisateurs ayant la permission `conges`
- **Gestion des congés** — créer, modifier, supprimer avec support demi-journée (matin/après-midi)
- **Vue calendrier annuelle** — calendrier année complète avec zoom mois/semaine
- **Préférences d'équipe** — couleur et ordre de tri personnalisables par utilisateur
- **Contrôles admin** — les admins gèrent tous les congés, les utilisateurs standards uniquement les leurs

## Capacités

### Nouvelles capacités
- `leave-calendar` : Visualisation calendrier avec barres colorées par membre, navigation annuelle et modes vue mois/semaine
- `leave-management` : Opérations CRUD sur les congés avec support demi-journée (complet/matin/après-midi), validation et contrôle d'accès
- `member-preferences` : Attribution de couleur et ordre de tri pour l'affichage calendrier

### Capacités modifiées
<!-- Aucune — c'est un nouveau module -->

## Existant (à réutiliser)

| Élément | Fichier/Endpoint | Usage dans ce module |
|---------|------------------|----------------------|
| Layout | `@boilerplate/shared/components` | Wrapper de page |
| ModuleHeader | `@boilerplate/shared/components` | Header avec bouton retour |
| Modal, ConfirmModal | `@boilerplate/shared/components` | Formulaires et confirmations |
| Toast, ToastContainer | `@boilerplate/shared/components` | Notifications |
| useGatewayUser | `@boilerplate/shared/components` | Utilisateur courant |
| authMiddleware | `middleware/` | Protection des routes API |
| Table `users` | Gateway | Source des membres |
| Table `user_permissions` | Gateway | Filtrage par permission `conges` |

## Scope (à implémenter)

### Fichiers à créer

| Fichier | Description |
|---------|-------------|
| `database/init/04_conges_schema.sql` | Schéma SQL (2 tables) |
| `modules/conges/index.ts` (backend) | Init + router exports |
| `modules/conges/routes.ts` (backend) | Routes Express |
| `modules/conges/dbService.ts` (backend) | Requêtes PostgreSQL |
| `modules/conges/App.tsx` (frontend) | Composant principal |
| `modules/conges/types/index.ts` | Types TypeScript |
| `modules/conges/services/api.ts` | Appels API |
| `modules/conges/components/LeaveCalendar/` | Calendrier + barres |
| `modules/conges/components/LeaveForm/` | Formulaire congé |
| `modules/conges/components/MemberList/` | Panel équipe |
| `modules/conges/components/ViewControls/` | Sélecteur de vue |
| `modules/conges/index.css` | Styles du module |

### Fichiers à modifier

| Fichier | Modification |
|---------|--------------|
| `router.tsx` | Ajouter lazy import + route |
| `vite.config.ts` | Ajouter proxy `/conges-api` |
| `SharedNav/constants.ts` | Ajouter app "Congés" |
| `gateway.ts` | Ajouter `conges` à AVAILABLE_APPS |
| `index.ts` (serveur) | Monter initConges + createCongesRouter |
| `vitest.config.ts` | Ajouter projets de test |
| `package.json` | Ajouter scripts de test |

## Hors scope (exclus volontairement)

| Élément | Raison de l'exclusion |
|---------|----------------------|
| Workflow d'approbation | Complexité inutile — les congés sont créés directement |
| Notifications par email | Sera une spec séparée si besoin |
| Intégration RH externe | Module standalone, pas de dépendance |
| Solde/quota de congés | Hors périmètre initial |
| Export CSV/PDF | Sera une spec séparée si besoin |

## Règles UI

- [x] `ModuleHeader` utilisé pour le header (JAMAIS de header custom)
- [x] Bouton "Retour" dans ModuleHeader via `onBack`
- [x] Boutons d'action dans ModuleHeader (Aujourd'hui, Équipe, + Nouveau)

## Impact

- **Frontend** : Nouveau module dans `apps/platform/src/modules/conges/`
- **Backend** : Nouveau module dans `apps/platform/servers/unified/src/modules/conges/`
- **Base de données** : Nouveau fichier `database/init/04_conges_schema.sql` (2 tables : `conges_user_preferences`, `conges_leaves`)
- **Configuration** : Mises à jour de `router.tsx`, `vite.config.ts`, `index.ts` (serveur), `SharedNav/constants.ts`, `gateway.ts`, `vitest.config.ts`, `package.json`
- **Dépendances** : Aucune — utilise uniquement les composants partagés du boilerplate et PostgreSQL

## Critères d'acceptation

1. Le calendrier affiche les membres avec leurs congés sous forme de barres colorées
2. CRUD complet des congés avec support demi-journée
3. Les admins peuvent gérer tous les congés, les utilisateurs standards uniquement les leurs
4. Aucune référence à `delivery-process`, `france-tv`, `francetv`, `ftv`
5. Tous les imports utilisent `@boilerplate/shared`
6. CSS utilise uniquement les design tokens du boilerplate
7. Tests unitaires présents (backend + frontend)
8. `npm test` passe
