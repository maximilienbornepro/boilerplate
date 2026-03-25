# Proposal: Auto-sync with Boilerplate Before Commit

## Description

Les projets derives du boilerplate doivent se synchroniser automatiquement avec le boilerplate upstream **avant chaque commit**. Cela garantit que les projets restent a jour et evite les divergences importantes.

## Objectifs

1. Rappeler a l'utilisateur de synchroniser avant de commit
2. Fournir une methode simple pour verifier/appliquer les mises a jour
3. Documenter le workflow dans CLAUDE.md
4. **Merge automatique sur main** lors du `/opsx:validate` (archive)

## Scope

- Ajouter une section dans CLAUDE.md pour les projets derives
- Optionnel : creer un skill `sync-boilerplate` pour automatiser

## Out of Scope

- Modification du script `sync-boilerplate.sh` (deja existant)
- Hooks git automatiques (trop intrusif)

## Acceptance Criteria

- [ ] CLAUDE.md contient les instructions de sync avant commit
- [ ] Le workflow est clair et documenté
