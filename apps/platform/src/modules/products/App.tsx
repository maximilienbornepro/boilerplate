import { useState, useEffect, useCallback } from 'react';
import { Layout, ToastContainer, ConfirmModal, ModuleHeader } from '@boilerplate/shared/components';
import type { ToastData } from '@boilerplate/shared/components';
import { ProductList } from './components/ProductList/ProductList';
import { ProductForm } from './components/ProductForm/ProductForm';
import type { Product, ProductFormData } from './types';
import * as api from './services/api';
import './index.css';

export default function ProductsApp({ onNavigate }: { onNavigate?: (path: string) => void }) {
  return (
    <Layout appId="products" variant="full-width" onNavigate={onNavigate}>
      <AppContent onNavigate={onNavigate} />
    </Layout>
  );
}

function AppContent({ onNavigate }: { onNavigate?: (path: string) => void }) {
  // Data
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  // UI state
  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Product | null>(null);
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const addToast = useCallback((toast: Omit<ToastData, 'id'>) => {
    const id = Date.now().toString();
    setToasts((prev) => [...prev, { ...toast, id }]);
    // Auto-remove after 5 seconds
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Load data
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.fetchProducts();
      setProducts(data);
    } catch (err) {
      console.error('Failed to load products:', err);
      addToast({ type: 'error', message: 'Erreur lors du chargement des produits' });
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handlers
  const handleAdd = useCallback(() => {
    setEditingProduct(null);
    setShowForm(true);
  }, []);

  const handleEdit = useCallback((product: Product) => {
    setEditingProduct(product);
    setShowForm(true);
  }, []);

  const handleDelete = useCallback((product: Product) => {
    setDeleteConfirm(product);
  }, []);

  const handleFormSubmit = useCallback(async (data: ProductFormData) => {
    try {
      if (editingProduct) {
        await api.updateProduct(editingProduct.id, data);
        addToast({ type: 'success', message: 'Produit modifie' });
      } else {
        await api.createProduct(data);
        addToast({ type: 'success', message: 'Produit cree' });
      }
      setShowForm(false);
      setEditingProduct(null);
      await loadData();
    } catch (err: any) {
      console.error('Failed to save product:', err);
      addToast({ type: 'error', message: err.message || 'Erreur lors de la sauvegarde' });
    }
  }, [editingProduct, addToast, loadData]);

  const confirmDelete = useCallback(async () => {
    if (!deleteConfirm) return;
    try {
      await api.deleteProduct(deleteConfirm.id);
      addToast({ type: 'success', message: 'Produit supprime' });
      setDeleteConfirm(null);
      await loadData();
    } catch (err: any) {
      console.error('Failed to delete product:', err);
      addToast({ type: 'error', message: err.message || 'Erreur lors de la suppression' });
    }
  }, [deleteConfirm, addToast, loadData]);

  const handleBack = useCallback(() => {
    if (onNavigate) onNavigate('/');
    else window.location.href = '/';
  }, [onNavigate]);

  return (
    <>
      <ModuleHeader title="Produits" onBack={handleBack}>
        <button className="module-header-btn module-header-btn-primary" onClick={handleAdd}>
          + Nouveau
        </button>
      </ModuleHeader>

      <div className="products-page">
        <div className="products-content">
          {loading && products.length === 0 ? (
            <div className="products-loading">Chargement...</div>
          ) : products.length === 0 ? (
            <div className="products-empty">
              <p>Aucun produit</p>
              <button className="products-empty-btn" onClick={handleAdd}>
                Creer un produit
              </button>
            </div>
          ) : (
            <ProductList
              products={products}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          )}
        </div>
      </div>

      {/* Modals */}
      {showForm && (
        <ProductForm
          product={editingProduct}
          onSubmit={handleFormSubmit}
          onClose={() => { setShowForm(false); setEditingProduct(null); }}
        />
      )}

      {deleteConfirm && (
        <ConfirmModal
          title="Supprimer le produit"
          message={`Etes-vous sur de vouloir supprimer "${deleteConfirm.name}" ?`}
          confirmLabel="Supprimer"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}

      <ToastContainer toasts={toasts} onClose={removeToast} />
    </>
  );
}
