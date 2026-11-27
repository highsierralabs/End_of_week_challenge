// Fluorescence-telescope tab of the charts panel: the shower as an Auger-like eye on the
// horizon would record it. A hexagonal camera (log colour scale of photons per pixel) whose
// pixels light up as the replay clock sweeps, the light track with its direction of motion,
// and an inset of the time traces of four pixels along the track. The light model lives in
// src/physics/telescope.ts; this module only draws it.
import { computeFdView, FD_MODEL, peakDepth, placeTelescope, spotAt, type FdView } from '../physics/telescope';
import type { ShowerResult } from '../physics/types';
import { CLASS_COLORS } from './colors';
import { h } from './dom';
import { si, timeNs } from './format';
import { Axis, drawAxes, haloText, INK, MONO, tagText, type Rect, type Surface } from './plot';

export const FD_CAPTION =
  'What a fluorescence telescope on the horizon would record, after the Pierre Auger Observatory’s eyes: a 30° × 30° camera of 440 hexagonal 1.5° pixels. ' +
  'The shower’s charged particles make nitrogen glow in the near-UV; the spot slides down the camera over microseconds. ' +
  'Colour: photons per pixel at the aperture (log scale); white cells are being hit right now. Inset: photons per 100 ns in four pixels along the track. ' +
  'Eye clock = replay clock + the light-travel time from Xmax. ' +
  'Model limits: a point-like source on the axis (no lateral width), 2.2 MeV per g/cm² per charged particle, a fixed yield of about 20 photons/MeV over 300-420 nm (the 337 nm band alone is ~5.6), ' +
  'isotropic emission, a simple exp(−d / 18 km) transmission, no multiple scattering of the light, no optics, noise or trigger, and no Cherenkov light, which contaminates real FD data, most when the axis points towards the eye. ' +
  'Real FDs work only on clear, moonless nights: a duty cycle of about 15 %.';

export interface FdLegendItem { color: string; label: string; dash?: boolean; marker?: string }

export interface FdDrawResult {
  /** Message for the empty-state overlay, or null when the chart is drawn. */
  empty: string | null;
  legend: FdLegendItem[];
  note?: string;
  hover: ((px: number, py: number) => string | null) | null;
}

const DISTANCES_KM = [10, 14, 18, 25, 32];
/** Trace colours, from the app palette (they are not particle classes here). */
const TRACE_COLORS = [CLASS_COLORS[1]!.css, CLASS_COLORS[3]!.css, CLASS_COLORS[0]!.css, CLASS_COLORS[2]!.css];
const SQ3 = Math.sqrt(3);

interface Cache {
  r: ShowerResult | null;
  km: number;
  view: FdView | null;
  /** Cumulative traces: photons per pixel up to the end of each bin. */
  cum: Float32Array;
  max: number;
  /** Pixels picked for the inset, early to late. */
  picks: number[];
  /** Photon-weighted mean arrival time per pixel. */
  tMean: Float64Array;
  peak: { u: number; v: number } | null;
}

export class TelescopeView {
  private km = 18;
  private c: Cache = { r: null, km: 0, view: null, cum: new Float32Array(0), max: 0, picks: [], tMean: new Float64Array(0), peak: null };

  buildOptions(el: HTMLElement, redraw: () => void): void {
    const sel = h('select', { class: 'cx-select cx-select--sm', 'aria-label': 'Telescope distance from the core' });
    for (const km of DISTANCES_KM) sel.append(h('option', { value: String(km), text: `eye ${km} km from core` }));
    sel.value = String(this.km);
    sel.addEventListener('change', () => { this.km = Number(sel.value); redraw(); });
    el.append(sel, h('span', { class: 'cx-copts-hint', text: 'side view, 1700 m a.s.l.' }));
  }

  private get(r: ShowerResult): Cache {
    if (this.c.r === r && this.c.km === this.km) return this.c;
    const view = computeFdView(r, placeTelescope(r, this.km * 1000));
    const nPix = view.pixels.length;
    const nb = view.nBins;
    const cum = new Float32Array(view.traces.length);
    const tMean = new Float64Array(nPix);
    let max = 0;
    for (let p = 0; p < nPix; p++) {
      let acc = 0;
      let tw = 0;
      for (let b = 0; b < nb; b++) {
        const x = view.traces[p * nb + b]!;
        acc += x;
        tw += x * (view.t0 + (b + 0.5) * view.timeBinNs);
        cum[p * nb + b] = acc;
      }
      tMean[p] = acc > 0 ? tw / acc : NaN;
      if (view.photons[p]! > max) max = view.photons[p]!;
    }
    // four pixels along the track, among the well-lit ones, spread from early to late
    const lit: number[] = [];
    for (let p = 0; p < nPix; p++) if (view.photons[p]! >= max * 0.08 && max > 0) lit.push(p);
    lit.sort((a, b) => tMean[a]! - tMean[b]!);
    const picks: number[] = [];
    if (lit.length > 0) {
      for (const f of [0.1, 0.37, 0.63, 0.9]) {
        const p = lit[Math.min(lit.length - 1, Math.round(f * (lit.length - 1)))]!;
        if (!picks.includes(p)) picks.push(p);
      }
    }
    const peakPt = view.track.length ? nearestDepthPoint(r, view) : null;
    this.c = { r, km: this.km, view, cum, max, picks, tMean, peak: peakPt };
    return this.c;
  }

  draw(s: Surface, r: ShowerResult, tNs: number | null): FdDrawResult {
    const c = this.get(r);
    const view = c.view!;
    const { ctx } = s;
    const tel = view.telescope;
    const pd = tel.pixelDeg;
    const pitchV = (pd * SQ3) / 2;
    const uExt = (view.nCols / 2 + 0.25) * pd;
    const vExt = ((view.nRows - 1) / 2) * pitchV + pd / SQ3;

    // ---- layout: camera, then the inset below (or to the right when wide)
    const wide = s.w >= 620;
    const pad = 8;
    const insetH = wide ? 0 : Math.round(Math.max(96, Math.min(140, s.h * 0.27)));
    const camBox: Rect = wide
      ? { x: 34, y: pad, w: Math.min(s.h - 2 * pad - 18, s.w * 0.55), h: s.h - 2 * pad - 18 }
      : { x: 34, y: pad, w: s.w - 34 - pad, h: s.h - insetH - 38 - pad - 18 };
    const scale = Math.min(camBox.w / (2 * uExt), camBox.h / (2 * vExt));
    const cx = camBox.x + camBox.w / 2;
    const cy = camBox.y + camBox.h / 2;
    const X = (u: number): number => cx + u * scale;
    const Yv = (v: number): number => cy - v * scale;
    const R = (pd / SQ3) * scale;

    // camera housing
    ctx.save();
    ctx.fillStyle = '#04060c';
    ctx.strokeStyle = 'rgba(150, 170, 215, 0.28)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(X(-uExt) - 6, Yv(vExt) - 6, 2 * uExt * scale + 12, 2 * vExt * scale + 12, 8);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // eye clock
    const delay = view.lightDelayNs;
    const tEye = tNs === null ? null : tNs + delay;
    const nb = view.nBins;
    const bin = tEye === null ? nb - 1 : Math.floor((tEye - view.t0) / view.timeBinNs);
    const bNow = Math.max(-1, Math.min(nb - 1, bin));
    const lut = fdColormap();
    const lmax = c.max > 0 ? Math.log10(c.max) : 0;
    const lmin = lmax - 2;
    const colorOf = (v: number, alpha = 1): string => {
      const f = Math.max(0, Math.min(1, (Math.log10(v) - lmin) / (lmax - lmin)));
      const k = Math.round(f * 255) * 3;
      return `rgba(${lut[k]},${lut[k + 1]},${lut[k + 2]},${alpha})`;
    };

    // ---- pixels
    const hexPath = (u: number, v: number, k: number): void => {
      const px = X(u);
      const py = Yv(v);
      const rr = R * k;
      ctx.moveTo(px, py - rr);
      for (let i = 1; i < 6; i++) {
        const a = Math.PI / 2 + (i * Math.PI) / 3;
        ctx.lineTo(px + rr * Math.cos(a), py - rr * Math.sin(a));
      }
      ctx.closePath();
    };
    // empty cells
    ctx.save();
    ctx.fillStyle = '#0b1020';
    ctx.strokeStyle = 'rgba(120, 140, 190, 0.22)';
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    for (const p of view.pixels) hexPath(p.centre[0], p.centre[1], 0.94);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    const active: { p: number; w: number }[] = [];
    if (c.max > 0) {
      ctx.save();
      for (let i = 0; i < view.pixels.length; i++) {
        const full = view.photons[i]!;
        if (!(full > 0)) continue;
        const now = bNow < 0 ? 0 : c.cum[i * nb + bNow]!;
        const pp = view.pixels[i]!;
        // a faint ghost of what is still to come
        if (now < full * 0.999 && full >= c.max * 1e-3) {
          ctx.fillStyle = colorOf(full, 0.2);
          ctx.beginPath();
          hexPath(pp.centre[0], pp.centre[1], 0.9);
          ctx.fill();
        }
        if (now > 0 && now >= c.max * 1e-3) {
          ctx.fillStyle = colorOf(now);
          ctx.beginPath();
          hexPath(pp.centre[0], pp.centre[1], 0.9);
          ctx.fill();
        }
        // being hit now: light in the last three bins
        if (tEye !== null && bin >= 0 && bin < nb) {
          let rate = 0;
          for (let b = Math.max(0, bin - 2); b <= bin; b++) rate += view.traces[i * nb + b]! * (b === bin ? 1 : 0.5);
          if (rate > 0) active.push({ p: i, w: rate });
        }
      }
      ctx.restore();
    }
    // glow on the pixels being hit
    if (active.length) {
      const wmax = Math.max(...active.map((a) => a.w));
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const a of active) {
        const pp = view.pixels[a.p]!;
        const k = Math.max(0.15, Math.min(1, a.w / wmax));
        ctx.shadowColor = 'rgba(190, 170, 255, 0.95)';
        ctx.shadowBlur = 14 * k;
        ctx.fillStyle = `rgba(235, 228, 255, ${0.35 + 0.6 * k})`;
        ctx.beginPath();
        hexPath(pp.centre[0], pp.centre[1], 0.86);
        ctx.fill();
      }
      ctx.restore();
    }

    // ---- the track: dashed path of the light spot with a direction arrow
    const inCam = (u: number, v: number): boolean => Math.abs(u) <= uExt && Math.abs(v) <= vExt;
    const pts = view.track.filter((p) => inCam(p.u, p.v));
    if (pts.length > 1) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(X(-uExt) - 6, Yv(vExt) - 6, 2 * uExt * scale + 12, 2 * vExt * scale + 12);
      ctx.clip();
      ctx.strokeStyle = 'rgba(225, 230, 255, 0.55)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      let pen = false;
      for (const p of view.track) {
        if (!inCam(p.u, p.v)) { pen = false; continue; }
        if (pen) ctx.lineTo(X(p.u), Yv(p.v));
        else { ctx.moveTo(X(p.u), Yv(p.v)); pen = true; }
      }
      ctx.stroke();
      ctx.setLineDash([]);
      // arrow beside the upper part of the visible track, pointing the way the spot moves
      const i1 = Math.min(pts.length - 1, Math.floor(pts.length * 0.42));
      const i0 = Math.max(0, i1 - Math.max(2, Math.floor(pts.length * 0.06)));
      const a0 = pts[i0]!;
      const a1 = pts[i1]!;
      const ang = Math.atan2(Yv(a1.v) - Yv(a0.v), X(a1.u) - X(a0.u));
      // offset to the side of the track with more room, so it does not cover the pixels
      const off = R * 2.4;
      let ox = -Math.sin(ang) * off;
      let oy = Math.cos(ang) * off;
      if (Math.abs(X(a1.u) + ox - cx) > Math.abs(X(a1.u) - ox - cx)) { ox = -ox; oy = -oy; }
      const ex = X(a1.u) + ox;
      const ey = Yv(a1.v) + oy;
      const len = Math.max(22, R * 5);
      ctx.strokeStyle = '#eef2fb';
      ctx.fillStyle = '#eef2fb';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(ex - Math.cos(ang) * len, ey - Math.sin(ang) * len);
      ctx.lineTo(ex - Math.cos(ang) * 5, ey - Math.sin(ang) * 5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - Math.cos(ang - 0.42) * 9, ey - Math.sin(ang - 0.42) * 9);
      ctx.lineTo(ex - Math.cos(ang + 0.42) * 9, ey - Math.sin(ang + 0.42) * 9);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      const right = ox > 0;
      haloText(ctx, 'motion', right ? ex + 6 : ex - 6, ey + 4, '#eef2fb', `10px ${MONO}`, right ? 'left' : 'right');
      // Xmax mark, on the other side of the track
      if (c.peak && !inCam(c.peak.u, c.peak.v)) {
        haloText(ctx, 'Xmax is outside this camera', X(uExt) - 4, Yv(-vExt) - 6, '#a7b6ff', `10px ${MONO}`, 'right');
      } else if (c.peak) {
        const px = X(c.peak.u);
        const py = Yv(c.peak.v);
        const lx = -ox;
        const ly = -oy;
        ctx.save();
        ctx.strokeStyle = 'rgba(167, 182, 255, 0.95)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(px + lx * 0.45, py + ly * 0.45);
        ctx.lineTo(px + lx * 1.0, py + ly * 1.0);
        ctx.stroke();
        ctx.restore();
        const leftSide = lx < 0;
        haloText(ctx, 'Xmax', px + lx * 1.08 + (leftSide ? -2 : 2), py + ly * 1.08 + 4, '#a7b6ff', `10px ${MONO}`, leftSide ? 'right' : 'left');
      }
    }

    // outlines of the inset pixels
    ctx.save();
    ctx.lineWidth = 1.6;
    c.picks.forEach((p, k) => {
      const pp = view.pixels[p]!;
      ctx.strokeStyle = TRACE_COLORS[k % TRACE_COLORS.length]!;
      ctx.beginPath();
      hexPath(pp.centre[0], pp.centre[1], 1.02);
      ctx.stroke();
    });
    ctx.restore();

    // the spot itself
    const spot = tEye === null ? null : spotAt(view, tEye);
    if (spot && inCam(spot.u, spot.v)) {
      const px = X(spot.u);
      const py = Yv(spot.v);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(px, py, 0, px, py, R * 2.0);
      g.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
      g.addColorStop(0.25, 'rgba(210, 195, 255, 0.7)');
      g.addColorStop(1, 'rgba(120, 90, 255, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px, py, R * 2.0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // ---- camera axes: elevation on the left, azimuth below
    ctx.save();
    ctx.fillStyle = INK.muted;
    ctx.strokeStyle = INK.axis;
    ctx.lineWidth = s.hair;
    ctx.font = `9.5px ${MONO}`;
    ctx.textAlign = 'right';
    const elLo = tel.elevationDeg - vExt;
    const elHi = tel.elevationDeg + vExt;
    for (let e = Math.ceil(elLo / 5) * 5; e <= elHi; e += 5) {
      const py = Yv(e - tel.elevationDeg);
      ctx.beginPath();
      ctx.moveTo(X(-uExt) - 10, s.crisp(py));
      ctx.lineTo(X(-uExt) - 6, s.crisp(py));
      ctx.stroke();
      ctx.fillText(`${e}°`, X(-uExt) - 12, py + 3);
    }
    ctx.textAlign = 'center';
    const azLo = -uExt;
    for (let du = Math.ceil(azLo / 5) * 5; du <= uExt; du += 5) {
      const px = X(du);
      if (px > X(uExt) - 56) continue; // room for the axis name
      const az = (((tel.azimuthDeg + du) % 360) + 360) % 360;
      ctx.beginPath();
      ctx.moveTo(s.crisp(px), Yv(-vExt) + 6);
      ctx.lineTo(s.crisp(px), Yv(-vExt) + 10);
      ctx.stroke();
      ctx.fillText(`${Math.round(az)}°`, px, Yv(-vExt) + 20);
    }
    ctx.restore();
    ctx.save();
    ctx.fillStyle = INK.faint;
    ctx.font = `9.5px ${MONO}`;
    ctx.textAlign = 'left';
    ctx.fillText('elev.', 2, Yv(vExt) + 2);
    ctx.textAlign = 'right';
    ctx.fillText('azimuth', X(uExt) + 4, Yv(-vExt) + 20);
    ctx.restore();

    // eye clock tag
    if (view.cameraPhotons > 0 && Number.isFinite(view.tFirst)) {
      const label = tEye === null ? 'whole event' : tEye < view.tFirst ? `first light in ${timeNs(view.tFirst - tEye)}` : tEye > view.tLast ? 'track complete' : `eye clock +${timeNs(tEye - view.tFirst)}`;
      tagText(ctx, label, X(-uExt) + 2, Yv(vExt) + 10, '#e6e0ff', 'left');
    } else {
      tagText(ctx, c.view!.totalPhotons > 0 ? 'no light falls in this field of view' : 'no fluorescence light: the profile is empty', cx, cy, INK.text, 'left');
    }

    // ---- inset: traces of the picked pixels
    let insetHover: ((px: number, py: number) => string | null) | null = null;
    if (c.picks.length > 0 && view.nBins > 1) {
      const frame: Rect = wide
        ? { x: camBox.x + camBox.w + 64, y: pad + 10, w: s.w - (camBox.x + camBox.w + 64) - 12, h: Math.min(180, s.h * 0.45) }
        : { x: 52, y: s.h - insetH - 34, w: s.w - 52 - 12, h: insetH };
      const tLo = view.tFirst;
      const tHi = view.tLast + view.timeBinNs;
      let ymax = 0;
      for (const p of c.picks) for (let b = 0; b < nb; b++) ymax = Math.max(ymax, view.traces[p * nb + b]!);
      const TX = new Axis(0, (tHi - tLo) / 1000, false, frame.x, frame.x + frame.w);
      const TY = new Axis(0, ymax * 1.15 || 1, false, frame.y + frame.h, frame.y);
      drawAxes(s, { frame, x: TX, y: TY, xLabel: 'time at the eye since first light (µs)', yLabel: 'γ / 100 ns' });
      ctx.save();
      ctx.beginPath();
      ctx.rect(frame.x, frame.y, frame.w, frame.h);
      ctx.clip();
      c.picks.forEach((p, k) => {
        const col = TRACE_COLORS[k % TRACE_COLORS.length]!;
        ctx.beginPath();
        let started = false;
        for (let b = 0; b < nb; b++) {
          const ta = (view.t0 + b * view.timeBinNs - tLo) / 1000;
          const tb = ta + view.timeBinNs / 1000;
          const y = TY.map(view.traces[p * nb + b]!);
          if (!started) { ctx.moveTo(TX.map(ta), TY.map(0)); started = true; }
          ctx.lineTo(TX.map(ta), y);
          ctx.lineTo(TX.map(tb), y);
        }
        ctx.lineTo(TX.map((view.t0 + nb * view.timeBinNs - tLo) / 1000), TY.map(0));
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = col;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.3;
        ctx.stroke();
      });
      if (tEye !== null && tEye >= tLo && tEye <= tHi) {
        const px = s.crisp(TX.map((tEye - tLo) / 1000));
        ctx.strokeStyle = '#e6e0ff';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(px, frame.y);
        ctx.lineTo(px, frame.y + frame.h);
        ctx.stroke();
      }
      ctx.restore();
      insetHover = (hx, hy) => {
        if (hx < frame.x || hx > frame.x + frame.w || hy < frame.y || hy > frame.y + frame.h) return null;
        const tt = TX.inv(hx);
        const b = Math.floor((tt * 1000 + tLo - view.t0) / view.timeBinNs);
        if (b < 0 || b >= nb) return `t = ${tt.toFixed(1)} µs`;
        return `t = ${tt.toFixed(1)} µs · ` + c.picks.map((p, k) => `${'ABCD'[k]} ${fmtPh(view.traces[p * nb + b]!)}`).join(' · ') + ' γ/100 ns';
      };
    }

    // ---- hover on the camera
    const hover = (hx: number, hy: number): string | null => {
      const ih = insetHover?.(hx, hy) ?? null;
      if (ih) return ih;
      const u = (hx - cx) / scale;
      const v = (cy - hy) / scale;
      if (!inCam(u, v)) return null;
      let best = -1;
      let bd = Infinity;
      for (let i = 0; i < view.pixels.length; i++) {
        const pp = view.pixels[i]!;
        const dd = (pp.centre[0] - u) ** 2 + (pp.centre[1] - v) ** 2;
        if (dd < bd) { bd = dd; best = i; }
      }
      if (best < 0 || bd > (pd / SQ3) ** 2) return null;
      const pp = view.pixels[best]!;
      const ph = view.photons[best]!;
      const el = tel.elevationDeg + pp.centre[1];
      const az = (((tel.azimuthDeg + pp.centre[0]) % 360) + 360) % 360;
      const tm = c.tMean[best]!;
      return `pixel ${pp.v + 1}-${pp.u + 1} · el ${el.toFixed(1)}° az ${az.toFixed(0)}° · ${fmtPh(ph)} γ` + (ph > 0 && Number.isFinite(tm) ? ` · at +${timeNs(tm - view.tFirst)}` : '');
    };

    const g = view.geometry;
    const legend: FdLegendItem[] = c.picks.map((p, k) => ({
      color: TRACE_COLORS[k % TRACE_COLORS.length]!,
      label: `${'ABCD'[k]} el ${(tel.elevationDeg + view.pixels[p]!.centre[1]).toFixed(1)}°`,
      marker: '⬡',
    }));
    const notes = [
      `eye ${g.distanceToCoreKm.toFixed(1)} km from the core`,
      `Rp ${g.rpKm.toFixed(1)} km`,
      `χ₀ ${g.chiDeg.toFixed(0)}°`,
      `${fmtPh(view.totalPhotons)} photons at the ${tel.apertureM2} m² aperture`,
      view.crossingNs > 0 ? `crosses the camera in ${timeNs(view.crossingNs)}` : 'the spot never enters the camera',
      `deposit ${(100 * view.depositEV / Math.max(1, r.params.energyEV)).toFixed(0)} % of E₀`,
      `yield ${FD_MODEL.yieldPerMeV} γ/MeV`,
    ];
    return { empty: null, legend, note: notes.join(' · '), hover };
  }
}

function fmtPh(v: number): string {
  if (!(v > 0)) return '0';
  if (v < 0.01) return v.toExponential(1);
  if (v < 10) return v.toFixed(2);
  return si(v, 3);
}

/** Camera position of the axis point at the profile's peak (the Xmax mark). */
function nearestDepthPoint(r: ShowerResult, view: FdView): { u: number; v: number } | null {
  const X = peakDepth(r);
  let best: { u: number; v: number } | null = null;
  let bd = Infinity;
  for (const p of view.track) {
    const dd = Math.abs(p.X - X);
    if (dd < bd) { bd = dd; best = { u: p.u, v: p.v }; }
  }
  return best;
}

let lutCache: Uint8Array | null = null;
/** Near-UV glow: deep indigo -> violet -> lavender -> white. */
function fdColormap(): Uint8Array {
  if (lutCache) return lutCache;
  const stops: [number, number, number, number][] = [
    [0.0, 34, 22, 84],
    [0.3, 84, 40, 160],
    [0.55, 136, 78, 230],
    [0.75, 170, 150, 255],
    [0.92, 214, 208, 255],
    [1.0, 255, 255, 255],
  ];
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const f = i / 255;
    let k = 0;
    while (k < stops.length - 2 && f > stops[k + 1]![0]) k++;
    const [f0, r0, g0, b0] = stops[k]!;
    const [f1, r1, g1, b1] = stops[k + 1]!;
    const t = (f - f0) / (f1 - f0);
    lut[i * 3] = Math.round(r0 + (r1 - r0) * t);
    lut[i * 3 + 1] = Math.round(g0 + (g1 - g0) * t);
    lut[i * 3 + 2] = Math.round(b0 + (b1 - b0) * t);
  }
  lutCache = lut;
  return lut;
}
