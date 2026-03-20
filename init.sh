#!/bin/bash
set -e

# =============================================================================
# init.sh - Initialisation du projet boilerplate
# Usage: ./init.sh
#
# Ce script remplace "boilerplate" par le nom de votre projet dans tous les
# fichiers de configuration, sources et scripts.
# =============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()  { echo -e "${CYAN}[INIT]${NC} $1"; }
ok()   { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# --- Vérification : script déjà lancé ? ---
if [ -f ".initialized" ]; then
  warn "Ce projet a déjà été initialisé (fichier .initialized présent)."
  warn "Voulez-vous ré-initialiser ? (y/N)"
  read -r answer
  [[ "$answer" != "y" && "$answer" != "Y" ]] && { log "Annulé."; exit 0; }
fi

# =============================================================================
# Bienvenue
# =============================================================================
echo ""
echo -e "${BOLD}╔══════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║       Initialisation du Boilerplate      ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════╝${NC}"
echo ""

# =============================================================================
# Questions
# =============================================================================

# Nom du projet (slug technique)
while true; do
  echo -e "${CYAN}Nom du projet${NC} (slug, ex: my-app, crm-interne, tools):"
  read -r PROJECT_SLUG

  # Validation : minuscules, chiffres, tirets uniquement
  if [[ "$PROJECT_SLUG" =~ ^[a-z][a-z0-9-]{1,30}$ ]]; then
    break
  else
    warn "Nom invalide. Utilisez uniquement des minuscules, chiffres et tirets (ex: my-app)."
  fi
done

# Nom d'affichage
echo ""
echo -e "${CYAN}Nom d'affichage${NC} (ex: My App, CRM Interne, Tools Platform):"
read -r PROJECT_DISPLAY_NAME
if [ -z "$PROJECT_DISPLAY_NAME" ]; then
  # Capitaliser le slug par défaut
  PROJECT_DISPLAY_NAME=$(echo "$PROJECT_SLUG" | sed 's/-/ /g' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) tolower(substr($i,2))}1')
fi

# Description
echo ""
echo -e "${CYAN}Description courte${NC} (ex: Plateforme interne de gestion):"
read -r PROJECT_DESCRIPTION
if [ -z "$PROJECT_DESCRIPTION" ]; then
  PROJECT_DESCRIPTION="Plateforme $PROJECT_DISPLAY_NAME"
fi

# Confirmation
echo ""
echo -e "${BOLD}Récapitulatif :${NC}"
echo -e "  Slug         : ${GREEN}$PROJECT_SLUG${NC}"
echo -e "  Nom affiché  : ${GREEN}$PROJECT_DISPLAY_NAME${NC}"
echo -e "  Description  : ${GREEN}$PROJECT_DESCRIPTION${NC}"
echo ""
echo -e "Confirmer ? (Y/n)"
read -r confirm
[[ "$confirm" == "n" || "$confirm" == "N" ]] && { log "Annulé."; exit 0; }

echo ""
log "Initialisation en cours..."
echo ""

# =============================================================================
# Remplacements
# =============================================================================

# Détecter la commande sed selon OS (macOS vs Linux)
if [[ "$OSTYPE" == "darwin"* ]]; then
  SED="sed -i ''"
else
  SED="sed -i"
fi

replace() {
  local file="$1"
  local from="$2"
  local to="$3"
  if [ -f "$file" ]; then
    $SED "s|$from|$to|g" "$file"
  fi
}

# --- package.json racine ---
log "package.json..."
replace "package.json" \
  '"name": "boilerplate-platform"' \
  "\"name\": \"${PROJECT_SLUG}-platform\""
replace "package.json" \
  '"description": "Boilerplate platform with JWT authentication and design system"' \
  "\"description\": \"${PROJECT_DESCRIPTION}\""

# --- packages/shared/package.json ---
replace "packages/shared/package.json" \
  '"name": "@boilerplate/shared"' \
  "\"name\": \"@${PROJECT_SLUG}/shared\""

# --- apps/platform/package.json ---
replace "apps/platform/package.json" \
  '"@boilerplate/shared": "\*"' \
  "\"@${PROJECT_SLUG}/shared\": \"*\""

# --- apps/platform/servers/unified/package.json ---
replace "apps/platform/servers/unified/package.json" \
  '"@boilerplate/shared": "\*"' \
  "\"@${PROJECT_SLUG}/shared\": \"*\""

# --- Imports @boilerplate/shared -> @PROJECT_SLUG/shared dans les sources ---
log "Imports TypeScript..."
FILES_WITH_IMPORTS=(
  "apps/platform/src/main.tsx"
  "apps/platform/src/App.tsx"
  "apps/platform/src/router.tsx"
  "apps/platform/src/modules/gateway/components/AdminPage.tsx"
  "apps/platform/src/modules/products/App.tsx"
  "apps/platform/src/modules/products/components/ProductForm/ProductForm.tsx"
  "apps/platform/servers/unified/src/index.ts"
  "apps/platform/servers/unified/src/modules/gateway.ts"
  "apps/platform/servers/unified/src/modules/products/routes.ts"
)
for f in "${FILES_WITH_IMPORTS[@]}"; do
  replace "$f" "@boilerplate/shared" "@${PROJECT_SLUG}/shared"
done

# Chercher tous les autres fichiers avec @boilerplate/shared
while IFS= read -r -d '' file; do
  replace "$file" "@boilerplate/shared" "@${PROJECT_SLUG}/shared"
done < <(grep -rl "@boilerplate/shared" . --include="*.ts" --include="*.tsx" --include="*.js" --include="*.json" --exclude-dir=node_modules -Z 2>/dev/null)

# --- vite.config.ts ---
log "vite.config.ts..."
replace "apps/platform/vite.config.ts" \
  "'vendor-shared': \['@boilerplate/shared'\]" \
  "'vendor-shared': ['@${PROJECT_SLUG}/shared']"

# --- index.html ---
log "index.html..."
replace "apps/platform/index.html" \
  "<title>Boilerplate Platform</title>" \
  "<title>${PROJECT_DISPLAY_NAME}</title>"
replace "apps/platform/index.html" \
  "boilerplate-theme" \
  "${PROJECT_SLUG}-theme"

# --- SharedNav constants.ts ---
log "SharedNav constants..."
replace "packages/shared/src/components/SharedNav/constants.ts" \
  "boilerplate-theme" \
  "${PROJECT_SLUG}-theme"

# --- SharedNav.tsx (texte affiché) ---
log "SharedNav.tsx..."
replace "packages/shared/src/components/SharedNav/SharedNav.tsx" \
  "alt=\"Boilerplate\"" \
  "alt=\"${PROJECT_DISPLAY_NAME}\""
replace "packages/shared/src/components/SharedNav/SharedNav.tsx" \
  ">Boilerplate<" \
  ">${PROJECT_DISPLAY_NAME}<"

# --- LoginPage.tsx ---
log "LoginPage..."
replace "apps/platform/src/modules/gateway/components/LoginPage.tsx" \
  ">Boilerplate<" \
  ">${PROJECT_DISPLAY_NAME}<"

# --- LandingPage.tsx ---
log "LandingPage..."
replace "apps/platform/src/modules/gateway/components/LandingPage.tsx" \
  "Boilerplate Platform" \
  "${PROJECT_DISPLAY_NAME}"

# --- docker-compose.yml ---
log "docker-compose.yml..."
replace "docker-compose.yml" \
  "container_name: boilerplate-db" \
  "container_name: ${PROJECT_SLUG}-db"

# --- docker-compose.prod.yml ---
log "docker-compose.prod.yml..."
replace "docker-compose.prod.yml" \
  "container_name: boilerplate-postgres" \
  "container_name: ${PROJECT_SLUG}-postgres"
replace "docker-compose.prod.yml" \
  "container_name: boilerplate-unified-server" \
  "container_name: ${PROJECT_SLUG}-unified-server"
replace "docker-compose.prod.yml" \
  "container_name: boilerplate-platform-client" \
  "container_name: ${PROJECT_SLUG}-platform-client"

# --- Dockerfile.prod (server) ---
log "Dockerfile.prod..."
replace "apps/platform/servers/unified/Dockerfile.prod" \
  "@boilerplate\\/shared" \
  "@${PROJECT_SLUG}\\/shared"

# --- deploy.sh ---
log "deploy.sh..."
replace "deploy.sh" \
  'PROJECT_NAME="boilerplate"' \
  "PROJECT_NAME=\"${PROJECT_SLUG}\""

# --- .deploy.env.example ---
log ".deploy.env.example..."
replace ".deploy.env.example" \
  "REMOTE_PATH=/opt/apps/boilerplate" \
  "REMOTE_PATH=/opt/apps/${PROJECT_SLUG}"

# --- .env.example ---
log ".env.example..."

# --- Mettre à jour package.json workspaces (remplacer @boilerplate/shared dans workspaces) ---
# (workspaces reference les chemins, pas le nom du package - pas de changement nécessaire)

# =============================================================================
# Créer le fichier .env depuis .env.example
# =============================================================================
if [ ! -f ".env" ]; then
  log "Création de .env..."
  cp .env.example .env
  ok ".env créé depuis .env.example"
fi

# =============================================================================
# Marquer comme initialisé
# =============================================================================
cat > ".initialized" <<EOF
PROJECT_SLUG=${PROJECT_SLUG}
PROJECT_DISPLAY_NAME=${PROJECT_DISPLAY_NAME}
PROJECT_DESCRIPTION=${PROJECT_DESCRIPTION}
INITIALIZED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
EOF

# Ajouter .initialized au .gitignore s'il n'y est pas
if ! grep -q "^\.initialized$" .gitignore 2>/dev/null; then
  echo ".initialized" >> .gitignore
fi

# =============================================================================
# Installation de OpenSpec (spec-driven development)
# =============================================================================
log "Installation de OpenSpec..."

# Vérifier si OpenSpec est déjà installé
if command -v openspec &> /dev/null; then
  ok "OpenSpec déjà installé ($(openspec --version 2>/dev/null || echo 'version inconnue'))"
else
  log "Installation de @fission-ai/openspec..."
  if npm install -g @fission-ai/openspec@latest; then
    ok "OpenSpec installé avec succès"
  else
    warn "Échec de l'installation globale d'OpenSpec. Vous pouvez l'installer manuellement :"
    warn "  npm install -g @fission-ai/openspec@latest"
  fi
fi

# Initialiser OpenSpec dans le projet
if [ ! -d ".openspec" ]; then
  log "Initialisation d'OpenSpec dans le projet..."
  if command -v openspec &> /dev/null; then
    openspec init --yes 2>/dev/null || openspec init 2>/dev/null || warn "Initialisation OpenSpec manuelle requise: openspec init"
    ok "OpenSpec initialisé"
  fi
fi

# =============================================================================
# Instructions suivantes
# =============================================================================
echo ""
echo -e "${BOLD}${GREEN}✓ Projet initialisé : ${PROJECT_DISPLAY_NAME}${NC}"
echo ""
echo -e "${BOLD}Prochaines étapes :${NC}"
echo ""
echo -e "  1. Installer les dépendances :"
echo -e "     ${CYAN}npm install${NC}"
echo ""
echo -e "  2. Lancer la base de données :"
echo -e "     ${CYAN}npm run db:start${NC}"
echo ""
echo -e "  3. Lancer le projet :"
echo -e "     ${CYAN}npm run dev${NC}"
echo ""
echo -e "  4. Se connecter sur http://localhost:5170"
echo -e "     Identifiant : ${CYAN}admin${NC} / Mot de passe : ${CYAN}admin${NC}"
echo ""
echo -e "${BOLD}Workflow OpenSpec (spec-driven development) :${NC}"
echo ""
echo -e "  Utiliser les commandes Claude Code :"
echo -e "     ${CYAN}/opsx:propose \"description de la feature\"${NC}  - Créer une spec"
echo -e "     ${CYAN}/opsx:apply${NC}                                  - Implémenter les tâches"
echo -e "     ${CYAN}/opsx:verify${NC}                                 - Vérifier l'implémentation"
echo -e "     ${CYAN}/opsx:archive${NC}                                - Archiver le travail terminé"
echo ""
echo -e "  Pour le déploiement distant :"
echo -e "     ${CYAN}cp .deploy.env.example .deploy.env${NC}"
echo -e "     ${CYAN}# Éditer .deploy.env puis : ./deploy-remote.sh deploy${NC}"
echo ""
