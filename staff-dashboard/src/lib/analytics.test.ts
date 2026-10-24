/**
 * analytics.test.ts — edge-case coverage of event-log summarization and
 * the alert/reorder derivation layer.
 *
 * Key real-world risks:
 *  - Float accumulation across many small consumptions produces wrong totals
 *  - The same jobId consumed twice should count as ONE job (dedup)
 *  - Reprints with 0 ft wasted must not show up as negative or phantom waste
 *  - Reorder list can't list the same material twice
 *  - Alert severity order must be deterministic (critical first)
 *  - An inventory with nothing loaded must not crash derivations
 */
import { Inventory, InventoryEvent } from '../types';
import { buildAnalytics, describeEvent } from './analytics';
import { deriveAlerts, derivePrinterAlerts, deriveReorderList } from './alerts';

/* ---------------------------------------------------------------- helpers -- */

let seq = 0;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ev = (base: any): InventoryEvent =>
  ({ ...base, id: `e${seq++}`, at: `2026-06-24T00:${String(seq).padStart(2, '0')}:00` } as InventoryEvent);

beforeEach(() => { seq = 0; });

const emptyInv = (): Inventory => ({
  rolls: [],
  spares: { Canvas: 5, Glossy: 5, Regular: 5, Sticky: 5, Outdoor: 5 },
  inks: [
    { color: 'Black',   model: 'HP 712', capacityMl: 38, levelPct: 80, replacedAt: '', sparesInStock: 2 },
    { color: 'Cyan',    model: 'HP 712', capacityMl: 29, levelPct: 80, replacedAt: '', sparesInStock: 2 },
    { color: 'Magenta', model: 'HP 712', capacityMl: 29, levelPct: 80, replacedAt: '', sparesInStock: 2 },
    { color: 'Yellow',  model: 'HP 712', capacityMl: 29, levelPct: 80, replacedAt: '', sparesInStock: 2 },
  ],
});

/* =========================================================== buildAnalytics */

describe('buildAnalytics — empty log', () => {
  it('returns all zeros on an empty event log', () => {
    const a = buildAnalytics([]);
    expect(a.totalPaperUsedFt).toBe(0);
    expect(a.rollsLoaded).toBe(0);
    expect(a.paperReceived).toBe(0);
    expect(a.inkReplacements).toBe(0);
    expect(a.jobsPrinted).toBe(0);
    expect(a.reprints).toBe(0);
    expect(a.wastedFt).toBe(0);
    expect(a.paperUsedByMaterial).toEqual([]);
    expect(a.inkReplacementsByColor).toEqual([]);
    expect(a.reprintsByReason).toEqual([]);
  });
});

describe('buildAnalytics — paper consumption', () => {
  it('sums roll_consumed events by material', () => {
    const events: InventoryEvent[] = [
      ev({ type: 'roll_consumed', material: 'Glossy',  rollId: 'r1', ft: 10, jobId: 'j1' }),
      ev({ type: 'roll_consumed', material: 'Glossy',  rollId: 'r1', ft: 5,  jobId: 'j2' }),
      ev({ type: 'roll_consumed', material: 'Canvas',  rollId: 'r2', ft: 6,  jobId: 'j3' }),
    ];
    const a = buildAnalytics(events);
    expect(a.totalPaperUsedFt).toBe(21);
    expect(a.paperUsedByMaterial.find((m) => m.material === 'Glossy')?.ft).toBe(15);
    expect(a.paperUsedByMaterial.find((m) => m.material === 'Canvas')?.ft).toBe(6);
  });

  it('counts distinct jobIds printed', () => {
    const events: InventoryEvent[] = [
      ev({ type: 'roll_consumed', material: 'Glossy', rollId: 'r1', ft: 10, jobId: 'j1' }),
      ev({ type: 'roll_consumed', material: 'Glossy', rollId: 'r1', ft: 5,  jobId: 'j2' }),
    ];
    expect(buildAnalytics(events).jobsPrinted).toBe(2);
  });

  it('EDGE: same jobId consumed twice counts as 1 job (no double-counting)', () => {
    const events: InventoryEvent[] = [
      ev({ type: 'roll_consumed', material: 'Glossy', rollId: 'r1', ft: 10, jobId: 'same' }),
      ev({ type: 'roll_consumed', material: 'Glossy', rollId: 'r1', ft: 5,  jobId: 'same' }),
    ];
    expect(buildAnalytics(events).jobsPrinted).toBe(1);
    expect(buildAnalytics(events).totalPaperUsedFt).toBe(15);
  });

  it('EDGE: roll_consumed without jobId is not counted as a job', () => {
    const events: InventoryEvent[] = [
      ev({ type: 'roll_consumed', material: 'Glossy', rollId: 'r1', ft: 5 }),
    ];
    const a = buildAnalytics(events);
    expect(a.jobsPrinted).toBe(0);
    expect(a.totalPaperUsedFt).toBe(5);
  });

  it('EDGE: float accumulation across 100 × 0.3 ft stays precise (round1 prevents drift)', () => {
    const events: InventoryEvent[] = Array.from({ length: 100 }, (_, i) =>
      ev({ type: 'roll_consumed', material: 'Glossy', rollId: 'r1', ft: 0.3, jobId: `j${i}` }),
    );
    expect(buildAnalytics(events).totalPaperUsedFt).toBe(30);
  });

  it('sorts paperUsedByMaterial by descending footage', () => {
    const events: InventoryEvent[] = [
      ev({ type: 'roll_consumed', material: 'Canvas',  rollId: 'r1', ft: 3 }),
      ev({ type: 'roll_consumed', material: 'Glossy',  rollId: 'r2', ft: 20 }),
      ev({ type: 'roll_consumed', material: 'Regular', rollId: 'r3', ft: 10 }),
    ];
    const sorted = buildAnalytics(events).paperUsedByMaterial;
    expect(sorted[0].material).toBe('Glossy');
    expect(sorted[1].material).toBe('Regular');
    expect(sorted[2].material).toBe('Canvas');
  });
});

describe('buildAnalytics — roll events', () => {
  it('counts roll_loaded events', () => {
    const events: InventoryEvent[] = [
      ev({ type: 'roll_loaded', material: 'Glossy', rollId: 'r1', fullLengthFt: 100, loadWasteFt: 0.75 }),
      ev({ type: 'roll_loaded', material: 'Canvas', rollId: 'r2', fullLengthFt: 60,  loadWasteFt: 0.75 }),
    ];
    expect(buildAnalytics(events).rollsLoaded).toBe(2);
  });

  it('EDGE: roll_switched and roll_depleted do not count toward rollsLoaded', () => {
    const events: InventoryEvent[] = [
      ev({ type: 'roll_switched', material: 'Glossy', rollId: 'r1' }),
      ev({ type: 'roll_depleted', material: 'Glossy', rollId: 'r1' }),
    ];
    expect(buildAnalytics(events).rollsLoaded).toBe(0);
  });
});

describe('buildAnalytics — reprints & waste', () => {
  it('counts reprints and accumulates wastedFt', () => {
    const events: InventoryEvent[] = [
      ev({ type: 'reprint_logged', material: 'Glossy', wastedFt: 3.5, reason: 'Paper jam' }),
      ev({ type: 'reprint_logged', material: 'Glossy', wastedFt: 2.0, reason: 'Color off' }),
    ];
    const a = buildAnalytics(events);
    expect(a.reprints).toBe(2);
    expect(a.wastedFt).toBe(5.5);
  });

  it('includes reprint waste in totalPaperUsedFt and paperUsedByMaterial', () => {
    const events: InventoryEvent[] = [
      ev({ type: 'roll_consumed',  material: 'Glossy', rollId: 'r1', ft: 10, jobId: 'j1' }),
      ev({ type: 'reprint_logged', material: 'Glossy', wastedFt: 3,  reason: 'Low resolution' }),
    ];
    const a = buildAnalytics(events);
    expect(a.totalPaperUsedFt).toBe(13);
    expect(a.paperUsedByMaterial.find((m) => m.material === 'Glossy')?.ft).toBe(13);
  });

  it('groups reprintsByReason sorted by count descending', () => {
    const events: InventoryEvent[] = [
      ev({ type: 'reprint_logged', material: 'Glossy', wastedFt: 1, reason: 'Paper jam' }),
      ev({ type: 'reprint_logged', material: 'Glossy', wastedFt: 1, reason: 'Color off' }),
      ev({ type: 'reprint_logged', material: 'Glossy', wastedFt: 1, reason: 'Paper jam' }),
      ev({ type: 'reprint_logged', material: 'Glossy', wastedFt: 1, reason: 'Paper jam' }),
    ];
    const a = buildAnalytics(events);
    expect(a.reprintsByReason[0]).toEqual({ reason: 'Paper jam', count: 3 });
    expect(a.reprintsByReason[1]).toEqual({ reason: 'Color off', count: 1 });
  });

  it('EDGE: reprint with wastedFt = 0 still increments reprints count', () => {
    const events: InventoryEvent[] = [
      ev({ type: 'reprint_logged', material: 'Glossy', wastedFt: 0, reason: 'Extra copies' }),
    ];
    const a = buildAnalytics(events);
    expect(a.reprints).toBe(1);
    expect(a.wastedFt).toBe(0);
    expect(a.totalPaperUsedFt).toBe(0);
  });

  it('EDGE: 50 zero-waste reprints do not inflate wastedFt', () => {
    const events: InventoryEvent[] = Array.from({ length: 50 }, () =>
      ev({ type: 'reprint_logged', material: 'Canvas', wastedFt: 0, reason: 'Extra copies' }),
    );
    expect(buildAnalytics(events).wastedFt).toBe(0);
  });
});

describe('buildAnalytics — ink', () => {
  it('counts ink replacements and groups by color', () => {
    const events: InventoryEvent[] = [
      ev({ type: 'ink_replaced', color: 'Magenta' }),
      ev({ type: 'ink_replaced', color: 'Magenta' }),
      ev({ type: 'ink_replaced', color: 'Black' }),
    ];
    const a = buildAnalytics(events);
    expect(a.inkReplacements).toBe(3);
    expect(a.inkReplacementsByColor[0]).toEqual({ color: 'Magenta', count: 2 });
    expect(a.inkReplacementsByColor[1]).toEqual({ color: 'Black',   count: 1 });
  });

  it('EDGE: ink_received events do not count as replacements', () => {
    const events: InventoryEvent[] = [
      ev({ type: 'ink_received', color: 'Black', qty: 3 }),
    ];
    expect(buildAnalytics(events).inkReplacements).toBe(0);
  });
});

describe('buildAnalytics — paper_received', () => {
  it('sums received qty across all materials', () => {
    const events: InventoryEvent[] = [
      ev({ type: 'paper_received', material: 'Glossy', qty: 3 }),
      ev({ type: 'paper_received', material: 'Canvas', qty: 2 }),
    ];
    expect(buildAnalytics(events).paperReceived).toBe(5);
  });
});

/* ============================================================== describeEvent */

describe('describeEvent', () => {
  it('covers every event type without throwing', () => {
    const events: InventoryEvent[] = [
      ev({ type: 'roll_loaded',       material: 'Glossy', rollId: 'r1', fullLengthFt: 100, loadWasteFt: 0.75 }),
      ev({ type: 'roll_switched',     material: 'Canvas', rollId: 'r2' }),
      ev({ type: 'roll_consumed',     material: 'Glossy', rollId: 'r1', ft: 5 }),
      ev({ type: 'roll_recalibrated', material: 'Glossy', rollId: 'r1', measuredFt: 42 }),
      ev({ type: 'roll_depleted',     material: 'Glossy', rollId: 'r1' }),
      ev({ type: 'paper_received',    material: 'Canvas', qty: 2 }),
      ev({ type: 'ink_replaced',      color: 'Black' }),
      ev({ type: 'ink_received',      color: 'Cyan', qty: 1 }),
      ev({ type: 'reprint_logged',    material: 'Glossy', wastedFt: 3, reason: 'Paper jam' }),
    ];
    for (const e of events) {
      const d = describeEvent(e);
      expect(typeof d.icon).toBe('string');
      expect(d.icon.length).toBeGreaterThan(0);
      expect(typeof d.text).toBe('string');
      expect(d.text.length).toBeGreaterThan(0);
    }
  });

  it('EDGE: reprint with 0 wasted ft omits footage from description text', () => {
    const d = describeEvent(
      ev({ type: 'reprint_logged', material: 'Canvas', wastedFt: 0, reason: 'Extra copies' }),
    );
    expect(d.text).not.toMatch(/0 ft/);
    expect(d.text).toContain('Extra copies');
  });
});

/* ============================================================== deriveAlerts */

describe('deriveAlerts', () => {
  const alertInv = (): Inventory => ({
    rolls: [
      { id: 'g', material: 'Glossy',  fullLengthFt: 100, remainingFt: 6.2, openedAt: '', loaded: true  },
      { id: 'o', material: 'Outdoor', fullLengthFt: 100, remainingFt: 91,  openedAt: '', loaded: false },
    ],
    spares: { Canvas: 3, Glossy: 2, Regular: 5, Sticky: 5, Outdoor: 0 },
    inks: [
      { color: 'Magenta', model: 'HP 712', capacityMl: 29, levelPct: 18, replacedAt: '', sparesInStock: 2 },
      { color: 'Black',   model: 'HP 712', capacityMl: 38, levelPct: 72, replacedAt: '', sparesInStock: 1 },
    ],
  });

  it('flags the critical loaded roll', () => {
    expect(deriveAlerts(alertInv()).map((a) => a.id)).toContain('roll-Glossy-loaded-crit');
  });
  it('flags out-of-spare-rolls for a material with opened stock left (warning)', () => {
    expect(deriveAlerts(alertInv()).map((a) => a.id)).toContain('roll-Outdoor-nospares');
  });
  it('flags critical ink', () => {
    expect(deriveAlerts(alertInv()).map((a) => a.id)).toContain('ink-Magenta-crit');
  });
  it('flags low-spare ink', () => {
    expect(deriveAlerts(alertInv()).map((a) => a.id)).toContain('ink-Black-spares');
  });
  it('does not alert healthy materials', () => {
    const ids = deriveAlerts(alertInv()).map((a) => a.id);
    expect(ids.some((id) => id.startsWith('roll-Canvas'))).toBe(false);
  });
  it('orders critical before warning', () => {
    expect(deriveAlerts(alertInv())[0].severity).toBe('critical');
  });

  // EDGE
  it('EDGE: no loaded roll → no loaded-roll alert', () => {
    const ids = deriveAlerts(emptyInv()).map((a) => a.id);
    expect(ids.some((id) => id.includes('loaded'))).toBe(false);
  });

  it('EDGE: fully healthy inventory → 0 alerts', () => {
    const healthy: Inventory = {
      rolls: [{ id: 'g', material: 'Glossy', fullLengthFt: 100, remainingFt: 80, openedAt: '', loaded: true }],
      spares: { Canvas: 3, Glossy: 3, Regular: 3, Sticky: 3, Outdoor: 3 },
      inks: [
        { color: 'Black',   model: 'HP 712', capacityMl: 38, levelPct: 80, replacedAt: '', sparesInStock: 3 },
        { color: 'Cyan',    model: 'HP 712', capacityMl: 29, levelPct: 80, replacedAt: '', sparesInStock: 3 },
        { color: 'Magenta', model: 'HP 712', capacityMl: 29, levelPct: 80, replacedAt: '', sparesInStock: 3 },
        { color: 'Yellow',  model: 'HP 712', capacityMl: 29, levelPct: 80, replacedAt: '', sparesInStock: 3 },
      ],
    };
    expect(deriveAlerts(healthy)).toHaveLength(0);
  });

  it('EDGE: material with 0 spares AND 0 opened footage → critical "out" alert', () => {
    const inv: Inventory = {
      rolls: [],
      spares: { Canvas: 0, Glossy: 3, Regular: 3, Sticky: 3, Outdoor: 3 },
      inks: [],
    };
    const canvasAlert = deriveAlerts(inv).find((a) => a.id === 'roll-Canvas-out');
    expect(canvasAlert).toBeDefined();
    expect(canvasAlert?.severity).toBe('critical');
  });

  it('EDGE: no duplicate alert ids in output', () => {
    const alerts = deriveAlerts(alertInv());
    const ids = alerts.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('EDGE: loaded roll at exactly 10% (critical boundary) → critical', () => {
    const inv: Inventory = {
      rolls: [{ id: 'g', material: 'Glossy', fullLengthFt: 100, remainingFt: 10, openedAt: '', loaded: true }],
      spares: { Canvas: 1, Glossy: 1, Regular: 1, Sticky: 1, Outdoor: 1 },
      inks: [],
    };
    expect(deriveAlerts(inv).find((a) => a.id === 'roll-Glossy-loaded-crit')).toBeDefined();
  });

  it('EDGE: loaded roll at 11% → warning not critical', () => {
    const inv: Inventory = {
      rolls: [{ id: 'g', material: 'Glossy', fullLengthFt: 100, remainingFt: 11, openedAt: '', loaded: true }],
      spares: { Canvas: 1, Glossy: 1, Regular: 1, Sticky: 1, Outdoor: 1 },
      inks: [],
    };
    const alerts = deriveAlerts(inv);
    expect(alerts.find((a) => a.id === 'roll-Glossy-loaded-crit')).toBeUndefined();
    expect(alerts.find((a) => a.id === 'roll-Glossy-loaded-low')).toBeDefined();
  });
});

/* ======================================================= derivePrinterAlerts */

describe('derivePrinterAlerts', () => {
  it('maps jam/cover-open/offline to critical', () => {
    const alerts = derivePrinterAlerts(['Paper jam', 'Cover open', 'Offline']);
    expect(alerts.every((a) => a.severity === 'critical')).toBe(true);
  });

  it('maps advisory errors to warning', () => {
    const alerts = derivePrinterAlerts(['Low paper', 'Output near full']);
    expect(alerts.every((a) => a.severity === 'warning')).toBe(true);
  });

  it('EDGE: empty error list → no alerts', () => {
    expect(derivePrinterAlerts([])).toHaveLength(0);
  });

  it('EDGE: each error produces a unique id', () => {
    const alerts = derivePrinterAlerts(['Paper jam', 'Cover open', 'Out of ink']);
    const ids = alerts.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('EDGE: unknown error string falls back to warning (not critical)', () => {
    const alerts = derivePrinterAlerts(['Some new firmware error XYZ']);
    expect(alerts[0].severity).toBe('warning');
  });

  it('EDGE: duplicate error strings produce duplicate entries (SNMP can report duplicates)', () => {
    const alerts = derivePrinterAlerts(['Paper jam', 'Paper jam']);
    expect(alerts).toHaveLength(2);
  });
});

/* ========================================================= deriveReorderList */

describe('deriveReorderList', () => {
  it('lists materials and inks with low spares, sorted by most depleted first', () => {
    const inv: Inventory = {
      rolls: [],
      spares: { Canvas: 5, Glossy: 5, Regular: 5, Sticky: 5, Outdoor: 0 },
      inks: [
        { color: 'Black', model: 'HP 712', capacityMl: 38, levelPct: 72, replacedAt: '', sparesInStock: 1 },
        { color: 'Cyan',  model: 'HP 712', capacityMl: 29, levelPct: 80, replacedAt: '', sparesInStock: 3 },
      ],
    };
    const list = deriveReorderList(inv);
    expect(list[0].sparesInStock).toBe(0);
    expect(list[0].kind).toBe('paper');
    expect(list[1].sparesInStock).toBe(1);
    expect(list[1].kind).toBe('ink');
  });

  it('EDGE: no low-spare items → empty list', () => {
    const inv: Inventory = {
      rolls: [],
      spares: { Canvas: 5, Glossy: 5, Regular: 5, Sticky: 5, Outdoor: 5 },
      inks: [{ color: 'Black', model: 'HP 712', capacityMl: 38, levelPct: 80, replacedAt: '', sparesInStock: 5 }],
    };
    expect(deriveReorderList(inv)).toHaveLength(0);
  });

  it('EDGE: no duplicate material names in output', () => {
    const inv: Inventory = {
      rolls: [],
      spares: { Canvas: 0, Glossy: 0, Regular: 0, Sticky: 0, Outdoor: 0 },
      inks: [],
    };
    const names = deriveReorderList(inv).filter((i) => i.kind === 'paper').map((i) => i.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('EDGE: all materials and inks at 0 spares → all listed', () => {
    const inv: Inventory = {
      rolls: [],
      spares: { Canvas: 0, Glossy: 0, Regular: 0, Sticky: 0, Outdoor: 0 },
      inks: [
        { color: 'Black',   model: 'HP 712', capacityMl: 38, levelPct: 5, replacedAt: '', sparesInStock: 0 },
        { color: 'Cyan',    model: 'HP 712', capacityMl: 29, levelPct: 5, replacedAt: '', sparesInStock: 0 },
        { color: 'Magenta', model: 'HP 712', capacityMl: 29, levelPct: 5, replacedAt: '', sparesInStock: 0 },
        { color: 'Yellow',  model: 'HP 712', capacityMl: 29, levelPct: 5, replacedAt: '', sparesInStock: 0 },
      ],
    };
    // 5 materials + 4 inks = 9 items
    expect(deriveReorderList(inv)).toHaveLength(9);
    expect(deriveReorderList(inv).every((i) => i.sparesInStock === 0)).toBe(true);
  });
});
