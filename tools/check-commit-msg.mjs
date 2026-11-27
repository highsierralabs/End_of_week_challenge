// PURPOSE: Validate a commit message against the repository grammar
//          (adapted RHACO-SOP-20260708-001 v4 Rule 3).
// USAGE:   node tools/check-commit-msg.mjs <message-file>
//          node tools/check-commit-msg.mjs --range <rev-range>   (audit existing commits)
// OUTPUT:  exit 0 when valid; exit 1 with one ASCII line per finding.
// VERSION HISTORY:
//   1.0  2026-11-26  Initial release.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const SUBJECT = /^EOWC-(CHG|DOC|REL|FIX)-\d{8}-\d{3}: \S.*$/;

export function checkMessage(msg) {
  const findings = [];
  // Git strips comment lines before the hook only with --cleanup; be tolerant.
  const body = msg.split('\n').filter((l) => !l.startsWith('#')).join('\n').replace(/\n+$/, '');
  const first = body.split('\n')[0] ?? '';
  if (/^Merge /.test(first)) return findings;
  for (let i = 0; i < body.length; i++) {
    const c = body.charCodeAt(i);
    if (c !== 0x0a && (c < 0x20 || c > 0x7e)) {
      findings.push(`non-ASCII or control byte 0x${c.toString(16)} at offset ${i}`);
      break;
    }
  }
  if (first.length > 72) findings.push(`subject is ${first.length} chars (max 72)`);
  if (!SUBJECT.test(first)) findings.push('subject must match "EOWC-<CHG|DOC|REL|FIX>-<YYYYMMDD>-<SEQ>: <summary>"');
  const lines = body.split('\n');
  if (lines.length > 1 && lines[1] !== '') findings.push('line 2 must be blank');
  return findings;
}

const args = process.argv.slice(2);
if (args[0] === '--range') {
  const log = execFileSync('git', ['log', '--format=%H%x00%B%x01', args[1] ?? 'HEAD'], { encoding: 'utf8' });
  let bad = 0;
  for (const rec of log.split('\x01')) {
    const [hash, msg] = rec.replace(/^\n/, '').split('\x00');
    if (!hash) continue;
    const f = checkMessage(msg ?? '');
    if (f.length) { bad++; console.log(`${hash.slice(0, 8)}: ${f.join('; ')}`); }
  }
  process.exit(bad ? 1 : 0);
} else if (args[0]) {
  const f = checkMessage(readFileSync(args[0], 'utf8'));
  if (f.length) {
    for (const x of f) console.log(`commit-msg: ${x}`);
    process.exit(1);
  }
}
