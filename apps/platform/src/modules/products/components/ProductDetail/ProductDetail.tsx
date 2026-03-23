import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { ModuleHeader } from '@boilerplate/shared/components';
import type { Product } from '../../types';
import { fetchProduct } from '../../services/api';
import styles from './ProductDetail.module.css';

interface ProductDetailProps {
  onBack: () => void;
  onEdit: (product: Product) => void;
}

export function ProductDetail({ onBack, onEdit }: ProductDetailProps) {
  const { id } = useParams<{ id: string }>();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadProduct = useCallback(async () => {
    if (!id) {
      setError('ID produit manquant');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const data = await fetchProduct(parseInt(id, 10));
      setProduct(data);
    } catch (err: any) {
      setError(err.message || 'Erreur lors du chargement du produit');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadProduct();
  }, [loadProduct]);

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
    }).format(price);
  };

  const formatDate = (dateString: string) => {
    return new Intl.DateTimeFormat('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(dateString));
  };

  const copyEmbedLink = useCallback(() => {
    if (!product) return;
    const url = `${window.location.origin}/products?embed=${product.id}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [product]);

  if (loading) {
    return (
      <>
        <ModuleHeader title="Chargement..." onBack={onBack} />
        <div className={styles.container}>
          <div className={styles.loading}>Chargement...</div>
        </div>
      </>
    );
  }

  if (error || !product) {
    return (
      <>
        <ModuleHeader title="Erreur" onBack={onBack} />
        <div className={styles.container}>
          <div className={styles.error}>
            <p>{error || 'Produit non trouve'}</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <ModuleHeader title={product.name} onBack={onBack}>
        <button
          className={`module-header-btn ${copied ? 'module-header-btn-success' : ''}`}
          onClick={copyEmbedLink}
          title="Copier le lien embed"
        >
          {copied ? 'Copie !' : 'Embed'}
        </button>
        <button
          className="module-header-btn module-header-btn-primary"
          onClick={() => onEdit(product)}
        >
          Modifier
        </button>
      </ModuleHeader>

      <div className={styles.container}>
        <div className={styles.content}>
          {product.description && (
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Description</h2>
              <p className={styles.description}>{product.description}</p>
            </div>
          )}

          <div className={styles.cards}>
            <div className={styles.card}>
              <span className={styles.cardLabel}>Prix</span>
              <span className={styles.cardValue}>{formatPrice(product.price)}</span>
            </div>

            <div className={styles.card}>
              <span className={styles.cardLabel}>Categorie</span>
              <span className={styles.cardValue}>{product.category}</span>
            </div>

            <div className={styles.card}>
              <span className={styles.cardLabel}>Stock</span>
              <span className={`${styles.cardValue} ${product.inStock ? styles.inStock : styles.outOfStock}`}>
                {product.inStock ? 'En stock' : 'Rupture de stock'}
              </span>
            </div>
          </div>

          <div className={styles.meta}>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Cree le</span>
              <span className={styles.metaValue}>{formatDate(product.createdAt)}</span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Modifie le</span>
              <span className={styles.metaValue}>{formatDate(product.updatedAt)}</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
