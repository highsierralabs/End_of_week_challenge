// Drumhead validation page: the solver's checks, re-run in the visitor's browser.

import './validation.css';
import { DRISCOLL_GWW } from '../solver/reference';
import { type VMsg } from './worker';

const RED = '#bd3b26';
const BLUE = '#2f5fa8';

const root = document.getElementById('v')!;
root.innerHTML = `
  <header>
    <p class="v-back"><a href="./">&larr; Back to Drumhead</a></p>
    <h1>How far to trust Drumhead</h1>
    <p class="v-lede">Every number on this page is computed in your browser, now, by the same solver the drums use:
    linear finite elements, a banded Cholesky factorisation and shift-invert Lanczos. Each is compared with an exact
    value or with a published high-precision one. <span class="v-status">Computing&hellip;</span></p>
  </header>

  <section id="v-gww">
    <h2>1. The isospectral twins against Driscoll (1997)</h2>
    <p>Tobin Driscoll computed the first 25 eigenvalues of the Gordon-Webb-Wolpert drums to 12 digits with a domain
    decomposition method (<em>SIAM Review</em> 39, Table 3.1). The drums here are built from seven right triangles
    with legs of length 2, as in his Figure 1.1, and every triangle is refined the same number of times.</p>
    <figure class="v-chart" aria-label="Convergence of two eigenvalues as the mesh is refined"></figure>
    <p class="v-note">Mode 9 is the bare triangle's own first mode, exactly 5&pi;&sup2;/4. It has no corner
    singularity and converges at the full <i>h</i>&sup2; rate of linear elements. Mode 1 feels the drum's re-entrant
    (270&deg;) corners, where the exact solution is not smooth, and theory expects it to settle no faster than about
    <i>h</i><sup>4/3</sup>. On coarse meshes its error is not even monotone: the lumped mass pulls eigenvalues down while
    the stiffness pushes them up, and the two partly cancel. Drumhead's drums use the equivalent of four to five
    refinements.</p>
    <div class="v-scroll"><table class="v-gww-table"><thead></thead><tbody></tbody></table></div>
  </section>

  <section id="v-iso">
    <h2>2. The twins agree with each other</h2>
    <p>Because both twins are made of identical triangle meshes, the transplantation proof carries over to the
    discrete equations. Their computed spectra should then be equal to rounding error at every refinement, whether
    or not they have converged to the true values yet.</p>
    <div class="v-scroll"><table class="v-iso-table"><thead><tr><th>Refinement</th><th>Vertices per drum</th><th>Largest relative difference, 25 eigenvalues</th><th>Time (both)</th></tr></thead><tbody></tbody></table></div>
  </section>

  <section id="v-exact">
    <h2>3. Shapes with exact answers</h2>
    <p>The unit square's eigenvalues are &pi;&sup2;(<i>m</i>&sup2; + <i>n</i>&sup2;), and the unit disc's are the
    squares of the zeros of Bessel functions. The disc is meshed the way freehand drums are: an equilateral lattice
    whose rim points are snapped onto the outline.</p>
    <div class="v-two">
      <div><h3>Unit square <span class="v-sq-n"></span></h3><table class="v-sq"><thead><tr><th>Mode</th><th>Exact</th><th>Drumhead</th><th>Error</th></tr></thead><tbody></tbody></table></div>
      <div><h3>Unit disc <span class="v-disc-n"></span></h3><table class="v-disc"><thead><tr><th>Mode</th><th>Exact</th><th>Drumhead</th><th>Error</th></tr></thead><tbody></tbody></table></div>
    </div>
  </section>

  <section id="v-weyl">
    <h2>4. Hearing the area and the perimeter</h2>
    <p>The card beside each drum fits Weyl's law, <i>N</i>(&lambda;) &asymp; <i>A</i>&lambda;/4&pi;
    &minus; <i>P</i>&radic;&lambda;/4&pi; + 1/6, to the first 48 eigenvalues and reports the area <i>A</i> and the
    perimeter <i>P</i> it hears. Here is how close that gets for every preset, at the size the app uses. The 1/6 is
    exact only for smooth outlines, and the higher modes of a mesh this coarse run slightly sharp, so a few per cent
    is the honest expectation.</p>
    <div class="v-scroll"><table class="v-weyl"><thead><tr><th>Drum</th><th>Area</th><th>Heard</th><th>Error</th><th>Perimeter</th><th>Heard</th><th>Error</th></tr></thead><tbody></tbody></table></div>
  </section>

  <footer><p>Source, tests and notes: <a href="https://github.com/highsierralabs/End_of_week_challenge/tree/main/Drumhead" target="_blank" rel="noopener">End_of_week_challenge/Drumhead</a>.
  The unit tests assert the same checks on every build.</p></footer>
`;

const $ = <T extends Element>(s: string) => root.querySelector<T>(s)!;
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
const pct = (e: number) => (e < 1e-4 ? `${(e * 100).toExponential(1)}%` : `${(e * 100).toFixed(e < 0.001 ? 4 : e < 0.01 ? 3 : 2)}%`);
const sci = (e: number) => (e === 0 ? '0' : `${e.toExponential(1).replace('e-', ' &times; 10<sup>&minus;')}</sup>`);

const gww: Extract<VMsg, { type: 'gww' }>[] = [];

function exactRows(sel: string, rows: { label: string; exact: number; got: number }[]): void {
  $(sel + ' tbody').innerHTML = rows.map((r) => `<tr><td>${r.label}</td><td>${r.exact.toFixed(4)}</td><td>${r.got.toFixed(4)}</td><td>${pct(rel(r.got, r.exact))}</td></tr>`).join('');
}

function gwwTable(): void {
  const levels = gww.map((g) => g.level);
  $('.v-gww-table thead').innerHTML = `<tr><th>Mode</th><th>Driscoll (1997)</th>${levels.map((l) => `<th>Refined ${l}&times;</th>`).join('')}<th>Error, finest</th></tr>`;
  $('.v-gww-table tbody').innerHTML = DRISCOLL_GWW.map((d, i) => {
    const cells = gww.map((g) => `<td>${g.left[i]!.toFixed(5)}</td>`).join('');
    const fin = gww[gww.length - 1]!;
    return `<tr${i === 0 || i === 8 ? ' class="v-hl"' : ''}><td>${i + 1}</td><td>${d.toFixed(5)}</td>${cells}<td>${pct(rel(fin.left[i]!, d))}</td></tr>`;
  }).join('');
  $('.v-iso-table tbody').innerHTML = gww.map((g) => {
    let w = 0;
    for (let i = 0; i < 25; i++) w = Math.max(w, rel(g.left[i]!, g.right[i]!));
    return `<tr><td>${g.level}&times;</td><td>${g.nv.toLocaleString('en-US')}</td><td>${sci(w)}</td><td>${(g.ms / 1000).toFixed(2)} s</td></tr>`;
  }).join('');
  chart();
}

/** Log-log convergence chart: relative error of modes 1 and 9 against mesh size, with reference slopes. */
function chart(): void {
  const fig = $<HTMLElement>('.v-chart');
  if (gww.length < 2) return;
  const W = 640, H = 330, L = 64, R = 120, T = 18, B = 46;
  const s1 = gww.map((g) => ({ h: g.h, e: rel(g.left[0]!, DRISCOLL_GWW[0]!), g }));
  const s9 = gww.map((g) => ({ h: g.h, e: rel(g.left[8]!, DRISCOLL_GWW[8]!), g }));
  const all = [...s1, ...s9];
  const hx0 = Math.log10(Math.min(...all.map((p) => p.h))) - 0.1, hx1 = Math.log10(Math.max(...all.map((p) => p.h))) + 0.1;
  const ey0 = Math.floor(Math.log10(Math.min(...all.map((p) => p.e)))), ey1 = Math.ceil(Math.log10(Math.max(...all.map((p) => p.e))));
  const x = (h: number) => L + ((Math.log10(h) - hx0) / (hx1 - hx0)) * (W - L - R);
  const y = (e: number) => T + ((ey1 - Math.log10(e)) / (ey1 - ey0)) * (H - T - B);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Relative error against mesh size, log-log">`;
  for (let k = ey0; k <= ey1; k++) {
    svg += `<line x1="${L}" x2="${W - R}" y1="${y(10 ** k)}" y2="${y(10 ** k)}" class="v-grid"/><text x="${L - 8}" y="${y(10 ** k) + 4}" class="v-tick" text-anchor="end">10<tspan dy="-5" font-size="9">${k}</tspan></text>`;
  }
  for (const g of gww) svg += `<text x="${x(g.h)}" y="${H - B + 18}" class="v-tick" text-anchor="middle">${g.h < 0.1 ? g.h.toFixed(3) : g.h.toFixed(2)}</text>`;
  svg += `<text x="${(L + W - R) / 2}" y="${H - 8}" class="v-axis" text-anchor="middle">Mesh size h (triangle leg)</text>`;
  svg += `<text x="14" y="${(T + H - B) / 2}" class="v-axis" text-anchor="middle" transform="rotate(-90 14 ${(T + H - B) / 2})">Relative error</text>`;
  // Reference slopes over the three finest meshes, anchored at the finest point.
  const ref = (pts: typeof s1, p: number, label: string) => {
    const f = pts[pts.length - 1]!, c = pts[Math.max(0, pts.length - 3)]!;
    const e0 = f.e * (c.h / f.h) ** p;
    return `<line x1="${x(f.h)}" y1="${y(f.e)}" x2="${x(c.h)}" y2="${y(e0)}" class="v-ref"/><text x="${x(c.h) + 4}" y="${y(e0) + (p === 2 ? -6 : 18)}" class="v-reflabel">${label}</text>`;
  };
  svg += ref(s1, 4 / 3, 'h<tspan dy="-5" font-size="9">4/3</tspan>');
  svg += ref(s9, 2, 'h<tspan dy="-5" font-size="9">2</tspan>');
  for (const [pts, col, name] of [[s1, RED, 'Mode 1'], [s9, BLUE, 'Mode 9']] as const) {
    svg += `<polyline points="${pts.map((p) => `${x(p.h)},${y(p.e)}`).join(' ')}" fill="none" stroke="${col}" stroke-width="2"/>`;
    for (const p of pts) {
      svg += `<g class="v-pt"><circle cx="${x(p.h)}" cy="${y(p.e)}" r="12" fill="transparent"/><circle cx="${x(p.h)}" cy="${y(p.e)}" r="4.5" fill="${col}" stroke="#efe8d8" stroke-width="2"/><title>${name}, refined ${p.g.level}x (h = ${p.h}): error ${pct(p.e)}, ${p.g.nv} vertices</title></g>`;
    }
    const first = pts[0]!;
    svg += `<text x="${x(first.h) + 12}" y="${y(first.e) + 4}" class="v-dlabel">${name}</text>`;
  }
  svg += '</svg>';
  const rate = (pts: typeof s1) => {
    const a = pts[pts.length - 2]!, b = pts[pts.length - 1]!;
    return Math.log(a.e / b.e) / Math.log(a.h / b.h);
  };
  fig.innerHTML = `${svg}<figcaption>Observed rate between the two finest meshes: mode 1 as <i>h</i><sup>${rate(s1).toFixed(2)}</sup>, mode 9 as <i>h</i><sup>${rate(s9).toFixed(2)}</sup>.<br><span class="v-key" style="background:${RED}"></span>Mode 1 <span class="v-key" style="background:${BLUE}"></span>Mode 9 <span class="v-key v-key-ref"></span>reference slopes. Hover a point for its values; the table below has every number.</figcaption>`;
}

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
worker.onmessage = (ev: MessageEvent<VMsg>) => {
  const m = ev.data;
  if (m.type === 'square') { exactRows('.v-sq', m.rows); $('.v-sq-n').textContent = `(${m.nv.toLocaleString('en-US')} vertices)`; }
  else if (m.type === 'disc') { exactRows('.v-disc', m.rows); $('.v-disc-n').textContent = `(${m.nv.toLocaleString('en-US')} vertices)`; }
  else if (m.type === 'gww') { gww.push(m); gwwTable(); }
  else if (m.type === 'weyl') {
    $('.v-weyl tbody').innerHTML = m.rows.map((r) => `<tr><td>${r.name}</td><td>${r.area.toFixed(4)} m&sup2;</td><td>${r.heardArea.toFixed(4)}</td><td>${pct(rel(r.heardArea, r.area))}</td><td>${r.perimeter.toFixed(3)} m</td><td>${r.heardPerimeter.toFixed(3)}</td><td>${pct(rel(r.heardPerimeter, r.perimeter))}</td></tr>`).join('');
  } else if (m.type === 'done') {
    $('.v-status').textContent = 'All computed.';
    document.documentElement.dataset.done = '1';
  }
};
worker.postMessage('go');
