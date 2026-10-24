/* ===========================================================================
   Derivation helpers — kept pure so they can be unit-tested in Phase 2.
   =========================================================================== */
import { InkCartridge, PrintJob, RollInstance } from '../types';
import { getSettings } from './settings';

/** Linear feet of paper a job consumes.
 *  Width runs across the 24-inch roll; height runs along the feed. Rotate
 *  swapped dimensions only when width exceeds the roll and height fits it. */
export function feetNeeded(job: Pick<PrintJob, 'widthIn' | 'heightIn' | 'quantity'>): number {
  const feedIn = job.widthIn > 24 && job.heightIn <= 24 ? job.widthIn : job.heightIn;
  return round1((feedIn / 12) * job.quantity);
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Roll fill as a 0-100 percentage of its full length. */
export function rollPct(roll: RollInstance): number {
  if (roll.fullLengthFt <= 0) return 0;
  return Math.round((roll.remainingFt / roll.fullLengthFt) * 100);
}

export type SupplyState = 'good' | 'warning' | 'critical' | 'no_stock';

/** Status of a single roll from its fill level (spares handled per-material). */
export function rollState(roll: RollInstance): SupplyState {
  const { rollCriticalPct, rollWarningPct } = getSettings();
  const pct = rollPct(roll);
  if (pct <= rollCriticalPct) return 'critical';
  if (pct <= rollWarningPct) return 'warning';
  return 'good';
}

/** Status of an ink cartridge from its live level. */
export function inkState(ink: InkCartridge): SupplyState {
  const { lowInkPct } = getSettings();
  if (ink.levelPct <= lowInkPct) return 'critical';
  if (ink.levelPct <= lowInkPct + 15) return 'warning';
  return 'good';
}

/** Whether a roll can satisfy a given job. */
export function rollCanFulfill(roll: RollInstance, job: Pick<PrintJob, 'widthIn' | 'heightIn' | 'quantity'>): boolean {
  return roll.remainingFt >= feetNeeded(job);
}
