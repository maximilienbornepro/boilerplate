\c app;

-- User credit balances
CREATE TABLE IF NOT EXISTS user_credits (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    balance INTEGER NOT NULL DEFAULT 0,
    monthly_allocation INTEGER NOT NULL DEFAULT 500,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Credit transaction ledger (immutable audit trail)
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
);

CREATE INDEX IF NOT EXISTS idx_credit_tx_user ON credit_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_tx_date ON credit_transactions(created_at);
