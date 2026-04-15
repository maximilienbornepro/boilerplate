import { Pool } from 'pg';
import { config } from '../../config.js';

let pool: Pool;

// ==================== CREDIT COSTS REGISTRY ====================

const CREDIT_COSTS: Record<string, Record<string, number>> = {
  suivitess: {
    create_document: 5,
    reformulation: 2,
    email_generation: 6,
    transcript_analysis: 10,
    transcript_merge: 10,
    content_import: 10,
    content_analysis: 10,
    create_ticket: 5,
    ticket_analysis: 10,
    routing_analysis: 2,
  },
  roadmap: {
    create_planning: 5,
    ai_suggestions: 1,
  },
  delivery: {
    create_board: 5,
    sanity_check: 5,
  },
};

const DEFAULT_MONTHLY_ALLOCATION = 500;

// ==================== ERROR ====================

export class InsufficientCreditsError extends Error {
  required: number;
  available: number;
  constructor(required: number, available: number) {
    super(`Insufficient credits: ${required} required, ${available} available`);
    this.name = 'InsufficientCreditsError';
    this.required = required;
    this.available = available;
  }
}

// ==================== INIT ====================

export async function initCreditPool(): Promise<void> {
  pool = new Pool({ connectionString: config.appDatabaseUrl });

  // Auto-create tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_credits (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      balance INTEGER NOT NULL DEFAULT 0,
      monthly_allocation INTEGER NOT NULL DEFAULT ${DEFAULT_MONTHLY_ALLOCATION},
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS credit_transactions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      type VARCHAR(20) NOT NULL,
      module VARCHAR(50),
      operation VARCHAR(100),
      description TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_credit_tx_user ON credit_transactions(user_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_credit_tx_date ON credit_transactions(created_at)');

  // Ensure all active users have a credit entry
  await pool.query(`
    INSERT INTO user_credits (user_id, balance, monthly_allocation)
    SELECT id, ${DEFAULT_MONTHLY_ALLOCATION}, ${DEFAULT_MONTHLY_ALLOCATION}
    FROM users WHERE is_active = true
    ON CONFLICT (user_id) DO NOTHING
  `);

  console.log('[Credits] Service initialized');
}

// ==================== CHECK ENABLED ====================

export async function isCreditSystemEnabled(): Promise<boolean> {
  try {
    const { rows } = await pool.query(
      "SELECT value FROM platform_settings WHERE key = 'credits_enabled'"
    );
    return rows.length > 0 && rows[0].value === 'true';
  } catch {
    return false;
  }
}

// ==================== CORE FUNCTIONS ====================

export function getOperationCost(module: string, operation: string): number {
  return CREDIT_COSTS[module]?.[operation] ?? 0;
}

export function getCreditCosts(): Record<string, Record<string, number>> {
  return CREDIT_COSTS;
}

export async function getBalance(userId: number): Promise<{ balance: number; monthlyAllocation: number }> {
  // Ensure user has a credit row
  await pool.query(`
    INSERT INTO user_credits (user_id, balance, monthly_allocation)
    VALUES ($1, $2, $2)
    ON CONFLICT (user_id) DO NOTHING
  `, [userId, DEFAULT_MONTHLY_ALLOCATION]);

  const { rows } = await pool.query(
    'SELECT balance, monthly_allocation FROM user_credits WHERE user_id = $1',
    [userId]
  );
  return {
    balance: rows[0]?.balance ?? 0,
    monthlyAllocation: rows[0]?.monthly_allocation ?? DEFAULT_MONTHLY_ALLOCATION,
  };
}

/**
 * Deduct credits atomically. Throws InsufficientCreditsError if balance too low.
 * Admins are always debited but never blocked (can go negative).
 * Skips deduction if credit system is disabled.
 */
export async function deductCredits(
  userId: number,
  isAdmin: boolean,
  module: string,
  operation: string,
): Promise<void> {
  const enabled = await isCreditSystemEnabled();
  if (!enabled) return;

  const cost = getOperationCost(module, operation);
  if (cost <= 0) return;

  // Ensure credit row exists
  await pool.query(`
    INSERT INTO user_credits (user_id, balance, monthly_allocation)
    VALUES ($1, $2, $2)
    ON CONFLICT (user_id) DO NOTHING
  `, [userId, DEFAULT_MONTHLY_ALLOCATION]);

  if (isAdmin) {
    // Admin: always deduct, allow negative balance
    const { rows } = await pool.query(
      `UPDATE user_credits
       SET balance = balance - $2, updated_at = NOW()
       WHERE user_id = $1
       RETURNING balance`,
      [userId, cost]
    );
    const newBalance = rows[0].balance;
    await pool.query(
      `INSERT INTO credit_transactions (user_id, amount, balance_after, type, module, operation, description)
       VALUES ($1, $2, $3, 'consumption', $4, $5, $6)`,
      [userId, -cost, newBalance, module, operation, `${module}/${operation}`]
    );
    return;
  }

  // Non-admin: block if insufficient
  const { rows, rowCount } = await pool.query(
    `UPDATE user_credits
     SET balance = balance - $2, updated_at = NOW()
     WHERE user_id = $1 AND balance >= $2
     RETURNING balance`,
    [userId, cost]
  );

  if (!rowCount || rowCount === 0) {
    const current = await getBalance(userId);
    throw new InsufficientCreditsError(cost, current.balance);
  }

  // Log transaction
  const newBalance = rows[0].balance;
  await pool.query(
    `INSERT INTO credit_transactions (user_id, amount, balance_after, type, module, operation, description)
     VALUES ($1, $2, $3, 'consumption', $4, $5, $6)`,
    [userId, -cost, newBalance, module, operation, `${module}/${operation}`]
  );
}

export async function addCredits(
  userId: number,
  amount: number,
  description: string,
  type: string = 'adjustment',
): Promise<number> {
  // Ensure credit row exists
  await pool.query(`
    INSERT INTO user_credits (user_id, balance, monthly_allocation)
    VALUES ($1, $2, $2)
    ON CONFLICT (user_id) DO NOTHING
  `, [userId, DEFAULT_MONTHLY_ALLOCATION]);

  const { rows } = await pool.query(
    `UPDATE user_credits
     SET balance = balance + $2, updated_at = NOW()
     WHERE user_id = $1
     RETURNING balance`,
    [userId, amount]
  );
  const newBalance = rows[0].balance;

  await pool.query(
    `INSERT INTO credit_transactions (user_id, amount, balance_after, type, description)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, amount, newBalance, type, description]
  );

  return newBalance;
}

export async function setMonthlyAllocation(userId: number, amount: number): Promise<void> {
  await pool.query(`
    INSERT INTO user_credits (user_id, balance, monthly_allocation)
    VALUES ($1, $2, $2)
    ON CONFLICT (user_id) DO UPDATE SET monthly_allocation = $2, updated_at = NOW()
  `, [userId, amount]);
}

export async function resetMonthlyCredits(): Promise<number> {
  // Reset all users to their monthly allocation
  const { rowCount } = await pool.query(`
    UPDATE user_credits SET balance = monthly_allocation, updated_at = NOW()
  `);

  // Log transactions for all users
  await pool.query(`
    INSERT INTO credit_transactions (user_id, amount, balance_after, type, description)
    SELECT user_id, monthly_allocation - balance + monthly_allocation, monthly_allocation, 'monthly_reset', 'Reset mensuel'
    FROM user_credits
  `);

  return rowCount ?? 0;
}

// ==================== QUERY FUNCTIONS ====================

export async function getRecentTransactions(userId: number, limit: number = 20): Promise<Array<{
  id: number;
  amount: number;
  balanceAfter: number;
  type: string;
  module: string | null;
  operation: string | null;
  description: string | null;
  createdAt: string;
}>> {
  const { rows } = await pool.query(
    `SELECT id, amount, balance_after, type, module, operation, description, created_at
     FROM credit_transactions WHERE user_id = $1
     ORDER BY created_at DESC LIMIT $2`,
    [userId, limit]
  );
  return rows.map((r: Record<string, unknown>) => ({
    id: r.id as number,
    amount: r.amount as number,
    balanceAfter: r.balance_after as number,
    type: r.type as string,
    module: r.module as string | null,
    operation: r.operation as string | null,
    description: r.description as string | null,
    createdAt: (r.created_at as Date).toISOString(),
  }));
}

export async function getAllBalances(): Promise<Array<{
  userId: number;
  email: string;
  balance: number;
  monthlyAllocation: number;
}>> {
  const { rows } = await pool.query(`
    SELECT u.id AS user_id, u.email, COALESCE(c.balance, 0) AS balance,
           COALESCE(c.monthly_allocation, ${DEFAULT_MONTHLY_ALLOCATION}) AS monthly_allocation
    FROM users u
    LEFT JOIN user_credits c ON c.user_id = u.id
    WHERE u.is_active = true
    ORDER BY u.email
  `);
  return rows.map((r: Record<string, unknown>) => ({
    userId: r.user_id as number,
    email: r.email as string,
    balance: r.balance as number,
    monthlyAllocation: r.monthly_allocation as number,
  }));
}
