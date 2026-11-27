// PURPOSE: Sum what a Claude Code session spent on a build: tokens per agent and per model from
//          the session transcript and its subagent transcripts, and the session meter's cost
//          and times from a usage-log snapshot. Each API response is counted once (a transcript
//          repeats a response's usage on every content block). Only counts and timestamps are
//          read; no transcript text is printed.
// USAGE:   node scripts/build-cost.mjs <session transcript .jsonl> [<usage log .json or .jsonl>]
//               [--until <ISO time>]
//          The subagent transcripts are looked for in "<transcript without .jsonl>/subagents".
//          --until leaves out anything later (conversation after the build was finished).
// OUTPUT:  a Markdown table per agent, totals per model, and the meter's figures.
// VERSION HISTORY:
//   1.0  2026-11-27  Initial release.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const untilAt = args.indexOf('--until');
// Count only what happened up to this moment (an ISO time), to leave out later conversation.
const until = untilAt >= 0 ? args.splice(untilAt, 2)[1] : null;
const [transcript, snapshot] = args;
if (!transcript) { console.error('usage: node scripts/build-cost.mjs <transcript.jsonl> [<usage-log .json or .jsonl>] [--until <ISO time>]'); process.exit(1); }

function scan(path) {
  const seen = new Map();
  let first = null;
  let last = null;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (until && e.timestamp && e.timestamp > until) continue;
    if (e.timestamp) { first ??= e.timestamp; last = e.timestamp; }
    const u = e.message?.usage;
    if (e.type !== 'assistant' || !u) continue;
    const key = e.message.id ?? e.uuid;
    const rec = { model: e.message.model ?? '?', input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, write: u.cache_creation_input_tokens ?? 0, read: u.cache_read_input_tokens ?? 0 };
    // Later lines for the same response carry its final output count.
    const prev = seen.get(key);
    if (!prev || rec.output >= prev.output) seen.set(key, rec);
  }
  const byModel = new Map();
  for (const r of seen.values()) {
    const t = byModel.get(r.model) ?? { responses: 0, input: 0, output: 0, write: 0, read: 0 };
    t.responses++;
    t.input += r.input;
    t.output += r.output;
    t.write += r.write;
    t.read += r.read;
    byModel.set(r.model, t);
  }
  return { byModel, first, last };
}

const n = (v) => v.toLocaleString('en-US');
const minutes = (a, b) => ((new Date(b) - new Date(a)) / 60000).toFixed(0);
const rows = [];
const totals = new Map();
const add = (name, s) => {
  for (const [model, t] of s.byModel) {
    rows.push(`| ${name} | \`${model}\` | ${n(t.responses)} | ${n(t.input)} | ${n(t.output)} | ${n(t.write)} | ${n(t.read)} | ${minutes(s.first, s.last)} min |`);
    const g = totals.get(model) ?? { responses: 0, input: 0, output: 0, write: 0, read: 0 };
    for (const k of Object.keys(g)) g[k] += t[k];
    totals.set(model, g);
  }
};
const main = scan(transcript);
add('Main session', main);
const subDir = join(transcript.replace(/\.jsonl$/, ''), 'subagents');
if (existsSync(subDir)) {
  for (const f of readdirSync(subDir).filter((x) => x.endsWith('.jsonl')).sort()) {
    let name = f;
    try { name = JSON.parse(readFileSync(join(subDir, f.replace('.jsonl', '.meta.json')), 'utf8')).description ?? f; } catch { /* no meta file */ }
    add(`Subagent: ${name}`, scan(join(subDir, f)));
  }
}
console.log('| Agent | Model | API responses | Input (uncached) | Output | Cache writes | Cache reads | Span |');
console.log('|---|---|---:|---:|---:|---:|---:|---:|');
for (const r of rows) console.log(r);
for (const [model, t] of totals) console.log(`| **All agents** | \`${model}\` | ${n(t.responses)} | ${n(t.input)} | ${n(t.output)} | ${n(t.write)} | ${n(t.read)} | |`);
console.log(`\ntranscript spans ${main.first} to ${main.last}`);
if (snapshot) {
  // A single snapshot, or a log of them (one JSON object per line): take the last one in time.
  const all = snapshot.endsWith('.jsonl')
    ? readFileSync(snapshot, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((x) => x && (!until || x.ts_utc <= until))
    : [JSON.parse(readFileSync(snapshot, 'utf8'))];
  const s = all[all.length - 1];
  const c = s.cost ?? {};
  console.log(`meter at ${s.ts_utc}: cost $${(c.total_cost_usd ?? 0).toFixed(2)}, wall ${(c.total_duration_ms / 60000).toFixed(0)} min, API ${(c.total_api_duration_ms / 60000).toFixed(0)} min, lines +${c.total_lines_added} -${c.total_lines_removed}, weekly ${s.rate_limits?.seven_day?.used_percentage}%`);
}
