# Proposal: Embed Support in Module Creator

## Description

Ajouter le support des embeds publics dans le skill `module-creator` et le core du boilerplate. Chaque module peut optionnellement etre accessible en mode embed (public, sans authentification).

## Objectifs

1. Modifier le skill `module-creator` pour proposer l'option embed
2. Ajouter la detection `?embed=` dans le core (App.tsx)
3. Generer les fichiers embed quand l'option est activee
4. Documenter le pattern embed

## Scope

### Core (boilerplate)
- `App.tsx` : Detection `?embed=ID` → skip auth
- `Layout` : Support prop `noNav` pour mode embed

### Skill module-creator
- Question "Activer l'embed public ?"
- Generation `EmbedView.tsx` si oui
- Generation route backend `/embed/:id` (publique)
- CSS embed minimal
- Bouton "Copier lien embed"

## Out of Scope

- Gestion admin des embeds (pas necessaire, par design)
- Tokens/authentification pour embeds (acces public par ID)
- Configuration nginx (a faire separement si besoin)

## Acceptance Criteria

- [ ] App.tsx detecte `?embed=` et skip l'auth
- [ ] Skill module-creator propose l'option embed
- [ ] Si embed active, genere EmbedView + route publique
- [ ] Documentation mise a jour dans CLAUDE.md
