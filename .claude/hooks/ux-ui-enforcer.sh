#!/usr/bin/env bash
#
# PreToolUse hook — UX/UI Guard enforcer.
#
# FLOW
#   1. Claude tries to Write/Edit a UI file (.tsx/.jsx/.css/.html in scope).
#   2. This hook blocks the tool call with stderr → Claude must :
#      a. List the shared components it plans to use (from design-system.data.json).
#      b. List the design tokens it will reference.
#      c. Ask the user for explicit confirmation.
#      d. Touch `.claude/.ux-ui-ack` to signal "checklist done + user approved".
#      e. Retry the Write/Edit — it will pass because the ack is fresh (≤ 5 min).
#
# The ack file has a 5-minute TTL so the discipline reapplies after any
# pause in the UI work.
#
# Input : JSON object on stdin with tool_name + tool_input (file_path + content).
# Output :
#   · exit 0 → tool proceeds
#   · exit 2 → tool blocked, stderr message delivered to Claude
#
# Config : referenced from `.claude/settings.json` via hooks.PreToolUse.

set -e

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
ACK_FILE="$REPO_ROOT/.claude/.ux-ui-ack"
ACK_TTL_SECONDS=300 # 5 minutes

# ── Read tool payload from stdin ─────────────────────────────────────────────
PAYLOAD="$(cat)"

# Extract the tool name and the target file path robustly (tolerant parser).
TOOL_NAME="$(echo "$PAYLOAD" | grep -o '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')"
FILE_PATH="$(echo "$PAYLOAD" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')"

# Only fire on Write/Edit.
case "$TOOL_NAME" in
  Write|Edit)
    ;;
  *)
    exit 0
    ;;
esac

# ── Is this a UI-impacting file ? ────────────────────────────────────────────
# Extension must be a UI artefact.
case "$FILE_PATH" in
  *.tsx|*.jsx|*.html|*.css|*.module.css)
    ;;
  *)
    exit 0
    ;;
esac

# Path must be in scope : the 5 modules we ship, or the shared components.
# Patterns tolerate both relative ("apps/...") and absolute ("/Users/.../apps/...") forms.
IN_SCOPE=false
case "$FILE_PATH" in
  *apps/platform/src/modules/gateway/components/LandingPage*|\
  *apps/platform/src/modules/roadmap/*|\
  *apps/platform/src/modules/conges/*|\
  *apps/platform/src/modules/delivery/*|\
  *apps/platform/src/modules/suivitess/*|\
  *packages/shared/src/components/*)
    IN_SCOPE=true
    ;;
esac

if [ "$IN_SCOPE" = false ]; then
  exit 0
fi

# ── Harmonisation check ─────────────────────────────────────────────────────
# Inspect the incoming content (new_string / content) for JSX tags that
# LOOK LIKE they could reuse a shared component but don't. We warn the
# agent so it can validate alignment with `design-system.data.json`
# before proceeding.
CONTENT="$(echo "$PAYLOAD" | grep -oE '"(content|new_string)"[[:space:]]*:[[:space:]]*"([^"\\]|\\.)*"' | head -1 | sed 's/^"[^"]*"[[:space:]]*:[[:space:]]*"//;s/"$//')"

# Components we actively share — if the content contains a JSX tag with
# one of these names but NOT imported, the agent likely re-rolled a
# local equivalent. Heuristic only — exhaustive enough to catch the
# common drifts.
SHARED_HINTS="Button Modal ConfirmModal FormField Card LoadingSpinner Tabs Toast ToastContainer ModuleHeader VisibilityPicker SharingModal ExpandableSection Badge"

HARMONISATION_WARNING=""
if [ -n "$CONTENT" ]; then
  for hint in $SHARED_HINTS; do
    # Does the content RENDER something named <Xxx... that matches a
    # shared name, without importing from shared ?
    if echo "$CONTENT" | grep -qE "<${hint}[[:space:]/>]"; then
      if ! echo "$CONTENT" | grep -qE "from ['\"]@boilerplate/shared/components['\"]"; then
        HARMONISATION_WARNING="${HARMONISATION_WARNING}  • <${hint}> detecte mais pas d'import depuis @boilerplate/shared/components.\n"
      fi
    fi
  done
fi

# ── Fresh ack ? ──────────────────────────────────────────────────────────────
if [ -f "$ACK_FILE" ]; then
  ACK_MTIME=$(stat -f '%m' "$ACK_FILE" 2>/dev/null || stat -c '%Y' "$ACK_FILE" 2>/dev/null || echo 0)
  NOW=$(date +%s)
  AGE=$((NOW - ACK_MTIME))
  if [ "$AGE" -le "$ACK_TTL_SECONDS" ]; then
    # User-approved checklist is still valid → allow (the user has seen
    # and validated the plan; harmonisation has been discussed).
    exit 0
  fi
fi

# ── Block with instructions ─────────────────────────────────────────────────
# Decide whether the file is in shared (more critical) or in a module.
SCOPE_KIND="module"
case "$FILE_PATH" in
  *packages/shared/src/components/*)
    SCOPE_KIND="shared"
    ;;
esac

cat >&2 <<EOF
╔══════════════════════════════════════════════════════════════════════════════╗
║  UX / UI GUARD — écriture bloquée                                            ║
╚══════════════════════════════════════════════════════════════════════════════╝

Fichier ciblé : $FILE_PATH
Catégorie     : ${SCOPE_KIND}
EOF

if [ -n "$HARMONISATION_WARNING" ]; then
  printf "\n⚠ HARMONISATION — drift potentiel détecté dans le contenu :\n" >&2
  printf "%b" "$HARMONISATION_WARNING" >&2
  printf "  Vérifier que chaque tag JSX utilise bien un composant importé depuis\n  @boilerplate/shared/components si l'équivalent existe.\n\n" >&2
fi

cat >&2 <<EOF

Avant de poursuivre cette écriture, tu DOIS :

  1. Lire la source de vérité  :  \`cat design-system.data.json\`
     (composants shared utilisés, locaux par module, duplicates)

  2. VÉRIFIER L'ALIGNEMENT — pour chaque composant que tu comptes
     utiliser ou modifier :
     · S'il y a un équivalent dans \`shared.used\` du JSON → l'utiliser tel quel.
     · S'il y a une implémentation locale dans \`localByModule\` d'un autre
       module en scope → la réutiliser ou la promouvoir.
     · Si c'est un nouveau pattern → justifier pourquoi aucun existant
       ne convient.

  3. Présenter à l'utilisateur la checklist suivante, en message clair :

        ┌──────────────────────────────────────────────┐
        │ UX-UI GUARD — Checklist avant écriture       │
        └──────────────────────────────────────────────┘
        • Fichier          : <chemin>
        • Intent           : <1-2 phrases expliquant le changement>
        • Composants shared utilisés (depuis DS) : <liste>
        • Composants locaux existants réutilisés  : <liste>
        • Alignement avec le DS vérifié ?          : oui (lu + validé)
        • Design tokens (var(--…))                 : <liste>
        • Nouveau pattern ?                        : oui/non (si oui, justifier)
        •
        • Tu confirmes ? (réponds « oui » pour débloquer)

  4. ATTENDRE la confirmation explicite de l'utilisateur (« oui », « ok », « go »).

  5. Une fois confirmé, débloquer en exécutant :

        touch .claude/.ux-ui-ack

     (ack valide 5 min → couvre une vague d'édits cohérente, puis repart
     à zéro — la discipline reapplique au prochain fichier)

  6. Relancer ton Write / Edit — il passera cette fois-ci.

--- Pourquoi ce blocage ? -----------------------------------------------------
Le skill \`ux-ui-guard\` impose la réutilisation des composants existants
(design-system.data.json) avant toute création, ET la vérification
systématique que tu utilises bien les composants du DS existants plutôt
que d'en recréer localement. Ce hook PreToolUse est le filet de sécurité.

Voir \`.claude/skills/ux-ui-guard/skill.md\` pour le workflow complet.
EOF

exit 2
