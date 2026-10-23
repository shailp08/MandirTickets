/* ===========================================================================
   Nesting / ganging suggestions.

   The T210 prints on a 24-in-wide roll. Narrow jobs of the same material can be
   placed side-by-side across the width in one pass — the roll only advances by
   the tallest piece, so the shorter pieces' length is saved.

   This is advisory: it groups same-material pending jobs into width-bins
   (first-fit decreasing) and estimates the paper saved. Pure + tested.
   =========================================================================== */
import { Material, PrintJob } from '../types';
import { round1 } from './calc';

export interface NestGroup {
  material: Material;
  jobs: Array<{ id: string; content: string; widthIn: number; heightIn: number }>;
  totalWidthIn: number;
  savedFt: number;
}

export function buildNestingSuggestions(
  jobs: PrintJob[],
  printerWidthIn = 24,
): NestGroup[] {
  const pending = jobs.filter((j) => j.status === 'pending');

  // Group by material.
  const byMaterial = new Map<Material, PrintJob[]>();
  for (const j of pending) {
    if (j.widthIn <= 0 || j.widthIn > printerWidthIn) continue; // can't nest oversize
    const list = byMaterial.get(j.material) ?? [];
    list.push(j);
    byMaterial.set(j.material, list);
  }

  const groups: NestGroup[] = [];

  for (const [material, list] of Array.from(byMaterial.entries())) {
    // First-fit decreasing by width.
    const sorted = [...list].sort((a, b) => b.widthIn - a.widthIn);
    const bins: PrintJob[][] = [];
    const binWidth: number[] = [];

    for (const job of sorted) {
      let placed = false;
      for (let i = 0; i < bins.length; i++) {
        if (binWidth[i] + job.widthIn <= printerWidthIn) {
          bins[i].push(job);
          binWidth[i] += job.widthIn;
          placed = true;
          break;
        }
      }
      if (!placed) { bins.push([job]); binWidth.push(job.widthIn); }
    }

    bins.forEach((bin, i) => {
      if (bin.length < 2) return; // nothing to gang
      const heights = bin.map((j) => j.heightIn);
      const sumHeights = heights.reduce((s, h) => s + h, 0);
      const maxHeight = Math.max(...heights);
      const savedFt = round1((sumHeights - maxHeight) / 12);
      groups.push({
        material,
        jobs: bin.map((j) => ({ id: j.id, content: j.content, widthIn: j.widthIn, heightIn: j.heightIn })),
        totalWidthIn: round1(binWidth[i]),
        savedFt,
      });
    });
  }

  // Biggest savings first.
  return groups.sort((a, b) => b.savedFt - a.savedFt);
}
