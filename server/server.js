// Studio Pixel — local Claude backend proxy
// Holds the API key server-side; the dashboard calls POST /api/agent.
// Each of the 3 agents is a role with its own cached system prompt + JSON schema.
//
//   npm install            (installs @anthropic-ai/sdk)
//   ANTHROPIC_API_KEY=sk-ant-... node server.js
//   (or put the key in a .env file next to this script)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { pushInbox, drainInbox, inboxCount, addDeliverable, listDeliverables } from './db.js';
import { record as recordSession, snapshot as snapshotSessions, getUsage, getDoneTasks } from './sessions.js';

/* ---- tiny .env loader (no dependency) ---- */
const __dir = path.dirname(fileURLToPath(import.meta.url));
try {
  const envPath = path.join(__dir, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch {}

const PORT = Number(process.env.PORT || 8787);
const MODEL = process.env.STUDIO_MODEL || 'claude-opus-4-8';
const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) {
  console.error('\n  ✗ ANTHROPIC_API_KEY is not set.');
  console.error('    Set it inline:   ANTHROPIC_API_KEY=sk-ant-... node server.js');
  console.error('    or create a .env file next to server.js with:');
  console.error('    ANTHROPIC_API_KEY=sk-ant-...\n');
  process.exit(1);
}
const client = new Anthropic({ apiKey: KEY });
// effort is supported on Opus 4.x and Sonnet 4.6 only (errors on Haiku / Sonnet 4.5)
const SUPPORTS_EFFORT = /^claude-opus-4/.test(MODEL) || MODEL === 'claude-sonnet-4-6';

/* ---- shared studio context (identical across roles → cacheable prefix) ---- */
const STUDIO_CONTEXT = `You are an AI teammate at "Studio Pixel", a small AI design studio.
Current project: Project Aurora — a mobile banking app redesign, Sprint 7.
The team is three AI agents working a Figma → review → Discord pipeline:
- Pixel (Senior UX/UI Designer) creates flows, wireframes, mockups and design-system work in Figma.
- Cora (Team Lead) reviews deliverables for accessibility, spacing, component reuse and consistency, then approves or requests revisions.
- Milo (Project Coordinator) reports status to the team on Discord (#aurora-updates).
Keep everything concise, concrete, and in the voice of a real product designer. No markdown headers, no preamble.
IMPORTANT: Write ALL field values in Thai (ภาษาไทย) — summaries, decisions, notes, feedback, and Discord messages must be in natural Thai. Keep product/technical terms (Figma, UI, UX, accessibility) as-is.`;

/* ---- per-role prompt + JSON schema ---- */
const ROLES = {
  designer: {
    system: `You are Pixel, the Senior UX/UI Designer. Given a design task, describe the deliverable you just produced in Figma as if reporting it for handoff. Be specific to mobile banking UX.`,
    user: (c) =>
      `Design task: "${c.task}".${c.revision ? ' This is a REVISION round addressing prior review feedback — note what you changed.' : ''} Summarize the finished deliverable.`,
    schema: {
      type: 'object',
      properties: {
        deliverable_summary: { type: 'string', description: 'One or two sentences on what was delivered.' },
        key_decisions: { type: 'array', items: { type: 'string' }, description: '2-4 concrete design decisions.' },
        figma_note: { type: 'string', description: 'Short note attached to the Figma file for the reviewer.' },
      },
      required: ['deliverable_summary', 'key_decisions', 'figma_note'],
      additionalProperties: false,
    },
  },
  lead: {
    system: `You are Cora, the Team Lead reviewing a design deliverable. Judge it on accessibility (contrast, touch targets), spacing scale, component reuse, and consistency with the design system. Approve when solid; request revisions when something concrete is off. Be a fair, specific reviewer — roughly 3 of 4 solid deliverables pass.`,
    user: (c) =>
      `Review the deliverable for task "${c.task}".${c.designer_notes ? ` Designer's notes: ${JSON.stringify(c.designer_notes)}` : ''} Decide approve or revise and give one concrete piece of feedback.`,
    schema: {
      type: 'object',
      properties: {
        decision: { type: 'string', enum: ['approve', 'revise'] },
        feedback: { type: 'string', description: 'One concrete, actionable sentence.' },
        severity: { type: 'string', enum: ['low', 'medium', 'high'] },
      },
      required: ['decision', 'feedback', 'severity'],
      additionalProperties: false,
    },
  },
  coordinator: {
    system: `You are Milo, the Project Coordinator. Write a short Discord status update for #aurora-updates about a review outcome. Friendly, scannable, one or two short lines. You may use one or two emoji.`,
    user: (c) =>
      `A deliverable for "${c.task}" was just ${c.kind === 'approved' ? 'APPROVED and merged into the design system' : 'sent back for REVISIONS'}. Post the Discord update.`,
    schema: {
      type: 'object',
      properties: {
        discord_message: { type: 'string', description: 'The message body to post in #aurora-updates.' },
      },
      required: ['discord_message'],
      additionalProperties: false,
    },
  },
};

async function runAgent(role, context) {
  const r = ROLES[role];
  if (!r) throw new Error('unknown role: ' + role);
  const output_config = { format: { type: 'json_schema', schema: r.schema } };
  if (SUPPORTS_EFFORT) output_config.effort = 'low'; // short, scoped task → keep it snappy
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    // stable shared prefix is cached; role block + task vary after it
    system: [
      { type: 'text', text: STUDIO_CONTEXT, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: r.system, cache_control: { type: 'ephemeral' } },
    ],
    output_config,
    messages: [{ role: 'user', content: r.user(context || {}) }],
  });
  const text = resp.content.find((b) => b.type === 'text')?.text || '{}';
  return { data: JSON.parse(text), usage: resp.usage, model: resp.model };
}

/* ---- HTTP server with CORS ---- */
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function json(res, code, obj) {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

// task inbox + deliverables — persisted in SQLite (db.js). Plus a human-readable .md export per deliverable.
const DELIV_DIR = path.join(__dir, 'deliverables');
fs.mkdirSync(DELIV_DIR, { recursive: true });
function slug(s){ return String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40); }
function saveDeliverable(d){
  const at = addDeliverable(d);   // ← persist to SQLite
  const md = `# ${d.id} · ${d.title}\n\n**Verdict:** ${d.verdict==='approve'?'✅ Approved':'🔁 Revisions requested'}  \n**Saved:** ${at}\n\n## Deliverable\n${d.summary||'—'}\n\n## Key decisions\n${(d.decisions||[]).map(x=>'- '+x).join('\n')||'- —'}\n\n## Figma note\n${d.figma_note||'—'}\n\n## Team Lead review\n${d.feedback||'—'}\n`;
  const file = path.join(DELIV_DIR, `${d.id}-${slug(d.title)}.md`);
  try { fs.writeFileSync(file, md); } catch(e){ console.error('save deliverable .md:', e.message); }
  return file;
}
// activity pulses — live "Pixel is working in Figma" signal from cowork (in-memory)
const PULSES = []; let PULSE_TOTAL = 0;
const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }
  if (req.url === '/api/inbox') {
    if (req.method === 'GET') { return json(res, 200, { tasks: drainInbox() }); }
    if (req.method === 'POST') {
      let b = ''; req.on('data', c => { b += c; if (b.length > 1e6) req.destroy(); });
      req.on('end', () => { try { const { title } = JSON.parse(b || '{}'); if (title && String(title).trim()) pushInbox(String(title).trim()); json(res, 200, { ok: true, queued: inboxCount() }); } catch (e) { json(res, 500, { error: String(e) }); } });
      return;
    }
  }
  // live cowork session events (Claude Code hooks POST here) + dashboard reads the snapshot
  if (req.url === '/api/sessions' && req.method === 'GET') { return json(res, 200, { sessions: snapshotSessions(), usage: getUsage(), doneTasks: getDoneTasks() }); }
  if (req.url === '/api/event' && req.method === 'POST') {
    let b = ''; req.on('data', c => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => { try { recordSession(JSON.parse(b || '{}')); json(res, 200, { ok: true }); } catch (e) { json(res, 500, { error: String(e) }); } });
    return;
  }
  if (req.url === '/api/pulse') {
    if (req.method === 'GET') { const out = PULSES.splice(0); return json(res, 200, { pulses: out, total: PULSE_TOTAL }); }
    if (req.method === 'POST') {
      let b = ''; req.on('data', c => { b += c; if (b.length > 1e6) req.destroy(); });
      req.on('end', () => { try { const { tool } = JSON.parse(b || '{}'); PULSES.push({ tool: String(tool||'tool'), at: Date.now() }); if (PULSES.length>100) PULSES.splice(0, PULSES.length-100); PULSE_TOTAL++; json(res, 200, { ok: true, total: PULSE_TOTAL }); } catch (e) { json(res, 500, { error: String(e) }); } });
      return;
    }
  }
  if (req.url === '/api/deliverables' && req.method === 'GET') { return json(res, 200, { items: listDeliverables() }); }
  if (req.url === '/api/deliverable' && req.method === 'POST') {
    let b = ''; req.on('data', c => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => { try { const file = saveDeliverable(JSON.parse(b || '{}')); json(res, 200, { ok: true, file }); } catch (e) { json(res, 500, { error: String(e) }); } });
    return;
  }
  if (req.method === 'GET' && req.url === '/api/health') {
    return json(res, 200, { ok: true, model: MODEL });
  }
  if (req.method === 'POST' && req.url === '/api/agent') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', async () => {
      try {
        const { role, context } = JSON.parse(body || '{}');
        const out = await runAgent(role, context);
        json(res, 200, out);
      } catch (e) {
        console.error('agent error:', e?.message || e);
        json(res, 500, { error: String(e?.message || e) });
      }
    });
    return;
  }
  json(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`\n  ✓ Studio Pixel backend running`);
  console.log(`    http://localhost:${PORT}   model: ${MODEL}`);
  console.log(`    In the dashboard, click "⚡ Live AI" to connect.\n`);
});
