---
name: spec-archive
description: >
  Archive un plan terminé : vérifie les tâches complètes et les tests,
  déplace plans/<slug>/ vers plans/archive/YYYY-MM-DD-<slug>/,
  propose le merge de branche.
triggers:
  - /spec:archive
  - spec archive
---

# /spec:archive

Archive un plan terminé. Vérifie la complétude, lance les tests, déplace vers l'archive, propose le merge.

**Input** : Nom du slug (optionnel).

---

## Règles OBLIGATOIRES

### A. npm test avant archive
Toujours lancer `npm test` avant d'archiver. Si les tests échouent → STOP.

### B. Merge et suppression de branche = confirmation explicite
Ne jamais merger ou supprimer une branche sans demander à l'utilisateur.

### C. Mettre à jour progress.md avant de déplacer
Phase → "Archive", Status → "completed", ajouter entrée historique.

---

## Étapes

### 1. Sélectionner le plan

```bash
ls plans/ | grep -v archive | grep -v .gitkeep
```

Auto-sélectionner si un seul plan actif, sinon demander.

### 2. Vérifier la complétude

**Tâches restantes :**
```bash
grep -c "\- \[ \]" plans/<slug>/tasks.md
```
Si N > 0 : "N tâches incomplètes. Archiver quand même ?" (avertissement, pas bloquant)

**Tests :**
```bash
npm test
```
Si échec → STOP. Corriger les tests d'abord.

### 3. Mettre à jour progress.md

```markdown
- Current Phase: archive
- Status: completed

## Historique
- <ISO8601>: Archivé via /spec:archive
```

### 4. Déplacer vers l'archive

```bash
mkdir -p plans/archive
DATE=$(date +%Y-%m-%d)
TARGET="plans/archive/${DATE}-<slug>"

# Vérifier que la cible n'existe pas
if [ -d "$TARGET" ]; then
  echo "Erreur : $TARGET existe déjà"
  exit 1
fi

mv plans/<slug> "$TARGET"
```

### 5. Proposer le merge

Lire la branche parent dans progress.md (généralement `main`).

```
Le plan a été archivé dans plans/archive/<date>-<slug>/.

La branche feat/<slug> est prête à merger dans <parent>.
Veux-tu que je fasse le merge ? (oui/non)
```

Si l'utilisateur confirme :
```bash
git checkout <parent>
git merge feat/<slug> --no-ff -m "feat: <slug> — merge plan"
```

Puis demander pour la suppression :
```
La branche feat/<slug> a été mergée.
Veux-tu que je la supprime ? (oui/non)
```

### 6. Résumé

```
## ✅ Archive terminée

**Plan** : <slug>
**Archivé** : plans/archive/<date>-<slug>/
**Merge** : ✓ dans <parent> (ou "non effectué")
**Branche** : supprimée (ou "conservée")
```

---

## Guardrails

- Ne jamais archiver si npm test échoue
- Confirmation explicite pour merge et suppression de branche
- Conserver l'intégralité du répertoire dans l'archive (specs/ inclus)
- Si la cible d'archive existe : erreur, ne pas écraser
