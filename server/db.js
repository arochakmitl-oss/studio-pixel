// ====================================================================
// db.js — ฐานข้อมูล SQLite (ไฟล์ data/studio-pixel.db)
// ใช้ node:sqlite ที่ติดมากับ Node 22+/24 → ไม่ต้องลงไลบรารีเสริม รันออฟไลน์ได้
// เก็บ: งานที่มอบเข้ามา (inbox) + งานที่ทำเสร็จ (deliverables)
// ====================================================================
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const dataDir = fileURLToPath(new URL('./data/', import.meta.url));
fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(fileURLToPath(new URL('./data/studio-pixel.db', import.meta.url)));
db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');

db.exec(`
  CREATE TABLE IF NOT EXISTS inbox (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    at    TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS deliverables (
    rowid      INTEGER PRIMARY KEY AUTOINCREMENT,
    id         TEXT,
    title      TEXT,
    verdict    TEXT,
    summary    TEXT,
    decisions  TEXT,   -- JSON array
    figma_note TEXT,
    feedback   TEXT,
    at         TEXT
  );
`);

const safeArr = (s) => { try { return JSON.parse(s || '[]'); } catch { return []; } };

// ----- inbox (งานที่มอบผ่านแชท) -----
export function pushInbox(title) {
  db.prepare('INSERT INTO inbox (title, at) VALUES (?, ?)').run(String(title), new Date().toISOString());
}
export function drainInbox() {
  const rows = db.prepare('SELECT id, title FROM inbox ORDER BY id').all();
  if (rows.length) db.prepare('DELETE FROM inbox').run();
  return rows.map(r => r.title);
}
export function inboxCount() {
  return db.prepare('SELECT COUNT(*) AS c FROM inbox').get().c;
}

// ----- deliverables (งานที่ทำเสร็จ) -----
export function addDeliverable(d) {
  const at = d.at || new Date().toISOString();
  db.prepare(
    'INSERT INTO deliverables (id,title,verdict,summary,decisions,figma_note,feedback,at) VALUES (?,?,?,?,?,?,?,?)'
  ).run(d.id || '', d.title || '', d.verdict || '', d.summary || '',
        JSON.stringify(d.decisions || []), d.figma_note || '', d.feedback || '', at);
  return at;
}
export function listDeliverables(limit = 200) {
  return db.prepare(
    'SELECT id,title,verdict,summary,decisions,figma_note,feedback,at FROM deliverables ORDER BY rowid DESC LIMIT ?'
  ).all(limit).map(r => ({ ...r, decisions: safeArr(r.decisions) }));
}

export { db };
