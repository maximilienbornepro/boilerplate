# Proposal : Skill Page Composer

## Pourquoi

Modifier les pages des modules demande de connaitre les composants disponibles, les tokens CSS, et les patterns du boilerplate. Un skill dedie centralise cette connaissance et montre le resultat live dans l'apercu Claude Preview, sans aller-retour terminal/navigateur.

## Ce qui change

- Nouveau skill `.claude/skills/page-composer/skill.md`
- Creation de `.claude/launch.json` pour configurer le dev server Preview
- Le skill charge le catalogue des composants (`@boilerplate/shared`) et tokens (`theme.css`)
- Il modifie les fichiers des modules existants et utilise `preview_start` + `preview_screenshot` pour montrer le rendu

## Capacites

- `compose` : Creer/modifier une page en decrivant ce qu'on veut
- `preview` : Voir le rendu live dans l'apercu Claude apres chaque modification
- `catalog` : Lister les composants et tokens disponibles
- `inspect` : Analyser une page existante et proposer des ameliorations

## Scope

| Fichier | Description |
|---------|-------------|
| `.claude/skills/page-composer/skill.md` | Le skill principal |
| `.claude/launch.json` | Config dev server pour Preview MCP |

## Criteres d'acceptation

1. `/page-composer` lance le skill et affiche le catalogue des composants disponibles
2. L'utilisateur decrit une page ou une modification, le skill edite les fichiers du module cible
3. Apres chaque modification, le skill lance un screenshot Preview pour montrer le rendu
4. Le skill utilise **uniquement** les composants de `@boilerplate/shared` et les tokens de `theme.css`
5. Le skill respecte les patterns existants (Layout, ModuleHeader, CSS modules, etc.)
