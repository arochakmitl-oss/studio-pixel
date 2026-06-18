#!/usr/bin/env node
// Cowork transcript watcher → Studio Pixel dashboard.
// The Claude app (cowork / local-agent mode) cannot run local hooks, but it DOES write
// an audit log (audit.jsonl) per session to disk. This watcher tails those logs in
// near-realtime and forwards compact events to the dashboard backend (/api/event),
// so each cowork session drives its character by scope (Figma create→Pixel,
// Figma review→Cora, docs→Milo) for as long as it's actually working.
//
//   node cowork-watch.mjs            # run alongside the backend
// Free · local · no app config · works with the Claude desktop/cowork app.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';

const BASE = process.env.COWORK_DIR ||
  path.join(os.homedir(), 'Library/Application Support/Claude/local-agent-mode-sessions');
const STUDIO = process.env.STUDIO_URL || 'http://localhost:8787';
const POLL_MS = 1500;
const offsets = new Map();   // file path -> bytes already read
const fileCwd = new Map();    // file path -> real session cwd (from the init line)
const fileScope = new Map();  // file path -> detected scope ('pixel'|'cora'|'milo') from tool history
const seenFiles = new Set();

// figure out what kind of work a tool represents
function scopeOfTool(tool){
  const t = String(tool||'').toLowerCase();
  if(/figma|use_figma|create_design|generate-design|perform-editing|edit-design/.test(t)) return 'pixel';   // create/edit Figma
  if(/get_screenshot|get_metadata|get_variable|get_code|get_design|list-comments|comment/.test(t)) return 'cora'; // review/read Figma
  if(/notion|google.?doc|gdoc|confluence|create_draft|present_files/.test(t)) return 'milo';                  // document tools (not bare code edits)
  return null;
}
// upgrade rule: a "create" signal (pixel) wins over a "review" signal (cora) for the same session
function mergeScope(prev, next){
  if(!next) return prev;
  if(!prev) return next;
  if(prev==='cora' && next==='pixel') return 'pixel';   // if it ever edits Figma, it's a create session
  return prev;
}
// peek a session's recent tool history to seed its scope (so short prompts still route correctly)
function peekScope(file){
  try {
    const st = fs.statSync(file); const want = 120000;
    const from = Math.max(0, st.size - want);
    const fd = fs.openSync(file,'r'); const buf = Buffer.alloc(st.size - from);
    fs.readSync(fd, buf, 0, buf.length, from); fs.closeSync(fd);
    let scope = null;
    for(const ln of buf.toString('utf8').split('\n')){
      if(!ln.includes('tool_name')) continue;
      try { const o = JSON.parse(ln); scope = mergeScope(scope, scopeOfTool(o.tool_name)); if(scope==='pixel') break; } catch {}
    }
    if(scope) fileScope.set(file, scope);
  } catch {}
}

// read the head of an audit file to grab the session's real cwd (init/system line carries it)
function peekCwd(file){
  try {
    const fd = fs.openSync(file,'r'); const buf = Buffer.alloc(16384);
    const n = fs.readSync(fd, buf, 0, 16384, 0); fs.closeSync(fd);
    for(const ln of buf.toString('utf8',0,n).split('\n')){
      if(!ln.trim()) continue;
      try { const o = JSON.parse(ln); if(o && o.cwd){ fileCwd.set(file, String(o.cwd)); return; } } catch {}
    }
  } catch {}
}

function post(payload){
  const body = JSON.stringify(payload);
  let u; try { u = new URL(STUDIO + '/api/event'); } catch { return; }
  const req = http.request(
    { hostname:u.hostname, port:u.port||80, path:u.pathname, method:'POST',
      headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}, timeout:1500 },
    r => r.resume());
  req.on('error', ()=>{}); req.on('timeout', ()=>req.destroy());
  req.write(body); req.end();
}

// find every audit.jsonl under BASE (bounded recursion)
function findAuditFiles(dir, depth, out){
  if(depth>6) return;
  let ents; try { ents = fs.readdirSync(dir,{withFileTypes:true}); } catch { return; }
  for(const e of ents){
    const p = path.join(dir, e.name);
    if(e.isDirectory()){ if(e.name==='node_modules') continue; findAuditFiles(p, depth+1, out); }
    else if(e.isFile() && e.name==='audit.jsonl'){ out.push(p); }
  }
}

// extract a human instruction string from a user message (skip tool_result echoes)
function userText(msg){
  if(!msg) return '';
  const c = msg.content;
  if(typeof c === 'string') return c;
  if(Array.isArray(c)){
    const t = c.find(b => b && b.type==='text' && typeof b.text==='string');
    if(t) return t.text;
  }
  return '';
}

const META_PROMPT = /^\s*<(scheduled-task|command-message|command-name|local-command|system-reminder)/i;
const MAX_AGE_MS = Number(process.env.COWORK_MAX_AGE_MS || 15*60*1000);   // ignore activity older than this (skip stale backfill of old sessions)
function handleLine(line, fallbackSid, cwd, file){
  let o; try { o = JSON.parse(line); } catch { return; }
  if(!o || typeof o!=='object') return;
  // only forward RECENT activity — old prompts from past sessions (read during backfill) are skipped
  const ts = o._audit_timestamp || o.timestamp;
  if(ts){ const age = Date.now() - new Date(ts).getTime(); if(!(age >= 0 && age <= MAX_AGE_MS)) return; }
  const sid = o.session_id || fallbackSid;
  // 0) permission flow → "needs allow" attention state (the key realtime signal)
  if(o.type === 'system' && (o.subtype === 'permission_request' || o.subtype === 'permission_response')){
    const sc = mergeScope(fileScope.get(file), scopeOfTool(o.tool_name));
    if(sc) fileScope.set(file, sc);
    post({ kind: o.subtype === 'permission_request' ? 'wait' : 'unwait', session_id:sid, cwd, scope:sc||undefined, tool_name:o.tool_name });
    return;
  }
  // 1) a tool was used → session is busy; refine & remember this session's scope
  if(typeof o.tool_name === 'string' && o.tool_name){
    const sc = mergeScope(fileScope.get(file), scopeOfTool(o.tool_name));
    if(sc) fileScope.set(file, sc);
    const ti = o.tool_input || {};
    post({ kind:'tool', session_id:sid, cwd, scope:sc||undefined, tool_name:o.tool_name, file_path:String(ti.file_path||ti.path||'').slice(0,200) });
    return;
  }
  // Claude usage / rate-limit telemetry → drives the "Claude Usage" monitor
  if(o.type === 'rate_limit_event' && o.rate_limit_info){
    const u=o.rate_limit_info;
    post({ kind:'usage', usage:{ status:u.status, resetsAt:u.resetsAt, rateLimitType:u.rateLimitType, isUsingOverage:u.isUsingOverage } });
    return;
  }
  // 2) the turn finished → idle + this turn's cost/tokens (attached to the task being archived)
  if(o.type === 'result'){
    const u=o.usage||{};
    post({ kind:'stop', session_id:sid, cwd,
      uuid:String(o.uuid||(sid+':'+(o._audit_timestamp||''))),
      cost: typeof o.total_cost_usd==='number'?o.total_cost_usd:undefined,
      tin:(u.input_tokens||0)+(u.cache_read_input_tokens||0)+(u.cache_creation_input_tokens||0),
      tout:(u.output_tokens||0) });
    return;
  }
  // 3) a fresh user instruction → busy; route by the session's known scope (history) even if the text is short
  if(o.type === 'user'){
    const txt = userText(o.message);
    if(txt && txt.trim() && !META_PROMPT.test(txt)){
      post({ kind:'prompt', session_id:sid, cwd, scope:fileScope.get(file)||undefined, prompt:txt.slice(0,300) });
    }
  }
}

function readNew(file){
  let st; try { st = fs.statSync(file); } catch { return; }
  const sid = path.basename(path.dirname(file)).replace(/^local_/,'');
  let start = offsets.get(file);
  if(start === undefined){
    // first sight: backfill a small recent tail so ongoing work appears immediately.
    // COWORK_REPLAY=<bytes> overrides (0 = pure live / EOF only).
    const back = process.env.COWORK_REPLAY!==undefined ? Number(process.env.COWORK_REPLAY) : 8000;
    start = back>0 ? Math.max(0, st.size - back) : st.size;
    offsets.set(file, start);
    if(back<=0) return;
  }
  if(st.size <= start){ offsets.set(file, st.size); return; }
  const fd = fs.openSync(file,'r');
  const len = st.size - start;
  const buf = Buffer.alloc(len);
  try { fs.readSync(fd, buf, 0, len, start); } finally { fs.closeSync(fd); }
  offsets.set(file, st.size);
  const text = buf.toString('utf8');
  // keep only complete lines; stash partial back by rewinding offset
  const lines = text.split('\n');
  if(!text.endsWith('\n')){ const partial = lines.pop(); offsets.set(file, st.size - Buffer.byteLength(partial)); }
  const cwd = fileCwd.get(file) || BASE;
  for(const ln of lines){ if(ln.trim()) handleLine(ln, sid, cwd, file); }
}

// reconstruct TODAY's completed cowork tasks from a session's log → POST as done (one-time per file)
const bkkDayStr = ts => { try{ return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok'}).format(new Date(ts)); }catch{ return ''; } };
function cleanTool(t){ return String(t||'').replace(/^mcp__[0-9a-f-]+__/i,'').replace(/^mcp__/,'').replace(/__/g,'·').replace(/[-_]/g,' '); }
function backfillDone(file){
  let st; try{ st=fs.statSync(file); }catch{ return; }
  const today=bkkDayStr(Date.now());
  if(bkkDayStr(st.mtimeMs)!==today) return;                 // only sessions touched today
  let txt; try{ const want=Math.min(st.size,3_000_000); const from=st.size-want; const fd=fs.openSync(file,'r');
    const buf=Buffer.alloc(want); fs.readSync(fd,buf,0,want,from); fs.closeSync(fd); txt=buf.toString('utf8'); }catch{ return; }
  const sid=path.basename(path.dirname(file)).replace(/^local_/,'');
  let scope=fileScope.get(file)||null, title='', chat='', lastTs=null, lastTool='';
  for(const ln of txt.split('\n')){
    if(!ln.trim()) continue;
    let o; try{ o=JSON.parse(ln); }catch{ continue; }
    const ts=o._audit_timestamp||o.timestamp; if(ts) lastTs=ts;
    if(o.type==='system' && (o.subtype==='permission_request'||o.subtype==='permission_response')){
      const sc=scopeOfTool(o.tool_name); if(sc) scope=mergeScope(scope,sc);
    } else if(typeof o.tool_name==='string' && o.tool_name){
      const sc=scopeOfTool(o.tool_name); if(sc) scope=mergeScope(scope,sc); lastTool=cleanTool(o.tool_name);
    } else if(o.type==='user'){
      const t=userText(o.message); if(t&&t.trim()&&!META_PROMPT.test(t)){ title=t.replace(/\s+/g,' ').trim().slice(0,140); if(!chat) chat=title.slice(0,80); }
    } else if(o.type==='result' && title && scope){
      const u=o.usage||{}; const atMs=lastTs?Date.parse(lastTs):st.mtimeMs;
      if(bkkDayStr(atMs)!==today) continue;
      post({ kind:'donearchive', uuid:String(o.uuid||(sid+':'+(lastTs||atMs))), scope, chat, task:title, lastTool,
        cost: typeof o.total_cost_usd==='number'?o.total_cost_usd:0,
        tokens:(u.input_tokens||0)+(u.cache_read_input_tokens||0)+(u.cache_creation_input_tokens||0)+(u.output_tokens||0),
        at: atMs });
    }
  }
}
function tick(){
  const files=[]; findAuditFiles(BASE, 0, files);
  for(const f of files){
    if(!seenFiles.has(f)){ seenFiles.add(f); peekCwd(f); peekScope(f); backfillDone(f);
      if(fileScope.get(f)) console.log('  watching', path.basename(path.dirname(f)), '· scope:', fileScope.get(f)); }
    readNew(f);
  }
}

console.log('\n  ✓ Cowork watcher → ' + STUDIO + '/api/event');
console.log('    base: ' + BASE.replace(os.homedir(),'~') + '   (polling every ' + POLL_MS + 'ms)\n');
tick();
setInterval(tick, POLL_MS);
