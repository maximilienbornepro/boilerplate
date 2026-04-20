# Prompt Logs — hook Claude Code

Ce module ingère les prompts que tu envoies dans Claude Code via le hook
`UserPromptSubmit` (et optionnellement `Stop`), et les affiche dans la page
admin **/prompt-logs**.

---

## Endpoint

`POST /prompt-logs/api/events` — **public** (pas d'auth requise), accepte
n'importe quelle origine. C'est la seule route ingress. Les routes de lecture
sont admin-gated.

Payload accepté :

```json
{
  "session_id": "abc-123",
  "cwd": "/Users/francetv/Documents/workspace/boilerplate",
  "prompt": "le prompt que tu viens d'envoyer",
  "hook_event_name": "UserPromptSubmit"
}
```

Champs minimum requis : `session_id` + `cwd`. Tout le reste est optionnel.

---

## Configuration recommandée

### En local (dev)

Ajoute ça dans **`~/.claude/settings.json`** (crée le fichier si absent) :

```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "hooks": [{
        "type": "command",
        "command": "curl -s -X POST http://localhost:3010/prompt-logs/api/events -H 'Content-Type: application/json' -d @- || true"
      }]
    }]
  }
}
```

Notes :
- Le port **3010** est celui du serveur unifié en local (voir `.env` /
  `config.port`). Vérifie avec `docker compose ps` ou la sortie de
  `npm run dev:server`.
- Le `|| true` à la fin garantit que le hook n'interrompt jamais CC si le
  serveur est down — fire-and-forget strict.

### En prod (studio.vitess.tech)

Si tu veux logger ta session CC même quand tu codes sur un autre repo,
pointe vers l'endpoint prod :

```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "hooks": [{
        "type": "command",
        "command": "curl -s -X POST https://boilerplate.vitess.tech/prompt-logs/api/events -H 'Content-Type: application/json' -d @- || true"
      }]
    }]
  }
}
```

---

## Par-projet (au lieu du global)

Si tu préfères n'activer le hook que pour certains repos, mets le settings
dans `<repo>/.claude/settings.json` au lieu du global. Le hook ne sera actif
que quand CC est lancé depuis ce répertoire.

---

## Hook `Stop` (optionnel) — capturer la réponse de l'assistant

Le payload natif de `Stop` envoyé par Claude Code NE contient PAS le texte
de la réponse de Claude — seulement `session_id`, `transcript_path`,
`hook_event_name: "Stop"`. Pour récupérer ma dernière réponse texte, il
faut lire le `transcript_path` (fichier JSONL géré par CC).

Le script [`stop-hook.sh`](./stop-hook.sh) fait ça : il lit le transcript,
extrait le dernier message `assistant` qui contient du **texte** (ignore
les tool_use / thinking), et enrichit le payload avec `response_summary`
avant le POST.

### Installation

```bash
mkdir -p ~/.claude/bin
cp apps/platform/servers/unified/src/modules/promptLogs/stop-hook.sh ~/.claude/bin/prompt-logs-stop-hook.sh
chmod +x ~/.claude/bin/prompt-logs-stop-hook.sh
```

### Config `~/.claude/settings.json`

```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "hooks": [{
        "type": "command",
        "command": "curl -s -X POST http://localhost:3010/prompt-logs/api/events -H 'Content-Type: application/json' -d @- || true"
      }]
    }],
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "/Users/<YOU>/.claude/bin/prompt-logs-stop-hook.sh"
      }]
    }]
  }
}
```

Prérequis : `jq` installé (`brew install jq` sur macOS). Le script échoue
silencieusement si `jq` manque ou si le transcript n'est pas lisible — pas
d'impact sur CC.

---

## Vérifier que ça marche

1. Redémarre Claude Code (les hooks sont chargés au démarrage).
2. Envoie un prompt quelconque.
3. Va sur [http://localhost:5170/prompt-logs](http://localhost:5170/prompt-logs)
   et clique 🔄.
4. Tu devrais voir ton `cwd` apparaître dans la sidebar avec `1 prompt · 1
   session`.

Si rien n'apparaît :
- Vérifie que le serveur tourne : `curl http://localhost:3010/prompt-logs/api/events -X POST -H 'Content-Type: application/json' -d '{"session_id":"test","cwd":"/tmp"}'`
  → doit répondre `{"ok":true,"id":N}`.
- Vérifie les logs serveur pour `[PromptLogs] rejected event`.
- Regarde le fichier `~/.claude/claude.log` (si CC log les hooks).

---

## Filtrage des prompts sensibles

Il n'y a **pas** de filtrage automatique côté serveur — tout le `prompt_text`
est stocké tel quel. Si tu veux masquer des secrets avant l'envoi, pipe le
payload dans `sed` ou `jq` :

```json
{
  "command": "jq 'if .prompt | test(\"sk-[A-Za-z0-9]{20,}\") then .prompt = \"[REDACTED]\" else . end' | curl -s -X POST http://localhost:3010/prompt-logs/api/events -H 'Content-Type: application/json' -d @- || true"
}
```

---

## Modèle de données

Table `prompt_logs` créée automatiquement par `initPromptLogs()` au boot.
Schema : voir [`dbService.ts`](./dbService.ts).

Colonnes clé :
- `session_id` — ID de la session CC (stable entre prompts d'une même convo)
- `cwd` — répertoire de travail au moment du prompt (= projet)
- `event_kind` — `user_prompt` / `stop` / `tool_use` / `manual`
- `prompt_text` — le prompt utilisateur (tronqué à 100 000 chars)
- `git_commit_sha` — optionnel, pour comptage d'itérations entre commits
- `metadata` — JSONB libre

Indexes : `(cwd, created_at DESC)`, `(session_id, created_at)`,
`(event_kind, created_at DESC)`.

---

## Roadmap

- **V1 (actuel)** : ingest + viewer par projet/session/événement.
- **V2** : compteur d'itérations entre `git commit` (nécessite que le hook
  envoie aussi `git_commit_sha`).
- **V3** : export CSV, dashboard (top fichiers touchés, distribution du
  nombre de prompts par feature).
