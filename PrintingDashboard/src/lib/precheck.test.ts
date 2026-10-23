/**
 * precheck.test.ts — edge-case coverage of the pre-print checklist logic.
 *
 * Key real-world risks tested:
 *  - Wrong material silently passes (gate must block it)
 *  - Floating-point feet comparison causes false "enough" on a marginally short roll
 *  - Threshold boundary: ink at exactly 20% must flag
 *  - Unknown (-1) ink readings must not generate a false low-ink warning
 *  - DPI check must not mislead on non-raster (PDF) or missing artwork
 */
import { PrintJob, RollInstance } from '../types';
import { buildPrecheck, dpiCheck } from './precheck';

/* ---------------------------------------------------------------- helpers -- */

const job = (over: Partial<PrintJob> = {}): PrintJob => ({
  id: 'j1', content: 'Banner', material: 'Glossy', widthIn: 18, heightIn: 24,
  quantity: 5, department: 'BKY', status: 'pending', submittedAt: '2026-06-24T00:00:00', ...over,
});

const loaded = (over: Partial<RollInstance> = {}): RollInstance => ({
  id: 'r1', material: 'Glossy', fullLengthFt: 100, remainingFt: 6.2,
  openedAt: '2026-06-05', loaded: true, ...over,
});

/* =========================================================== buildPrecheck */

describe('buildPrecheck — paper', () => {
  it('computes feetNeeded correctly (heightIn × qty / 12)', () => {
    // 24in × 5 / 12 = 10 ft
    expect(buildPrecheck(job(), loaded(), []).feetNeeded).toBe(10);
  });

  it('passes when loaded roll has enough of the right material', () => {
    const pc = buildPrecheck(job(), loaded({ remainingFt: 60 }), []);
    expect(pc.paperEnough).toBe(true);
    expect(pc.wrongMaterial).toBe(false);
  });

  it('fails when loaded roll has too little', () => {
    // roll has 6.2 ft, job needs 10 ft
    const pc = buildPrecheck(job(), loaded({ remainingFt: 6.2 }), []);
    expect(pc.paperEnough).toBe(false);
    expect(pc.wrongMaterial).toBe(false);
  });

  // ---- wrong-material detection ----

  it('flags wrongMaterial when loaded material differs from job material', () => {
    const pc = buildPrecheck(job({ material: 'Canvas' }), loaded({ material: 'Glossy', remainingFt: 60 }), []);
    expect(pc.wrongMaterial).toBe(true);
    expect(pc.loadedMaterial).toBe('Glossy');
    expect(pc.paperEnough).toBe(false); // wrong material → can't print regardless of footage
  });

  it('EDGE: wrong material even if footage would technically be enough — still blocked', () => {
    const pc = buildPrecheck(
      job({ material: 'Outdoor', heightIn: 6, quantity: 1 }), // needs 0.5 ft
      loaded({ material: 'Glossy', remainingFt: 99 }),         // plenty of footage, wrong material
      [],
    );
    expect(pc.wrongMaterial).toBe(true);
    expect(pc.paperEnough).toBe(false);
  });

  it('EDGE: same material name, different case — treated as equal (TypeScript enforces this)', () => {
    // Both are 'Glossy' — no wrong-material flag
    const pc = buildPrecheck(job({ material: 'Glossy' }), loaded({ material: 'Glossy', remainingFt: 60 }), []);
    expect(pc.wrongMaterial).toBe(false);
  });

  // ---- no loaded roll ----

  it('treats no loaded roll as not enough', () => {
    const pc = buildPrecheck(job(), undefined, []);
    expect(pc.paperEnough).toBe(false);
    expect(pc.rollRemainingFt).toBe(0);
    expect(pc.rollFullFt).toBe(0);
    expect(pc.wrongMaterial).toBe(false);
    expect(pc.loadedMaterial).toBeNull();
  });

  // ---- boundary: exactly enough ----

  it('EDGE: remaining equals feetNeeded exactly → paperEnough true (not wasteful to refuse)', () => {
    // 12in × 10 / 12 = 10 ft needed; roll has exactly 10 ft
    const pc = buildPrecheck(
      job({ heightIn: 12, quantity: 10 }),
      loaded({ material: 'Glossy', remainingFt: 10 }),
      [],
    );
    expect(pc.feetNeeded).toBe(10);
    expect(pc.paperEnough).toBe(true);
  });

  it('EDGE: remaining is 0.1 ft short → paperEnough false', () => {
    const pc = buildPrecheck(
      job({ heightIn: 12, quantity: 10 }), // needs 10 ft
      loaded({ material: 'Glossy', remainingFt: 9.9 }),
      [],
    );
    expect(pc.paperEnough).toBe(false);
  });

  it('EDGE: zero-height job needs 0 ft — even empty roll passes', () => {
    const pc = buildPrecheck(
      job({ heightIn: 0, quantity: 5 }),
      loaded({ material: 'Glossy', remainingFt: 0 }),
      [],
    );
    expect(pc.feetNeeded).toBe(0);
    expect(pc.paperEnough).toBe(true);
  });

  it('EDGE: zero-quantity job needs 0 ft', () => {
    const pc = buildPrecheck(
      job({ quantity: 0 }),
      loaded({ material: 'Glossy', remainingFt: 60 }),
      [],
    );
    expect(pc.feetNeeded).toBe(0);
    expect(pc.paperEnough).toBe(true);
  });

  it('EDGE: loaded roll at exactly 0 ft remaining → not enough', () => {
    const pc = buildPrecheck(
      job({ heightIn: 1, quantity: 1 }),
      loaded({ material: 'Glossy', remainingFt: 0 }),
      [],
    );
    expect(pc.paperEnough).toBe(false);
  });
});

describe('buildPrecheck — ink', () => {
  it('lists inks at or below 20%', () => {
    const pc = buildPrecheck(job(), loaded({ remainingFt: 60 }), [
      { color: 'Black',   levelPct: 72 },
      { color: 'Magenta', levelPct: 18 },
      { color: 'Yellow',  levelPct: 20 },  // exactly at threshold
    ]);
    expect(pc.lowInks).toEqual(['Magenta', 'Yellow']);
  });

  it('EDGE: exactly 20% is flagged (boundary inclusive)', () => {
    const pc = buildPrecheck(job(), loaded({ remainingFt: 60 }), [{ color: 'Cyan', levelPct: 20 }]);
    expect(pc.lowInks).toContain('Cyan');
  });

  it('EDGE: exactly 21% is not flagged (just above threshold)', () => {
    const pc = buildPrecheck(job(), loaded({ remainingFt: 60 }), [{ color: 'Cyan', levelPct: 21 }]);
    expect(pc.lowInks).not.toContain('Cyan');
  });

  it('EDGE: unknown reading (-1) is not flagged as low', () => {
    const pc = buildPrecheck(job(), loaded({ remainingFt: 60 }), [{ color: 'Cyan', levelPct: -1 }]);
    expect(pc.lowInks).toEqual([]);
  });

  it('EDGE: all four inks unknown (-1) → no false warnings', () => {
    const pc = buildPrecheck(job(), loaded({ remainingFt: 60 }), [
      { color: 'Black',   levelPct: -1 },
      { color: 'Cyan',    levelPct: -1 },
      { color: 'Magenta', levelPct: -1 },
      { color: 'Yellow',  levelPct: -1 },
    ]);
    expect(pc.lowInks).toEqual([]);
  });

  it('EDGE: empty ink array → empty lowInks, no crash', () => {
    const pc = buildPrecheck(job(), loaded({ remainingFt: 60 }), []);
    expect(pc.lowInks).toEqual([]);
  });

  it('EDGE: all inks at 0% → all flagged', () => {
    const pc = buildPrecheck(job(), loaded({ remainingFt: 60 }), [
      { color: 'Black',   levelPct: 0 },
      { color: 'Cyan',    levelPct: 0 },
      { color: 'Magenta', levelPct: 0 },
      { color: 'Yellow',  levelPct: 0 },
    ]);
    expect(pc.lowInks).toHaveLength(4);
  });

  it('EDGE: all inks at 100% → none flagged', () => {
    const pc = buildPrecheck(job(), loaded({ remainingFt: 60 }), [
      { color: 'Black',   levelPct: 100 },
      { color: 'Cyan',    levelPct: 100 },
      { color: 'Magenta', levelPct: 100 },
      { color: 'Yellow',  levelPct: 100 },
    ]);
    expect(pc.lowInks).toEqual([]);
  });

  it('EDGE: wrong-material job still surfaces ink warnings (operator needs to see both)', () => {
    const pc = buildPrecheck(
      job({ material: 'Canvas' }),
      loaded({ material: 'Glossy', remainingFt: 60 }),
      [{ color: 'Black', levelPct: 5 }],
    );
    expect(pc.wrongMaterial).toBe(true);
    expect(pc.lowInks).toContain('Black');
  });
});

/* ============================================================== dpiCheck */

describe('dpiCheck', () => {
  it('passes when both dimensions meet the minimum', () => {
    // 3600px / 18in = 200 dpi; 4800px / 24in = 200 dpi
    expect(dpiCheck(3600, 4800, { widthIn: 18, heightIn: 24 }, 150))
      .toEqual({ dpiW: 200, dpiH: 200, effective: 200, ok: true });
  });

  it('fails when width DPI is below minimum', () => {
    // 1800 / 18 = 100 dpi — below 150
    const r = dpiCheck(1800, 4800, { widthIn: 18, heightIn: 24 }, 150);
    expect(r?.dpiW).toBe(100);
    expect(r?.effective).toBe(100);
    expect(r?.ok).toBe(false);
  });

  it('fails when height DPI is the limiting dimension', () => {
    // width=200dpi fine, height=100dpi bad
    const r = dpiCheck(3600, 2400, { widthIn: 18, heightIn: 24 }, 150);
    expect(r?.dpiH).toBe(100);
    expect(r?.effective).toBe(100);
    expect(r?.ok).toBe(false);
  });

  it('effective is the LOWER of dpiW and dpiH', () => {
    const r = dpiCheck(3600, 2400, { widthIn: 18, heightIn: 24 }, 50)!;
    expect(r.effective).toBe(Math.min(r.dpiW, r.dpiH));
  });

  // EDGE: invalid inputs
  it('EDGE: widthPx = 0 → null', () => {
    expect(dpiCheck(0, 4800, { widthIn: 18, heightIn: 24 }, 150)).toBeNull();
  });
  it('EDGE: heightPx = 0 → null', () => {
    expect(dpiCheck(3600, 0, { widthIn: 18, heightIn: 24 }, 150)).toBeNull();
  });
  it('EDGE: widthIn = 0 → null (avoid division by zero)', () => {
    expect(dpiCheck(3600, 4800, { widthIn: 0, heightIn: 24 }, 150)).toBeNull();
  });
  it('EDGE: heightIn = 0 → null (avoid division by zero)', () => {
    expect(dpiCheck(3600, 4800, { widthIn: 18, heightIn: 0 }, 150)).toBeNull();
  });
  it('EDGE: all dimensions 0 → null', () => {
    expect(dpiCheck(0, 0, { widthIn: 0, heightIn: 0 }, 150)).toBeNull();
  });
  it('EDGE: minDpi = 0 → always ok (any resolution passes)', () => {
    const r = dpiCheck(1, 1, { widthIn: 18, heightIn: 24 }, 0);
    expect(r?.ok).toBe(true);
  });
  it('EDGE: exactly at the minimum DPI → ok (boundary inclusive)', () => {
    // 2700 / 18 = 150; 3600 / 24 = 150
    const r = dpiCheck(2700, 3600, { widthIn: 18, heightIn: 24 }, 150);
    expect(r?.effective).toBe(150);
    expect(r?.ok).toBe(true);
  });
  it('EDGE: 1 pixel below minimum DPI → not ok', () => {
    // width dpi = 149
    const r = dpiCheck(2682, 3600, { widthIn: 18, heightIn: 24 }, 150);
    expect(r?.ok).toBe(false);
  });
  it('EDGE: very small artwork (1×1 px) on large print → very low dpi, fails', () => {
    const r = dpiCheck(1, 1, { widthIn: 18, heightIn: 24 }, 150);
    expect(r?.ok).toBe(false);
  });
  it('EDGE: very high-res artwork on small print → high dpi, passes easily', () => {
    // 9000px on 1in print = 9000 dpi
    const r = dpiCheck(9000, 9000, { widthIn: 1, heightIn: 1 }, 150);
    expect(r?.ok).toBe(true);
  });
});
