# Boilerplate Platform — Instructions Claude

## Règles OBLIGATOIRES

### Tests avant commit/push

**Toujours exécuter `npm test` AVANT tout commit ou push.**
Si les tests échouent : corriger, relancer, puis commit. Pas de contournement.

### Approbation utilisateur avant commit/merge/push

**JAMAIS de commit, merge ou push sans approbation explicite.**
Présenter un résumé des changements + attendre l'instruction de l'utilisateur
(« commit », « merge », « push »). Ne pas enchaîner automatiquement.

---

## Architecture

- **`packages/shared/`** — Design system (composants, hooks, server utils partagés).
- **`apps/platform/src/`** — Frontend SPA (React + Vite).
- **`apps/platform/servers/unified/`** — Backend Express unifié.

Cartographie complète des composants : voir `COMPONENTS.md` à la racine
(classification shared / candidats-promotion / locaux légitimes).

---

## Design System

Tous les composants utilisables sont importés depuis
`@boilerplate/shared/components` :

| Composant | Usage |
|---|---|
| `Layout` | Wrapper de page avec SharedNav + main + variantes (`centered`, `full-width`). |
| `ModuleHeader` | Header avec titre + back button + slot actions. |
| `Modal`, `ConfirmModal` | Modales (standard + confirmation danger). |
| `Button` | Variantes `primary`, `secondary`, `danger`. |
| `Toast`, `ToastContainer` | Notifications. |
| `LoadingSpinner` | Loader (`sm`, `md`, `lg`, `fullPage`). |
| `Card`, `Badge`, `ExpandableSection`, `Tabs` | Data display. |
| `SharingModal`, `VisibilityPicker` | Gestion de partage + visibilité. |

Hooks utiles :

| Hook | Usage |
|---|---|
| `useGatewayAuth()` | Retourne `{ user, loading, error, logout, refreshUser }`. |
| `useGatewayUser()` | Retourne `{ user, loading, error }` — **toujours destructurer**, `user` n'est pas la racine. |
| `useSharedTheme()` | Toggle dark/light. |

**Convention de convergence** : tout composant utilisé par ≥ 2 modules doit
vivre dans `packages/shared/`. Avant de créer un nouveau composant, consulter
`COMPONENTS.md` — un pattern existant ou candidat à promotion peut déjà
couvrir le besoin.

---

## Tests unitaires

**Framework** : Vitest avec projets par module (`vitest.config.ts`).
**Emplacement** : `__tests__/*.test.ts` à côté du code.

| Commande | Description |
|---|---|
| `npm test` | Tous les tests (obligatoire avant commit). |
| `npm run test:watch` | Mode watch. |
| `npm run test:coverage` | Avec couverture. |
| `npm run test:client` | Tests frontend uniquement. |
| `npm run test:server` | Tests backend uniquement. |
| `npm run test:client:<module>` / `npm run test:server:<module>` | Module spécifique. |

Chaque nouveau module DOIT inclure ses tests + être ajouté à `vitest.config.ts`
(projets `server-<module>` et `client-<module>`) + à `package.json` (scripts
`test:server:<module>` et `test:client:<module>`).

---

## Déploiement

Scripts `deploy-remote.sh` (exécuté en local) et `deploy.sh` (sur le serveur).

| Commande locale | Description |
|---|---|
| `./deploy-remote.sh deploy` | Déploiement complet (tests + backup + build Docker + restart). |
| `./deploy-remote.sh quick` | Déploiement rapide (tests + pull + restart, pas de rebuild). |
| `./deploy-remote.sh logs` | Logs distants. |
| `./deploy-remote.sh status` | État des services. |

**Règle** : `deploy-remote.sh` exécute systématiquement `npm test` avant tout
déploiement. Test KO = deploy annulé, aucun contournement.

Utiliser `deploy` quand il y a : nouvelle dépendance npm, nouveau `.md`
embarqué dans l'image Docker, changement backend structurel. Sinon `quick`
suffit pour du code applicatif.

---

## Ajout d'un nouveau module

### Frontend (`apps/platform/src/modules/<module>/`)

- `App.tsx` — composant principal utilisant `<Layout appId="<module>" …>`.
- `services/api.ts` — appels API via `const API_BASE = '/<module>-api'`.
- `components/` — composants avec CSS modules.
- `__tests__/<module>.test.ts` — tests (obligatoire).

### Backend (`apps/platform/servers/unified/src/modules/<module>/`)

- `index.ts` — exports `init<Module>` + `create<Module>Router`.
- `routes.ts` — handlers Express. Gater avec `router.use(authMiddleware)` pour
  les routes privées.
- `dbService.ts` — pool PG + queries SQL paramétrées (`$1`, `$2`, jamais de
  template strings).
- `__tests__/<module>/<module>.test.ts` — tests (obligatoire).

### Câblage

- `router.tsx` — `lazy()` + `<Route>`.
- `vite.config.ts` — proxy `/<module>-api` → backend.
- `apps/platform/servers/unified/src/index.ts` — monter le router.
- `SharedNav/constants.ts` — enregistrer l'app pour la nav.
- `AVAILABLE_APPS` dans `gateway.ts` — ajouter l'ID pour les permissions.
- `database/init/XX_<module>_schema.sql` — schéma SQL (numéro libre à partir
  de 03).
- `vitest.config.ts` + `package.json` — enregistrer les 2 projets de tests.

---

## Conventions

- **Langue** : UI en français (accents), code + commentaires + commits en anglais.
- **Naming** : Composants `PascalCase.tsx`, CSS modules `Component.module.css`,
  services `camelCase.ts`, routes backend `kebab-case`, branches
  `feat/<nom>` / `fix/<nom>` / `refactor/<nom>`.
- **Styles** : design tokens CSS uniquement (`var(--spacing-md)`,
  `var(--text-primary)`). Préfixer les classes globales avec le module.
- **SQL** : queries paramétrées, jamais de template strings avec user input.

---

## Sécurité

- **Auth** : `authMiddleware` par défaut sur toute route privée.
- **Admin** : `adminMiddleware` en plus pour les routes admin.
- **CORS** : whitelist gérée dans `apps/platform/servers/unified/src/index.ts`
  (localhost dev, `*.vitess.tech`, `chrome-extension://`, env `ALLOWED_ORIGINS`).
- **Ownership** : utiliser `canUserAccess(userId, isAdmin, resourceType, resourceId)`
  depuis `shared/resourceSharing.ts` sur toute route qui retourne des
  ressources par id. `ensureOwnership` ne doit PAS être appelé sur des
  endpoints publics (sinon takeover).
- **Embed** : routes `/embed/:id` = read-only + vérifier `visibility='public'`
  dans `resource_sharing` avant de retourner les données.
- **Rate limit** : `express-rate-limit` sur toute route publique (sans auth)
  qui déclenche un coût (LLM, scraping). Voir `rag/routes/publicRoutes.ts`
  pour le pattern.
- **XSS** : si `dangerouslySetInnerHTML`, escape l'input en amont avant de
  rebuilder les tags autorisés (voir `SubjectReview.tsx`).
- **Secrets** : jamais de secret dans le code ou les logs. `JWT_SECRET` doit
  être set en production/staging (check au boot dans `config.ts`).

---

## Comptes admin & variables d'env

Deux comptes admin créés au boot :

| Identifiant | Mot de passe | Source |
|---|---|---|
| `admin` | `admin` | Toujours créé (dev/debug — intentionnel). |
| `ADMIN_EMAIL` | `ADMIN_PASSWORD` | Si défini dans `.env`, sinon pas créé. |

Variables d'env critiques :

| Variable | Contexte | Description |
|---|---|---|
| `APP_DATABASE_URL` | Toujours | URL PostgreSQL. |
| `JWT_SECRET` | Staging/Prod | Secret JWT (min 32 chars en prod). |
| `ALLOWED_ORIGINS` | Optionnel | CORS allowlist supplémentaire (CSV). |
| `PROMPT_LOGS_HOOK_SECRET` | Optionnel | Secret `X-Hook-Secret` pour l'ingest `/prompt-logs/api/events`. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Optionnel | Admin supplémentaire. |

---

## Données de production (seed)

Les données de `francetv.vitess.tech` sont commitées dans `database/seed/*.csv`
pour permettre le dev local avec des données réelles — **choix explicite et
assumé** (contient des noms d'équipe internes, pas de credentials).

```bash
./scripts/sync-prod-data.sh              # Importe les CSV commités
./scripts/sync-prod-data.sh --from-prod  # Dump frais depuis prod + import
```

Après `--from-prod`, commiter `database/seed/*.csv` pour que l'équipe en
bénéficie.

---

## Admin feature toggles

La page `/admin-features` expose les flags globaux de la plateforme
(connecteurs + modules + intégrations). Backend :

- `GET /api/platform/settings/public` — lecture (authenticated) → `{ key: boolean }`.
- `GET /api/platform/settings` — lecture admin complète.
- `PUT /api/platform/settings/:key` — admin, `value` = `"true"` ou `"false"`.

Pour brancher un consumer : fetch `/api/platform/settings/public` au mount,
puis `flags['connector_<id>_enabled'] !== false` pour afficher/masquer. Voir
`ConnectorsPage.tsx` pour le pattern.

---

## Fichiers de configuration

| Fichier | Usage | Git |
|---|---|---|
| `.env` | Dev local | Ignoré |
| `.env.example` | Template | Commité |
| `.env.prod` | Production (sur le serveur) | Ignoré |
| `.deploy.env` | SSH config pour `deploy-remote.sh` | Ignoré |
| `.deploy.env.example` | Template | Commité |
