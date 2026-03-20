# Boilerplate Platform

Plateforme modulaire avec authentification JWT, design system terminal et déploiement automatisé.

## Démarrage rapide

### Prérequis

- Node.js 20+
- Docker (pour PostgreSQL)

### Installation

```bash
# 1. Cloner le repo
git clone <repo-url> mon-projet
cd mon-projet

# 2. Initialiser le projet (nom, containers Docker, package names...)
./init.sh

# 3. Installer les dépendances
npm install

# 4. Lancer la base de données
npm run db:start

# 5. Lancer le projet
npm run dev
```

Le script `init.sh` demande interactivement :
- **Slug** : nom technique (`mon-app`, `crm-interne`) — utilisé pour les containers Docker, packages npm, localStorage
- **Nom d'affichage** : nom visible dans l'UI (`Mon App`, `CRM Interne`)
- **Description** : courte description

Une fois initialisé, un fichier `.initialized` est créé pour éviter de relancer le script par erreur.

- Frontend : http://localhost:5170
- Backend : http://localhost:3010

### Comptes par défaut

| Identifiant | Mot de passe | Source |
|---|---|---|
| `admin` | `admin` | Toujours créé au démarrage |
| `ADMIN_EMAIL` | `ADMIN_PASSWORD` | Si défini dans `.env` |

Le mot de passe du second compte est synchronisé à chaque démarrage.

## Architecture

```
boilerplate/
├── packages/shared/             # Design system (composants, hooks, thème)
│   └── src/
│       ├── components/          # Layout, Modal, Toast, SharedNav...
│       ├── hooks/               # useGatewayAuth, useSharedTheme
│       ├── styles/              # theme.css (terminal dark/light)
│       └── server/              # asyncHandler, errorMiddleware
├── apps/platform/
│   ├── src/                     # Frontend SPA (React + Vite)
│   │   └── modules/
│   │       ├── gateway/         # Auth, admin, landing page
│   │       └── products/        # Module template CRUD
│   └── servers/unified/         # Backend Express unifié
│       └── src/
│           ├── middleware/      # JWT auth, admin guard
│           └── modules/         # gateway.ts, products/...
├── database/init/               # Scripts SQL d'initialisation
├── deploy.sh                    # Déploiement (sur le serveur)
├── deploy-remote.sh             # Déploiement (via SSH, depuis le local)
├── vitest.config.ts             # Configuration des tests par module
├── docker-compose.yml           # Dev (PostgreSQL)
└── docker-compose.prod.yml      # Production (PostgreSQL + server + nginx)
```

## Thème

Un seul style : **terminal** — police monospace, coins carrés, accent cyan, pas d'ombres.

Deux modes : **dark** (défaut) et **light**, bascule via le menu (icône soleil/lune).

Fichier unique : `packages/shared/src/styles/theme.css`.

## Administration

Le bouton **Administration** apparaît dans la barre de navigation pour les admins. Il permet de :

- Voir tous les utilisateurs
- Activer / désactiver un compte
- Supprimer un utilisateur
- Gérer les permissions par module (checkboxes)
- La permission "Administration" synchronise automatiquement le statut admin

## Tests

### Commandes

```bash
npm test                      # Tous les tests
npm run test:watch            # Mode watch
npm run test:coverage         # Avec couverture

# Par couche
npm run test:server           # Backend uniquement
npm run test:client           # Frontend uniquement
npm run test:shared           # Package shared

# Par module
npm run test:server:gateway
npm run test:server:products
npm run test:server:middleware
npm run test:client:gateway
npm run test:client:products
```

### Convention

Chaque module **doit** avoir des tests unitaires :

```
# Backend
apps/platform/servers/unified/src/modules/__tests__/<module>/<module>.test.ts

# Frontend
apps/platform/src/modules/<module>/__tests__/<module>.test.ts
```

Voir `CLAUDE.md` pour la checklist complète (vitest.config.ts, scripts, etc.).

## Déploiement

### Configuration

```bash
cp .deploy.env.example .deploy.env
# Éditer : REMOTE_HOST, REMOTE_USER, REMOTE_PATH, SSH_KEY
```

### Depuis le poste local (recommandé)

```bash
./deploy-remote.sh deploy    # Complet : tests + backup + build + restart
./deploy-remote.sh quick     # Rapide : tests + pull + restart (sans rebuild)
./deploy-remote.sh status    # État des services
./deploy-remote.sh logs      # Logs en temps réel
./deploy-remote.sh backup    # Backup de la base
./deploy-remote.sh ssh       # Connexion SSH interactive
```

Les tests sont **obligatoires** : si un test échoue, le déploiement est annulé.

### Sur le serveur directement

```bash
./deploy.sh init             # Configuration initiale (.env.prod)
./deploy.sh setup            # Build des images Docker
./deploy.sh deploy           # Pull + build + restart (avec backup)
./deploy.sh start|stop|restart
./deploy.sh logs|status|backup
```

### Première installation serveur

```bash
git clone <repo> /opt/apps/boilerplate
cd /opt/apps/boilerplate
./deploy.sh init     # Configure .env.prod interactivement
./deploy.sh setup    # Build les images
./deploy.sh start    # Lance les services
```

## Ajouter un nouveau module

1. **Frontend** : `App.tsx`, types, services API, composants, styles, tests
2. **Backend** : `index.ts`, routes, dbService, tests
3. **Config** : router.tsx, vite.config.ts, SharedNav/constants.ts, gateway/constants.ts, AVAILABLE_APPS
4. **Database** : `database/init/XX_<module>_schema.sql`

Checklist détaillée dans `CLAUDE.md`.

## Mode OpenSpec (Claude Code)

Mode qui impose spec + branche dédiée avant toute modification. Activé par défaut.

```bash
# Désactiver (travail libre sur main)
mkdir -p .claude && echo "OPENSPEC_MODE=off" > .claude/config

# Réactiver
mkdir -p .claude && echo "OPENSPEC_MODE=on" > .claude/config

# Vérifier
cat .claude/config 2>/dev/null | grep OPENSPEC_MODE || echo "activé (défaut)"
```

## Variables d'environnement

| Variable | Obligatoire | Description |
|---|---|---|
| `APP_DATABASE_URL` | Oui | URL PostgreSQL |
| `JWT_SECRET` | Production | Secret JWT (min 32 caractères) |
| `ADMIN_EMAIL` | Non | Email du second compte admin |
| `ADMIN_PASSWORD` | Non | Mot de passe du second compte admin |
| `UNIFIED_PORT` | Non | Port backend (défaut : 3010) |

## Fichiers de configuration

| Fichier | Rôle | Git |
|---|---|---|
| `.env` | Config dev locale | Ignoré |
| `.env.example` | Template pour `.env` | Commité |
| `.env.prod` | Config production (serveur) | Ignoré |
| `.deploy.env` | Config SSH pour deploy-remote | Ignoré |
| `.deploy.env.example` | Template pour `.deploy.env` | Commité |
| `.claude/config` | Config Claude (OpenSpec) | Ignoré |

## Scripts npm

| Script | Description |
|---|---|
| `npm run dev` | Frontend + backend en dev |
| `npm run build` | Build production du frontend |
| `npm test` | Lancer tous les tests |
| `npm run test:watch` | Tests en mode watch |
| `npm run db:start` | Démarrer PostgreSQL (Docker) |
| `npm run db:stop` | Arrêter PostgreSQL |
| `npm run db:reset` | Reset complet de la base |

## Technologies

- **Frontend** : React 18, TypeScript, Vite, React Router
- **Backend** : Express 5, TypeScript, JWT, bcrypt
- **Database** : PostgreSQL 16
- **Tests** : Vitest
- **Déploiement** : Docker Compose, scripts SSH
- **Style** : CSS custom properties, thème terminal monospace
