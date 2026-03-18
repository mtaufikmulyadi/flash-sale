-- ============================================================
-- Flash Sale Schema
-- Using SQLite via better-sqlite3
-- ============================================================

-- Stores the sale configuration
-- Only one sale is active at a time for this project
CREATE TABLE IF NOT EXISTS sales (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_name TEXT    NOT NULL,
  total_stock  INTEGER NOT NULL CHECK (total_stock > 0),
  start_time   TEXT    NOT NULL,  -- ISO 8601 string e.g. "2024-06-01T14:00:00.000Z"
  end_time     TEXT    NOT NULL,  -- ISO 8601 string
  status       TEXT    NOT NULL DEFAULT 'upcoming'
                       CHECK (status IN ('upcoming', 'active', 'ended')),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Each confirmed purchase by a user
-- One row per successful buy — enforced at DB level too as a safety net
CREATE TABLE IF NOT EXISTS purchases (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT    NOT NULL,
  sale_id      INTEGER NOT NULL REFERENCES sales(id),
  status       TEXT    NOT NULL DEFAULT 'confirmed'
                       CHECK (status IN ('confirmed', 'cancelled')),
  purchased_at TEXT    NOT NULL DEFAULT (datetime('now')),

  -- DB-level guarantee: one purchase per user per sale
  -- Redis is the fast guard, this is the safety net
  UNIQUE (user_id, sale_id)
);
