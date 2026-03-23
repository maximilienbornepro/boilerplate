# Design: Page detail produit

## Architecture Decision

Ajout d'une page de detail produit accessible via `/products/:id`. Utilisation de React Router pour la navigation interne au module.

**Choix techniques :**
- React Router v6 pour le routing interne (deja utilise dans le projet)
- Composant `ProductDetail` autonome avec chargement de donnees
- Reutilisation du modal `ProductForm` existant pour la modification
- CSS Modules pour les styles (coherent avec le reste du module)

## Component Structure

### ProductDetail.tsx

```typescript
interface ProductDetailProps {
  onBack: () => void;
  onEdit: (product: Product) => void;
}

// Utilise useParams() pour recuperer l'ID depuis l'URL
// Charge le produit via fetchProduct(id)
// Affiche: nom, description, prix, categorie, stock, dates creation/modification
```

### Modifications ProductList.tsx

```typescript
interface ProductListProps {
  products: Product[];
  onView: (product: Product) => void;  // NOUVEAU
  onEdit: (product: Product) => void;
  onDelete: (product: Product) => void;
}

// Le nom du produit devient un lien cliquable
// onClick sur le nom appelle onView(product)
```

### Modifications App.tsx

```typescript
// Ajout de React Router Routes pour navigation interne
import { Routes, Route, useNavigate } from 'react-router-dom';

<Routes>
  <Route index element={<ProductListView />} />
  <Route path=":id" element={<ProductDetailView />} />
</Routes>
```

## Sequence Diagrams

### Navigation vers le detail

```mermaid
sequenceDiagram
    participant U as User
    participant L as ProductList
    participant R as React Router
    participant D as ProductDetail
    participant A as GET /products/:id

    U->>L: Click sur nom produit
    L->>R: navigate('/products/123')
    R->>D: Render ProductDetail
    D->>D: useParams() -> id=123
    D->>A: fetchProduct(123)
    A-->>D: Product data
    D-->>U: Affiche detail complet
```

### Retour a la liste

```mermaid
sequenceDiagram
    participant U as User
    participant D as ProductDetail
    participant R as React Router
    participant L as ProductList

    U->>D: Click bouton "Retour"
    D->>R: navigate('/products')
    R->>L: Render ProductList
    L-->>U: Affiche liste produits
```

### Modification depuis le detail

```mermaid
sequenceDiagram
    participant U as User
    participant D as ProductDetail
    participant F as ProductForm (modal)
    participant A as PUT /products/:id

    U->>D: Click "Modifier"
    D->>F: Ouvre modal avec product
    U->>F: Modifie champs
    U->>F: Click "Enregistrer"
    F->>A: updateProduct(id, data)
    A-->>F: Product updated
    F->>D: Ferme modal
    D->>D: Refresh donnees
    D-->>U: Affiche produit mis a jour
```

### Erreur produit non trouve

```mermaid
sequenceDiagram
    participant U as User
    participant D as ProductDetail
    participant A as GET /products/:id

    U->>D: Acces /products/999
    D->>A: fetchProduct(999)
    A-->>D: 404 Not Found
    D-->>U: Affiche "Produit non trouve"
    U->>D: Click "Retour a la liste"
    D-->>U: Navigue vers /products
```

## Files to Create

| Fichier | Description |
|---------|-------------|
| `components/ProductDetail/ProductDetail.tsx` | Composant principal |
| `components/ProductDetail/ProductDetail.module.css` | Styles |
| `components/ProductDetail/index.ts` | Export |

## Files to Modify

| Fichier | Modification |
|---------|-------------|
| `App.tsx` | Ajouter React Router Routes |
| `components/ProductList/ProductList.tsx` | Ajouter prop `onView`, nom cliquable |
| `components/ProductList/ProductList.module.css` | Style lien cliquable |

## UI Design

### Page Detail

```
+--------------------------------------------------+
| <- Retour                              [Modifier] |
+--------------------------------------------------+
|                                                   |
|  NOM DU PRODUIT                                   |
|  ===============                                  |
|                                                   |
|  Description                                      |
|  -----------                                      |
|  Lorem ipsum dolor sit amet...                    |
|                                                   |
|  +-------------+  +-------------+  +------------+ |
|  | Prix        |  | Categorie   |  | Stock      | |
|  | 99,99 EUR   |  | Electronics |  | En stock   | |
|  +-------------+  +-------------+  +------------+ |
|                                                   |
|  Cree le: 15/01/2024                              |
|  Modifie le: 20/01/2024                           |
|                                                   |
+--------------------------------------------------+
```

## API Contract

Endpoint existant, pas de modification :

```
GET /products-api/products/:id

Response 200:
{
  "id": 123,
  "name": "Product Name",
  "description": "Description text",
  "price": 99.99,
  "category": "Electronics",
  "inStock": true,
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-20T14:00:00.000Z"
}

Response 404:
{
  "error": "Non trouve"
}
```
