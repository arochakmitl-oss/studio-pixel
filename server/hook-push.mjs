#!/usr/bin/env node
// Claude Code hook bridge → Studio Pixel dashboard.
// This runs for Claude Code sessions = the "develop office" → mapped to the BUTLER character
// (build office, edit code, this chat). Cowork design work is captured separately by cowork-watch.mjs.
// Forwards compact events to the backend (/api/event), all tagged scope:'butler':
//   UserPromptSubmit → {kind:'prompt'}   turn starts → butler busy
//   PostToolUse      → {kind:'tool'}      keeps butler busy
//   Stop             → {kind:'stop'}      turn ends → butler idle
//   SessionEnd       → {kind:'end'}       session gone → remove
// Skips work in the otteri-ai-office repo (kept separate). Always exits 0 within ~2s.

import http from 'node:http';
import fs from 'node:fs';

const BASE = process.env.STUDIO_URL || 'http://localhost:8787';
setTimeout(() => process.exit(0), 2200).unref?.();   // hard safety exit

const KIND = { UserPromptSubmit: 'prompt', PostToolUse: 'tool', PreToolUse: 'tool', Stop: 'stop', SessionEnd: 'end' };

// Claude Code (unlike cowork) doesn't pass tokens in the Stop event — so read the session transcript
// and count tokens: (a) the just-finished turn (for this Done card) and (b) the WHOLE session so far
// (cumulative since the chat was created → Otto's running total). Tokens only — no $/baht estimate.
function usageFromTranscript(tp) {
  try {
    const objs = [];
    for (const ln of fs.readFileSync(tp, 'utf8').split('\n')) { if (!ln) continue; try { objs.push(JSON.parse(ln)); } catch {} }
    const tk = u => (+u.input_tokens || 0) + (+u.cache_creation_input_tokens || 0) + (+u.cache_read_input_tokens || 0) + (+u.output_tokens || 0);
    const out = u => (+u.output_tokens || 0);
    // (b) full session — sum every assistant message's usage
    let sessTin = 0, sessTout = 0;
    for (const o of objs) { if (o.type === 'assistant') { const u = o.message && o.message.usage; if (u) { sessTin += tk(u) - out(u); sessTout += out(u); } } }
    // (a) last turn — walk back from the end to the human prompt that started it
    let tin = 0, tout = 0, uuid = '';
    for (let i = objs.length - 1; i >= 0; i--) {
      const o = objs[i];
      if (o.type === 'assistant') { const u = o.message && o.message.usage; if (u) { tin += tk(u) - out(u); tout += out(u); if (!uuid) uuid = o.uuid || ''; } }
      else if (o.type === 'user') {
        const c = o.message && o.message.content;
        if (!(Array.isArray(c) && c.some(x => x && x.type === 'tool_result'))) break;
      }
    }
    return { tin, tout, uuid, sessTin, sessTout };
  } catch { return null; }
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => { raw += c; if (raw.length > 2e6) process.stdin.destroy(); });
process.stdin.on('end', () => {
  let ev = {};
  try { ev = JSON.parse(raw || '{}'); } catch { /* ignore malformed */ }
  const cwd = String(ev.cwd || '');
  const ti = ev.tool_input || {};
  const fp = String(ti.file_path || ti.path || '');
  if (/otteri-ai-office/.test(cwd) || /otteri-ai-office/.test(fp)) return process.exit(0);  // keep otteri separate

  // Notification = Claude needs permission / is waiting for input → butler "waiting for allow"
  let payload;
  if (ev.hook_event_name === 'Notification') {
    const msg = String(ev.message || '');
    const label = /permission|approve|allow/i.test(msg) ? ('ขอ allow: ' + msg.replace(/^Claude needs your permission to use\s*/i, '').slice(0, 40))
                : /waiting|input|idle/i.test(msg) ? 'รอคำสั่งถัดไป'
                : (msg.slice(0, 50) || 'รอ allow');
    payload = { kind: 'wait', scope: 'butler', session_id: ev.session_id || '', cwd, waitLabel: label };
  } else {
    const kind = KIND[ev.hook_event_name];
    if (!kind) return process.exit(0);
    payload = { kind, scope: 'butler', session_id: ev.session_id || '', cwd };
    if (kind === 'prompt') payload.prompt = String(ev.prompt || '').slice(0, 300);
    if (kind === 'tool') { payload.tool_name = String(ev.tool_name || ''); payload.file_path = fp.slice(0, 200); }
    if (kind === 'stop' && ev.transcript_path) {   // attach this turn's burn + the running session total
      const u = usageFromTranscript(String(ev.transcript_path));
      if (u) { payload.tin = u.tin; payload.tout = u.tout; payload.uuid = u.uuid;
        payload.sessTin = u.sessTin; payload.sessTout = u.sessTout; }
    }
  }

  const body = JSON.stringify(payload);
  let u;
  try { u = new URL(BASE + '/api/event'); } catch { return process.exit(0); }
  const req = http.request(
    { hostname: u.hostname, port: u.port || 80, path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: 1500 },
    r => { r.resume(); r.on('end', () => process.exit(0)); }
  );
  req.on('error', () => process.exit(0));
  req.on('timeout', () => { req.destroy(); process.exit(0); });
  req.write(body); req.end();
});
