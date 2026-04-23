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
PREVIEW_FILE="$REPO_ROOT/apps/platform/src/ux-preview/currentPreview.tsx"
ACK_TTL_SECONDS=300 # 5 minutes
# Preview must be no older than the ack — if the user approved an ack at
# T0, the preview they saw cannot be older than 10 min before T0.
PREVIEW_MAX_AGE_BEFORE_ACK=600

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

# ── Fresh ack ? + Preview rendered ? ────────────────────────────────────────
# Two-gate check before allowing a UI write :
#   1. Fresh ack file (user said « oui » within last 5 min)
#   2. Preview sandbox written recently (Claude populated currentPreview.tsx
#      BEFORE the ack — proves the user saw the visual before confirming)
# Both must pass ; otherwise the hook blocks with the right instructive
# message.

PREVIEW_REASON=""
if [ -f "$ACK_FILE" ]; then
  ACK_MTIME=$(stat -f '%m' "$ACK_FILE" 2>/dev/null || stat -c '%Y' "$ACK_FILE" 2>/dev/null || echo 0)
  NOW=$(date +%s)
  AGE=$((NOW - ACK_MTIME))
  if [ "$AGE" -le "$ACK_TTL_SECONDS" ]; then
    # Ack is fresh. Now require that the preview sandbox was populated
    # at most PREVIEW_MAX_AGE_BEFORE_ACK seconds BEFORE the ack — which
    # means Claude actually wrote a snippet for the user to visualise.
    if [ ! -f "$PREVIEW_FILE" ]; then
      PREVIEW_REASON="Le fichier preview n'existe pas — impossible de debloquer sans visualisation"
    else
      PREVIEW_MTIME=$(stat -f '%m' "$PREVIEW_FILE" 2>/dev/null || stat -c '%Y' "$PREVIEW_FILE" 2>/dev/null || echo 0)
      # preview must be older than the ack (written BEFORE user approval)
      # but not older than the ack by more than PREVIEW_MAX_AGE_BEFORE_ACK.
      if [ "$PREVIEW_MTIME" -ge "$ACK_MTIME" ]; then
        PREVIEW_REASON="Preview ecrite APRES l'ack — l'ordre est invalide (preview doit preceder la confirmation)"
      else
        PREVIEW_AGE_BEFORE_ACK=$((ACK_MTIME - PREVIEW_MTIME))
        if [ "$PREVIEW_AGE_BEFORE_ACK" -gt "$PREVIEW_MAX_AGE_BEFORE_ACK" ]; then
          PREVIEW_REASON="Preview trop ancienne (> 10 min avant l'ack) — l'utilisateur n'a probablement pas revu le rendu"
        else
          # Both conditions met → allow.
          exit 0
        fi
      fi
    fi
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

if [ -n "$PREVIEW_REASON" ]; then
  printf "\n⚠ PREVIEW — raison du blocage spécifique :\n  %s\n" "$PREVIEW_REASON" >&2
fi

if [ -n "$HARMONISATION_WARNING" ]; then
  printf "\n⚠ HARMONISATION — drift potentiel détecté dans le contenu :\n" >&2
  printf "%b" "$HARMONISATION_WARNING" >&2
  printf "  Vérifier que chaque tag JSX utilise bien un composant importé depuis\n  @boilerplate/shared/components si l'équivalent existe.\n\n" >&2
fi

cat >&2 <<EOF

Avant de poursuivre cette écriture, tu DOIS enchaîner les 4 étapes suivantes
DANS L'ORDRE :

  ── Étape 1 — Lire la source de vérité ─────────────────────────────────────

     cat design-system.data.json

  ── Étape 2 — Présenter la checklist ──────────────────────────────────────

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

  ── Étape 3 — Preview sandbox OBLIGATOIRE ──────────────────────────────────

     3a. Écrire le snippet à valider dans :
           apps/platform/src/ux-preview/currentPreview.tsx

         Contraintes :
           · export default d'un composant React self-contained
           · imports shared + types autorisés
           · aucune dépendance runtime (pas de fetch, pas de hook
             externe, mocks inline si besoin)

     3b. Indiquer à l'utilisateur l'URL à visualiser :

           /ux-preview?appId=<module-cible>

         (appId possible : conges, roadmap, delivery, suivitess,
          design-system — contrôle la cascade de --accent-primary)

     3c. ATTENDRE la confirmation visuelle explicite (« oui », « ok », « go »).

  ── Étape 4 — Débloquer et écrire pour de vrai ─────────────────────────────

     4a. Une fois le « oui » reçu :   touch .claude/.ux-ui-ack
     4b. Relancer le Write/Edit sur le fichier cible — il passera.

  ── Étape 5 — Remettre la sandbox à zéro ───────────────────────────────────

     Après l'écriture réelle, restaurer le placeholder par défaut dans
     currentPreview.tsx (voir l'en-tête du fichier pour le contenu).

--- Règles du hook ------------------------------------------------------------
Le hook vérifie 2 conditions cumulatives pour autoriser une écriture UI :
  · un .claude/.ux-ui-ack fraichement crée (≤ 5 min)
  · un currentPreview.tsx écrit AVANT l'ack (≤ 10 min avant)

Ça garantit que l'utilisateur a vu le rendu visuel AVANT de confirmer.

Voir \`.claude/skills/ux-ui-guard/skill.md\` pour le workflow complet.
EOF

exit 2
