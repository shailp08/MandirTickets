/* ===========================================================================
   Inventory persistence — localStorage today, swappable for the SQLite-backed
   API later (the InventoryContext only depends on this module's interface).
   Stores the materialized snapshot plus an append-only event log.
   =========================================================================== */
import { INVENTORY_EVENTS_KEY, INVENTORY_KEY } from '../config';
import { inkCartridges } from '../data/mockData';
import { Inventory, InventoryEvent } from '../types';

/** Seed used on first run (and for the no-storage demo). One roll loaded
 *  (Glossy, nearly empty — for the critical-alert demo), the rest are partial
 *  rolls on the shelf, plus unopened spares per material. */
export function seedInventory(): Inventory {
  return {
    rolls: [
      { id: 'r-glossy-1', material: 'Glossy', fullLengthFt: 100, remainingFt: 6.2, openedAt: '2026-06-05', loaded: true },
      { id: 'r-canvas-1', material: 'Canvas', fullLengthFt: 60, remainingFt: 46.8, openedAt: '2026-06-20', loaded: false },
      { id: 'r-regular-1', material: 'Regular', fullLengthFt: 150, remainingFt: 112.5, openedAt: '2026-06-19', loaded: false },
      { id: 'r-sticky-1', material: 'Sticky', fullLengthFt: 98, remainingFt: 53.9, openedAt: '2026-06-18', loaded: false },
      { id: 'r-outdoor-1', material: 'Outdoor', fullLengthFt: 100, remainingFt: 91.0, openedAt: '2026-06-22', loaded: false },
    ],
    spares: { Canvas: 3, Glossy: 2, Regular: 2, Sticky: 1, Outdoor: 0 },
    inks: inkCartridges.map((i) => ({ ...i })),
  };
}

export function loadInventory(): Inventory {
  try {
    const raw = localStorage.getItem(INVENTORY_KEY);
    if (!raw) return seedInventory();
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.rolls) && parsed.spares && Array.isArray(parsed.inks)) {
      return parsed as Inventory;
    }
  } catch {
    /* fall through to seed */
  }
  return seedInventory();
}

export function saveInventory(inv: Inventory): void {
  try {
    localStorage.setItem(INVENTORY_KEY, JSON.stringify(inv));
  } catch {
    /* storage disabled — non-fatal in demo mode */
  }
}

export function loadEvents(): InventoryEvent[] {
  try {
    const raw = localStorage.getItem(INVENTORY_EVENTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveEvents(events: InventoryEvent[]): void {
  try {
    localStorage.setItem(INVENTORY_EVENTS_KEY, JSON.stringify(events));
  } catch {
    /* non-fatal */
  }
}

/** Best-effort unique id (crypto when available, timestamp fallback). */
export function genId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
