# Boilerplate Platform - Instructions Claude

## Règles OBLIGATOIRES

### Tests avant commit/push

**OBLIGATOIRE : Toujours exécuter `npm test` AVANT tout commit ou push.**

```bash
# Lancer les tests
npm test

# Si les tests passent, alors commit
git add <fichiers>
git commit -m "message"
git push
```

**Si les tests échouent :**
1. NE PAS commit/push
2. Corriger les erreurs
3. Relancer `npm test`
4. Commit uniquement quand tous les tests passent

Cette règle s'applique à TOUS les commits, sans exception.

### Approbation utilisateur avant commit/merge/push

**OBLIGATOIRE : JAMAIS de commit, merge ou push sans approbation explicite de l'utilisateur.**

Après avoir terminé une implémentation et vérifié que les tests passent :

1. **S'arrêter** et présenter le résumé des changements
2. **Attendre** l'instruction explicite de l'utilisateur ("commit", "merge", "push", etc.)
3. **Ne jamais** procéder automatiquement, même si tout semble prêt

**Exemple de workflow correct :**
```
Claude: Les tests passent (28/28). Voici les fichiers modifiés:
        - App.tsx
        - router.tsx
        - ...
        Tu veux que je commit et merge ?

User:   oui, commit

Claude: [Procède au commit]
```

**Ce qui est interdit :**
- Commit automatique après les tests
- Merge automatique vers main
- Push automatique vers origin
- Enchaîner commit + merge + push sans validation entre chaque étape

---

## Synchronisation avec le Boilerplate Upstream

Ce projet peut être utilisé comme base pour d'autres projets. Le script `init.sh` configure automatiquement les remotes Git pour permettre de récupérer les mises à jour du boilerplate.

### Architecture des remotes

Après initialisation, le projet a deux remotes :

| Remote | Usage |
|--------|-------|
| `origin` | Votre dépôt projet (push/pull quotidien) |
| `boilerplate` | Le boilerplate source (pull des mises à jour) |

### Récupérer les mises à jour

```bash
# Voir les mises à jour disponibles (sans appliquer)
./sync-boilerplate.sh --dry-run

# Appliquer les mises à jour
./sync-boilerplate.sh
```

### Ce qui est synchronisé

Le merge récupère **toutes** les modifications du boilerplate :
- Design system (`packages/shared/`)
- Scripts de déploiement (`deploy.sh`, `deploy-remote.sh`)
- Configuration Vitest, Docker, etc.
- Documentation (`CLAUDE.md`)

### Gestion des conflits

Si des conflits surviennent lors du merge :

```bash
# 1. Résoudre les conflits dans les fichiers marqués
# 2. Ajouter les fichiers résolus
git add <fichiers-résolus>

# 3. Terminer le merge
git commit

# 4. Vérifier que tout fonctionne
npm test

# 5. Pousser
git push
```

### Bonnes pratiques

- **Ne pas modifier** les fichiers du boilerplate core (`packages/shared/`) dans vos projets dérivés, sinon vous aurez des conflits
- Créer vos modules dans `apps/platform/src/modules/` (pas de conflit)
- Synchroniser régulièrement (1x/semaine) pour éviter les gros écarts
- Toujours lancer `npm test` après un sync

### PROJETS DERIVES : Sync obligatoire avant commit

**REGLE OBLIGATOIRE** pour les projets utilisant ce boilerplate :

Avant **chaque commit**, vérifier et appliquer les mises à jour du boilerplate :

```bash
# 1. Vérifier les updates disponibles
./sync-boilerplate.sh --dry-run

# 2. Si updates disponibles, les appliquer
./sync-boilerplate.sh

# 3. Résoudre les conflits si nécessaire

# 4. Puis commit normalement
git add <fichiers>
git commit -m "message"
```

**Workflow Claude (automatique)** :

Quand tu demandes un commit, Claude doit :
1. Vérifier si le remote `boilerplate` existe
2. Si oui, `git fetch boilerplate` et vérifier les updates
3. Si updates disponibles, proposer de sync d'abord
4. Puis commit

Cette règle garantit que les projets dérivés restent synchronisés avec les améliorations du boilerplate.

---

## Architecture

- **packages/shared/** : Design system minimal (composants, hooks, styles, server utils)
- **apps/platform/src/** : Frontend SPA (React + Vite)
- **apps/platform/servers/unified/** : Backend Express unifié

## Thème

Un seul style : **terminal** (monospace, coins carrés, cyan accent, pas d'ombres).
Deux modes de couleurs : `dark` (défaut) et `light`, via `data-theme` sur `<html>`.

Le thème est défini dans un fichier unique : `packages/shared/src/styles/theme.css`.
Le toggle dark/light est dans la SharedNav via `useSharedTheme`.

## Design System

### Composants disponibles

| Composant | Import | Usage |
|-----------|--------|-------|
| `Layout` | `@boilerplate/shared/components` | Layout wrapper avec SharedNav |
| `ModuleHeader` | `@boilerplate/shared/components` | Header de page avec bouton retour |
| `Modal` | `@boilerplate/shared/components` | Modale de base |
| `ConfirmModal` | `@boilerplate/shared/components` | Modale de confirmation |
| `Toast`, `ToastContainer` | `@boilerplate/shared/components` | Notifications |
| `LoadingSpinner` | `@boilerplate/shared/components` | Loader |
| `SharedNav` | `@boilerplate/shared/components` | Navigation principale |

### Hooks

| Hook | Usage |
|------|-------|
| `useGatewayAuth` | Accès au contexte d'auth (user, logout) |
| `useGatewayUser` | Accès au user courant |
| `useSharedTheme` | Toggle dark/light (utilisé dans App.tsx) |
| `AuthGuard` | Protection de route |

### Styles

Import des tokens : `@boilerplate/shared/styles/theme.css`

## Tests unitaires

### Framework

- **Vitest** avec projets par module (`vitest.config.ts`)
- Tests dans `__tests__/*.test.ts` à côté du code qu'ils testent

### Commandes

| Commande | Description |
|----------|-------------|
| `npm test` | Lancer tous les tests |
| `npm run test:watch` | Mode watch |
| `npm run test:coverage` | Avec couverture |
| `npm run test:server` | Tests backend uniquement |
| `npm run test:server:gateway` | Tests gateway backend |
| `npm run test:server:products` | Tests products backend |
| `npm run test:server:middleware` | Tests middleware |
| `npm run test:client` | Tests frontend uniquement |
| `npm run test:client:gateway` | Tests gateway frontend |
| `npm run test:client:products` | Tests products frontend |
| `npm run test:shared` | Tests shared package |

### Règle : tests obligatoires par module

**Chaque nouveau module DOIT inclure des tests unitaires.**

#### Structure des tests

```
# Backend
apps/platform/servers/unified/src/modules/__tests__/<module>/<module>.test.ts

# Frontend
apps/platform/src/modules/<module>/__tests__/<module>.test.ts
```

#### Checklist tests pour un nouveau module

- [ ] Au moins 1 fichier de test backend (`__tests__/<module>/<module>.test.ts`)
- [ ] Au moins 1 fichier de test frontend (`__tests__/<module>.test.ts`)
- [ ] Ajouter le projet dans `vitest.config.ts` :
  ```ts
  // Backend
  {
    test: {
      name: 'server-<module>',
      root: '.',
      include: ['apps/platform/servers/unified/src/modules/__tests__/<module>/**/*.test.ts'],
      environment: 'node',
    },
  },
  // Frontend
  {
    test: {
      name: 'client-<module>',
      root: '.',
      include: ['apps/platform/src/modules/<module>/__tests__/**/*.test.ts'],
      environment: 'node',
    },
  },
  ```
- [ ] Ajouter les scripts dans `package.json` :
  ```json
  "test:server:<module>": "vitest run --project server-<module>",
  "test:client:<module>": "vitest run --project client-<module>"
  ```
- [ ] Les tests doivent passer (`npm test`) avant tout commit

#### Ce qu'il faut tester

- **Backend** : validation des données, logique métier, constantes, helpers
- **Frontend** : constantes, utilitaires, logique de filtrage, helpers

## Déploiement

### Scripts

| Script | Usage |
|--------|-------|
| `./deploy.sh` | Exécuté **sur le serveur** de production |
| `./deploy-remote.sh` | Exécuté **en local**, déploie via SSH |

### Déploiement distant (recommandé)

```bash
# 1. Configurer
cp .deploy.env.example .deploy.env
# Éditer .deploy.env avec host, user, path, SSH key

# 2. Déployer (lance les tests, puis backup + build + restart)
./deploy-remote.sh deploy

# 3. Déploiement rapide (sans rebuild Docker)
./deploy-remote.sh quick
```

### Règle : tests obligatoires avant déploiement

`deploy-remote.sh` exécute **systématiquement** `npm test` avant tout déploiement.
Si un test échoue, le déploiement est **annulé**. Pas de contournement possible.

### Commandes deploy.sh (sur le serveur)

| Commande | Description |
|----------|-------------|
| `./deploy.sh init` | Configuration initiale (.env.prod interactif) |
| `./deploy.sh setup` | Build des images Docker |
| `./deploy.sh deploy` | Pull + build + restart (avec backup) |
| `./deploy.sh start` | Démarrer les services |
| `./deploy.sh stop` | Arrêter les services |
| `./deploy.sh restart` | Redémarrer les services |
| `./deploy.sh logs` | Voir les logs |
| `./deploy.sh status` | État des services |
| `./deploy.sh backup` | Backup de la base de données |

### Commandes deploy-remote.sh (en local)

| Commande | Description |
|----------|-------------|
| `./deploy-remote.sh deploy` | Déploiement complet (tests + backup + build) |
| `./deploy-remote.sh quick` | Déploiement rapide (tests + pull + restart) |
| `./deploy-remote.sh restart` | Redémarrer les services distants |
| `./deploy-remote.sh logs` | Logs distants |
| `./deploy-remote.sh status` | État des services distants |
| `./deploy-remote.sh backup` | Backup de la base distante |
| `./deploy-remote.sh ssh` | Connexion SSH interactive |

## Ajout d'un nouveau module

### Checklist obligatoire

#### 1. Frontend (`apps/platform/src/modules/<module>/`)

- [ ] `App.tsx` - Composant principal
  ```tsx
  export default function <Module>App({ onNavigate }: { onNavigate?: (path: string) => void }) {
    return (
      <Layout appId="<module>" variant="full-width" onNavigate={onNavigate}>
        <AppContent onNavigate={onNavigate} />
      </Layout>
    );
  }
  ```
- [ ] `types/index.ts` - Types TypeScript
- [ ] `services/api.ts` - Appels API CRUD
- [ ] `components/` - Composants avec CSS modules
- [ ] `index.css` - Styles du module (préfixe `<module>-`)
- [ ] `__tests__/<module>.test.ts` - **Tests unitaires (OBLIGATOIRE)**

#### 2. Backend (`apps/platform/servers/unified/src/modules/<module>/`)

- [ ] `index.ts` - init + createRouter exports
- [ ] `routes.ts` - Express Router handlers
- [ ] `dbService.ts` - Pool + queries SQL
- [ ] `__tests__/<module>/<module>.test.ts` - **Tests unitaires (OBLIGATOIRE)**

#### 3. Configuration

- [ ] `router.tsx` - Ajouter lazy import + Route
  ```tsx
  const <Module>App = lazy(() => import('./modules/<module>/App'));

  <Route path="/<module>/*" element={<SuspenseWrapper><Module>App onNavigate={onNavigate} /></SuspenseWrapper>} />
  ```
- [ ] `vite.config.ts` - Ajouter proxy
  ```ts
  '/<module>-api': {
    target: UNIFIED_SERVER,
    rewrite: (path) => path.replace(/^\/<module>-api/, '/<module>/api'),
  },
  ```
- [ ] `proxy-nginx/nginx/nginx.conf` - Ajouter route du module dans le regex boilerplate.vitess.tech (`/<module>` dans le pattern) + commit/deploy proxy-nginx
- [ ] `index.ts` (serveur) - Monter le module
  ```ts
  import { init<Module>, create<Module>Router } from './modules/<module>/index.js';

  await init<Module>();
  app.use('/<module>/api', create<Module>Router());
  ```
- [ ] `SharedNav/constants.ts` - Ajouter l'app (source unique pour nav ET landing page)
- [ ] `AVAILABLE_APPS` dans `gateway.ts` - Ajouter l'ID du module

#### 4. Tests

- [ ] `vitest.config.ts` - Ajouter les projets server-<module> et client-<module>
- [ ] `package.json` - Ajouter `test:server:<module>` et `test:client:<module>`
- [ ] `npm test` doit passer

#### 5. Database

Structure des fichiers SQL :
- `01_create_databases.sql` - Creation base (NE PAS MODIFIER)
- `02_platform_schema.sql` - Tables plateforme (NE PAS MODIFIER)
- `03_<module>_schema.sql` et suivants - Tables modules

- [ ] `database/init/XX_<module>_schema.sql` - Schema SQL du module (XX = 03, 04, 05...)

### Pattern API Service

```typescript
// services/api.ts
const API_BASE = '/<module>-api';

async function handleResponse<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Une erreur est survenue');
  }
  return data;
}

export async function fetchItems(): Promise<Item[]> {
  const response = await fetch(`${API_BASE}/items`, { credentials: 'include' });
  return handleResponse<Item[]>(response);
}
```

### Pattern Backend Routes

```typescript
// routes.ts
import { Router } from 'express';
import { authMiddleware } from '../../middleware/index.js';
import { asyncHandler } from '@boilerplate/shared/server';
import * as db from './dbService.js';

export function createRoutes(): Router {
  const router = Router();
  router.use(authMiddleware);

  router.get('/items', asyncHandler(async (_req, res) => {
    const items = await db.getAllItems();
    res.json(items);
  }));

  // POST, PUT, DELETE...

  return router;
}
```

## Mode Embed (acces public)

Le mode embed permet d'acceder a un element d'un module sans authentification, ideal pour l'integration dans des iframes ou le partage de liens publics.

### Comment ca fonctionne

1. **Detection** : L'URL contient `?embed=<ID>` (ex: `/products?embed=123`)
2. **Skip auth** : `App.tsx` detecte le parametre et bypass l'AuthProvider
3. **Vue minimale** : Affiche un composant `EmbedView` sans navigation
4. **Route publique** : Le backend expose `/embed/:id` sans authMiddleware

### Activer l'embed pour un module

Lors de la creation d'un module avec `/module-creator`, repondre **oui** a la question "Activer le mode embed public ?".

Cela genere automatiquement :
- `components/EmbedView/EmbedView.tsx` - Composant de vue embed
- `components/EmbedView/EmbedView.css` - Styles minimal (dark/light toggle)
- Route publique `/embed/:id` dans le backend
- Fonction `fetchEmbed()` dans `services/api.ts`

### Structure du mode embed

```
Frontend (App.tsx)
  |
  +-- detecte ?embed=ID dans URL
  |
  +-- Si embed: <AppRouter embedMode embedId={id} />
  |
  +-- Router redirige vers <ModuleApp embedMode embedId={id} />
  |
  +-- ModuleApp affiche <EmbedView itemId={id} />

Backend (routes.ts)
  |
  +-- GET /embed/:id (PUBLIC, avant authMiddleware)
  |
  +-- Retourne les donnees de l'item
```

### Exemple d'URL embed

```
# Acces normal (authentifie)
https://app.example.com/products

# Acces embed (public)
https://app.example.com/products?embed=42

# Dans une iframe
<iframe src="https://app.example.com/products?embed=42" />
```

### Bouton "Copier lien embed"

Pour ajouter un bouton de copie du lien embed dans la liste ou le detail :

```typescript
const copyEmbedLink = (item: Entity) => {
  const url = `${window.location.origin}/<module>?embed=${item.id}`;
  navigator.clipboard.writeText(url);
  addToast({ type: 'success', message: 'Lien embed copie !' });
};
```

### Securite

- Les routes embed sont **read-only** (GET uniquement)
- Seules les donnees publiques doivent etre exposees
- L'ID doit etre difficile a deviner si les donnees sont sensibles (utiliser UUID)
- Pas de tokens d'authentification dans les URLs embed

## Conventions

### Langue

- Interface utilisateur : Français (avec accents)
- Code et commentaires : Anglais
- Messages de commit : Anglais

### Naming

- Composants React : PascalCase (`ProductList.tsx`)
- CSS modules : `ComponentName.module.css`
- Services : camelCase (`api.ts`)
- Routes backend : kebab-case (`/products/api/items`)
- Branches : `feat/<feature>`, `fix/<feature>`, `refactor/<feature>`

### Styles

- Toujours utiliser les design tokens CSS (`var(--spacing-md)`, `var(--text-primary)`)
- Préfixer les classes globales avec le nom du module (`products-page`)
- Utiliser CSS modules pour les composants internes

## Données de production (seed)

Les données de production de `francetv.vitess.tech` (delivery-process) sont commitées dans `database/seed/` pour que tout le monde puisse travailler avec des données réelles en local.

### Importer les données de production en local

```bash
# Importer les données commitées (database/seed/)
./scripts/sync-prod-data.sh

# OU : dump frais depuis le serveur de prod + import
./scripts/sync-prod-data.sh --from-prod
```

**Prérequis** :
- Docker Compose lancé (`docker compose up -d`)
- Pour `--from-prod` : accès SSH à `studio.vitess.tech`

### Ce qui est importé

| Source (francetv.vitess.tech) | Destination locale | Notes |
|---|---|---|
| DB `suivitess` → documents, sections, subjects, snapshots | `suivitess_*` | Import direct, mapping 1:1 |
| DB `roadmap` → plannings, tasks, dependencies, markers | `roadmap_*` | Import direct, colonnes `owner_id`/`workspace_id` ignorées |
| DB `delivery` → task_positions par (project, PI) | `delivery_boards` + `delivery_tasks` + `delivery_positions` | **Converti** : chaque combo (project_id, pi_id) → 1 board agile de 6 semaines |

### Mettre à jour les données seed

Après avoir fait `--from-prod`, les CSV dans `database/seed/` sont mis à jour. **Commiter** les fichiers pour que les autres puissent en bénéficier :

```bash
./scripts/sync-prod-data.sh --from-prod
git add database/seed/
git commit -m "chore: update seed data from production"
git push
```

### Fichiers seed

| Fichier | Contenu |
|---|---|
| `database/seed/suivitess_documents.csv` | Documents suivitess |
| `database/seed/suivitess_sections.csv` | Sections |
| `database/seed/suivitess_subjects.csv` | Sujets |
| `database/seed/suivitess_snapshots.csv` | Snapshots |
| `database/seed/roadmap_plannings.csv` | Plannings roadmap |
| `database/seed/roadmap_tasks.csv` | Tâches roadmap |
| `database/seed/roadmap_deps.csv` | Dépendances |
| `database/seed/roadmap_markers.csv` | Marqueurs |
| `database/seed/delivery_positions.csv` | Positions brutes (ancien modèle) |
| `database/seed/delivery_import.sql` | SQL généré : boards + tasks + positions (nouveau modèle) |

---

## Compte admin par défaut

Deux comptes administrateur sont créés automatiquement au démarrage :

| Identifiant | Mot de passe | Source |
|-------------|--------------|--------|
| `admin` | `admin` | Toujours créé (`createDefaultAdmin`) |
| `ADMIN_EMAIL` | `ADMIN_PASSWORD` | Si défini dans `.env` |

Le mot de passe du second compte est **synchronisé** à chaque démarrage.

## Variables d'environnement

| Variable | Obligatoire | Description |
|----------|-------------|-------------|
| `JWT_SECRET` | Prod | Secret JWT (min 32 chars) |
| `ADMIN_EMAIL` | Non | Email admin supplémentaire |
| `ADMIN_PASSWORD` | Non | Mot de passe admin supplémentaire |
| `APP_DATABASE_URL` | Oui | URL PostgreSQL |

## Fichiers de configuration

| Fichier | Usage | Git |
|---------|-------|-----|
| `.env` | Config locale de développement | Ignoré |
| `.env.example` | Template pour `.env` | Commité |
| `.env.prod` | Config production (sur le serveur) | Ignoré |
| `.deploy.env` | Config SSH pour deploy-remote.sh | Ignoré |
| `.deploy.env.example` | Template pour `.deploy.env` | Commité |
| `.claude/config` | Config Claude | Ignoré |
