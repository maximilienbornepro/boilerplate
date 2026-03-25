---
name: deploy
description: Deployer l'application en production via deploy-remote.sh
invocation: user
---

# Deploiement en production

## REGLE ABSOLUE

**Toujours utiliser `./deploy-remote.sh` depuis la machine locale.**
Ne JAMAIS se connecter en SSH pour deployer manuellement.
Ne JAMAIS executer `deploy.sh` directement - c'est le script cote serveur, appele automatiquement par `deploy-remote.sh`.

## Commandes disponibles

| Commande | Usage |
|----------|-------|
| `./deploy-remote.sh deploy` | Deploiement complet (tests + backup + build Docker + restart) |
| `./deploy-remote.sh quick` | Deploiement rapide (tests + pull + restart, sans rebuild Docker) |
| `./deploy-remote.sh restart` | Redemarrer les services distants |
| `./deploy-remote.sh logs` | Voir les logs distants |
| `./deploy-remote.sh status` | Etat des services distants |
| `./deploy-remote.sh backup` | Backup de la base distante |

## Workflow de deploiement

1. **Verifier** que tous les tests passent localement (`npm test`)
2. **Commiter et pusher** les changements sur origin
3. **Executer** `./deploy-remote.sh deploy` (ou `quick` si pas de changement Docker)
4. **Verifier** les logs apres deploiement : `./deploy-remote.sh logs`
5. **Verifier** le statut : `./deploy-remote.sh status`

## Quand utiliser `deploy` vs `quick`

- **`deploy`** : Changements dans `Dockerfile.prod`, `docker-compose.prod.yml`, `package.json` (nouvelles deps), ou `nginx.conf`
- **`quick`** : Changements de code uniquement (TypeScript, CSS, HTML)

## Pre-requis

- Fichier `.deploy.env` configure (copier `.deploy.env.example`)
- Acces SSH au serveur
- Git initialise sur le serveur distant (origin pointe vers le repo)

## Reverse proxy (proxy-network)

Si le serveur utilise un **shared-proxy** (nginx partage entre plusieurs apps), les containers doivent etre sur le reseau `proxy-network` pour que le proxy puisse les atteindre.

**Dans `docker-compose.prod.yml`** :
```yaml
services:
  unified-server:
    networks:
      - app-network
      - proxy-network    # Necessaire pour le reverse proxy

  platform-client:
    networks:
      - app-network
      - proxy-network    # Necessaire pour le reverse proxy

networks:
  app-network:
    driver: bridge
  proxy-network:
    external: true       # Reseau cree par le shared-proxy
```

**IMPORTANT** : Sans `proxy-network`, le site retourne 502/maintenance apres chaque deploiement car les containers sont recrees et perdent la connexion au proxy.

### Verifier la connectivite
```bash
# Voir les reseaux d'un container
ssh <user>@<host> "docker inspect <container> --format '{{range \$k, \$v := .NetworkSettings.Networks}}{{\$k}} {{end}}'"

# Connecter manuellement si necessaire (temporaire)
ssh <user>@<host> "docker network connect proxy-network <container>"
```

## Depannage

### Site en maintenance / 502 apres deploy
Cause probable : les containers ne sont pas sur `proxy-network`.
Fix : ajouter `proxy-network` dans `docker-compose.prod.yml` (voir section ci-dessus).

### `Permission denied` sur deploy.sh
```bash
ssh <user>@<host> "chmod +x /path/to/deploy.sh"
```

### Container qui redemarre en boucle
```bash
./deploy-remote.sh logs
```
Verifier les erreurs dans les logs du container concerne.

### `not a git repository` sur le serveur
```bash
ssh <user>@<host> "cd /path/to/app && git init && git remote add origin <repo-url> && git fetch origin main && git reset --hard origin/main"
```

### API retourne 200 ou 404 une fois sur deux (round-robin fantome)
**Cause** : `nginx -s reload` ne suffit pas quand les routes ou upstreams changent (ex: renommage de module). Les anciens worker processes gardent la resolution DNS en cache et servent l'ancienne config en alternance avec les nouveaux workers.

**Symptome** : les requetes API retournent alternativement 200 et 404.

**Fix** : toujours faire un `docker restart` complet du shared-proxy apres un changement de routes, jamais un simple `nginx -s reload`.
```bash
ssh <user>@<host> "docker restart shared-proxy"
```

**REGLE** : apres tout renommage de module ou changement de config nginx, toujours :
```bash
# 1. Mettre a jour la config
sed -i 's/old-name/new-name/g' /opt/apps/proxy/nginx/nginx.conf

# 2. Tester la syntaxe
docker exec shared-proxy nginx -t

# 3. RESTART complet (pas reload)
docker restart shared-proxy
```

### Scripts sans permission d'execution apres deploy
Le `git reset --hard` peut retirer les permissions d'execution. Fix :
```bash
ssh <user>@<host> "chmod +x /path/to/deploy.sh /path/to/deploy-remote.sh /path/to/init.sh"
```

## Ce que fait deploy-remote.sh

1. Execute `npm test` en local (bloquant si echec)
2. Se connecte en SSH au serveur
3. Execute `deploy.sh` sur le serveur qui :
   - Backup la base de donnees
   - `git pull origin main`
   - Rebuild les images Docker si necessaire
   - Restart les containers
   - Healthcheck des services
