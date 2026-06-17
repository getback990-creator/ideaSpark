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
  goal TEXT,                                   -- ユーザーのオープンな要望・ゴール
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
  mentor_id INTEGER,                           -- human相談時のメンター
  mentor_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 登録メンター（プロピッカー）
CREATE TABLE IF NOT EXISTS mentors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6c5cff',
  expertise TEXT DEFAULT '[]',
  bio TEXT,
  focus TEXT,
  responses INTEGER DEFAULT 0,
  rate TEXT DEFAULT '初回相談 無料',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 人メンターへの相談依頼
CREATE TABLE IF NOT EXISTS consultations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  validation_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  mentor_id INTEGER NOT NULL,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'requested',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// ---------- 既存DB向けの安全なマイグレーション（列追加） ----------
function addColumn(table, def) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${def};`);
  } catch (e) {
    if (!/duplicate column/i.test(e.message)) throw e;
  }
}
addColumn("projects", "goal TEXT");
addColumn("mentor_messages", "mentor_id INTEGER");
addColumn("mentor_messages", "mentor_name TEXT");

// ---------- メンターのサンプル投入（空のときだけ） ----------
const mentorCount = db.prepare("SELECT COUNT(*) AS c FROM mentors").get().c;
if (mentorCount === 0) {
  const seed = db.prepare(
    "INSERT INTO mentors (name, title, color, expertise, bio, focus, responses, rate) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const mentors = [
    ["田中 健一", "連続起業家 / 2社をバイアウト", "#6c5cff", ["0→1", "資金調達", "SaaS", "出口戦略"],
      "SaaSスタートアップを2社創業し、いずれもM&Aでイグジット。短期間で企業価値を高める設計が得意。", "数年でのバイアウトを見据えた事業設計", 248, "初回相談 無料"],
    ["佐藤 美咲", "ベンチャーキャピタリスト", "#00b3d6", ["投資", "事業計画", "市場分析", "ピッチ"],
      "シードVCで100社以上を審査・投資。投資家目線で“伸びる市場”と“刺さる事業計画”を見極める。", "投資家に響く事業計画と市場選定", 312, "初回相談 無料"],
    ["鈴木 大輔", "元上場企業 新規事業責任者", "#7a52ff", ["社内新規事業", "大企業連携", "事業開発", "PoC"],
      "東証プライム企業で新規事業部門を統括。社内提案の通し方と大企業アセットの活かし方に精通。", "社内新規事業の企画と承認の通し方", 187, "初回相談 無料"],
    ["山本 由香", "グロースマーケター", "#ff7a59", ["マーケティング", "LP/CVR", "SNS", "D2C"],
      "D2C・SaaSのグロースを支援。低予算で需要を検証し、CVRを伸ばす実践手法が強み。", "低コストでの需要検証と集客", 401, "初回相談 無料"],
    ["中村 翔", "プロダクトマネージャー", "#34d399", ["PdM", "UXリサーチ", "MVP", "顧客開発"],
      "BtoB/BtoCで複数プロダクトを0から立ち上げ。顧客課題の見極めとMVP設計を支援。", "顧客課題の検証とMVPの作り方", 156, "初回相談 無料"],
    ["小林 亮", "副業の専門家 / 複数の月100万円事業", "#b14cff", ["副業", "スモールビジネス", "物販", "コンテンツ"],
      "会社員をしながら複数の副業で月収100万円超を達成。小さく始めて伸ばす型を体系化。", "副業で月数万円→数十万円に伸ばす", 523, "初回相談 無料"],
  ];
  mentors.forEach((m) => seed.run(m[0], m[1], m[2], JSON.stringify(m[3]), m[4], m[5], m[6], m[7]));
}

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
