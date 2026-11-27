// PURPOSE: Assemble the GitHub Pages site for End_of_week_challenge: one folder per challenge
//          listed in challenges.json, plus the index page generated from the same manifest.
// USAGE:   node tools/build-site.mjs [--install] [--check] [--skip-build]
//            --install     run "npm ci" in each npm challenge first (CI)
//            --check       run "npm run check" in each npm challenge before building
//            --skip-build  assemble from the outputs already on disk (the gate builds them itself)
// OUTPUT:  _site/ (gitignored): index.html, assets/, <slug>/ per challenge, licence files.
//          One ASCII line per step and "site: PASS" or "site: FAIL"; exit 0 / 1.
// VERSION HISTORY:
//   1.0  2026-11-27  Initial release.
//   1.1  2026-11-27  Optional animated clip per entry (manifest "clip"); the still image stays as the
//                    picture for visitors who ask for reduced motion.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = join(import.meta.dirname, '..');
const RESERVED = new Set(['assets', 'index.html', 'license', 'third-party-notices.md']);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
  'November', 'December'];

// Read and validate challenges.json. Returns { repo, challenges } or throws with every finding.
export function loadManifest() {
  const manifest = JSON.parse(readFileSync(join(root, 'challenges.json'), 'utf8'));
  const findings = [];
  const seen = new Set();
  const list = Array.isArray(manifest.challenges) ? manifest.challenges : [];
  if (!list.length) findings.push('challenges.json lists no challenges');
  for (const c of list) {
    const id = c.slug ?? c.dir ?? '(unnamed)';
    if (!/^[a-z0-9][a-z0-9-]*$/.test(c.slug ?? '')) findings.push(`${id}: slug must be lowercase letters, digits and hyphens`);
    if (RESERVED.has(c.slug) || existsSync(join(root, 'site', c.slug ?? ''))) findings.push(`${id}: slug collides with a root page`);
    if (seen.has(c.slug)) findings.push(`${id}: duplicate slug`);
    seen.add(c.slug);
    if (!c.dir || !existsSync(join(root, c.dir))) findings.push(`${id}: dir "${c.dir}" does not exist`);
    for (const k of ['title', 'tagline', 'summary']) if (!c[k]) findings.push(`${id}: missing ${k}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.date ?? '')) findings.push(`${id}: date must be YYYY-MM-DD`);
    if (c.image && !existsSync(join(root, c.image))) findings.push(`${id}: image "${c.image}" does not exist`);
    if (c.image && !c.imageAlt) findings.push(`${id}: image needs imageAlt`);
    if (c.clip && !existsSync(join(root, c.clip))) findings.push(`${id}: clip "${c.clip}" does not exist`);
    if (c.clip && extname(c.clip).toLowerCase() !== '.gif') findings.push(`${id}: clip must be a .gif`);
    if (c.clip && !c.image) findings.push(`${id}: clip needs a still image for reduced motion`);
  }
  if (findings.length) throw new Error(findings.join('\n'));
  return {
    repo: manifest.repo ?? 'https://github.com/highsierralabs/End_of_week_challenge',
    challenges: list.map((c) => ({ ...c, npm: existsSync(join(root, c.dir, 'package.json')), out: c.out ?? 'dist' })),
  };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function longDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function entryHtml(c, number, repo) {
  const href = `${c.slug}/`;
  const still = c.image && `assets/${c.slug}${extname(c.image)}`;
  // With a clip, the GIF plays and the still is what reduced-motion visitors get instead.
  const picture = c.clip
    ? `<picture><source media="(prefers-reduced-motion: reduce)" srcset="${still}" /><img src="assets/${c.slug}-clip.gif" alt="${esc(c.clipAlt ?? c.imageAlt)}" loading="lazy" /></picture>`
    : `<img src="${still}" alt="${esc(c.imageAlt)}" loading="lazy" />`;
  const shot = c.image
    ? `          <a class="shot" href="${href}" tabindex="-1" aria-hidden="true">${picture}</a>\n`
    : '';
  const tech = (c.tech ?? []).map((t) => `<li>${esc(t)}</li>`).join('');
  return `        <article class="entry">
${shot}          <div>
            <p class="meta"><span class="no">No. ${String(number).padStart(2, '0')}</span><time datetime="${c.date}">${longDate(c.date)}</time></p>
            <h2><a href="${href}">${esc(c.title)}</a></h2>
            <p class="tagline">${esc(c.tagline)}</p>
            <p class="summary">${esc(c.summary)}</p>
${tech ? `            <ul class="tech">${tech}</ul>\n` : ''}            <p class="links"><a class="open" href="${href}">Open ${esc(c.title)}</a><a href="${repo}/tree/main/${encodeURI(c.dir)}">Source and notes</a></p>
          </div>
        </article>`;
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
}

function main() {
  const args = process.argv.slice(2);
  const site = join(root, '_site');
  let failed = false;
  const fail = (msg) => { console.log(`FAIL ${msg}`); failed = true; };
  const step = (cwd, script) => {
    const r = spawnSync('npm', script, { cwd, encoding: 'utf8', shell: process.platform === 'win32' });
    if (r.status !== 0) console.log((r.stdout + r.stderr).split('\n').slice(-25).join('\n'));
    return r.status === 0;
  };

  let manifest;
  try { manifest = loadManifest(); } catch (e) { console.log(e.message); console.log('site: FAIL'); process.exit(1); }
  const { repo, challenges } = manifest;

  rmSync(site, { recursive: true, force: true });
  mkdirSync(join(site, 'assets'), { recursive: true });

  for (const c of challenges) {
    const dir = join(root, c.dir);
    if (c.npm && !args.includes('--skip-build')) {
      if (args.includes('--install') && !step(dir, ['ci'])) { fail(`${c.slug}: npm ci`); continue; }
      if (args.includes('--check') && !step(dir, ['run', 'check'])) { fail(`${c.slug}: npm run check`); continue; }
      if (!step(dir, ['run', 'build'])) { fail(`${c.slug}: npm run build`); continue; }
    }
    const out = join(dir, c.out);
    if (!existsSync(join(out, 'index.html'))) { fail(`${c.slug}: ${c.dir}/${c.out}/index.html is missing`); continue; }
    cpSync(out, join(site, c.slug), { recursive: true });
    if (c.image) cpSync(join(root, c.image), join(site, 'assets', `${c.slug}${extname(c.image)}`));
    if (c.clip) cpSync(join(root, c.clip), join(site, 'assets', `${c.slug}-clip.gif`));

    // A challenge is served from /<repo>/<slug>/, so a root-absolute URL in its pages would miss.
    const pages = walk(join(site, c.slug)).filter((f) => f.endsWith('.html'));
    for (const page of pages) {
      const abs = readFileSync(page, 'utf8').match(/\b(?:src|href)="\/(?!\/)[^"]*"/g);
      if (abs) fail(`${c.slug}: root-absolute URL ${abs[0]} in ${page.slice(site.length + 1).replace(/\\/g, '/')}`);
    }
    const bytes = walk(join(site, c.slug)).reduce((n, f) => n + statSync(f).size, 0);
    console.log(`ok   ${c.slug}: ${pages.length} page(s), ${(bytes / 1048576).toFixed(1)} MB from ${c.dir}/${c.out}`);
  }

  // Root pages: everything in site/ verbatim, index.html filled in from the manifest (newest first).
  cpSync(join(root, 'site'), site, { recursive: true });
  for (const f of ['LICENSE', 'THIRD-PARTY-NOTICES.md']) cpSync(join(root, f), join(site, f));
  const numbered = [...challenges].sort((a, b) => a.date.localeCompare(b.date)).map((c, i) => ({ c, n: i + 1 }));
  const entries = numbered.reverse().map(({ c, n }) => entryHtml(c, n, repo)).join('\n');
  const index = readFileSync(join(root, 'site', 'index.html'), 'utf8')
    .replace('<!-- CHALLENGES -->', entries)
    .replace('<!-- COUNT -->', `${challenges.length} so far`)
    .replace('<!-- REPO -->', repo);
  if (/<!-- [A-Z]+ -->/.test(index)) fail('index.html still has an unfilled placeholder');
  writeFileSync(join(site, 'index.html'), index);

  // Every relative link on the root pages must land on a file in _site.
  for (const name of readdirSync(site).filter((f) => f.endsWith('.html'))) {
    const html = readFileSync(join(site, name), 'utf8');
    for (const m of html.matchAll(/\b(?:src|srcset|href|url)=["']?([^"'\s>]+)/g)) {
      const url = m[1];
      if (/^(?:[a-z]+:|#)/i.test(url)) continue;
      const target = join(site, decodeURI(url.split(/[?#]/)[0]));
      const hit = existsSync(target) && (statSync(target).isFile() || existsSync(join(target, 'index.html')));
      if (!hit) fail(`${name}: link "${url}" does not resolve`);
    }
  }
  if (!failed) console.log(`ok   index: ${challenges.length} challenge(s)`);

  console.log(`site: ${failed ? 'FAIL' : 'PASS'}`);
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
