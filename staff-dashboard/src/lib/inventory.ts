/* ===========================================================================
   Pure inventory operations over the roll-instance model.

   Selectors read the inventory; reducers return a NEW inventory (no mutation,
   no I/O) so the waste-critical math is unit-tested in isolation. The store
   layer wires these to persistence + the event log.
   =========================================================================== */
import { InkCartridge, Inventory, Material, RollInstance } from '../types';
import { round1 } from './calc';

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/* ----------------------------------------------------------- selectors ---- */

/** The roll currently mounted on the printer, if any. */
export function loadedRoll(inv: Inventory): RollInstance | undefined {
  return inv.rolls.find((r) => r.loaded);
}

/** All opened rolls of a material (loaded + partials on the shelf). */
export function rollsOfMaterial(inv: Inventory, material: Material): RollInstance[] {
  return inv.rolls.filter((r) => r.material === material);
}

/** Total feet available for a material: opened remaining + unopened spares. */
export function materialAvailableFt(inv: Inventory, material: Material, fullLengthFt: number): number {
  const opened = rollsOfMaterial(inv, material).reduce((s, r) => s + r.remainingFt, 0);
  return round1(opened + (inv.spares[material] ?? 0) * fullLengthFt);
}

/* ------------------------------------------------------------ reducers ---- */

/** Open a fresh spare roll and mount it; the previously loaded roll goes to the
 *  shelf. Draws one from spare stock. */
export function openNewRoll(
  inv: Inventory, material: Material, fullLengthFt: number, loadWasteFt: number,
  id: string, at: string = new Date().toISOString(),
): Inventory {
  const fresh: RollInstance = {
    id, material, fullLengthFt,
    remainingFt: round1(Math.max(0, fullLengthFt - loadWasteFt)),
    openedAt: at, loaded: true,
  };
  return {
    ...inv,
    spares: { ...inv.spares, [material]: Math.max(0, (inv.spares[material] ?? 0) - 1) },
    rolls: [...inv.rolls.map((r) => ({ ...r, loaded: false })), fresh],
  };
}

/** Mount an existing shelf roll. Reloading re-trims for skew, so a small
 *  load-waste comes off. Unloads whatever was on the printer. No-op if the
 *  roll id doesn't exist (so a bad id never silently unloads everything). */
export function switchRoll(inv: Inventory, rollId: string, loadWasteFt: number): Inventory {
  if (!inv.rolls.some((r) => r.id === rollId)) return inv;
  const trim = Math.max(0, loadWasteFt);
  return {
    ...inv,
    rolls: inv.rolls.map((r) => {
      if (r.id !== rollId) return r.loaded ? { ...r, loaded: false } : r;
      return { ...r, loaded: true, remainingFt: round1(Math.max(0, r.remainingFt - trim)) };
    }),
  };
}

/** Deduct printed feet from the loaded roll (never below zero). A negative or
 *  NaN amount is treated as zero so a bad value can't inflate the count. */
export function consumeLoaded(inv: Inventory, ft: number): Inventory {
  const d = Number.isFinite(ft) && ft > 0 ? ft : 0;
  if (d === 0) return inv;
  return {
    ...inv,
    rolls: inv.rolls.map((r) => (r.loaded ? { ...r, remainingFt: round1(Math.max(0, r.remainingFt - d)) } : r)),
  };
}

/** Set a measured remaining length for a specific roll (correct drift).
 *  Non-finite values (NaN, Infinity) clamp to 0 so a bad measurement can't
 *  corrupt the footage counter. */
export function recalibrate(inv: Inventory, rollId: string, measuredFt: number): Inventory {
  const safe = Number.isFinite(measuredFt) ? measuredFt : 0;
  return {
    ...inv,
    rolls: inv.rolls.map((r) => (r.id === rollId ? { ...r, remainingFt: round1(clamp(safe, 0, r.fullLengthFt)) } : r)),
  };
}

/** Receive unopened spare rolls into stock. */
export function receivePaper(inv: Inventory, material: Material, qty: number): Inventory {
  return { ...inv, spares: { ...inv.spares, [material]: (inv.spares[material] ?? 0) + Math.max(0, Math.trunc(qty)) } };
}

/** Remove a roll from the shelf (used up or discarded). */
export function discardRoll(inv: Inventory, rollId: string): Inventory {
  return { ...inv, rolls: inv.rolls.filter((r) => r.id !== rollId) };
}

/* ----------------------------------------------------------- ink (entity) -- */

export function replaceInk(ink: InkCartridge, at: string = new Date().toISOString()): InkCartridge {
  return { ...ink, levelPct: 100, replacedAt: at, sparesInStock: Math.max(0, ink.sparesInStock - 1) };
}

export function receiveInk(ink: InkCartridge, qty: number): InkCartridge {
  return { ...ink, sparesInStock: ink.sparesInStock + Math.max(0, Math.trunc(qty)) };
}
