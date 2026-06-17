import { DatabaseSync } from "node:sqlite";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// DATA_DIR を指定すると永続ボリュームに保存（クラウド向け）。未指定ならアプリ直下。
const DATA_DIR = process.env.DATA_DIR || __dirname;
fs.mkdirSync(DATA_DIR, { recursive: true });
export const db = new DatabaseSync(path.join(DATA_DIR, "data.db"));

db.exec(`
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'individual',   -- individual | company
  company_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 対話型の要件整理セッション（市場ニーズ/顧客課題/トレンド/実現コスト・難易度）
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '無題のテーマ',
  persona TEXT,
  market_need TEXT,
  customer_problem TEXT,
  trend TEXT,
  cost_difficulty TEXT,
  chat_log TEXT DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',       -- draft | ready
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ideas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  project_id INTEGER,
  title TEXT NOT NULL,
  catchphrase TEXT,
  problem TEXT,
  target TEXT,
  solution TEXT,
  trend TEXT,
  cost_difficulty TEXT,
  tags TEXT DEFAULT '[]',
  selected INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 0,        -- OIマーケットに公開
  price INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS validations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idea_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  hypothesis TEXT,
  riskiest_assumption TEXT,
  metrics TEXT,
  timeline TEXT,
  go_criteria TEXT,
  plan_json TEXT DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS validation_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  validation_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  detail TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS mentor_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  validation_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL,                          -- user | ai | human
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// ---------- 認証ヘルパー ----------
export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = (stored || "").split(":");
  if (!salt || !hash) return false;
  const test = scryptSync(password, salt, 64);
  const ref = Buffer.from(hash, "hex");
  return test.length === ref.length && timingSafeEqual(test, ref);
}

export function newToken() {
  return randomBytes(32).toString("hex");
}
