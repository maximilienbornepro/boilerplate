---
name: openspec
description: Workflow OpenSpec - Spec-driven development avec @fission-ai/openspec
invocation: user
---

# OpenSpec - Spec-Driven Development

Ce skill utilise l'outil **@fission-ai/openspec** pour un developpement specification-first.

## Prerequis

OpenSpec doit etre installe et initialise. Verifier :

```bash
# Verifier l'installation
openspec --version

# Si non installe
npm install -g @fission-ai/openspec@latest

# Initialiser dans le projet (si pas deja fait)
openspec init
```

## Workflow Principal

### 1. Proposer une feature

Avant d'ecrire du code, creer une specification :

```
/opsx:propose "description de la fonctionnalite"
```

Exemple :
```
/opsx:propose "Ajouter un module de gestion des utilisateurs avec CRUD complet"
```

Cela cree un dossier dans `.openspec/` avec :
- `proposal.md` - Description de la proposition
- `specs/` - Specifications detaillees
- `design.md` - Decisions de conception
- `tasks.md` - Liste des taches a implementer

### 2. Implementer les taches

Une fois la spec approuvee, implementer :

```
/opsx:apply
```

Cette commande traite les taches definies dans `tasks.md`.

### 3. Verifier l'implementation

Apres implementation, verifier que tout est conforme :

```
/opsx:verify
```

### 4. Archiver le travail termine

Une fois la feature terminee et testee :

```
/opsx:archive
```

## Commandes Supplementaires

| Commande | Description |
|----------|-------------|
| `/opsx:new` | Creer une nouvelle specification |
| `/opsx:continue` | Continuer le travail en cours |
| `/opsx:sync` | Synchroniser les specs avec le code |
| `/opsx:status` | Voir l'etat actuel |

## Configuration

Configurer votre profil OpenSpec :

```bash
openspec config profile
```

Mettre a jour les slash commands :

```bash
openspec update
```

## Integration avec le Boilerplate

### Mode OpenSpec (CLAUDE.md)

Le mode OpenSpec du boilerplate s'integre avec l'outil :

```bash
# Verifier le mode
cat .claude/config 2>/dev/null | grep OPENSPEC_MODE || echo "OPENSPEC_MODE=on"
```

Quand le mode est **ON** :
- Toujours utiliser `/opsx:propose` avant d'implementer
- Travailler sur des branches dediees (`feat/`, `fix/`, `refactor/`)
- Ne jamais commit directement sur `main`
- Inclure les tests unitaires

### Structure du projet avec OpenSpec

```
projet/
├── .openspec/              # Dossier OpenSpec
│   ├── config.yaml         # Configuration
│   └── changes/            # Historique des changements
│       └── <feature>/
│           ├── proposal.md
│           ├── specs/
│           ├── design.md
│           └── tasks.md
├── specs/                  # Specs manuelles (optionnel)
└── ...
```

### Workflow complet pour une nouvelle feature

```bash
# 1. Creer une branche
git checkout -b feat/ma-feature

# 2. Proposer la spec (dans Claude Code)
/opsx:propose "Description de ma feature"

# 3. Revoir et ajuster la spec generee
# Editer .openspec/changes/<feature>/proposal.md si necessaire

# 4. Implementer
/opsx:apply

# 5. Verifier
/opsx:verify

# 6. Tester
npm test

# 7. Commit et push
git add .
git commit -m "feat: ajouter ma-feature"
git push -u origin feat/ma-feature

# 8. Archiver
/opsx:archive
```

## Bonnes Pratiques

1. **Spec d'abord** : Toujours `/opsx:propose` avant d'ecrire du code
2. **Revue humaine** : Relire la spec generee avant `/opsx:apply`
3. **Tests inclus** : Les specs doivent definir les tests requis
4. **Branches isolees** : Une branche par feature
5. **Archivage** : Utiliser `/opsx:archive` pour garder un historique propre

## Troubleshooting

### OpenSpec non reconnu

```bash
# Reinstaller
npm install -g @fission-ai/openspec@latest

# Verifier le PATH
which openspec
```

### Reinitialiser OpenSpec

```bash
# Supprimer et reinitialiser
rm -rf .openspec
openspec init
```

### Mettre a jour les commandes

```bash
openspec update
```
