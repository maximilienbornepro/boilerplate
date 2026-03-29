---
name: spec-apply
description: >
  Implémente les tâches d'un plan dans plans/<slug>/.
  Lit proposal.md + design.md + tasks.md, implémente tâche par tâche,
  coche les checkboxes, lance npm test à la fin.
triggers:
  - /spec:apply
  - spec apply
---

# /spec:apply

Implémente un plan existant. Tâche par tâche, avec checkboxes et tests.

**Input** : Slug du plan (optionnel — auto-détecté si un seul plan actif).

---

## Règles

- Lire les artifacts AVANT d'écrire du code
- Ne pas implémenter sur `main`
- Cocher les tâches AU FUR ET À MESURE
- Appliquer les migrations SQL immédiatement après création
- `npm test` obligatoire à la fin

---

## Étapes

### 1. Trouver le plan

```bash
ls plans/ | grep -v archive | grep -v .gitkeep
```

Auto-sélectionner si un seul actif, sinon demander.

### 2. Lire les artifacts

```bash
cat plans/<slug>/proposal.md
cat plans/<slug>/design.md
cat plans/<slug>/tasks.md
```

### 3. Afficher l'état

```
## Implémentation : <slug>
Tâches : N/M complétées

Restantes :
- [ ] ...
```

### 4. Implémenter tâche par tâche

Pour chaque `- [ ]` :
1. Annoncer la tâche
2. Coder
3. Cocher `- [x]` dans tasks.md
4. Continuer

**Pause si** : tâche ambiguë, blocage, ou problème de design découvert.

**Migrations SQL** : appliquer immédiatement :
```bash
CONTAINER=$(docker ps --filter "name=boilerplate-db" --format "{{.Names}}" | head -1)
[ -n "$CONTAINER" ] && docker exec -i "$CONTAINER" psql -U postgres -d app < <fichier.sql>
```

### 5. Tests

```bash
npm test
```

Si tout passe :
```
✅ Implémentation terminée — M/M tâches, tests OK
```
