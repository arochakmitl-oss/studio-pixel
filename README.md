# Studio Pixel — AI Design Studio Command Center

แดชบอร์ดมอนิเตอร์ทีม AI Agent แบบเกมพิกเซลอาร์ต (มุมมอง 2D ท็อปดาวน์ สไตล์ Stardew × ธีมนีออนน้ำเงิน)
มอนิเตอร์งานจริงจาก cowork/Claude Code แบบเรียลไทม์ · ทีม 4 ตัว: **Pixel** (ออกแบบ Figma) · **Cora** (รีวิว Figma) · **Milo** (รีวิว+เอกสาร) · **Otto** (พ่อบ้าน: build/แก้โค้ด = แชท develop)

> โปรเจกต์นี้แยกอิสระจาก `otteri-ai-office` — เป็นเวอร์ชัน HTML standalone + backend เบา ๆ

## โครงสร้าง
```
studio-pixel/
  index.html          ← แดชบอร์ด (ดับเบิลคลิกเปิดได้เลย)
  server/
    ollama-server.js  ← monitor backend (ออฟไลน์ ไม่ใช้ LLM — ชื่อไฟล์เดิมไว้เพื่อความเข้ากันได้)
    cowork-watch.mjs  ← อ่าน log cowork (audit.jsonl) → ส่งงานเข้า dashboard
    usage-poll.py     ← ดึง usage % จาก claude.ai (curl_cffi)
    start-all.mjs     ← รันทั้ง 3 ตัวพร้อมกัน (npm start)
    sessions.js · db.js
```

## วิธีรัน

### 1) เปิดแดชบอร์ด
ดับเบิลคลิก `index.html` (เปิดในเบราว์เซอร์ได้เลย)

### 2) เปิด monitor backend (มอนิเตอร์งาน cowork/Claude Code จริง)
```bash
cd server
npm start        # รัน backend + cowork-watch + usage-poll พร้อมกัน (ออฟไลน์ ไม่ต้องมี LLM)
```
> **ไม่ใช้ Ollama / ไม่ต้องมีโมเดล LLM แล้ว** — ตัวละครสะท้อนงานจริงจาก cowork/Claude Code โดยตรง
> (ตัวอ่าน usage % ต้องเปิดแอป Claude ค้างไว้ให้ cookie สด · ต้องมี `curl_cffi`: `python3 -m pip install curl_cffi`)

## วิธีใช้
- **มอนิเตอร์อัตโนมัติ** — ทำงานใน cowork/Claude Code → ตัวละครทำงานตามจริง (แยก scope: Figma→Pixel/Cora, เอกสาร→Milo, build/แก้โค้ด→Otto พ่อบ้าน)
- **ไม่มีงาน = หลับ** — designer/lead/coord หลับที่โต๊ะ · พ่อบ้านหลับในครัว
- **Kanban** (ปุ่ม ▦) — รอ allow / กำลังทำ / เสร็จแล้ว · งานเสร็จค้างทั้งวัน รีเซ็ตเที่ยงคืน
- **Claude Usage** (มุมขวาบน) — Current session % + กดดู modal (เหมือนแอป) + มูลค่าใช้งานเป็นบาท
- คลิกตัวละคร = โปรไฟล์ + สกิล · เวลา = Asia/Bangkok (ICT)
- ข้อมูล **รอด restart** (เก็บ SQLite) · ล้าง: `cd server && npm run reset-db`

## Endpoints (monitor backend, port 8787)
- `GET /api/health` · `GET /api/sessions` (live + usage + doneTasks) · `POST /api/event` (hooks/watcher)
- `POST /api/inbox` · `POST /api/deliverable` · `GET /api/deliverables`
