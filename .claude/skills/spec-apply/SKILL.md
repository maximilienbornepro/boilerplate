---
name: spec-apply
description: >
  Implémente les tâches d'un plan existant dans plans/<slug>/.
  Lit proposal.md, design.md, tasks.md, implémente tâche par tâche,
  coche les checkboxes, met à jour progress.md. Lance npm test à la fin.
triggers:
  - /spec:apply
  - spec apply
---

# /spec:apply

Implémente les tâches d'un plan existant. Lit les artifacts, implémente une tâche à la fois, tient à jour les checkboxes et progress.md.

**Input** : Nom du slug (optionnel — auto-détecté si un seul plan actif).

---

## Règles OBLIGATOIRES

### A. Vérification de sécurité avant tout code

AVANT d'écrire du code :
1. `git branch --show-current` ne doit PAS retourner `main`
2. `plans/<slug>/tasks.md` doit exister
3. `plans/<slug>/progress.md` doit exister (phase ≠ archive)

Si une condition échoue → STOP et expliquer.

### B. Toujours lire les artifacts avant d'implémenter

Lire dans cet ordre : `proposal.md` → `design.md` → `tasks.md` → `progress.md` → `specs/` (si présent).
Ne jamais improviser — s'en tenir au design approuvé.

### C. Mettre à jour les checkboxes et progress.md immédiatement

Après chaque tâche : `- [ ]` → `- [x]` dans tasks.md + entrée dans progress.md.

### D. Migrations SQL → appliquer immédiatement

Si un fichier `database/init/XX_*.sql` est créé, l'appliquer aussitôt :
```bash
CONTAINER=$(docker ps --filter "name=boilerplate-db" --format "{{.Names}}" 2>/dev/null | head -1)
[ -n "$CONTAINER" ] && docker exec -i "$CONTAINER" psql -U postgres -d app < <fichier.sql>
```

### E. npm test obligatoire à la fin

Lancer `npm test` une fois toutes les tâches complétées. Si des tests échouent : corriger avant de marquer l'implémentation comme terminée.

---

## Étapes

### 1. Sélectionner le plan

Si un nom est fourni → utiliser `plans/<nom>/`.

Sinon, lister les plans actifs (hors `archive/`) :
```bash
ls plans/ | grep -v archive | grep -v .gitkeep
```

- Si **un seul plan** → l'utiliser automatiquement, annoncer : "Utilisation du plan : `<slug>`"
- Si **plusieurs plans** → demander à l'utilisateur de choisir

### 2. Lire les artifacts

```bash
cat plans/<slug>/proposal.md
cat plans/<slug>/design.md
cat plans/<slug>/tasks.md
cat plans/<slug>/progress.md
ls plans/<slug>/specs/ 2>/dev/null && cat plans/<slug>/specs/**/*.md
```

### 3. Afficher l'état

```
## Implémentation : <slug>

**Branche** : feat/<slug>
**Tâches** : N/M complétées

### Restantes
- [ ] 2.1 ...
- [ ] 2.2 ...
```

### 4. Implémenter tâche par tâche

Pour chaque `- [ ]` dans tasks.md :

1. **Annoncer** : `Tâche N : <description>`
2. **Implémenter** les changements de code (en respectant design.md)
3. **Cocher** dans tasks.md : `- [ ]` → `- [x]`
4. **Mettre à jour** `plans/<slug>/progress.md` :
   - `Current Phase: implementation`
   - Ajouter entrée historique : `<ISO8601>: Tâche N.M complétée — <description courte>`
5. Passer à la tâche suivante

**Pause obligatoire si :**
- Tâche ambiguë ou incomplète → demander à l'utilisateur
- Blocage technique → expliquer le problème et attendre
- L'implémentation révèle un problème de design → signaler et proposer de mettre à jour design.md
- Erreur irrécupérable → STOP et reporter

### 5. À la fin — tests

```bash
npm test
```

**Si tests passent :**
```
## ✅ Implémentation terminée

**Plan** : <slug>
**Tâches** : M/M complétées
**Tests** : ✓

Lance `/spec:archive` ou `/spec:archive <slug>` pour archiver.
```

**Si tests échouent :**
Corriger les erreurs, relancer `npm test`, puis marquer comme terminé.

---

## Guardrails

- Lire les artifacts AVANT tout code
- Cocher les tâches AU FUR ET À MESURE (pas toutes à la fin)
- Ne pas implémenter sur `main`
- Pause sur erreurs, blocages ou ambiguïtés — ne jamais deviner
- Appliquer les migrations SQL dès qu'elles sont créées
- Ne jamais skipper la tâche `npm test`
- S'en tenir au design.md — ne pas improviser de nouvelles décisions d'architecture
