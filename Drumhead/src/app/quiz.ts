// "Which drum?": hear a hidden drum, pick its shape from three. Kac's question as a game.
// Some rounds offer both twins; since they sound identical, either answer counts, and the
// reveal says why.

import { PRESETS } from '../solver/shapes';
import { LiveDrum, type Tuning } from './live';
import type { DrumData } from './worker';

export interface QuizHost {
  getDrum: (id: string) => Promise<DrumData>;
  strike: (bank: number, live: LiveDrum, x: number, y: number) => void;
  sendBank: (bank: number, live: LiveDrum) => void;
  tuning: () => Tuning;
  shapeIcon: (outline: number[]) => string;
}

const POOL = ['circle', 'square', 'triangle', 'ell', 'stadium', 'guitar', 'star', 'heart', 'gww-left', 'gww-right'];
const BANK = 7;
const isTwin = (id: string) => id.startsWith('gww');

export class Quiz {
  readonly el: HTMLDivElement;
  private host: QuizHost;
  private answer = '';
  private options: string[] = [];
  private live: LiveDrum | null = null;
  private point: [number, number] = [0, 0];
  private done = false;
  private score = 0;
  private rounds = 0;
  private seed = (Date.now() % 100000) + 1;
  private token = 0;

  constructor(parent: HTMLElement, host: QuizHost) {
    this.host = host;
    this.el = document.createElement('div');
    this.el.className = 'dh-quiz';
    this.el.hidden = true;
    this.el.innerHTML = `
      <p class="dh-quiz-q">Which drum is this?</p>
      <button class="dh-btn dh-quiz-play" data-q="again">Hear it again</button>
      <div class="dh-quiz-opts"></div>
      <p class="dh-quiz-a" aria-live="polite"></p>
      <div class="dh-quiz-foot"><span class="dh-quiz-score"></span><button class="dh-btn" data-q="next" hidden>Next drum</button></div>`;
    parent.append(this.el);
    this.el.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>('button');
      if (!b) return;
      if (b.dataset.q === 'again') this.play();
      else if (b.dataset.q === 'next') void this.round();
      else if (b.dataset.opt) this.guess(b.dataset.opt);
    });
  }

  private rand(n: number): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed % n;
  }

  async open(): Promise<void> {
    this.el.hidden = false;
    if (!this.answer || this.done) await this.round();
  }

  close(): void { this.el.hidden = true; }

  async round(): Promise<void> {
    const token = ++this.token;
    this.done = false;
    this.live = null;
    // One round in three is a twins round.
    const twins = this.rand(3) === 0;
    let opts: string[];
    if (twins) {
      const other = POOL.filter((p) => !isTwin(p));
      opts = ['gww-left', 'gww-right', other[this.rand(other.length)]!];
      this.answer = opts[this.rand(2)]!;
    } else {
      const pool = POOL.filter((p) => !isTwin(p));
      opts = [];
      while (opts.length < 3) { const p = pool[this.rand(pool.length)]!; if (!opts.includes(p)) opts.push(p); }
      this.answer = opts[this.rand(3)]!;
    }
    // Shuffle.
    for (let i = opts.length - 1; i > 0; i--) { const j = this.rand(i + 1); [opts[i], opts[j]] = [opts[j]!, opts[i]!]; }
    this.options = opts;
    const optsEl = this.el.querySelector<HTMLDivElement>('.dh-quiz-opts')!;
    optsEl.innerHTML = opts.map((id) => {
      const p = PRESETS.find((x) => x.id === id)!;
      return `<button class="dh-quiz-opt" data-opt="${id}" aria-label="${p.name}"><svg viewBox="0 0 30 30">${this.host.shapeIcon(p.outline)}</svg><span>${p.name}</span></button>`;
    }).join('');
    this.el.querySelector<HTMLParagraphElement>('.dh-quiz-a')!.textContent = '';
    this.el.querySelector<HTMLButtonElement>('[data-q="next"]')!.hidden = true;
    this.updateScore();
    const data = await this.host.getDrum(this.answer);
    // A later round started while this drum was solving: it owns the stage now.
    if (token !== this.token) return;
    this.live = new LiveDrum(data, this.host.tuning());
    this.host.sendBank(BANK, this.live);
    // Strike a little off-centre, the same way for every drum.
    this.point = pickPoint(this.live);
    // Warm the cache for the other options so the reveal is instant next time.
    for (const o of opts) if (o !== this.answer) void this.host.getDrum(o);
    setTimeout(() => this.play(), 120);
  }

  play(): void {
    if (!this.live) return;
    this.host.strike(BANK, this.live, this.point[0], this.point[1]);
  }

  private guess(id: string): void {
    if (this.done) return;
    this.done = true;
    this.rounds++;
    const both = isTwin(id) && isTwin(this.answer);
    const right = id === this.answer || both;
    if (right) this.score++;
    const name = (x: string) => PRESETS.find((p) => p.id === x)!.name;
    const a = this.el.querySelector<HTMLParagraphElement>('.dh-quiz-a')!;
    a.innerHTML = both && id !== this.answer
      ? `It was <strong>${name(this.answer)}</strong>, but you could not have known: the twins have exactly the same frequencies. Counted as right. That is the answer to Kac's question.`
      : right
        ? `Yes: <strong>${name(this.answer)}</strong>.${isTwin(this.answer) ? ' Though the other twin would have sounded exactly the same.' : ''}`
        : `No: it was <strong>${name(this.answer)}</strong>.`;
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('.dh-quiz-opt')) {
      const o = b.dataset.opt!;
      b.classList.toggle('is-answer', o === this.answer || (isTwin(o) && isTwin(this.answer)));
      b.classList.toggle('is-wrong', o === id && !right);
    }
    this.el.querySelector<HTMLButtonElement>('[data-q="next"]')!.hidden = false;
    this.updateScore();
  }

  private updateScore(): void {
    this.el.querySelector<HTMLSpanElement>('.dh-quiz-score')!.textContent = this.rounds ? `${this.score} of ${this.rounds}` : '';
  }

  get state(): { answer: string; options: string[]; done: boolean; score: number; rounds: number } {
    return { answer: this.answer, options: this.options, done: this.done, score: this.score, rounds: this.rounds };
  }
}

function pickPoint(live: LiveDrum): [number, number] {
  const d = live.data;
  let cx = 0, cy = 0;
  for (let i = 0; i < d.nv; i++) { cx += d.xy[2 * i]!; cy += d.xy[2 * i + 1]!; }
  cx /= d.nv; cy /= d.nv;
  const R = Math.sqrt(d.area);
  for (let t = 0; t < 40; t++) {
    const r = R * (0.2 - t * 0.004), a = 2.1 + t * 0.8;
    if (live.inside(cx + r * Math.cos(a), cy + r * Math.sin(a))) return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  }
  return [cx, cy];
}
