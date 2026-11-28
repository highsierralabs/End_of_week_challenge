// Pack a print kit into one zip file and hand it to the browser as a download.
import { strToU8, zipSync } from 'fflate';
import { type Kit } from '../../core/machine/kit';
import { toBinaryStl } from '../../core/mesh/kit';

export function kitZip(kit: Kit): Uint8Array {
  const files: Record<string, Uint8Array> = { 'wheelwork-kit/README.txt': strToU8(kit.readme) };
  for (const p of kit.pieces) files[`wheelwork-kit/${p.file}`] = toBinaryStl(p.mesh, p.name);
  return zipSync(files, { level: 6 });
}

export function download(bytes: Uint8Array, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
