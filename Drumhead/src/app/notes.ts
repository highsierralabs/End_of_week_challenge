// Frequencies to note names (equal temperament, A4 = 440 Hz).

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function noteName(f: number): { name: string; cents: number; midi: number } {
  const m = 69 + 12 * Math.log2(f / 440);
  const r = Math.round(m);
  const cents = Math.round((m - r) * 100);
  return { name: `${NAMES[((r % 12) + 12) % 12]}${Math.floor(r / 12) - 1}`, cents, midi: r };
}

export function formatNote(f: number): string {
  const n = noteName(f);
  const c = n.cents === 0 ? '' : ` ${n.cents > 0 ? '+' : '−'}${Math.abs(n.cents)}¢`;
  return `${n.name.replace('#', '♯')}${c}`;
}

export function midiToHz(m: number): number { return 440 * 2 ** ((m - 69) / 12); }
