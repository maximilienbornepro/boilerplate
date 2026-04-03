# Tasks: Page detail produit

## Taches d'implementation

### 1. Creer le composant ProductDetail

- [ ] `components/ProductDetail/ProductDetail.tsx`
  - Utiliser `useParams()` pour recuperer l'ID
  - Charger le produit avec `fetchProduct(id)`
  - Gerer les etats : loading, error, data
  - Afficher toutes les informations du produit
  - Bouton "Retour" vers la liste
  - Bouton "Modifier" pour ouvrir le modal

- [ ] `components/ProductDetail/ProductDetail.module.css`
  - Style coherent avec le design system
  - Cards pour prix/categorie/stock
  - Responsive

- [ ] `components/ProductDetail/index.ts`
  - Export du composant

### 2. Modifier ProductList pour rendre le nom cliquable

- [ ] `components/ProductList/ProductList.tsx`
  - Ajouter prop `onView: (product: Product) => void`
  - Rendre le nom du produit cliquable
  - Appeler `onView(product)` au click

- [ ] `components/ProductList/ProductList.module.css`
  - Style pour le nom cliquable (hover, cursor)

### 3. Ajouter le routing dans App.tsx

- [ ] `App.tsx`
  - Importer `Routes`, `Route`, `useNavigate` de react-router-dom
  - Creer `ProductListView` component interne
  - Creer `ProductDetailView` component interne
  - Configurer les routes : index et `:id`
  - Gerer la navigation entre vues
  - Gerer le modal de modification depuis le detail

### 4. Tests unitaires

- [ ] `__tests__/products.test.ts`
  - Test constantes (routes, etc.)
  - Test helpers de formatage
  - Test logique de navigation

## Ordre d'execution

1. ProductDetail (composant isole)
2. ProductList (modification mineure)
3. App.tsx (integration routing)
4. Tests

## Definition of Done

- [ ] Tous les fichiers crees/modifies
- [ ] Navigation liste -> detail fonctionne
- [ ] Navigation detail -> liste fonctionne
- [ ] Modification depuis detail fonctionne
- [ ] Erreur 404 geree
- [ ] Tests passent (`npm test`)
- [ ] Pas de regression sur fonctionnalites existantes
