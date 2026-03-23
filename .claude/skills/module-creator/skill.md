---
name: module-creator
description: Creer un nouveau module integre au boilerplate avec design system et permissions
invocation: user
---

# Module Creator

## ⛔ PRE-REQUIS OBLIGATOIRE : OpenSpec

**AVANT d'utiliser ce skill, verifier que le workflow OpenSpec a ete suivi :**

```bash
# 1. Verifier le mode OpenSpec
cat .claude/config 2>/dev/null | grep OPENSPEC_MODE || echo "OPENSPEC_MODE=on (defaut)"

# 2. Si OpenSpec est actif, une spec DOIT exister
ls .openspec/changes/*/progress.md
```

**Si aucune spec n'existe :**

1. **REFUSER** d'utiliser ce skill
2. **DIRE** a l'utilisateur : "Utilise d'abord `/opsx:propose 'Nouveau module <nom>'` pour creer la spec"
3. **ATTENDRE** que la spec soit validee (phase = implementation)

**Ce skill ne doit PAS etre utilise directement sans spec validee.**

---

## REGLES UI OBLIGATOIRES

### 1. Boutons TOUJOURS dans ModuleHeader

**JAMAIS** de header custom avec boutons. Utiliser UNIQUEMENT `ModuleHeader` du design system.

```tsx
// ✅ CORRECT
<ModuleHeader title="Titre" onBack={handleBack}>
  <button className="module-header-btn">Action</button>
  <button className="module-header-btn module-header-btn-primary">Primary</button>
</ModuleHeader>

// ❌ INTERDIT
<div className={styles.header}>
  <button onClick={onBack}>Retour</button>
  <button onClick={onEdit}>Modifier</button>
</div>
```

**Classes disponibles pour les boutons :**
- `module-header-btn` - Style de base
- `module-header-btn-primary` - Action principale (bleu)
- `module-header-btn-success` - Succes (vert)
- `module-header-btn-danger` - Danger (rouge)

### 2. Bouton Embed OBLIGATOIRE si mode embed actif

**Si ENABLE_EMBED = oui**, chaque vue de detail DOIT inclure :

```tsx
const [copied, setCopied] = useState(false);

const copyEmbedLink = useCallback(() => {
  const url = `${window.location.origin}/<module>?embed=${item.id}`;
  navigator.clipboard.writeText(url);
  setCopied(true);
  setTimeout(() => setCopied(false), 2000);
}, [item]);

// Dans le ModuleHeader
<ModuleHeader title={item.name} onBack={onBack}>
  <button
    className={`module-header-btn ${copied ? 'module-header-btn-success' : ''}`}
    onClick={copyEmbedLink}
  >
    {copied ? 'Copie !' : 'Embed'}
  </button>
  <button className="module-header-btn module-header-btn-primary" onClick={() => onEdit(item)}>
    Modifier
  </button>
</ModuleHeader>
```

### 3. Pages detail avec ModuleHeader

Toute page de detail (vue d'un element unique) DOIT :
1. Avoir un `ModuleHeader` avec le nom de l'element en titre
2. Avoir un bouton "Retour" via `onBack`
3. Avoir un bouton "Modifier" si l'edition est possible
4. Avoir un bouton "Embed" si le mode embed est actif

---

Ce skill guide la creation d'un nouveau module parfaitement integre au boilerplate, avec :
- Design system (composants, tokens CSS, Layout)
- Systeme de permissions (activable par utilisateur dans l'admin)
- Tests unitaires obligatoires
- Pattern CRUD complet

## Parametres requis

Avant de commencer, collecter :
- **MODULE_NAME** : Nom technique en minuscules (ex: `orders`, `inventory`, `clients`)
- **MODULE_DISPLAY_NAME** : Nom affiche (ex: `Commandes`, `Inventaire`, `Clients`)
- **MODULE_DESCRIPTION** : Description courte
- **MODULE_COLOR** : Couleur principale hex (ex: `#10b981`)
- **ENTITY_NAME** : Nom de l'entite principale (ex: `Order`, `Item`, `Client`)
- **ENTITY_FIELDS** : Champs de l'entite (avec types)
- **ENABLE_EMBED** : Activer le mode embed public (oui/non) - Permet l'acces public via `?embed=ID`

## Checklist de creation

### 1. Schema SQL

**Structure des fichiers SQL :**
- `01_create_databases.sql` - Creation de la base (NE PAS MODIFIER)
- `02_platform_schema.sql` - Tables plateforme: users, user_permissions (NE PAS MODIFIER)
- `03_<module>_schema.sql` - Tables du module (a creer)

Creer `database/init/XX_<module>_schema.sql` (XX = numero sequentiel, ex: 03, 04, 05...) :

```sql
-- =============================================================================
-- Module: <MODULE_NAME>
-- Tables specifiques au module <module>
-- =============================================================================

\c app;

CREATE TABLE IF NOT EXISTS <module_name_plural> (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    -- Ajouter les champs specifiques
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_<module>_created ON <module_name_plural>(created_at);
```

> **Note** : Chaque module a son propre fichier SQL. Ne jamais modifier `02_platform_schema.sql`.

### 2. Backend

#### 2.1 `apps/platform/servers/unified/src/modules/<module>/dbService.ts`

```typescript
import { Pool } from 'pg';
import { config } from '../../config.js';

let pool: Pool;

export async function initPool() {
  pool = new Pool({ connectionString: config.appDatabaseUrl });
  try {
    await pool.query('SELECT 1');
    console.log('[<Module>] Database connected');
  } catch (err) {
    console.error('[<Module>] Database connection failed:', err);
    throw err;
  }
}

export interface <Entity> {
  id: number;
  name: string;
  // Ajouter les champs
  createdAt: string;
  updatedAt: string;
}

interface <Entity>Input {
  name: string;
  // Champs requis
}

interface <Entity>Update {
  name?: string;
  // Champs optionnels
}

function mapRow(row: any): <Entity> {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function getAll(): Promise<<Entity>[]> {
  const { rows } = await pool.query(
    'SELECT * FROM <table> ORDER BY created_at DESC'
  );
  return rows.map(mapRow);
}

export async function getById(id: number): Promise<<Entity> | null> {
  const { rows } = await pool.query('SELECT * FROM <table> WHERE id = $1', [id]);
  if (rows.length === 0) return null;
  return mapRow(rows[0]);
}

export async function create(data: <Entity>Input): Promise<<Entity>> {
  const { rows } = await pool.query(
    `INSERT INTO <table> (name) VALUES ($1) RETURNING *`,
    [data.name]
  );
  return mapRow(rows[0]);
}

export async function update(id: number, data: <Entity>Update): Promise<<Entity>> {
  const updates: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (data.name !== undefined) {
    updates.push(`name = $${paramIndex++}`);
    values.push(data.name);
  }

  updates.push(`updated_at = CURRENT_TIMESTAMP`);
  values.push(id);

  const { rows } = await pool.query(
    `UPDATE <table> SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );
  return mapRow(rows[0]);
}

export async function remove(id: number): Promise<void> {
  await pool.query('DELETE FROM <table> WHERE id = $1', [id]);
}
```

#### 2.2 `apps/platform/servers/unified/src/modules/<module>/routes.ts`

```typescript
import { Router } from 'express';
import { authMiddleware } from '../../middleware/index.js';
import { asyncHandler } from '@boilerplate/shared/server';
import * as db from './dbService.js';

export async function initDb() {
  await db.initPool();
}

export function create<Module>Routes(): Router {
  const router = Router();

  // Require authentication
  router.use(authMiddleware);

  // List
  router.get('/<entities>', asyncHandler(async (_req, res) => {
    const items = await db.getAll();
    res.json(items);
  }));

  // Get one
  router.get('/<entities>/:id', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const item = await db.getById(id);
    if (!item) {
      res.status(404).json({ error: 'Non trouve' });
      return;
    }
    res.json(item);
  }));

  // Create
  router.post('/<entities>', asyncHandler(async (req, res) => {
    const { name } = req.body;
    if (!name || !name.trim()) {
      res.status(400).json({ error: 'Le nom est requis' });
      return;
    }
    const item = await db.create({ name: name.trim() });
    res.status(201).json(item);
  }));

  // Update
  router.put('/<entities>/:id', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const existing = await db.getById(id);
    if (!existing) {
      res.status(404).json({ error: 'Non trouve' });
      return;
    }
    const { name } = req.body;
    if (name !== undefined && !name.trim()) {
      res.status(400).json({ error: 'Le nom ne peut pas etre vide' });
      return;
    }
    const item = await db.update(id, { name: name?.trim() });
    res.json(item);
  }));

  // Delete
  router.delete('/<entities>/:id', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const existing = await db.getById(id);
    if (!existing) {
      res.status(404).json({ error: 'Non trouve' });
      return;
    }
    await db.remove(id);
    res.status(204).send();
  }));

  return router;
}
```

#### 2.3 `apps/platform/servers/unified/src/modules/<module>/index.ts`

```typescript
import { Router } from 'express';
import { initDb, create<Module>Routes } from './routes.js';

export async function init<Module>() {
  await initDb();
  console.log('[<Module>] Module initialized');
}

export function create<Module>Router(): Router {
  return create<Module>Routes();
}
```

#### 2.4 Tests backend `apps/platform/servers/unified/src/modules/__tests__/<module>/<module>.test.ts`

```typescript
import { describe, it, expect } from 'vitest';

// Constants tests
describe('<Module> Module', () => {
  describe('Constants', () => {
    it('should have MODULE_NAME defined', () => {
      const MODULE_NAME = '<module>';
      expect(MODULE_NAME).toBe('<module>');
    });
  });

  describe('Validation', () => {
    it('should validate name is required', () => {
      const validateName = (name: string | undefined) => {
        if (!name || !name.trim()) return false;
        return true;
      };
      expect(validateName('')).toBe(false);
      expect(validateName('  ')).toBe(false);
      expect(validateName('Valid Name')).toBe(true);
    });
  });
});
```

### 3. Frontend

#### 3.1 Types `apps/platform/src/modules/<module>/types/index.ts`

```typescript
export interface <Entity> {
  id: number;
  name: string;
  // Ajouter les champs
  createdAt: string;
  updatedAt: string;
}

export interface <Entity>FormData {
  name: string;
  // Champs du formulaire
}
```

#### 3.2 API Service `apps/platform/src/modules/<module>/services/api.ts`

```typescript
import type { <Entity>, <Entity>FormData } from '../types';

const API_BASE = '/<module>-api';

async function handleResponse<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Une erreur est survenue');
  }
  return data;
}

export async function fetchAll(): Promise<<Entity>[]> {
  const response = await fetch(`${API_BASE}/<entities>`, { credentials: 'include' });
  return handleResponse<<Entity>[]>(response);
}

export async function fetchOne(id: number): Promise<<Entity>> {
  const response = await fetch(`${API_BASE}/<entities>/${id}`, { credentials: 'include' });
  return handleResponse<<Entity>>(response);
}

export async function create(data: <Entity>FormData): Promise<<Entity>> {
  const response = await fetch(`${API_BASE}/<entities>`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    credentials: 'include',
  });
  return handleResponse<<Entity>>(response);
}

export async function update(id: number, data: <Entity>FormData): Promise<<Entity>> {
  const response = await fetch(`${API_BASE}/<entities>/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    credentials: 'include',
  });
  return handleResponse<<Entity>>(response);
}

export async function remove(id: number): Promise<void> {
  const response = await fetch(`${API_BASE}/<entities>/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Erreur lors de la suppression');
  }
}
```

#### 3.3 Styles `apps/platform/src/modules/<module>/index.css`

```css
/* <Module> module styles */

.<module>-page {
  padding: var(--spacing-lg);
  max-width: 1200px;
  margin: 0 auto;
}

.<module>-content {
  min-height: 400px;
}

.<module>-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-3xl);
  color: var(--text-muted);
  font-size: var(--font-size-md);
}

.<module>-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-3xl);
  text-align: center;
  gap: var(--spacing-lg);
}

.<module>-empty p {
  color: var(--text-muted);
  font-size: var(--font-size-md);
  margin: 0;
}

.<module>-empty-btn {
  padding: var(--spacing-sm) var(--spacing-lg);
  background: var(--accent-primary);
  color: var(--text-inverse);
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: background var(--transition-normal);
}

.<module>-empty-btn:hover {
  background: var(--accent-primary-hover);
}
```

#### 3.4 Composants

Creer les composants dans `apps/platform/src/modules/<module>/components/` :

- `<Entity>List/<Entity>List.tsx` + `.module.css`
- `<Entity>Form/<Entity>Form.tsx` + `.module.css`

Utiliser les composants du design system :
- `Modal` pour les formulaires
- `ConfirmModal` pour les confirmations
- `ToastContainer` pour les notifications
- `ModuleHeader` pour le header avec bouton retour
- `Layout` pour le wrapper principal

#### 3.5 App principale `apps/platform/src/modules/<module>/App.tsx`

```typescript
import { useState, useEffect, useCallback } from 'react';
import { Layout, ToastContainer, ConfirmModal, ModuleHeader } from '@boilerplate/shared/components';
import type { ToastData } from '@boilerplate/shared/components';
import { <Entity>List } from './components/<Entity>List/<Entity>List';
import { <Entity>Form } from './components/<Entity>Form/<Entity>Form';
import type { <Entity>, <Entity>FormData } from './types';
import * as api from './services/api';
import './index.css';

export default function <Module>App({ onNavigate }: { onNavigate?: (path: string) => void }) {
  return (
    <Layout appId="<module>" variant="full-width" onNavigate={onNavigate}>
      <AppContent onNavigate={onNavigate} />
    </Layout>
  );
}

function AppContent({ onNavigate }: { onNavigate?: (path: string) => void }) {
  const [items, setItems] = useState<<Entity>[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<<Entity> | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<<Entity> | null>(null);
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const addToast = useCallback((toast: Omit<ToastData, 'id'>) => {
    const id = Date.now().toString();
    setToasts((prev) => [...prev, { ...toast, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.fetchAll();
      setItems(data);
    } catch (err) {
      console.error('Failed to load:', err);
      addToast({ type: 'error', message: 'Erreur lors du chargement' });
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleAdd = useCallback(() => { setEditing(null); setShowForm(true); }, []);
  const handleEdit = useCallback((item: <Entity>) => { setEditing(item); setShowForm(true); }, []);
  const handleDelete = useCallback((item: <Entity>) => { setDeleteConfirm(item); }, []);

  const handleFormSubmit = useCallback(async (data: <Entity>FormData) => {
    try {
      if (editing) {
        await api.update(editing.id, data);
        addToast({ type: 'success', message: 'Modifie avec succes' });
      } else {
        await api.create(data);
        addToast({ type: 'success', message: 'Cree avec succes' });
      }
      setShowForm(false);
      setEditing(null);
      await loadData();
    } catch (err: any) {
      addToast({ type: 'error', message: err.message || 'Erreur lors de la sauvegarde' });
    }
  }, [editing, addToast, loadData]);

  const confirmDelete = useCallback(async () => {
    if (!deleteConfirm) return;
    try {
      await api.remove(deleteConfirm.id);
      addToast({ type: 'success', message: 'Supprime avec succes' });
      setDeleteConfirm(null);
      await loadData();
    } catch (err: any) {
      addToast({ type: 'error', message: err.message || 'Erreur lors de la suppression' });
    }
  }, [deleteConfirm, addToast, loadData]);

  const handleBack = useCallback(() => {
    if (onNavigate) onNavigate('/');
    else window.location.href = '/';
  }, [onNavigate]);

  return (
    <>
      <ModuleHeader title="<MODULE_DISPLAY_NAME>" onBack={handleBack}>
        <button className="module-header-btn module-header-btn-primary" onClick={handleAdd}>
          + Nouveau
        </button>
      </ModuleHeader>

      <div className="<module>-page">
        <div className="<module>-content">
          {loading && items.length === 0 ? (
            <div className="<module>-loading">Chargement...</div>
          ) : items.length === 0 ? (
            <div className="<module>-empty">
              <p>Aucun element</p>
              <button className="<module>-empty-btn" onClick={handleAdd}>Creer</button>
            </div>
          ) : (
            <<Entity>List items={items} onEdit={handleEdit} onDelete={handleDelete} />
          )}
        </div>
      </div>

      {showForm && (
        <<Entity>Form
          item={editing}
          onSubmit={handleFormSubmit}
          onClose={() => { setShowForm(false); setEditing(null); }}
        />
      )}

      {deleteConfirm && (
        <ConfirmModal
          title="Supprimer"
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
```

#### 3.6 Tests frontend `apps/platform/src/modules/<module>/__tests__/<module>.test.ts`

```typescript
import { describe, it, expect } from 'vitest';

describe('<Module> Module', () => {
  describe('API_BASE', () => {
    it('should have correct API base path', () => {
      const API_BASE = '/<module>-api';
      expect(API_BASE).toBe('/<module>-api');
    });
  });

  describe('Types', () => {
    it('should have <Entity> interface structure', () => {
      const mock<Entity> = {
        id: 1,
        name: 'Test',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };
      expect(mock<Entity>.id).toBe(1);
      expect(mock<Entity>.name).toBe('Test');
    });
  });
});
```

### 4. Configuration

#### 4.1 Router `apps/platform/src/router.tsx`

Ajouter :

```typescript
// En haut avec les autres imports lazy
const <Module>App = lazy(() => import('./modules/<module>/App'));

// Dans les Routes
<Route
  path="/<module>/*"
  element={
    <SuspenseWrapper>
      <<Module>App onNavigate={onNavigate} />
    </SuspenseWrapper>
  }
/>
```

#### 4.2 Vite Proxy `apps/platform/vite.config.ts`

Ajouter dans `proxy` :

```typescript
'/<module>-api': {
  target: UNIFIED_SERVER,
  rewrite: (path) => path.replace(/^\/<module>-api/, '/<module>/api'),
},
```

#### 4.3 Server Index `apps/platform/servers/unified/src/index.ts`

Ajouter :

```typescript
// Import
import { init<Module>, create<Module>Router } from './modules/<module>/index.js';

// Dans init()
await init<Module>();
app.use('/<module>/api', create<Module>Router());
```

#### 4.4 SharedNav constants `packages/shared/src/components/SharedNav/constants.ts`

**SOURCE UNIQUE** pour la navigation ET la landing page. Ajouter dans `APPS` :

```typescript
{
  id: '<module>',
  name: '<MODULE_DISPLAY_NAME>',
  description: '<MODULE_DESCRIPTION>',
  color: '<MODULE_COLOR>',
  gradientEnd: '<MODULE_COLOR_LIGHT>',
  path: '/<module>',
  category: 'main',
},
```

> Note: Ce fichier est importe par SharedNav et LandingPage. Un seul endroit a modifier.

#### 4.5 AVAILABLE_APPS dans gateway.ts

Dans `apps/platform/servers/unified/src/modules/gateway.ts`, ajouter l'ID du module dans `AVAILABLE_APPS` :

```typescript
const AVAILABLE_APPS = ['products', '<module>'];
```

Cela permet de gerer les permissions dans l'admin.

### 5. Tests Configuration

#### 5.1 `vitest.config.ts`

Ajouter les projets :

```typescript
// Server: <module>
{
  test: {
    name: 'server-<module>',
    root: '.',
    include: ['apps/platform/servers/unified/src/modules/__tests__/<module>/**/*.test.ts'],
    environment: 'node',
  },
},
// Client: <module>
{
  test: {
    name: 'client-<module>',
    root: '.',
    include: ['apps/platform/src/modules/<module>/__tests__/**/*.test.ts'],
    environment: 'node',
  },
},
```

#### 5.2 `package.json`

Ajouter les scripts :

```json
"test:server:<module>": "vitest run --project server-<module>",
"test:client:<module>": "vitest run --project client-<module>"
```

### 6. Permissions

Les permissions sont gerees via :
- Table `user_permissions` (user_id, app_id)
- Admin UI permet d'activer/desactiver l'acces par utilisateur
- L'ID du module doit etre dans `AVAILABLE_APPS` du gateway

**Comment ca fonctionne :**

1. **Frontend** : Le `SharedNav` filtre les apps visibles selon `allowedAppIds` (permissions user)
2. **Backend** : Utilise `authMiddleware` pour verifier l'authentification
3. **Admin** : Peut activer/desactiver l'acces a chaque module par utilisateur

**Pour ajouter une verification cote serveur (optionnel) :**

Creer un middleware dans `apps/platform/servers/unified/src/middleware/permission.ts` :

```typescript
import type { Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import { config } from '../config.js';

const pool = new Pool({ connectionString: config.appDatabaseUrl });

export function permissionMiddleware(appId: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'Non authentifie' });
      return;
    }

    // Admins have all permissions
    if (req.user.isAdmin) {
      next();
      return;
    }

    const { rows } = await pool.query(
      'SELECT 1 FROM user_permissions WHERE user_id = $1 AND app_id = $2',
      [req.user.id, appId]
    );

    if (rows.length === 0) {
      res.status(403).json({ error: 'Acces non autorise a ce module' });
      return;
    }

    next();
  };
}
```

Puis l'utiliser dans les routes :
```typescript
router.use(authMiddleware);
router.use(permissionMiddleware('<module>'));
```

### 7. Mode Embed (si ENABLE_EMBED = oui)

Le mode embed permet d'acceder a un element du module sans authentification, via l'URL `/<module>?embed=<ID>`.

#### 7.1 Modifier App.tsx pour supporter le mode embed

```typescript
// apps/platform/src/modules/<module>/App.tsx

import { EmbedView } from './components/EmbedView/EmbedView';

interface <Module>AppProps {
  onNavigate?: (path: string) => void;
  embedMode?: boolean;
  embedId?: string;
}

export default function <Module>App({ onNavigate, embedMode, embedId }: <Module>AppProps) {
  // Embed mode: render minimal view
  if (embedMode && embedId) {
    return <EmbedView itemId={embedId} />;
  }

  // Normal mode: full app with layout
  return (
    <Layout appId="<module>" variant="full-width" onNavigate={onNavigate}>
      <AppContent onNavigate={onNavigate} />
    </Layout>
  );
}
```

#### 7.2 Composant EmbedView

Creer `apps/platform/src/modules/<module>/components/EmbedView/EmbedView.tsx` :

```typescript
import { useState, useEffect } from 'react';
import { fetch<Entity>Embed } from '../../services/api';
import type { <Entity> } from '../../types';
import './EmbedView.css';

interface EmbedViewProps {
  itemId: string;
}

export function EmbedView({ itemId }: EmbedViewProps) {
  const [item, setItem] = useState<<Entity> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  useEffect(() => {
    async function loadItem() {
      try {
        setLoading(true);
        setError(null);
        const data = await fetch<Entity>Embed(itemId);
        setItem(data);
      } catch (err: any) {
        setError(err.message || 'Erreur lors du chargement');
      } finally {
        setLoading(false);
      }
    }
    loadItem();
  }, [itemId]);

  if (loading) {
    return <div className="embed-loading">Chargement...</div>;
  }

  if (error) {
    return <div className="embed-error">{error}</div>;
  }

  if (!item) {
    return <div className="embed-error">Element non trouve</div>;
  }

  return (
    <div className={`embed-app ${isDark ? 'embed-dark' : 'embed-light'}`}>
      <div className="embed-header">
        <h1 className="embed-title">{item.name}</h1>
        <button
          className="embed-theme-toggle"
          onClick={() => setIsDark(!isDark)}
          title={isDark ? 'Mode clair' : 'Mode sombre'}
        >
          {isDark ? '\u2600\ufe0f' : '\ud83c\udf19'}
        </button>
      </div>
      <div className="embed-content">
        {/* Afficher les champs de l'entite en lecture seule */}
        <div className="embed-field">
          <span className="embed-label">Nom</span>
          <p className="embed-value">{item.name}</p>
        </div>
        {/* Ajouter d'autres champs selon l'entite */}
      </div>
    </div>
  );
}
```

#### 7.3 Styles EmbedView

Creer `apps/platform/src/modules/<module>/components/EmbedView/EmbedView.css` :

```css
.embed-app {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: var(--font-family);
}

.embed-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-md) var(--spacing-lg);
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.embed-title {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  margin: 0;
  color: var(--text-primary);
}

.embed-theme-toggle {
  background: transparent;
  border: 1px solid var(--border-color);
  padding: var(--spacing-xs) var(--spacing-sm);
  cursor: pointer;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-base);
  color: var(--text-primary);
  transition: background-color 0.2s, border-color 0.2s;
}

.embed-theme-toggle:hover {
  background: var(--bg-hover);
  border-color: var(--accent-color);
}

.embed-content {
  flex: 1;
  overflow: auto;
  padding: var(--spacing-lg);
}

.embed-field {
  margin-bottom: var(--spacing-lg);
}

.embed-label {
  display: block;
  font-size: var(--font-size-sm);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: var(--spacing-xs);
}

.embed-value {
  margin: 0;
  font-size: var(--font-size-base);
  color: var(--text-primary);
}

.embed-loading,
.embed-error {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  color: var(--text-muted);
  font-family: var(--font-family);
  background: var(--bg-primary);
}

.embed-error {
  color: var(--color-error);
}
```

#### 7.4 Index export

Creer `apps/platform/src/modules/<module>/components/EmbedView/index.ts` :

```typescript
export { EmbedView } from './EmbedView';
```

#### 7.5 Route publique embed (backend)

Modifier `apps/platform/servers/unified/src/modules/<module>/routes.ts` pour ajouter la route publique AVANT l'authMiddleware :

```typescript
export function create<Module>Routes(): Router {
  const router = Router();

  // PUBLIC: Route embed (NO AUTH REQUIRED)
  router.get('/embed/:id', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: 'ID invalide' });
      return;
    }

    const item = await db.getById(id);
    if (!item) {
      res.status(404).json({ error: 'Non trouve' });
      return;
    }

    res.json(item);
  }));

  // All other routes require authentication
  router.use(authMiddleware);

  // ... reste des routes protegees
}
```

#### 7.6 API embed (frontend)

Ajouter dans `apps/platform/src/modules/<module>/services/api.ts` :

```typescript
// Public embed endpoint (no auth required)
export async function fetch<Entity>Embed(id: string): Promise<<Entity>> {
  const response = await fetch(`${API_BASE}/embed/${id}`);
  return handleResponse<<Entity>>(response);
}
```

#### 7.7 Router support embed

Verifier que `apps/platform/src/router.tsx` passe les props embed au module :

```typescript
// Dans les Routes du mode embed
<Route
  path="/<module>/*"
  element={
    <SuspenseWrapper>
      <<Module>App onNavigate={onNavigate} embedMode embedId={embedId} />
    </SuspenseWrapper>
  }
/>
```

#### 7.8 Bouton "Copier lien embed" (optionnel)

Ajouter dans la liste ou le detail de l'entite :

```typescript
const copyEmbedLink = useCallback((item: <Entity>) => {
  const url = `${window.location.origin}/<module>?embed=${item.id}`;
  navigator.clipboard.writeText(url);
  addToast({ type: 'success', message: 'Lien embed copie !' });
}, [addToast]);

// Dans le render
<button
  className="embed-link-btn"
  onClick={() => copyEmbedLink(item)}
  title="Copier le lien embed"
>
  Embed
</button>
```

### 8. Verification finale

```bash
# Creer la branche (mode OpenSpec)
git checkout -b feat/<module>

# Lancer les tests
npm test

# Tester le module
npm run dev

# Verifier l'acces avec permissions
# 1. Se connecter en admin
# 2. Aller dans Administration > Utilisateurs
# 3. Activer le module pour un utilisateur
# 4. Se connecter avec cet utilisateur
# 5. Verifier l'acces au module
```

## Tokens CSS disponibles

### Spacing
`--spacing-xs`, `--spacing-sm`, `--spacing-md`, `--spacing-lg`, `--spacing-xl`, `--spacing-2xl`, `--spacing-3xl`

### Typography
`--font-size-sm`, `--font-size-base`, `--font-size-md`, `--font-size-lg`, `--font-size-xl`
`--font-weight-normal`, `--font-weight-medium`, `--font-weight-semibold`, `--font-weight-bold`

### Colors
`--text-primary`, `--text-secondary`, `--text-muted`, `--text-inverse`
`--bg-primary`, `--bg-secondary`, `--bg-elevated`
`--accent-primary`, `--accent-primary-hover`
`--border-color`, `--border-color-light`
`--success`, `--warning`, `--error`

### Effects
`--radius-sm`, `--radius-md`, `--radius-lg`
`--transition-fast`, `--transition-normal`
