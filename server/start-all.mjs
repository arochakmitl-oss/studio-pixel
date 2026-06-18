#!/usr/bin/env node
// One command to run the whole Studio Pixel monitor:
//   - the backend (inbox + deliverables + live sessions API)
//   - the cowork watcher (reads the Claude app's audit logs → drives the characters)
// Usage:  npm start     (from the server/ folder)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
// keep the dashboard from monitoring the "develop office" (the sessions that BUILD this tool)
const exclude = process.env.STUDIO_EXCLUDE || 'studio-pixel,otteri-ai-office,Scheduled';

function run(file, name, extraEnv) {
  const p = spawn(process.execPath, [path.join(dir, file)], {
    stdio: 'inherit',
    env: { ...process.env, STUDIO_EXCLUDE: exclude, ...extraEnv },
  });
  p.on('exit', (code) => { console.log(`[${name}] exited (${code}) — restarting in 2s`); setTimeout(() => run(file, name, extraEnv), 2000); });
  return p;
}

function runPy(file, name) {
  const p = spawn('python3', [path.join(dir, file)], { stdio: 'inherit', env: { ...process.env } });
  p.on('error', () => console.log(`[${name}] python3 not available — skipping`));
  p.on('exit', (code) => { console.log(`[${name}] exited (${code}) — restarting in 5s`); setTimeout(() => runPy(file, name), 5000); });
  return p;
}

console.log('\n  🏢 Studio Pixel monitor starting…  (Ctrl+C to stop)\n');
run('ollama-server.js', 'backend');
setTimeout(() => run('cowork-watch.mjs', 'cowork-watch'), 1200);
setTimeout(() => runPy('usage-poll.py', 'usage-poll'), 1800);   // real Claude usage % from claude.ai
