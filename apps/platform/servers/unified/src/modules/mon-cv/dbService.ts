import { Pool } from 'pg';
import { config } from '../../config.js';
import type { CV, CVData, CVListItem, CVLogo, createEmptyCV } from './types.js';

let pool: Pool;

export async function initPool() {
  pool = new Pool({ connectionString: config.appDatabaseUrl });

  // Test connection
  try {
    await pool.query('SELECT 1');
    console.log('[Mon-CV] Database connected');
  } catch (err) {
    console.error('[Mon-CV] Database connection failed:', err);
    throw err;
  }

  // Create tables if they don't exist
  await ensureTables();
}

async function ensureTables() {
  // CVs table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cvs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL DEFAULT 'Mon CV',
      cv_data JSONB NOT NULL DEFAULT '{}',
      is_default BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // CV logos table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cv_logos (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      company_name VARCHAR(255) NOT NULL,
      image_data TEXT NOT NULL,
      mime_type VARCHAR(50) NOT NULL DEFAULT 'image/png',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create indexes
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_cvs_user_id ON cvs(user_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_cv_logos_user_id ON cv_logos(user_id)
  `);
}

// Map database row to CV object
function mapCVRow(row: any): CV {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    cvData: row.cv_data || {},
    isDefault: row.is_default,
    createdAt: row.created_at?.toISOString() || new Date().toISOString(),
    updatedAt: row.updated_at?.toISOString() || new Date().toISOString(),
  };
}

function mapCVListRow(row: any): CVListItem {
  return {
    id: row.id,
    name: row.name,
    isDefault: row.is_default,
    createdAt: row.created_at?.toISOString() || new Date().toISOString(),
    updatedAt: row.updated_at?.toISOString() || new Date().toISOString(),
  };
}

function mapLogoRow(row: any): CVLogo {
  return {
    id: row.id,
    userId: row.user_id,
    companyName: row.company_name,
    imageData: row.image_data,
    mimeType: row.mime_type,
    createdAt: row.created_at?.toISOString() || new Date().toISOString(),
  };
}

// ============ CV Operations ============

export async function getDefaultCV(userId: number): Promise<CV | null> {
  const { rows } = await pool.query(
    'SELECT * FROM cvs WHERE user_id = $1 AND is_default = true LIMIT 1',
    [userId]
  );
  if (rows.length === 0) return null;
  return mapCVRow(rows[0]);
}

export async function getCVById(id: number, userId: number): Promise<CV | null> {
  const { rows } = await pool.query(
    'SELECT * FROM cvs WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  if (rows.length === 0) return null;
  return mapCVRow(rows[0]);
}

// Public access (for embed mode) - no user check
export async function getCVByIdPublic(id: number): Promise<CV | null> {
  const { rows } = await pool.query(
    'SELECT * FROM cvs WHERE id = $1',
    [id]
  );
  if (rows.length === 0) return null;
  return mapCVRow(rows[0]);
}

export async function getAllCVs(userId: number): Promise<CVListItem[]> {
  const { rows } = await pool.query(
    'SELECT id, name, is_default, created_at, updated_at FROM cvs WHERE user_id = $1 ORDER BY is_default DESC, updated_at DESC',
    [userId]
  );
  return rows.map(mapCVListRow);
}

export async function createCV(
  userId: number,
  name: string,
  cvData: CVData,
  isDefault: boolean = false
): Promise<CV> {
  // If this is the first CV or marked as default, ensure it's the only default
  if (isDefault) {
    await pool.query(
      'UPDATE cvs SET is_default = false WHERE user_id = $1',
      [userId]
    );
  }

  const { rows } = await pool.query(
    `INSERT INTO cvs (user_id, name, cv_data, is_default)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [userId, name, JSON.stringify(cvData), isDefault]
  );
  return mapCVRow(rows[0]);
}

export async function updateCV(
  id: number,
  userId: number,
  updates: { name?: string; cvData?: CVData; isDefault?: boolean }
): Promise<CV | null> {
  const setClauses: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (updates.name !== undefined) {
    setClauses.push(`name = $${paramIndex++}`);
    values.push(updates.name);
  }

  if (updates.cvData !== undefined) {
    setClauses.push(`cv_data = $${paramIndex++}`);
    values.push(JSON.stringify(updates.cvData));
  }

  if (updates.isDefault !== undefined) {
    // First, unset any existing default
    if (updates.isDefault) {
      await pool.query(
        'UPDATE cvs SET is_default = false WHERE user_id = $1 AND id != $2',
        [userId, id]
      );
    }
    setClauses.push(`is_default = $${paramIndex++}`);
    values.push(updates.isDefault);
  }

  if (setClauses.length === 0) {
    return getCVById(id, userId);
  }

  setClauses.push(`updated_at = CURRENT_TIMESTAMP`);
  values.push(id);
  values.push(userId);

  const { rows } = await pool.query(
    `UPDATE cvs SET ${setClauses.join(', ')} WHERE id = $${paramIndex++} AND user_id = $${paramIndex} RETURNING *`,
    values
  );

  if (rows.length === 0) return null;
  return mapCVRow(rows[0]);
}

export async function deleteCV(id: number, userId: number): Promise<boolean> {
  const { rowCount } = await pool.query(
    'DELETE FROM cvs WHERE id = $1 AND user_id = $2 AND is_default = false',
    [id, userId]
  );
  return (rowCount ?? 0) > 0;
}

export async function getOrCreateDefaultCV(userId: number, emptyCVData: CVData): Promise<CV> {
  let cv = await getDefaultCV(userId);
  if (!cv) {
    cv = await createCV(userId, 'Mon CV', emptyCVData, true);
  }
  return cv;
}

// ============ Logo Operations ============

export async function getAllLogos(userId: number): Promise<CVLogo[]> {
  const { rows } = await pool.query(
    'SELECT * FROM cv_logos WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );
  return rows.map(mapLogoRow);
}

export async function getLogoById(id: number, userId: number): Promise<CVLogo | null> {
  const { rows } = await pool.query(
    'SELECT * FROM cv_logos WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  if (rows.length === 0) return null;
  return mapLogoRow(rows[0]);
}

export async function getLogoByCompany(userId: number, companyName: string): Promise<CVLogo | null> {
  const { rows } = await pool.query(
    'SELECT * FROM cv_logos WHERE user_id = $1 AND LOWER(company_name) = LOWER($2) LIMIT 1',
    [userId, companyName]
  );
  if (rows.length === 0) return null;
  return mapLogoRow(rows[0]);
}

export async function createLogo(
  userId: number,
  companyName: string,
  imageData: string,
  mimeType: string
): Promise<CVLogo> {
  const { rows } = await pool.query(
    `INSERT INTO cv_logos (user_id, company_name, image_data, mime_type)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [userId, companyName, imageData, mimeType]
  );
  return mapLogoRow(rows[0]);
}

export async function deleteLogo(id: number, userId: number): Promise<boolean> {
  const { rowCount } = await pool.query(
    'DELETE FROM cv_logos WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  return (rowCount ?? 0) > 0;
}
