import { Router } from 'express';
import { authMiddleware } from '../../middleware/index.js';
import { asyncHandler } from '@boilerplate/shared/server';
import * as db from './dbService.js';

export async function initDb() {
  await db.initPool();
}

export function createProductsRoutes(): Router {
  const router = Router();

  // Public embed route (NO AUTH REQUIRED)
  router.get('/embed/:id', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: 'ID invalide' });
      return;
    }

    const product = await db.getProductById(id);
    if (!product) {
      res.status(404).json({ error: 'Produit non trouve' });
      return;
    }

    res.json(product);
  }));

  // All other routes require authentication
  router.use(authMiddleware);

  // List products
  router.get('/products', asyncHandler(async (_req, res) => {
    const products = await db.getAllProducts();
    res.json(products);
  }));

  // Get single product
  router.get('/products/:id', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const product = await db.getProductById(id);

    if (!product) {
      res.status(404).json({ error: 'Produit non trouve' });
      return;
    }

    res.json(product);
  }));

  // Create product
  router.post('/products', asyncHandler(async (req, res) => {
    const { name, description, price, category, inStock } = req.body;

    if (!name || !name.trim()) {
      res.status(400).json({ error: 'Le nom est requis' });
      return;
    }

    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum < 0) {
      res.status(400).json({ error: 'Le prix doit etre un nombre positif' });
      return;
    }

    const product = await db.createProduct({
      name: name.trim(),
      description: description?.trim() || null,
      price: priceNum,
      category: category || 'general',
      inStock: inStock !== false,
    });

    res.status(201).json(product);
  }));

  // Update product
  router.put('/products/:id', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { name, description, price, category, inStock } = req.body;

    // Check if product exists
    const existing = await db.getProductById(id);
    if (!existing) {
      res.status(404).json({ error: 'Produit non trouve' });
      return;
    }

    if (name !== undefined && !name.trim()) {
      res.status(400).json({ error: 'Le nom ne peut pas etre vide' });
      return;
    }

    if (price !== undefined) {
      const priceNum = parseFloat(price);
      if (isNaN(priceNum) || priceNum < 0) {
        res.status(400).json({ error: 'Le prix doit etre un nombre positif' });
        return;
      }
    }

    const product = await db.updateProduct(id, {
      name: name?.trim(),
      description: description?.trim(),
      price: price !== undefined ? parseFloat(price) : undefined,
      category,
      inStock,
    });

    res.json(product);
  }));

  // Delete product
  router.delete('/products/:id', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);

    const existing = await db.getProductById(id);
    if (!existing) {
      res.status(404).json({ error: 'Produit non trouve' });
      return;
    }

    await db.deleteProduct(id);
    res.status(204).send();
  }));

  return router;
}
