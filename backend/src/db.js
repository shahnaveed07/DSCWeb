import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const rootDir = path.resolve(path.join(path.dirname(new URL(import.meta.url).pathname), ".."));
const dbDir = path.join(rootDir, "db");
const dbPath = path.join(dbDir, "news.sqlite");
const initSqlPath = path.join(dbDir, "init.sql");

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

const initSql = fs.readFileSync(initSqlPath, "utf8");
db.exec(initSql);

export function getDb() {
  return db;
}

export function closeDb() {
  db.close();
}
