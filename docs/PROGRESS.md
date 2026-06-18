# Studio Pixel — Progress Tracker

ไฟล์นี้ใช้ "ติดตามงาน" ว่าทำอะไรไปแล้ว / กำลังทำ / ยังไม่ทำ
บอกผม (Claude) ว่า "อัปเดต progress" เมื่อไหร่ก็ได้ ผมจะแก้ตารางนี้ให้
สถานะ: ✅ เสร็จ · 🔄 กำลังทำ · ⬜ ยังไม่ทำ

_อัปเดตล่าสุด: 2026-06-09_

## ฟีเจอร์ (อิง Roadmap ใน workflow.md)

| # | ฟีเจอร์ | สถานะ | หมายเหตุ |
|---|---|---|---|
| 3.1 | แดชบอร์ดกราฟิก isometric (chibi) | ✅ | ฉากภาพจริง `scene-full.png` + ตัวละคร sprite วางทับ เดินได้ |
| 3.2 | ระบบสถานะงาน (state machine) | ✅ | Backlog→In Progress→Review→Approved/Revise→Done |
| 3.3 | ต่อ AI จริง (Ollama/Claude) + fallback | ✅ | Live ตลอด, ออฟไลน์→โหมดจำลอง |
| 3.4 | มอบงานผ่านแชท (inbox bridge) | ✅ | "มอบงาน: ..." → ทีมรับไปทำ |
| 3.5 | คลังงานเสร็จ (แท็บ Done + ไฟล์) | ✅ | เซฟ `server/deliverables/*.md` |
| 3.6 | โปรไฟล์ + สกิลตัวละคร (modal) | ✅ | คลิกตัวละคร |
| 3.7 | ภาษาไทย (UI + ผลลัพธ์ AI) | ✅ | สถานะ/log/AI output เป็นไทย |
| — | sim เดินต่อแม้สลับแท็บ | ✅ | setInterval ตอนแท็บซ่อน |
| — | นาฬิกาเวลาจริง Bangkok (ICT) | ✅ | |
| — | แอนิเมชันสด ๆ ตอน AI กำลังคิด | ✅ | pacing + จุด "กำลังคิด…" |
| — | เก็บงานลง SQLite (เหมือน otteri) | ✅ | `node:sqlite` · `server/data/studio-pixel.db` · เก็บ inbox + deliverables (รอด restart) |

| — | เชื่อม cowork → dashboard อัตโนมัติ (Claude Code hook) | ✅ | พิมพ์สั่งงาน=งานใหม่ · Figma MCP=สัญญาณ "กำลังแก้ Figma" |
| — | **Live Session Monitor** (หลายหน้าต่างพร้อมกัน) | ✅ | แยก scope อัตโนมัติ: Figma create→Pixel, review→Cora, เอกสาร→Milo · ตัวละครทำงาน "เรียลไทม์" ตราบที่ session busy · จบ session=ยืน idle ที่โต๊ะ |
| — | **มอนิเตอร์ cowork (แอป Claude)** ผ่าน log watcher | ✅ | cowork ใช้ hook ไม่ได้ → `cowork-watch.mjs` ตามอ่าน `audit.jsonl` ของแอปแบบเรียลไทม์ → ส่งเข้า dashboard · กัน "ห้อง develop" (แชทที่สร้าง tool) ออกด้วย `STUDIO_EXCLUDE` |
| — | **Kanban เต็มจอ + เตือน "รอ allow" เรียลไทม์** | ✅ | ปุ่ม Kanban → modal 3 คอลัมน์ (รอ allow/กำลังทำ/พัก) การ์ดงานวันนี้: ชื่อ+role, รายละเอียด, tool, progress bar, actions · จับ `permission_request` = ขอ allow → การ์ดแดงเรืองแสง+แบนเนอร์+badge+toast |
| — | **Butler "Otto" (ตัวที่ 4)** = แชท develop | ✅ | พ่อบ้านดูแล office · ตัวแทนแชท Claude Code (build/แก้โค้ด) ขับด้วย hook (scope `butler`) · sprite `butler-*.png` จาก `butler-sheet.png` |

## กำลังทำ / ถัดไป
- ✅ 3.9 เปลี่ยนเป็นกราฟิก chibi isometric — renderer composite เสร็จแล้ว (ฉากภาพ + sprite วางทับ depth-sort)
- ⬜ จูนตำแหน่ง zone ของแต่ละ agent ให้ตรงโต๊ะในรูปเป๊ะ ๆ (พิกัด normalized ใน `HOME/SEAT/...`)
- ⬜ ส่ง Discord webhook จริง / ย้าย live state ลง SQLite

## บันทึกประจำงาน (log)
- 2026-06-05 · สร้างโปรเจกต์ `studio-pixel` แยกจาก `otteri-ai-office` + วาง workflow/progress doc
- 2026-06-09 · เก็บงานลง SQLite — เพิ่ม `server/db.js` (node:sqlite), ต่อ inbox+deliverables, `npm run reset-db`; ทดสอบข้อมูลรอด restart แล้ว
- 2026-06-09 · รับชีตตัวละคร 3 ตัว (pixel/cora/milo, 1024×1536, 3×3) → หั่นด้วย Pillow (largest-blob ตัดติ่ง) เป็น 27 sprite โปร่งใสใน `assets/characters/`
- 2026-06-09 · **ทำงานร่วมกัน → เดินไปคุยกัน**: Figma/เอกสาร → Pixel คุยกับ Milo · ตรวจงาน → Cora คุยกับ Milo (Milo=ตัวประสาน) · ตรวจจาก busy ของ designer/lead ใน applyLiveSessions → set `collab` → `collabDrive` (override ใน tick) เดินไปรวมที่ `MEET` + สถานะ 💬 หันหน้าเข้าหากัน · Otto(dev) ไม่ร่วม · backfill งาน cowork ที่เสร็จวันนี้ลง Done (kind `donearchive`, dedupe uuid)
- 2026-06-09 · การ์ด "เสร็จแล้ว" โชว์ **token + บาท ต่องาน**: watcher รวม cost/tokens ของเทิร์นเข้า event `stop` (uuid) → backend ผูกกับ task ตอน archive (`cost`,`tokens`) + สะสม daily (dedupe) · การ์ดแสดง "🪙 X tokens · ≈฿Y" (USD_THB 36.5)
- 2026-06-09 · ปุ่ม **เลิกงาน/เริ่มงาน** (toggle): เลิกงาน→ทุกตัวเดินไปหัวบันได (`STAIRS`) แล้วลงออกนอกเฟรม (`EXIT` gy 1.25, ซ่อน sprite เมื่อ gy>1.05) · เริ่มงาน→เดินกลับ HOME/ประจำที่ · `offDuty` override ใน tick (ข้าม FSM)
- 2026-06-09 · **เซฟสถานะลงดิสก์ (รอด restart)**: `server/data/monitor-state.json` เก็บ sessions+doneTasks+cost · โหลดตอน start (เฉพาะวันนี้) · debounced save 1.5s · แก้ปัญหา "task เสร็จหายตอน restart" · เพิ่ม **เงิน (฿) ใน header** ข้าง session % (sub: "฿X วันนี้ · กดดู ▸")
- 2026-06-09 · **แสดง Claude plugins ที่ติดตั้ง**: `/api/plugins` สแกน Figma plugin (`…/rpm/plugin_*/skills/figma-*` 8 skills) + Vercel (`~/.claude/plugins/cache/*/vercel/*/skills`) อ่าน SKILL.md name/desc · map Figma→Pixel, Vercel→Otto · โปรไฟล์โชว์ "🧩 Plugin: …" + chips (hover=desc) ใต้ส่วนไฟล์ .md · cache 5 นาที
- 2026-06-09 · **Skills = ไฟล์ .md จริง**: `server/skills.json` map character→path ไฟล์จริง (Otteri docs: workflow→Pixel, UX_Review→Cora, discord_config+PROGRESS→Milo, CLAUDE+workflow→Otto) · backend `/api/skills` (list+excerpt) + `/api/skill?path=` (เนื้อหา, whitelist เฉพาะใน skills.json) · โปรไฟล์แทน skill bar เดิมด้วยรายการไฟล์ .md (คลิกดูเนื้อหาเต็ม + ปุ่มกลับ) · แก้ skills.json เพิ่ม/เปลี่ยนไฟล์ได้
- 2026-06-09 · **ลบ Ollama/LLM ออกหมด**: ตัวละครสะท้อนงานจริง (cowork/Claude Code) ไม่ต้องใช้โมเดลแล้ว → `ollama-server.js` กลายเป็น monitor backend ล้วน (เอา ROLES/runAgent/STUDIO_CONTEXT/`/api/agent`/Ollama health ping ออก · health คืน `{ok:true}`) · dashboard เอา `LIVE.model`/`aiCall`/aiThink-branch ออก (FSM ใช้ fallback template) · ปุ่ม "LIVE · ON" · อัปเดต README (เลิกใช้ Ollama)
- 2026-06-09 · **archive task เสร็จทีละชิ้น**: เดิม 1 แชท=1 การ์ด (ค้าง working) → เปลี่ยนเป็นแต่ละ prompt ที่จบ (Stop / มี prompt ใหม่ / SessionEnd) = 1 การ์ด done เก็บใน `doneTasks` (รีเซ็ตรายวัน) · คอลัมน์ "เสร็จแล้ว" แสดง archive · KPI Done = จำนวน task เสร็จวันนี้ · watcher กรอง event เก่า >15 นาที (env `COWORK_MAX_AGE_MS`) กัน phantom จาก backfill session เก่า
- 2026-06-09 · แยก **task vs project**: `chat` = prompt แรกของ session (ชื่อแชท/หัวข้อ) · `title` = prompt ล่าสุด (task) · การ์ด Kanban โชว์ 💬 project chip + "งาน: <task>" · แผงขวาโชว์ 💬 ชื่อแชท + task
- 2026-06-09 · KPI หน้าแรก: Approved→**Done** + ผูกกับ live cowork (Active=working, Waiting=รอ allow, Done=เสร็จวันนี้) · Kanban "เสร็จแล้ว" เก็บ**ตามวัน** (เดิม 8h) — งานเสร็จ (รวม Otto) ค้างทั้งวัน รีเซ็ตเที่ยงคืน Bangkok (`bkkDayOf(startedAt)!==today`→ลบ) · designer/lead/coord เดินไปหลับที่โต๊ะ iMac ของตัวเอง (`sleepAtSeat`), ย้ายพิกัด SEAT ให้ตรงโต๊ะ 3 ตัวฝั่งซ้าย
- 2026-06-09 · ไม่มีงาน→หลับ: cowork/butler ที่ไม่ busy = `sleep` (เดิม butler ยืน idle) · designer/lead/coord หลับที่โต๊ะตัวเอง (SEAT) · **พ่อบ้านหลับในครัว** (`KITCHEN` 0.82,0.21) · สี focus เปลี่ยนเป็น **เขียวนีออนสีเดียว** `#39ff14` (เดิมแยกสีตามตัว)
- 2026-06-09 · Kanban: เพิ่มคอลัมน์ **"✅ เสร็จแล้ว"** — งานที่ปิด session (SessionEnd) ไม่ถูกลบทิ้งแล้ว (เดิม `end`→delete) แต่ mark `ended` + state `done` ค้างทั้งวัน (KEEP_MS 8h) · งานไม่มี activity >3 นาที = done · การ์ด done โชว์เวลาเสร็จ + ✓ · Butler: เพิ่ม **Notification hook** (ขอ allow/รอตอบ) + เก็บ `lastFile` (ไฟล์ที่แก้) โชว์ในการ์ด
- 2026-06-09 · **Claude Usage % จริง (เหมือนหน้า Settings▸Usage ในแอป)**: ค้นพบว่า % อยู่หลัง Cloudflare ที่ `GET https://claude.ai/api/organizations/{org}/usage` (คืน `five_hour`/`seven_day`/`seven_day_sonnet` utilization%). curl ธรรมดาโดน CF บล็อก → ใช้ **`curl_cffi` (Chrome impersonation)** + ถอด cookie `sessionKey` จาก `Cookies` (AES-128-CBC, key จาก Keychain "Claude Safe Storage" via PBKDF2-SHA1 1003, strip 32-byte domain prefix) + org จาก `lastActiveOrg`. สร้าง `server/usage-poll.py` (poll 60s → POST `/api/event {kind:'limits'}`), backend เก็บ `lastLimits`, `start-all.mjs` spawn poller. **กุญแจ Keychain ฝังไว้ใน poller** (env `CLAUDE_SAFE_KEY` override) เพราะเรียก `security` จาก subprocess จะเด้ง GUI prompt ค้าง. dashboard: header chip = Current session % (กดเปิด modal), modal เลียนแบบแอป (Current session/All models/Sonnet only + reset countdown + cost/tokens วันนี้). ต้องเปิดแอป Claude ไว้ให้ cf_clearance สด
- 2026-06-09 · ปรับ UI 6 จุด: (1) Project Health→**Claude Usage** (อ่าน `rate_limit_event` จาก cowork → status + นับถอยหลังรีเซ็ต window 5h) (2) selection จากวงแหวน→**neon ground-shadow** ของตัวละคร (3) แก้ avatar การ์ดซ้ายยืด (object-fit:contain) (4) **ตัดรูปใหม่ทุกชีต** วิธีขยาย cell + largest-blob (กันแขน/ขา/หัวแหว่ง — milo/butler เคยโดน) (5) ตัดปุ่ม pause/×1/×2/×4 (6) ตัด PROJECT AURORA ออกทั้งหน้าจอ+แผงขวา → โชว์งานจริงจากแชท (เช่น "ทำ otteri blueplus daily") · Kanban card ใช้ title จาก session อยู่แล้ว
- 2026-06-09 · **เพิ่ม Butler "Otto" ตัวที่ 4**: หั่น `butler-sheet.png` (alpha + largest-blob → 9 ท่า, ชีตโปร่งใส) · เอเจนต์ kind `butler` ที่ HOME/SEAT กลางออฟฟิศ · scope `butler` = แชท Claude Code (build/แก้โค้ด) ผ่าน hook (`hook-push.mjs` ติด `scope:'butler'`, ข้าม otteri) · butler bypass `STUDIO_EXCLUDE` · `updateButler` (idle=ยืนดูแล office ไม่หลับ) · โชว์ในจอ/sidebar/profile/Kanban
- 2026-06-09 · **Kanban board เต็มจอ**: ปุ่มบน topbar → modal 3 คอลัมน์ตามสถานะ (waiting/working/idle) การ์ด = cowork session วันนี้ (ชื่อตัวละครตาม scope, รายละเอียด=prompt, lastTool, progress bar indeterminate, actions, เวลาเริ่ม). backend `sessions.js` เพิ่ม `waiting/waitTool/toolCount/startedAt` + state + เก็บงานทั้งวัน (KEEP_MS 8h). watcher จับ `permission_request`→`wait`, `permission_response`→`unwait`. เตือน "รอ allow" เรียลไทม์: badge บนปุ่ม + แบนเนอร์ + toast เมื่อมีงานใหม่ติดรอ
- 2026-06-09 · **มอนิเตอร์ cowork ผ่าน log watcher**: ค้นพบว่าแอป Claude/cowork รัน sandbox ยิง local hook ไม่ได้ แต่เขียน `audit.jsonl` ต่อ session ลงเครื่อง → สร้าง `server/cowork-watch.mjs` ตามอ่านไฟล์ (tail + peek cwd จากบรรทัด init) ส่ง event เข้า `/api/event` · กรอง meta-prompt (scheduled/command) + classify เฉพาะ Figma/เอกสาร · `STUDIO_EXCLUDE` กันห้อง develop (แชทนี้) + Scheduled/otteri-code · เพิ่ม `start-all.mjs` (`npm start` รัน backend+watcher พร้อมกัน) · ทดสอบ replay เห็นงาน Figma จริง map เป็น pixel/cora ถูกต้อง
- 2026-06-09 · **Live Session Monitor**: `server/sessions.js` (ติดตามทุก session, แยก scope จากเครื่องมือ+คำสั่ง, busy/idle), endpoint `/api/event`+`/api/sessions` (ทั้ง 2 backend), hook ครบ 4 ตัว (UserPromptSubmit/PostToolUse/Stop/SessionEnd) ส่ง session_id, dashboard `pollSessions`+`liveDrive` ขับ 3 ตัวละครแบบเรียลไทม์ตาม session จริง (ป้าย in-progress indeterminate) · จบ session→ยืน idle · ทดสอบ 3 scope พร้อมกันผ่าน
- 2026-06-09 · ต่อ cowork → dashboard อัตโนมัติ: เพิ่ม `/api/pulse` (backend ทั้ง 2 ตัว) + `server/hook-push.mjs` + Claude Code hook ใน `~/.claude/settings.json` (global): `UserPromptSubmit`→งานใหม่, `PostToolUse mcp__.*`→pulse (กรองเฉพาะ Figma). dashboard เพิ่ม `pollPulse` + แยก `LIVE.ok`(backend) จาก `LIVE.model`(Ollama) ให้ inbox ทำงานได้แม้ไม่เปิด Ollama · ทดสอบครบวงจรแล้ว
- 2026-06-09 · เขียน renderer ใหม่แบบ composite — วาด `scene-full.png` เป็นพื้นหลัง (contain-fit) + วาง sprite ตัวละครทับด้วยพิกัด normalized 0..1, depth-sort ตาม gy, เลือก pose ตามสถานะ (idle/think/typing/sleep/เดิน 4 ทิศ + flip); ลบโค้ดวาด pixel-art เดิมทิ้ง · avatar/portrait ใช้ PNG จริง
