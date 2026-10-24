/* ===========================================================================
   Pre-print check — pure logic behind the checklist dialog, so it's testable.
   =========================================================================== */
import { InkCartridge, Material, PrintJob, RollInstance } from '../types';
import { feetNeeded } from './calc';

export interface InkReading {
  color: string;
  levelPct: number;
}

export interface Precheck {
  feetNeeded: number;
  rollRemainingFt: number;
  rollFullFt: number;
  paperEnough: boolean;
  /** True when the mounted roll's material differs from the job's. */
  wrongMaterial: boolean;
  loadedMaterial: Material | null;
  /** Colors at or below the low-ink threshold. */
  lowInks: string[];
}

const LOW_INK_PCT = 20;

export interface DpiCheck {
  dpiW: number;
  dpiH: number;
  effective: number; // the lower of the two — the limiting resolution
  ok: boolean;
}

/** Effective print resolution of raster artwork at the requested size. */
export function dpiCheck(
  widthPx: number, heightPx: number,
  job: Pick<PrintJob, 'widthIn' | 'heightIn'>,
  minDpi: number,
): DpiCheck | null {
  if (job.widthIn <= 0 || job.heightIn <= 0 || widthPx <= 0 || heightPx <= 0) return null;
  const dpiW = Math.round(widthPx / job.widthIn);
  const dpiH = Math.round(heightPx / job.heightIn);
  const effective = Math.min(dpiW, dpiH);
  return { dpiW, dpiH, effective, ok: effective >= minDpi };
}

export function buildPrecheck(
  job: Pick<PrintJob, 'widthIn' | 'heightIn' | 'quantity' | 'material'>,
  loaded: RollInstance | undefined,
  inks: Array<InkReading | InkCartridge>,
): Precheck {
  const need = feetNeeded(job);
  const remaining = loaded?.remainingFt ?? 0;
  const wrongMaterial = loaded != null && loaded.material !== job.material;
  return {
    feetNeeded: need,
    rollRemainingFt: remaining,
    rollFullFt: loaded?.fullLengthFt ?? 0,
    wrongMaterial,
    loadedMaterial: loaded?.material ?? null,
    paperEnough: loaded != null && !wrongMaterial && remaining >= need,
    lowInks: inks.filter((i) => i.levelPct >= 0 && i.levelPct <= LOW_INK_PCT).map((i) => i.color),
  };
}
