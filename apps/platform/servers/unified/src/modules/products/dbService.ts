import { Pool } from 'pg';
import { config } from '../../config.js';

let pool: Pool;

export async function initPool() {
  pool = new Pool({ connectionString: config.appDatabaseUrl });

  // Test connection
  try {
    await pool.query('SELECT 1');
    console.log('[Products] Database connected');
  } catch (err) {
    console.error('[Products] Database connection failed:', err);
    throw err;
  }
}

export interface Product {
  id: number;
  name: string;
  description: string | null;
  price: number;
  category: string;
  inStock: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ProductInput {
  name: string;
  description?: string | null;
  price: number;
  category: string;
  inStock: boolean;
}

interface ProductUpdate {
  name?: string;
  description?: string | null;
  price?: number;
  category?: string;
  inStock?: boolean;
}

function mapRow(row: any): Product {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: parseFloat(row.price),
    category: row.category,
    inStock: row.in_stock,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function getAllProducts(): Promise<Product[]> {
  const { rows } = await pool.query(
    'SELECT * FROM products ORDER BY created_at DESC'
  );
  return rows.map(mapRow);
}

export async function getProductById(id: number): Promise<Product | null> {
  const { rows } = await pool.query('SELECT * FROM products WHERE id = $1', [id]);
  if (rows.length === 0) return null;
  return mapRow(rows[0]);
}

export async function createProduct(data: ProductInput): Promise<Product> {
  const { rows } = await pool.query(
    `INSERT INTO products (name, description, price, category, in_stock)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [data.name, data.description || null, data.price, data.category, data.inStock]
  );
  return mapRow(rows[0]);
}

export async function updateProduct(id: number, data: ProductUpdate): Promise<Product> {
  const updates: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (data.name !== undefined) {
    updates.push(`name = $${paramIndex++}`);
    values.push(data.name);
  }
  if (data.description !== undefined) {
    updates.push(`description = $${paramIndex++}`);
    values.push(data.description);
  }
  if (data.price !== undefined) {
    updates.push(`price = $${paramIndex++}`);
    values.push(data.price);
  }
  if (data.category !== undefined) {
    updates.push(`category = $${paramIndex++}`);
    values.push(data.category);
  }
  if (data.inStock !== undefined) {
    updates.push(`in_stock = $${paramIndex++}`);
    values.push(data.inStock);
  }

  updates.push(`updated_at = CURRENT_TIMESTAMP`);
  values.push(id);

  const { rows } = await pool.query(
    `UPDATE products SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );

  return mapRow(rows[0]);
}

export async function deleteProduct(id: number): Promise<void> {
  await pool.query('DELETE FROM products WHERE id = $1', [id]);
}
