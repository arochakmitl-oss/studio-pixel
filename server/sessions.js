// Live cowork session tracker.
// Maps each Claude Code session to a Studio Pixel character (scope) by what it's doing,
// and tracks whether it is actively working RIGHT NOW (realtime), so the dashboard can
// show each character working for as long as its session is busy.
//
//   scope 'pixel' = create/design in Figma      (Senior UX/UI Designer)
//   scope 'cora'  = review Figma / QA / comments (Team Lead)
//   scope 'milo'  = documents / reports / specs  (Project Coordinator)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sessions = new Map();   // session_id -> { scope, busy, waiting, waitTool, lastTool, title, toolCount, at, startedAt }

const BUSY_TIMEOUT = 60_000;     // no event for this long → not actively working
const MAX_SESSIONS = 120;         // cap stored sessions (drop oldest idle)
const bkkDayOf = (ts) => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date(ts)); } catch { return ''; } };

// "Develop office" = the Claude Code session(s) that BUILD this tool — must NOT be monitored as workers.
// Exclude by session_id or by a substring of the session cwd. Configure via STUDIO_EXCLUDE (comma-separated).
const EXCLUDE = (process.env.STUDIO_EXCLUDE ||
  'studio-pixel,otteri-ai-office'                 // default: any session working in the dev repos
).split(',').map(s => s.trim()).filter(Boolean);
function isExcluded(ev) {
  const id = String(ev.session_id || '');
  const cwd = String(ev.cwd || '');
  return EXCLUDE.some(x => id === x || (cwd && cwd.includes(x)));
}

function classifyScope(ev, prev) {
  const tool = String(ev.tool_name || '').toLowerCase();
  const file = String(ev.file_path || '').toLowerCase();
  const text = String(ev.prompt || '').toLowerCase();
  const blob = `${tool} ${file} ${text}`;

  const figmaTool = /figma|get_design|get_screenshot|get_variable|get_metadata|get_code|create_design|generate-design|get_image|edit-design|perform-editing/.test(tool);
  const figmaWord = /figma|ออกแบบ|ดีไซน์|design|wireframe|mockup|prototype|\bui\b|\bux\b|หน้าจอ|สกรีน|component/.test(text);
  const reviewSig = /review|รีวิว|ตรวจ|approve|อนุมัติ|comment|คอมเมนต์|feedback|ฟีดแบ็ก|critique|\bqa\b|accessibility|ตรวจสอบ|get_screenshot|list-comments/.test(blob);
  const docsSig   = /\.md|\.mdx|\.doc|\.txt|document|เอกสาร|report|รายงาน|สรุป|summary|spec|สเปก|notion|readme|note|บันทึก|write|เขียน/.test(blob);

  if (figmaTool || figmaWord) return reviewSig ? 'cora' : 'pixel';
  if (docsSig) return 'milo';
  return (prev && prev.scope) || null;   // null = not a tracked work type → ignore (no Figma/docs signal)
}

function prettyTool(t) { return String(t || '').replace(/^mcp__[0-9a-f-]+__/i, '').replace(/^mcp__/, '').replace(/__/g, '·').replace(/[-_]/g, ' ').trim(); }

// kind: 'prompt' | 'tool' | 'wait' | 'unwait' | 'stop' | 'end'
let lastUsage = null;   // latest Claude rate-limit telemetry from cowork
let lastLimits = null;  // real usage % from claude.ai API (via usage-poll.py)
// accumulated credit/usage spent "today" (Bangkok day), summed from each turn's total_cost_usd
const cost = { day: '', usd: 0, tin: 0, tout: 0, turns: 0, seen: new Set() };
function bkkDay() { return bkkDayOf(Date.now()); }
function getUsage() {
  return { ...(lastUsage || {}), limits: lastLimits,
    costToday: cost.usd, tokensInToday: cost.tin, tokensOutToday: cost.tout, turnsToday: cost.turns, costDay: cost.day };
}

// completed-task archive — each finished task (one prompt's worth of work) becomes a card.
// Kept FOREVER, bucketed by Bangkok day → the dashboard can browse any past day's history.
let doneHistory = {};            // 'YYYY-MM-DD' -> [records]
let doneSeen = new Set();        // global dedupe by uuid (across all days)
function archiveDone(rec) {                       // add a done-task record (dedupe by uuid)
  if (rec.uuid) { if (doneSeen.has(rec.uuid)) return false; doneSeen.add(rec.uuid); if (doneSeen.size > 20000) doneSeen.clear(); }
  const day = bkkDayOf(rec.at || Date.now());
  const arr = (doneHistory[day] ||= []);
  arr.push(rec);
  arr.sort((a, b) => a.at - b.at);
  if (arr.length > 300) arr.splice(0, arr.length - 300);
  return true;
}
function accumulateCost(uuid, c, tin, tout) {   // daily usage total (dedupe by uuid)
  const d = bkkDay();
  if (cost.day !== d) { cost.day = d; cost.usd = 0; cost.tin = 0; cost.tout = 0; cost.turns = 0; cost.seen.clear(); }
  const id = uuid || '';
  if (id) { if (cost.seen.has(id)) return; cost.seen.add(id); if (cost.seen.size > 8000) cost.seen.clear(); }
  cost.usd += (+c || 0); cost.tin += (+tin || 0); cost.tout += (+tout || 0); cost.turns++;
  scheduleSave();
}
function archiveTask(s, turn) {
  if (!s || !s.title) return;
  const uuid = turn && turn.uuid;
  if (uuid) { if (doneSeen.has(uuid)) return; }
  else if (s.title === s.lastArchived) return;   // no uuid (butler hook) → dedupe consecutive same task
  s.lastArchived = s.title;
  archiveDone({ uuid: uuid || '', scope: s.scope, chat: s.chat || '', task: s.title, lastTool: s.lastTool || '', lastFile: s.lastFile || '', toolCount: s.toolCount || 0, at: Date.now(),
    cost: (turn && +turn.cost) || 0, tokens: (turn ? (+turn.tin || 0) + (+turn.tout || 0) : 0) });
  return;
}
function getDoneTasks(day) { return doneHistory[day || bkkDay()] || []; }
function getDoneDays() { return Object.keys(doneHistory).filter(d => (doneHistory[d] || []).length).sort().reverse(); }

function record(ev) {
  if (ev.kind === 'usage') { if (ev.usage) lastUsage = { ...ev.usage, at: Date.now() }; return; }
  if (ev.kind === 'limits') { if (ev.limits) lastLimits = { ...ev.limits, at: Date.now() }; return; }
  if (ev.kind === 'cost') { accumulateCost(ev.uuid, ev.cost, ev.tin, ev.tout); return; }
  if (ev.kind === 'donearchive') {     // backfill a completed cowork task (from log history)
    if (!ev.task || !ev.scope) return;
    if (archiveDone({ uuid: ev.uuid || '', scope: ev.scope, chat: (ev.chat || '').slice(0, 80), task: String(ev.task).slice(0, 140),
      lastTool: ev.lastTool || '', lastFile: '', toolCount: 0, at: +ev.at || Date.now(), cost: +ev.cost || 0, tokens: +ev.tokens || 0 })) scheduleSave();
    return;
  }
  // 'butler' = the develop-office chat (build/edit code) — it IS represented (as the butler),
  // so it bypasses the exclusion. Everything else excluded by STUDIO_EXCLUDE is ignored.
  if (ev.scope !== 'butler' && isExcluded(ev)) return;
  const id = String(ev.session_id || 'default');
  const now = Date.now();
  // session window closed → archive its last task as done
  if (ev.kind === 'end') { const e = sessions.get(id); if (e) { archiveTask(e, ev); e.ended = true; e.busy = false; e.waiting = false; e.at = now; scheduleSave(); } return; }
  const existing = sessions.get(id);
  // turn finished → the current task is DONE → archive it (with this turn's cost/tokens)
  if (ev.kind === 'stop') {
    if (existing) { archiveTask(existing, ev); existing.busy = false; existing.waiting = false; existing.at = now;
      if (typeof ev.sessTin === 'number') { existing.sessTok = (+ev.sessTin || 0) + (+ev.sessTout || 0); } }  // running session token total (Claude Code)
    if (typeof ev.cost === 'number') accumulateCost(ev.uuid, ev.cost, ev.tin, ev.tout);  // also add to daily total
    scheduleSave();
    return;
  }
  // scope: prefer an explicit scope from the watcher (knows the session's tool history),
  // else classify from this event. If still unknown, ignore (not a Figma/docs session).
  const valid = { pixel: 1, cora: 1, milo: 1, butler: 1 };
  const scope = (ev.scope && valid[ev.scope]) ? ev.scope : classifyScope(ev, existing);
  if (!scope && !existing) return;       // unknown work type and not already tracked → ignore
  let s = existing || { scope: scope || 'pixel', busy: false, waiting: false, waitTool: '', lastTool: '', lastFile: '', title: '', chat: '', toolCount: 0, startedAt: now };
  if (scope) s.scope = scope;
  if (ev.kind === 'wait') {              // asking for permission / waiting for input → needs attention
    s.waiting = true; s.waitTool = String(ev.waitLabel || prettyTool(ev.tool_name) || 'allow').slice(0, 60); s.busy = true;
  } else if (ev.kind === 'unwait') {     // user responded → resume
    s.waiting = false; s.busy = true;
  } else {
    s.waiting = false; s.busy = true;    // any fresh prompt/tool clears the waiting state
    if (ev.kind === 'prompt' && ev.prompt) {
      const p = String(ev.prompt).replace(/\s+/g, ' ').trim();
      if (s.title && s.title !== p) archiveTask(s);  // a new prompt → the previous task is done → archive
      s.title = p.slice(0, 140);                 // task = latest prompt/command
      if (!s.chat) s.chat = p.slice(0, 80);      // project/chat name = the FIRST prompt (topic)
    }
    if (ev.kind === 'tool' && ev.tool_name) {
      s.lastTool = prettyTool(ev.tool_name); s.toolCount = (s.toolCount || 0) + 1;
      if (ev.file_path) s.lastFile = String(ev.file_path).split('/').pop().slice(0, 48);   // file being edited
    }
  }
  s.at = now;
  sessions.set(id, s);
  if (sessions.size > MAX_SESSIONS) {    // drop the oldest idle session
    let oldest = null;
    for (const [k, v] of sessions) if (!v.busy && (!oldest || v.at < oldest[1].at)) oldest = [k, v];
    if (oldest) sessions.delete(oldest[0]);
  }
  scheduleSave();
}

function snapshot() {
  const now = Date.now();
  const today = bkkDayOf(now);
  const list = [];
  for (const [id, s] of sessions) {
    if (bkkDayOf(s.startedAt) !== today) { sessions.delete(id); continue; }  // keep only today's → reset at midnight (Bangkok)
    const active = s.busy && (now - s.at < BUSY_TIMEOUT);
    // done = session ended, or finished its turn a while ago (no activity > 3 min)
    const done = s.ended || (!active && (now - s.at > 180_000));
    const state = s.waiting ? 'waiting' : active ? 'working' : done ? 'done' : 'idle';
    list.push({
      id, scope: s.scope, state, busy: active, waiting: !!s.waiting, waitTool: s.waitTool || '', ended: !!s.ended,
      lastTool: s.lastTool || '', lastFile: s.lastFile || '', title: s.title || '', chat: s.chat || '', toolCount: s.toolCount || 0,
      idleMs: now - s.at, startedAt: s.startedAt, sessTok: s.sessTok || 0,
    });
  }
  return list;
}

/* ---- persistence: survive backend restarts; reset at midnight (Bangkok) ---- */
const STATE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'monitor-state.json');
let _saveT = null;
function saveState() {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({
      day: bkkDay(), savedAt: Date.now(),
      sessions: [...sessions], doneHistory, doneSeen: [...doneSeen],
      cost: { day: cost.day, usd: cost.usd, tin: cost.tin, tout: cost.tout, turns: cost.turns },
    }));
  } catch {}
}
function scheduleSave() { clearTimeout(_saveT); _saveT = setTimeout(saveState, 1500); _saveT.unref?.(); }
function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    // done-task HISTORY persists across days (never wiped). Migrate old single-day format if present.
    if (s.doneHistory && typeof s.doneHistory === 'object') doneHistory = s.doneHistory;
    else if (Array.isArray(s.doneTasks)) for (const rec of s.doneTasks) { const day = bkkDayOf(rec.at || Date.now()); (doneHistory[day] ||= []).push(rec); }
    if (Array.isArray(s.doneSeen)) doneSeen = new Set(s.doneSeen);
    // live sessions + today's cost only carry over when still the SAME Bangkok day.
    if (s.day === bkkDay()) {
      if (Array.isArray(s.sessions)) for (const [id, v] of s.sessions) sessions.set(id, v);
      if (s.cost) { cost.day = s.cost.day; cost.usd = s.cost.usd; cost.tin = s.cost.tin; cost.tout = s.cost.tout; cost.turns = s.cost.turns; cost.seen = new Set(); }
    }
    const days = Object.keys(doneHistory).length;
    console.log(`  ↺ restored ${sessions.size} sessions · ${(doneHistory[bkkDay()] || []).length} done today · ${days} day(s) of history`);
  } catch {}
}
loadState();

export { record, snapshot, getUsage, getDoneTasks, getDoneDays };
