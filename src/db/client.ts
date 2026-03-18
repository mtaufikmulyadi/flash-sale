/**
 * Database client — uses Node's built-in `node:sqlite`
 *
 * Available in Node 22+ with no npm install needed.
 * Node 22:  requires --experimental-sqlite flag
 * Node 23+: stable, no flag needed
 * Node 24:  stable, no flag needed ✓
 */

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const DB_PATH =
  process.env.DB_PATH ?? path.join(__dirname, "../../flash-sale.db");

let db: DatabaseSync;

export function getDb(): DatabaseSync {
  if (!db) {
    db = new DatabaseSync(DB_PATH);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");

    const schema = fs.readFileSync(
      path.join(__dirname, "schema.sql"),
      "utf-8"
    );
    db.exec(schema);
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = undefined as unknown as DatabaseSync;
  }
}

export type Sale = {
  id: number;
  product_name: string;
  total_stock: number;
  start_time: string;
  end_time: string;
  status: "upcoming" | "active" | "ended";
  created_at: string;
};

export type Purchase = {
  id: number;
  user_id: string;
  sale_id: number;
  status: "confirmed" | "cancelled";
  purchased_at: string;
};
