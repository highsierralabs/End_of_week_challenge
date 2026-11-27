// A compact "what the crystal got" line appended to the readout panel.
import type { DetectorExposure } from '../physics/detector';
import { RClass } from '../physics/types';
import { h } from './dom';
import { si } from './format';

export function renderDetector(el: HTMLElement, d: DetectorExposure): void {
  el.querySelector('.cx-det')?.remove();
  const fmt = (v: number): string => (v >= 0.01 ? si(v, 2) : v > 0 ? v.toExponential(1) : '0');
  const thin = d.records < 10;
  const poissonP = 1 - Math.exp(-d.shieldedMuons);
  const note = `Densities from ${d.records} ground records at ${d.rLo.toFixed(0)}-${d.rHi.toFixed(0)} m from the axis${thin ? ' (few records: rough)' : ''}. Expected counts from this one shower; the lead's effect on electrons and photons is not modelled.`;
  const block = h('div', { class: 'cx-det', title: note });
  block.innerHTML = `
    <span class="cx-det-k">Detector &middot; ${d.coreDistance.toFixed(0)} m</span>
    <span>&mu; <b>${fmt(d.density[RClass.MUON]!)}</b></span>
    <span>e&plusmn; <b>${fmt(d.density[RClass.ELECTRON]! + d.density[RClass.POSITRON]!)}</b></span>
    <span>&gamma; <b>${fmt(d.density[RClass.GAMMA]!)}</b> /m&sup2;</span>
    <span class="cx-det-sep">1 cm&sup3; bare <b>${fmt(d.bareCharged)}</b> charged &middot; in castle <b>${fmt(d.shieldedMuons)}</b> &mu; (P&ge;1 ${(poissonP * 100).toFixed(poissonP < 0.01 ? 2 : 0)}%)</span>`;
  el.append(block);
}
