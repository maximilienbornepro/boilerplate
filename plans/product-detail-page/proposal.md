# Proposal: Page detail produit

## Description

Ajouter une page de detail pour chaque produit, accessible en cliquant sur le nom d'un produit dans la liste. Cette page affiche toutes les informations du produit de maniere claire et permet de revenir a la liste ou de modifier le produit.

## Objectifs

1. Creer un composant `ProductDetail` affichant toutes les informations d'un produit
2. Ajouter le routing interne au module products (`/products/:id`)
3. Rendre le nom du produit cliquable dans la liste
4. Permettre la navigation fluide : liste -> detail -> liste

## Existant (ne pas modifier)

Ces elements existent deja et seront reutilises :

| Element | Fichier | Usage |
|---------|---------|-------|
| API GET product | `services/api.ts:fetchProduct` | Charger un produit par ID |
| Mode embed | `components/EmbedView/` | Vue publique d'un produit (via `?embed=ID`) |
| Modal modification | `components/ProductForm/` | Formulaire d'edition |
| Backend | `/products-api/products/:id` | Endpoint existant |

## Scope (a implementer)

### Composants a creer

| Fichier | Description |
|---------|-------------|
| `components/ProductDetail/ProductDetail.tsx` | Vue detail du produit (authentifie) |
| `components/ProductDetail/ProductDetail.module.css` | Styles |
| `components/ProductDetail/index.ts` | Export |

### Composants a modifier

| Fichier | Modification |
|---------|--------------|
| `ProductList.tsx` | Nom cliquable + callback `onView` |
| `App.tsx` | Ajouter React Router pour navigation interne |

### Fonctionnalites incluses

- Navigation liste -> detail via click sur le nom
- Affichage complet du produit (nom, description, prix, categorie, stock, dates)
- Bouton "Retour" vers la liste
- Bouton "Modifier" ouvrant le modal existant `ProductForm`
- Bouton "Copier lien embed" pour partager le produit en mode public

## Out of Scope (exclus volontairement)

| Element | Raison |
|---------|--------|
| Edition inline | Le modal existant suffit, pas besoin de dupliquer |
| Suppression depuis detail | Garder la suppression dans la liste uniquement |
| Pagination/filtres | Feature separee, hors de cette spec |

## Criteres d'acceptation

1. Cliquer sur le nom d'un produit dans la liste navigue vers `/products/:id`
2. La page detail affiche : nom, description, prix, categorie, stock, dates
3. Un bouton "Retour" permet de revenir a la liste
4. Un bouton "Modifier" ouvre le modal de modification existant
5. L'URL est bookmarkable (`/products/123`)
6. Tests unitaires presents
