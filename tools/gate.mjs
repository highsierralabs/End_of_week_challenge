// PURPOSE: Closeout gate for End_of_week_challenge (adapted RHACO-SOP-20260708-001 v4 section 5
//          "Gate command"): one PASS/FAIL verdict over its member checks.
// USAGE:   node tools/gate.mjs [--range <rev-range>] [--allow-dirty] [--no-smoke]
// OUTPUT:  one ASCII line per member and a final tuple line, e.g.
//          gate: check=PASS build=PASS smoke=PASS site=PASS msgs=PASS public=PASS clean=PASS -> PASS
//          Exit 0 on PASS, 1 on FAIL.
// VERSION HISTORY:
//   1.0  2026-11-26  Initial release: check, build, commit-message audit, public-safety scan, clean tree.
//   1.1  2026-11-26  Smoke member: the production build in GPU Chromium on both backends.
//   1.2  2026-11-27  Check, build and smoke run for every challenge in challenges.json; site member
//                    assembles the Pages site with tools/build-site.mjs.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkMessage } from './check-commit-msg.mjs';
import { loadManifest } from './build-site.mjs';

const root = join(import.meta.dirname, '..');
const args = process.argv.slice(2);
const range = args.includes('--range') ? args[args.indexOf('--range') + 1] : 'HEAD';
const allowDirty = args.includes('--allow-dirty');
const results = {};

// A member covers every challenge: it passes only when each one passes.
function run(name, label, cmd, cmdArgs, cwd) {
  const r = spawnSync(cmd, cmdArgs, { cwd, encoding: 'utf8', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    results[name] = 'FAIL';
    console.log(`${name}: FAIL (${label})\n${(r.stdout + r.stderr).split('\n').slice(-25).join('\n')}`);
  } else {
    results[name] ??= 'PASS';
    console.log(`${name}: PASS (${label})`);
  }
}

const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' });

// 1-2: each challenge's own checks, production build and smoke test (its package.json scripts).
// The smoke tests need a GPU; --no-smoke skips them.
let challenges = [];
try { challenges = loadManifest().challenges; } catch (e) { results.check = 'FAIL'; console.log(`check: FAIL\n${e.message}`); }
const noSmoke = args.includes('--no-smoke');
if (noSmoke) { results.smoke = 'SKIP'; console.log('smoke: SKIP'); }
for (const c of challenges.filter((x) => x.npm)) {
  const dir = join(root, c.dir);
  const scripts = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).scripts ?? {};
  run('check', c.slug, 'npm', ['run', 'check'], dir);
  run('build', c.slug, 'npm', ['run', 'build'], dir);
  if (!noSmoke && scripts.smoke) run('smoke', c.slug, 'npm', ['run', 'smoke'], dir);
}
// 2b: the Pages site assembles from those builds and every link on the index resolves.
run('site', 'all', 'node', ['tools/build-site.mjs', '--skip-build'], root);

// 3: every commit message in range follows the grammar.
{
  let bad = 0;
  let log = '';
  try { log = git('log', '--format=%H%x00%B%x01', range); } catch { log = ''; }
  for (const rec of log.split('\x01')) {
    const [hash, msg] = rec.replace(/^\n/, '').split('\x00');
    if (!hash) continue;
    const f = checkMessage(msg ?? '');
    if (f.length) { bad++; console.log(`msgs: ${hash.slice(0, 8)} ${f.join('; ')}`); }
  }
  results.msgs = bad ? 'FAIL' : 'PASS';
  console.log(`msgs: ${results.msgs}`);
}

// 4: public-safety scan of tracked text files (the repository goes public).
{
  const PATTERNS = [
    [/[A-Za-z]:\\Users\\/, 'Windows user-home path'],
    [/\/Users\/[a-z]/, 'macOS user-home path'],
    [/\bkgran\b/i, 'local account name'],
    [/tailf[0-9a-f]{5}|\.ts\.net\b/, 'tailnet host'],
    [/desktop-[a-z0-9]{6,}/i, 'host name'],
    [/RC-110-\d{6}/, 'detector serial'],
    [/\b(?:[0-9A-F]{2}:){5}[0-9A-F]{2}\b/, 'MAC address'],
    [/gh[opsu]_[A-Za-z0-9]{20,}|sk-ant-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}/, 'credential'],
    [/JL11RE\d+/, 'sensor serial'],
  ];
  const files = git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0').filter(Boolean);
  let hits = 0;
  for (const f of files) {
    if (/\.(png|jpg|glb|bin|ico)$/i.test(f) || f.endsWith('package-lock.json') || f === 'tools/gate.mjs') continue;
    let text;
    try { text = readFileSync(join(root, f), 'utf8'); } catch { continue; }
    text.split('\n').forEach((line, i) => {
      for (const [re, what] of PATTERNS) {
        if (re.test(line)) { hits++; console.log(`public: ${f}:${i + 1} ${what}`); }
      }
    });
  }
  results.public = hits ? 'FAIL' : 'PASS';
  console.log(`public: ${results.public}`);
}

// 5: working tree clean.
{
  const st = git('status', '--porcelain');
  results.clean = st.trim() === '' ? 'PASS' : allowDirty ? 'SKIP' : 'FAIL';
  if (results.clean === 'FAIL') console.log(st);
  console.log(`clean: ${results.clean}`);
}

const verdict = Object.values(results).every((v) => v !== 'FAIL') ? 'PASS' : 'FAIL';
console.log(`gate: ${Object.entries(results).map(([k, v]) => `${k}=${v}`).join(' ')} -> ${verdict}`);
process.exit(verdict === 'PASS' ? 0 : 1);
