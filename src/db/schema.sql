-- ============================================================
-- Flash Sale Schema
-- ============================================================

CREATE TABLE IF NOT EXISTS sales (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  product_name TEXT    NOT NULL,
  total_stock  INTEGER NOT NULL CHECK (total_stock > 0),
  start_time   TEXT    NOT NULL,
  end_time     TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'upcoming'
                       CHECK (status IN ('upcoming', 'active', 'ended')),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchases (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        TEXT    NOT NULL,
  sale_id        INTEGER NOT NULL REFERENCES sales(id),
  status         TEXT    NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'confirmed', 'cancelled', 'expired')),
  reserved_until TEXT    NOT NULL,             -- ISO — reservation expires at this time
  payment_id     TEXT,                         -- mock payment reference
  purchased_at   TEXT    NOT NULL DEFAULT (datetime('now')),

  -- DB-level safety net: one purchase attempt per user per sale
  UNIQUE (user_id, sale_id)
);
