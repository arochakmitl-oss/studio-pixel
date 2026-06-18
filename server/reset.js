// reset.js — ลบไฟล์ฐานข้อมูลทั้งหมด เพื่อเริ่มข้อมูลใหม่หมด (เหมือน otteri: npm run reset-db)
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const dir = fileURLToPath(new URL('./data/', import.meta.url));
for (const f of ['studio-pixel.db', 'studio-pixel.db-wal', 'studio-pixel.db-shm']) {
  try { fs.rmSync(new URL('./data/' + f, import.meta.url), { force: true }); } catch {}
}
console.log('✓ ล้างฐานข้อมูลแล้ว (data/studio-pixel.db) — ครั้งต่อไปที่รัน backend จะสร้างใหม่ว่างเปล่า');
