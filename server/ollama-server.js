// Studio Pixel — monitor backend (no LLM / no Ollama).
// Pure local API for the dashboard: live cowork/Claude-Code sessions, Claude usage %,
// inbox (assign-by-chat), and the finished-work archive. Runs fully offline.
//   node ollama-server.js     (or: npm start  → also launches the watcher + usage poller)
// (Filename kept for compatibility with start-all.mjs / launch.json.)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { pushInbox, drainInbox, inboxCount, addDeliverable, listDeliverables } from './db.js';
import { record as recordSession, snapshot as snapshotSessions, getUsage, getDoneTasks, getDoneDays } from './sessions.js';

const PORT = Number(process.env.PORT || 8787);

// finished deliverables: stored in SQLite (db.js) + also exported as a human-readable .md
const DELIV_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'deliverables');
fs.mkdirSync(DELIV_DIR, { recursive: true });
function slug(s){ return String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40); }
function saveDeliverable(d){
  const at = addDeliverable(d);   // ← persist to SQLite
  const md = `# ${d.id} · ${d.title}\n\n**Verdict:** ${d.verdict==='approve'?'✅ Approved':'🔁 Revisions requested'}  \n**Saved:** ${at}\n\n## Deliverable\n${d.summary||'—'}\n\n## Key decisions\n${(d.decisions||[]).map(x=>'- '+x).join('\n')||'- —'}\n\n## Figma note\n${d.figma_note||'—'}\n\n## Team Lead review\n${d.feedback||'—'}\n`;
  const file = path.join(DELIV_DIR, `${d.id}-${slug(d.title)}.md`);
  try { fs.writeFileSync(file, md); } catch(e){ console.error('save deliverable .md:', e.message); }
  return file;
}

const cors = (res) => { res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); };
const json = (res, code, obj) => { cors(res); res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
function readBody(req){ return new Promise((resolve)=>{ let b=''; req.on('data',c=>{b+=c; if(b.length>1e6) req.destroy();}); req.on('end',()=>resolve(b)); }); }

// activity pulses — live signal that cowork/Figma MCP is actively working (in-memory, not persisted).
const pulses = []; let pulseTotal = 0;
function addPulse(tool){ pulses.push({ tool: String(tool||'tool'), at: Date.now() }); if(pulses.length>100) pulses.splice(0, pulses.length-100); pulseTotal++; }

// ---- skill files: each character's REAL .md docs (mapped in skills.json) ----
const SKILLS_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'skills.json');
function loadSkillMap() { try { const m = JSON.parse(fs.readFileSync(SKILLS_FILE, 'utf8')); delete m._note; return m; } catch { return {}; } }
function skillTitle(txt, file) { const m = txt.match(/^#\s+(.+)$/m); return m ? m[1].trim().slice(0, 80) : path.basename(file); }
function listSkills() {
  const map = loadSkillMap(); const out = {};
  for (const [agent, paths] of Object.entries(map)) {
    out[agent] = (paths || []).map(p => {
      try { const txt = fs.readFileSync(p, 'utf8');
        return { path: p, name: path.basename(p), title: skillTitle(txt, p), lines: txt.split('\n').length, chars: txt.length,
                 excerpt: txt.replace(/^---[\s\S]*?---/, '').replace(/[#>*`]/g, '').replace(/\n{2,}/g, '\n').trim().slice(0, 220) };
      } catch { return { path: p, name: path.basename(p), title: path.basename(p), missing: true }; }
    });
  }
  return out;
}
function allowedSkillPaths() { const m = loadSkillMap(); return new Set(Object.values(m).flat()); }

// ---- installed Claude plugins (Figma / Vercel / …) — scanned from the app's skill dirs ----
function readSkillMeta(dir) {
  try {
    const t = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
    let name = path.basename(dir), desc = '';
    const fm = t.match(/^---([\s\S]*?)---/);
    if (fm) { const nm = fm[1].match(/name:\s*"?([^"\n]+)"?/); const dm = fm[1].match(/description:\s*"?([\s\S]*?)"?\s*\n[a-z-]+:/i);
      if (nm) name = nm[1].trim(); if (dm) desc = dm[1].trim(); }
    return { name, desc: desc.replace(/\s+/g, ' ').slice(0, 160) };
  } catch { return null; }
}
function listSkillDirs(skillsDir) {
  try { return fs.readdirSync(skillsDir, { withFileTypes: true }).filter(e => e.isDirectory())
    .map(e => readSkillMeta(path.join(skillsDir, e.name))).filter(Boolean); } catch { return []; }
}
const LA_BASE = path.join(os.homedir(), 'Library/Application Support/Claude/local-agent-mode-sessions');
function findFigmaSkillsDir() {
  try { for (const acc of fs.readdirSync(LA_BASE)) { const ap = path.join(LA_BASE, acc);
    let st; try { st = fs.statSync(ap); } catch { continue; } if (!st.isDirectory()) continue;
    for (const sp of fs.readdirSync(ap)) { const rpm = path.join(ap, sp, 'rpm'); if (!fs.existsSync(rpm)) continue;
      for (const plug of fs.readdirSync(rpm)) { const sk = path.join(rpm, plug, 'skills');
        try { if (fs.existsSync(sk) && fs.readdirSync(sk).some(d => /^figma-/.test(d))) return sk; } catch {} } } } } catch {}
  return null;
}
function findVercelSkillsDir() {
  try { const cache = path.join(os.homedir(), '.claude/plugins/cache');
    for (const mk of fs.readdirSync(cache)) { const vd = path.join(cache, mk, 'vercel'); if (!fs.existsSync(vd)) continue;
      for (const ver of fs.readdirSync(vd)) { const sk = path.join(vd, ver, 'skills'); if (fs.existsSync(sk)) return sk; } } } catch {}
  return null;
}
let _plugCache = null, _plugAt = 0;
function getPlugins() {
  if (_plugCache && Date.now() - _plugAt < 300000) return _plugCache;
  const out = [];
  const fig = findFigmaSkillsDir(); if (fig) { const s = listSkillDirs(fig); if (s.length) out.push({ plugin: 'Figma', agent: 'ux', skills: s }); }
  const ver = findVercelSkillsDir(); if (ver) { const s = listSkillDirs(ver); if (s.length) out.push({ plugin: 'Vercel', agent: 'butler', skills: s }); }
  _plugCache = out; _plugAt = Date.now(); return out;
}

// Heartbeat for NORMAL Claude desktop chat (not Cowork): we can't read its (encrypted) content,
// but the app rewrites its Local/Session Storage on every interaction → fresh mtime = "chatting now".
const CLAUDE_STORE = [
  path.join(os.homedir(), 'Library/Application Support/Claude/Local Storage/leveldb'),
  path.join(os.homedir(), 'Library/Application Support/Claude/Session Storage'),
];
function claudeAppActivity() {
  let newest = 0;
  for (const d of CLAUDE_STORE) { try { for (const f of fs.readdirSync(d)) {
    try { const m = fs.statSync(path.join(d, f)).mtimeMs; if (m > newest) newest = m; } catch {} } } catch {} }
  return { appActiveAt: newest, appActive: newest > 0 && (Date.now() - newest) < 45000 };
}
// Figma desktop activity — fresh storage mtime = "designing in Figma right now" → wakes Pixel
function figmaActivity() {
  const dp = path.join(os.homedir(), 'Library/Application Support/Figma/DesktopProfile');
  let newest = 0;
  try { for (const v of fs.readdirSync(dp)) {
    const vd = path.join(dp, v);
    for (const t of ['Cookies', 'Network Persistent State', 'DIPS-wal', 'Local Storage/leveldb', 'Session Storage']) {
      const p = path.join(vd, t);
      try { const st = fs.statSync(p);
        if (st.isDirectory()) { for (const f of fs.readdirSync(p)) { try { const m = fs.statSync(path.join(p, f)).mtimeMs; if (m > newest) newest = m; } catch {} } }
        else if (st.mtimeMs > newest) newest = st.mtimeMs;
      } catch {}
    }
  } } catch {}
  return { figmaActiveAt: newest, figmaActive: newest > 0 && (Date.now() - newest) < 45000 };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }
  if (req.method === 'GET' && req.url === '/api/health') { return json(res, 200, { ok: true, monitor: true }); }
  if (req.method === 'GET' && req.url === '/api/skills') { return json(res, 200, { skills: listSkills() }); }
  if (req.method === 'GET' && req.url === '/api/plugins') { return json(res, 200, { plugins: getPlugins() }); }
  if (req.method === 'GET' && req.url.startsWith('/api/skill?')) {
    const p = decodeURIComponent(new URL(req.url, 'http://x').searchParams.get('path') || '');
    if (!allowedSkillPaths().has(p)) return json(res, 403, { error: 'not allowed' });   // whitelist only
    try { return json(res, 200, { path: p, name: path.basename(p), content: fs.readFileSync(p, 'utf8') }); }
    catch (e) { return json(res, 404, { error: 'cannot read' }); }
  }
  if (req.url === '/api/inbox') {
    if (req.method === 'GET') { return json(res, 200, { tasks: drainInbox() }); } // drain from DB
    if (req.method === 'POST') {
      try { const b = await readBody(req); const { title } = JSON.parse(b || '{}');
        if (title && String(title).trim()) { pushInbox(String(title).trim()); }
        return json(res, 200, { ok: true, queued: inboxCount() });
      } catch (e) { return json(res, 500, { error: String(e) }); }
    }
  }
  // live cowork session events (Claude Code hooks + cowork-watch POST here) + dashboard reads the snapshot
  if (req.url === '/api/sessions' && req.method === 'GET') { return json(res, 200, { sessions: snapshotSessions(), usage: { ...getUsage(), ...claudeAppActivity(), ...figmaActivity() }, doneTasks: getDoneTasks() }); }
  // done-task history for a specific Bangkok day (?day=YYYY-MM-DD; omit = today) + list of days that have records
  if (req.url.startsWith('/api/done') && req.method === 'GET') {
    const day = new URL(req.url, 'http://x').searchParams.get('day') || '';
    return json(res, 200, { day, tasks: getDoneTasks(day || undefined), days: getDoneDays() });
  }
  if (req.url === '/api/event' && req.method === 'POST') {
    try { const b = await readBody(req); recordSession(JSON.parse(b || '{}')); return json(res, 200, { ok: true }); }
    catch (e) { return json(res, 500, { error: String(e) }); }
  }
  if (req.url === '/api/pulse') {
    if (req.method === 'GET') { const out = pulses.splice(0); return json(res, 200, { pulses: out, total: pulseTotal }); } // drain
    if (req.method === 'POST') {
      try { const b = await readBody(req); const { tool } = JSON.parse(b || '{}'); addPulse(tool); return json(res, 200, { ok: true, total: pulseTotal }); }
      catch (e) { return json(res, 500, { error: String(e) }); }
    }
  }
  if (req.url === '/api/deliverables' && req.method === 'GET') { return json(res, 200, { items: listDeliverables() }); }
  if (req.url === '/api/deliverable' && req.method === 'POST') {
    try { const b = await readBody(req); const d = JSON.parse(b || '{}'); const file = saveDeliverable(d);
      return json(res, 200, { ok: true, file });
    } catch (e) { return json(res, 500, { error: String(e) }); }
  }
  json(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`\n  ✓ Studio Pixel monitor backend on http://localhost:${PORT}  (no LLM — pure local monitor)\n`);
});
