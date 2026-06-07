import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { InvoiceRecord } from "@ledgerrun/contract";
import { config } from "./config.js";
import { publish } from "./events.js";

mkdirSync(dirname(config.dbPath), { recursive: true });
const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");
db.exec(`CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  data TEXT NOT NULL
)`);

const upsert = db.prepare("INSERT OR REPLACE INTO invoices (id, created_at, data) VALUES (?, ?, ?)");
const selectOne = db.prepare("SELECT data FROM invoices WHERE id = ?");
const selectAll = db.prepare("SELECT data FROM invoices ORDER BY created_at DESC");

export function saveInvoice(rec: InvoiceRecord): void {
  upsert.run(rec.id, rec.created_at, JSON.stringify(rec));
  publish(rec);
}

export function getInvoice(id: string): InvoiceRecord | null {
  const row = selectOne.get(id) as { data: string } | undefined;
  return row ? InvoiceRecord.parse(JSON.parse(row.data)) : null;
}

export function listInvoices(): InvoiceRecord[] {
  return (selectAll.all() as { data: string }[]).map((r) => InvoiceRecord.parse(JSON.parse(r.data)));
}

export function clearInvoices(): void {
  db.exec("DELETE FROM invoices");
}
