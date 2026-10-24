/* ===========================================================================
   Derive live alerts + a reorder list from the current inventory.
   Pure — so the ticker and the reorder panel stay testable and in sync.
   =========================================================================== */
import { Alert, Inventory, Material } from '../types';
import { inkState, rollPct, rollState } from './calc';
import { loadedRoll, rollsOfMaterial } from './inventory';
import { getSettings } from './settings';

export function deriveAlerts(inv: Inventory): Alert[] {
  const out: Alert[] = [];

  // The loaded roll is the urgent one — you can run out mid-print.
  const loaded = loadedRoll(inv);
  if (loaded) {
    const state = rollState(loaded);
    if (state === 'critical') {
      out.push({
        id: `roll-${loaded.material}-loaded-crit`, severity: 'critical',
        title: `${loaded.material} (loaded) critical`,
        detail: `${loaded.remainingFt} ft left (${rollPct(loaded)}%) on the printer`,
      });
    } else if (state === 'warning') {
      out.push({
        id: `roll-${loaded.material}-loaded-low`, severity: 'warning',
        title: `${loaded.material} (loaded) low`,
        detail: `${loaded.remainingFt} ft left (${rollPct(loaded)}%)`,
      });
    }
  }

  // Out of spare rolls for a material — can't open a fresh one.
  const materials = Object.keys(inv.spares) as Material[];
  for (const material of materials) {
    const spares = inv.spares[material] ?? 0;
    const openedFt = rollsOfMaterial(inv, material).reduce((s, r) => s + r.remainingFt, 0);
    if (spares <= 0 && openedFt <= 0) {
      out.push({
        id: `roll-${material}-out`, severity: 'critical',
        title: `${material} paper out`, detail: 'no rolls left — reorder',
      });
    } else if (spares <= 0) {
      out.push({
        id: `roll-${material}-nospares`, severity: 'warning',
        title: `${material} out of spare rolls`, detail: `${openedFt.toFixed(1)} ft left on opened rolls`,
      });
    }
  }

  for (const ink of inv.inks) {
    if (inkState(ink) === 'critical') {
      out.push({
        id: `ink-${ink.color}-crit`, severity: 'critical',
        title: `${ink.color} ink at ${ink.levelPct}%`,
        detail: `replace soon · ${ink.sparesInStock} spare${ink.sparesInStock === 1 ? '' : 's'} in stock`,
      });
    } else if (ink.sparesInStock <= getSettings().lowSpareThreshold) {
      out.push({
        id: `ink-${ink.color}-spares`, severity: 'warning',
        title: `${ink.color} cartridge spares low`,
        detail: `${ink.sparesInStock} remaining`,
      });
    }
  }

  // Critical first, then warnings — most urgent leads the ticker.
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1));
}

/** Severe printer faults that warrant a critical alert (vs. an advisory one). */
const CRITICAL_PRINTER_ERRORS = ['Out of paper', 'Cover open', 'Paper jam', 'Out of ink', 'Offline'];

/** Turn printer error strings (from SNMP) into ticker alerts. */
export function derivePrinterAlerts(errors: string[]): Alert[] {
  return errors.map((e) => ({
    id: `printer-${e.replace(/\s+/g, '-').toLowerCase()}`,
    severity: CRITICAL_PRINTER_ERRORS.includes(e) ? 'critical' : 'warning',
    title: `Printer: ${e}`,
    detail: 'check the printer',
  }));
}

export interface ReorderItem {
  kind: 'paper' | 'ink';
  name: string;
  detail: string;
  sparesInStock: number;
}

/** Items that should be reordered (low spare stock). */
export function deriveReorderList(inv: Inventory): ReorderItem[] {
  const items: ReorderItem[] = [];

  const materials = Object.keys(inv.spares) as Material[];
  for (const material of materials) {
    const spares = inv.spares[material] ?? 0;
    if (spares <= getSettings().lowSpareThreshold) {
      items.push({ kind: 'paper', name: `${material} paper`, detail: 'spare rolls', sparesInStock: spares });
    }
  }
  for (const ink of inv.inks) {
    if (ink.sparesInStock <= getSettings().lowSpareThreshold) {
      items.push({
        kind: 'ink', name: `${ink.color} (${ink.model})`,
        detail: 'cartridge', sparesInStock: ink.sparesInStock,
      });
    }
  }
  // Most depleted first.
  return items.sort((a, b) => a.sparesInStock - b.sparesInStock);
}
