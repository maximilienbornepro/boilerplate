#!/bin/bash
set -e

# =============================================================================
# deploy-remote.sh - Déploiement distant via SSH
# Usage: ./deploy-remote.sh [command]
# Commands: deploy, quick, restart, logs, status, backup, ssh, exec
#
# RÈGLE : Les tests sont OBLIGATOIRES avant tout déploiement.
#         Si les tests échouent, le déploiement est annulé.
# =============================================================================

DEPLOY_ENV=".deploy.env"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${CYAN}[REMOTE]${NC} $1"; }
ok()   { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERROR]${NC} $1"; }

# --- Load config ---
load_config() {
  if [ ! -f "$DEPLOY_ENV" ]; then
    err "Fichier $DEPLOY_ENV manquant."
    err "Copiez .deploy.env.example vers .deploy.env et configurez-le."
    exit 1
  fi
  source "$DEPLOY_ENV"

  if [ -z "$REMOTE_HOST" ] || [ -z "$REMOTE_USER" ] || [ -z "$REMOTE_PATH" ]; then
    err "REMOTE_HOST, REMOTE_USER et REMOTE_PATH sont requis dans $DEPLOY_ENV"
    exit 1
  fi

  SSH_OPTS=""
  if [ -n "$SSH_KEY" ]; then
    SSH_OPTS="-i $SSH_KEY"
  fi
}

# --- SSH helper ---
remote_exec() {
  ssh $SSH_OPTS "$REMOTE_USER@$REMOTE_HOST" "cd $REMOTE_PATH && $1"
}

# =============================================================================
# TESTS OBLIGATOIRES AVANT DEPLOY
# =============================================================================
run_tests() {
  log "━━━ Exécution des tests unitaires ━━━"
  echo ""

  if npm test; then
    echo ""
    ok "Tous les tests passent"
    echo ""
  else
    echo ""
    err "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    err "  TESTS EN ÉCHEC - DÉPLOIEMENT ANNULÉ"
    err "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    err ""
    err "Corrigez les tests avant de déployer."
    err "  npm test          - lancer tous les tests"
    err "  npm run test:watch - mode watch"
    exit 1
  fi
}

# --- Deploy complet (tests + backup + pull + build + restart) ---
cmd_deploy() {
  load_config

  log "Déploiement complet vers $REMOTE_HOST"
  echo ""

  # Tests obligatoires en local
  run_tests

  log "Backup de la base distante..."
  remote_exec "./deploy.sh backup"

  log "Pull + build + restart sur le serveur..."
  remote_exec "./deploy.sh deploy"

  echo ""
  ok "━━━ Déploiement terminé avec succès ━━━"
  echo ""
  cmd_status
}

# --- Deploy rapide (tests + restart sans rebuild) ---
cmd_quick() {
  load_config

  log "Déploiement rapide vers $REMOTE_HOST"
  echo ""

  # Tests obligatoires en local
  run_tests

  log "Pull sur le serveur..."
  remote_exec "git pull origin main"

  log "Redémarrage des services..."
  remote_exec "./deploy.sh restart"

  echo ""
  ok "Déploiement rapide terminé"
}

# --- Restart distant ---
cmd_restart() {
  load_config
  log "Redémarrage des services sur $REMOTE_HOST..."
  remote_exec "./deploy.sh restart"
  ok "Services redémarrés"
}

# --- Logs distant ---
cmd_logs() {
  load_config
  local service="${2:-}"
  if [ -n "$service" ]; then
    ssh $SSH_OPTS -t "$REMOTE_USER@$REMOTE_HOST" "cd $REMOTE_PATH && docker compose -f docker-compose.prod.yml logs -f $service"
  else
    ssh $SSH_OPTS -t "$REMOTE_USER@$REMOTE_HOST" "cd $REMOTE_PATH && docker compose -f docker-compose.prod.yml logs -f"
  fi
}

# --- Status distant ---
cmd_status() {
  load_config
  log "État des services sur $REMOTE_HOST :"
  remote_exec "./deploy.sh status"
}

# --- Backup distant ---
cmd_backup() {
  load_config
  log "Backup de la base sur $REMOTE_HOST..."
  remote_exec "./deploy.sh backup"
}

# --- SSH interactif ---
cmd_ssh() {
  load_config
  log "Connexion SSH à $REMOTE_HOST..."
  ssh $SSH_OPTS -t "$REMOTE_USER@$REMOTE_HOST" "cd $REMOTE_PATH && bash"
}

# --- Exec commande distante ---
cmd_exec() {
  load_config
  shift
  local command="$*"
  if [ -z "$command" ]; then
    err "Usage: ./deploy-remote.sh exec <commande>"
    exit 1
  fi
  log "Exécution sur $REMOTE_HOST : $command"
  remote_exec "$command"
}

# --- Help ---
cmd_help() {
  echo ""
  echo "Usage: ./deploy-remote.sh [command]"
  echo ""
  echo "Commands:"
  echo "  deploy    Déploiement complet (tests + backup + pull + build + restart)"
  echo "  quick     Déploiement rapide (tests + pull + restart, sans rebuild)"
  echo "  restart   Redémarrer les services distants"
  echo "  logs      Voir les logs (optionnel: nom du service)"
  echo "  status    État des services distants"
  echo "  backup    Backup de la base distante"
  echo "  ssh       Connexion SSH interactive"
  echo "  exec      Exécuter une commande sur le serveur"
  echo ""
  echo "Prérequis:"
  echo "  - Fichier .deploy.env configuré (voir .deploy.env.example)"
  echo "  - deploy.sh présent sur le serveur distant"
  echo "  - Tous les tests doivent passer avant deploy/quick"
  echo ""
}

# --- Main ---
case "${1:-help}" in
  deploy)  cmd_deploy ;;
  quick)   cmd_quick ;;
  restart) cmd_restart ;;
  logs)    cmd_logs "$@" ;;
  status)  cmd_status ;;
  backup)  cmd_backup ;;
  ssh)     cmd_ssh ;;
  exec)    cmd_exec "$@" ;;
  *)       cmd_help ;;
esac
