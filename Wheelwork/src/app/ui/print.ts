// The Print panel: build the kit from the machine as it stands, show what was checked, download it.
import { buildKit, type Kit } from '../../core/machine/kit';
import { encodeSpec } from '../../core/machine/spec';
import { download, kitZip } from '../export/zip';
import { type App, type Panel } from './app';
import { clear, fmt, h } from './dom';

export class PrintPanel implements Panel {
  el: HTMLElement;
  private out: HTMLElement;
  private status: HTMLElement;
  private scale = 1;
  kit: Kit | null = null;
  private kitFor = '';

  constructor(private app: App) {
    this.out = h('div.kit');
    this.status = h('p.status', { role: 'status' });
    const scale = h('select', { 'aria-label': 'Scale', onchange: () => { this.scale = Number(scale.value); this.kit = null; clear(this.out); this.status.textContent = 'The scale has changed; check the kit again.'; } },
      [1, 1.25, 1.5, 2].map((v) => h('option', { value: v, selected: v === 1 }, v === 1 ? 'as drawn (plates 216 mm across)' : `${v} times (plates ${fmt(216 * v, 0)} mm)`)));
    const build = h('button', { type: 'button', onclick: () => this.build(false) }, 'Check the kit');
    const save = h('button.primary', { type: 'button', onclick: () => this.build(true) }, 'Download the kit (.zip of STL files)');
    this.el = h('section.panel.print', null,
      h('h2', null, 'Print'),
      h('p.lede', null, 'The machine on the workbench, as files for a 3D printer: every wheel, cluster, tube, arm, plate and pillar, with a parts list and assembly notes.'),
      h('p', null, 'The solids are the ones drawn on screen, made again at finer detail and with a little more backlash. The walnut case and the engraving are not in the kit.'),
      h('p.caution', null, h('strong', null, 'This kit has not been printed.'), " Each file is checked to be a closed solid and each pair of spur wheels is run through a full tooth pitch to look for interference, but fits and clearances are nominal and no one has put it together. The parts on the Earth's arm are small; they want a resin printer or a larger scale."),
      h('label', null, h('span', null, 'Scale'), scale),
      h('div.buttons', null, build, save),
      this.status,
      this.out,
    );
  }

  private build(save: boolean): void {
    this.status.textContent = 'Building the kit…';
    // Let the message paint before the work starts.
    setTimeout(() => {
      try {
        const key = `${encodeSpec(this.app.model.spec)}@${this.scale}`;
        if (!this.kit || this.kitFor !== key) { this.kit = buildKit(this.app.model.layout, this.scale); this.kitFor = key; }
        const kit = this.kit;
        if (save) {
          const bytes = kitZip(kit);
          download(bytes, 'wheelwork-kit.zip', 'application/zip');
          this.status.textContent = `Saved ${kit.pieces.length} files, ${fmt(bytes.length / 1e6, 1)} MB.`;
        } else {
          this.status.textContent = kit.ok ? 'Every solid is closed and no pair of spur wheels interferes.' : 'The kit has faults: see below.';
        }
        this.render();
      } catch (e) {
        this.status.textContent = `The kit could not be built: ${(e as Error).message}`;
      }
    }, 30);
  }

  private render(): void {
    clear(this.out);
    const kit = this.kit;
    if (!kit) return;
    const pieces = kit.pieces.reduce((n, p) => n + p.count, 0);
    this.out.append(
      h('p', null, `${pieces} pieces from ${kit.pieces.length} files. The largest lies ${fmt(kit.largest[0], 0)} by ${fmt(kit.largest[1], 0)} mm on the bed; the tallest stands ${fmt(kit.largest[2], 0)} mm. About ${fmt(kit.totalVolume / 1000, 0)} cm³ of plastic if printed solid.`),
      h('h3', null, 'Pairs of spur wheels'),
    );
    const t = h('table.readings');
    t.append(h('thead', null, h('tr', null, h('th', null, 'Train'), h('th', null, 'Teeth'), h('th', { title: 'Tooth size' }, 'Module'), h('th', { title: 'Above 1, a tooth is always engaged' }, 'Contact'), h('th', { title: 'Smallest gap between the wheels over a tooth pitch' }, 'Gap'))));
    const tb = h('tbody');
    for (const m of kit.meshes) {
      tb.append(h('tr', null, h('th', { scope: 'row' }, `${m.train}, ${m.pair}`), h('td', null, m.teeth), h('td', null, `${fmt(m.module, 2)} mm`),
        h('td', { class: m.contactRatio > 1.2 ? 'good' : 'warn' }, fmt(m.contactRatio, 2)), h('td', { class: m.ok ? 'good' : 'bad' }, m.ok ? `${fmt(m.clearance, 2)} mm` : 'interferes')));
    }
    t.append(tb);
    this.out.append(t, h('h3', null, 'Files'));
    const list = h('ul.files');
    let group = '';
    for (const p of kit.pieces) {
      if (p.group !== group) { group = p.group; list.append(h('li.group', null, group)); }
      list.append(h('li', { class: p.closed ? '' : 'bad' }, h('span', null, p.name), h('span', null, `${p.count > 1 ? `${p.count} × ` : ''}${fmt(p.size[0], 0)} × ${fmt(p.size[1], 0)} × ${fmt(p.size[2], 0)} mm`)));
    }
    this.out.append(list);
  }

  update(): void {
    // A kit shown for another machine would mislead.
    const key = `${encodeSpec(this.app.model.spec)}@${this.scale}`;
    if (this.kit && this.kitFor !== key) { this.kit = null; clear(this.out); this.status.textContent = 'The machine has changed; check the kit again.'; }
  }
}
