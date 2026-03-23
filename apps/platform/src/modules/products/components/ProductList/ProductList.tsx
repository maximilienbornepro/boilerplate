import type { Product } from '../../types';
import styles from './ProductList.module.css';

interface ProductListProps {
  products: Product[];
  onView: (product: Product) => void;
  onEdit: (product: Product) => void;
  onDelete: (product: Product) => void;
}

export function ProductList({ products, onView, onEdit, onDelete }: ProductListProps) {
  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
    }).format(price);
  };

  return (
    <div className={styles.container}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Nom</th>
            <th>Description</th>
            <th>Prix</th>
            <th>Categorie</th>
            <th>Stock</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <tr key={product.id}>
              <td className={styles.nameCell}>
                <button
                  className={styles.nameLink}
                  onClick={() => onView(product)}
                  title="Voir le detail"
                >
                  {product.name}
                </button>
              </td>
              <td className={styles.descriptionCell}>
                <span className={styles.description}>
                  {product.description || '-'}
                </span>
              </td>
              <td className={styles.priceCell}>
                {formatPrice(product.price)}
              </td>
              <td>
                <span className={styles.category}>{product.category}</span>
              </td>
              <td>
                <span className={`${styles.stock} ${product.inStock ? styles.inStock : styles.outOfStock}`}>
                  {product.inStock ? 'En stock' : 'Rupture'}
                </span>
              </td>
              <td className={styles.actionsCell}>
                <button
                  className={styles.editBtn}
                  onClick={() => onEdit(product)}
                  title="Modifier"
                >
                  ✏️
                </button>
                <button
                  className={styles.deleteBtn}
                  onClick={() => onDelete(product)}
                  title="Supprimer"
                >
                  🗑️
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
