import {
  createContext, useCallback, useContext, useMemo, useRef, useState,
} from 'react';
import { ROLL_LENGTH_FT } from '../config';
import { getSettings } from '../lib/settings';
import {
  consumeLoaded, discardRoll, loadedRoll, openNewRoll, receiveInk, receivePaper,
  recalibrate as recalibrateRoll, replaceInk, switchRoll,
} from '../lib/inventory';
import {
  genId, loadEvents, loadInventory, saveEvents, saveInventory,
} from '../services/inventoryStore';
import {
  InkColor, Inventory, InventoryEvent, Material,
} from '../types';

type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;
type NewEvent = DistributiveOmit<InventoryEvent, 'id' | 'at'>;

interface InventoryActions {
  /** Open a fresh spare roll and mount it. */
  loadNewRoll: (material: Material, fullLengthFt?: number) => void;
  /** Mount an existing shelf roll. */
  switchToRoll: (rollId: string) => void;
  recalibrate: (rollId: string, measuredFt: number) => void;
  receivePaperStock: (material: Material, qty: number) => void;
  discardRoll: (rollId: string) => void;
  /** Deduct printed feet from the loaded roll (job material assumed loaded). */
  consumeForJob: (material: Material, ft: number, jobId?: string) => void;
  replaceCartridge: (color: InkColor) => void;
  addInkSpare: (color: InkColor, qty?: number) => void;
  logReprint: (material: Material, wastedFt: number, reason: string, jobId?: string) => void;
}

interface InventoryContextValue extends InventoryActions {
  inventory: Inventory;
  events: InventoryEvent[];
}

const InventoryContext = createContext<InventoryContextValue | null>(null);

export function InventoryProvider({ children }: { children: React.ReactNode }) {
  const [inventory, setInventory] = useState<Inventory>(() => loadInventory());
  const [events, setEvents] = useState<InventoryEvent[]>(() => loadEvents());
  const invRef = useRef(inventory);
  invRef.current = inventory;
  const eventsRef = useRef(events);
  eventsRef.current = events;

  const append = useCallback((e: NewEvent) => {
    const full = { ...e, id: genId(), at: new Date().toISOString() } as InventoryEvent;
    const next = [...eventsRef.current, full];
    setEvents(next);
    saveEvents(next);
  }, []);

  /** Apply an inventory reducer, persist, and optionally log an event. */
  const apply = useCallback((fn: (inv: Inventory) => Inventory, event?: NewEvent) => {
    setInventory((prev) => {
      const next = fn(prev);
      saveInventory(next);
      return next;
    });
    if (event) append(event);
  }, [append]);

  const actions: InventoryActions = useMemo(() => ({
    loadNewRoll: (material, fullLengthFt = ROLL_LENGTH_FT[material] ?? 100) => {
      const rollId = genId();
      apply(
        (inv) => openNewRoll(inv, material, fullLengthFt, getSettings().loadWasteFt, rollId),
        { type: 'roll_loaded', material, rollId, fullLengthFt, loadWasteFt: getSettings().loadWasteFt },
      );
    },
    switchToRoll: (rollId) => {
      const roll = invRef.current.rolls.find((r) => r.id === rollId);
      apply(
        (inv) => switchRoll(inv, rollId, getSettings().loadWasteFt),
        roll ? { type: 'roll_switched', material: roll.material, rollId } : undefined,
      );
    },
    recalibrate: (rollId, measuredFt) => {
      const roll = invRef.current.rolls.find((r) => r.id === rollId);
      apply(
        (inv) => recalibrateRoll(inv, rollId, measuredFt),
        roll ? { type: 'roll_recalibrated', material: roll.material, rollId, measuredFt } : undefined,
      );
    },
    receivePaperStock: (material, qty) => {
      apply((inv) => receivePaper(inv, material, qty), { type: 'paper_received', material, qty });
    },
    discardRoll: (rollId) => {
      const roll = invRef.current.rolls.find((r) => r.id === rollId);
      apply(
        (inv) => discardRoll(inv, rollId),
        roll ? { type: 'roll_depleted', material: roll.material, rollId } : undefined,
      );
    },
    consumeForJob: (material, ft, jobId) => {
      const loaded = loadedRoll(invRef.current);
      apply(
        (inv) => consumeLoaded(inv, ft),
        loaded ? { type: 'roll_consumed', material: loaded.material, rollId: loaded.id, ft, jobId } : undefined,
      );
    },
    replaceCartridge: (color) => {
      apply((inv) => ({ ...inv, inks: inv.inks.map((i) => (i.color === color ? replaceInk(i) : i)) }), { type: 'ink_replaced', color });
    },
    addInkSpare: (color, qty = 1) => {
      apply((inv) => ({ ...inv, inks: inv.inks.map((i) => (i.color === color ? receiveInk(i, qty) : i)) }), { type: 'ink_received', color, qty });
    },
    logReprint: (material, wastedFt, reason, jobId) => {
      // Wasted paper comes off the loaded roll; the event records why.
      apply((inv) => consumeLoaded(inv, wastedFt), { type: 'reprint_logged', material, wastedFt, reason, jobId });
    },
  }), [apply]);

  return (
    <InventoryContext.Provider value={{ inventory, events, ...actions }}>
      {children}
    </InventoryContext.Provider>
  );
}

export function useInventory(): InventoryContextValue {
  const ctx = useContext(InventoryContext);
  if (!ctx) throw new Error('useInventory must be used within an InventoryProvider');
  return ctx;
}
