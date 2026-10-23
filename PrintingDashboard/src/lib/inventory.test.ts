/**
 * inventory.test.ts — exhaustive edge-case coverage of every pure inventory op.
 *
 * Guiding principle: if a bad value can silently corrupt the remaining-footage
 * number, a test must catch it. Each describe block ends with a section of
 * edge / adversarial cases clearly marked with "EDGE:".
 */
import { InkCartridge, Inventory, RollInstance } from '../types';
import { feetNeeded, inkState, rollCanFulfill, rollPct, rollState } from './calc';
import {
  consumeLoaded, discardRoll, loadedRoll, materialAvailableFt, openNewRoll,
  receiveInk, receivePaper, recalibrate, replaceInk, rollsOfMaterial, switchRoll,
} from './inventory';

/* ---------------------------------------------------------------- helpers -- */

const roll = (over: Partial<RollInstance> & { id: string }): RollInstance => ({
  material: 'Glossy', fullLengthFt: 100, remainingFt: 100,
  openedAt: '2026-06-01', loaded: false, ...over,
});

const inv = (over: Partial<Inventory> = {}): Inventory => ({
  rolls: [roll({ id: 'gl', remainingFt: 60, loaded: true })],
  spares: { Canvas: 0, Glossy: 2, Regular: 0, Sticky: 0, Outdoor: 0 },
  inks: [],
  ...over,
});

const ink = (over: Partial<InkCartridge> = {}): InkCartridge => ({
  color: 'Magenta', model: 'HP 712', capacityMl: 29,
  levelPct: 50, replacedAt: '2026-06-01', sparesInStock: 2, ...over,
});

/* ============================================================== feetNeeded */

describe('feetNeeded', () => {
  it('uses the largest dimension × qty / 12 rounded to 1 decimal', () => {
    // heightIn is larger — 36 × 2 / 12 = 6
    expect(feetNeeded({ widthIn: 24, heightIn: 36, quantity: 2 })).toBe(6);
    // widthIn is larger — 60 × 1 / 12 = 5
    expect(feetNeeded({ widthIn: 60, heightIn: 24, quantity: 1 })).toBe(5);
    expect(feetNeeded({ widthIn: 20, heightIn: 40, quantity: 2 })).toBe(6.7);  // 6.666…
  });
  it('single copy', () => {
    expect(feetNeeded({ widthIn: 6, heightIn: 12, quantity: 1 })).toBe(1);
  });
  // EDGE
  it('EDGE: zero height → uses width', () => {
    expect(feetNeeded({ widthIn: 0, heightIn: 0, quantity: 5 })).toBe(0);
  });
  it('EDGE: zero quantity → 0 ft', () => {
    expect(feetNeeded({ widthIn: 12, heightIn: 24, quantity: 0 })).toBe(0);
  });
  it('EDGE: very large job (10 × 24ft banners)', () => {
    expect(feetNeeded({ widthIn: 24, heightIn: 288, quantity: 10 })).toBe(240);
  });
  it('EDGE: fractional inches round correctly', () => {
    // 13in × 3 = 39in = 3.25ft → 3.3
    expect(feetNeeded({ widthIn: 8, heightIn: 13, quantity: 3 })).toBe(3.3);
  });
});

/* ============================================================== openNewRoll */

describe('openNewRoll', () => {
  it('mounts the new roll and shelves the previous one', () => {
    const next = openNewRoll(inv(), 'Glossy', 100, 0.75, 'new-1', '2026-06-24');
    expect(loadedRoll(next)!.id).toBe('new-1');
    expect(next.rolls.filter((r) => r.loaded)).toHaveLength(1);
  });
  it('deducts load-waste from the fresh roll', () => {
    const next = openNewRoll(inv(), 'Glossy', 100, 0.75, 'n');
    expect(loadedRoll(next)!.remainingFt).toBe(99.3);
  });
  it('draws one spare', () => {
    expect(openNewRoll(inv(), 'Glossy', 100, 0.75, 'n').spares.Glossy).toBe(1);
  });
  it('does not affect spares of other materials', () => {
    const next = openNewRoll(inv(), 'Glossy', 100, 0.75, 'n');
    expect(next.spares.Canvas).toBe(0);
  });
  it('works when nothing is currently loaded', () => {
    const empty = inv({ rolls: [] });
    const next = openNewRoll(empty, 'Glossy', 100, 0.75, 'n');
    expect(loadedRoll(next)!.id).toBe('n');
  });
  // EDGE
  it('EDGE: load-waste larger than the roll → remaining floors at 0', () => {
    const next = openNewRoll(inv(), 'Glossy', 2, 5, 'n');
    expect(loadedRoll(next)!.remainingFt).toBe(0);
  });
  it('EDGE: zero load-waste → no trim at all', () => {
    const next = openNewRoll(inv(), 'Glossy', 60, 0, 'n');
    expect(loadedRoll(next)!.remainingFt).toBe(60);
  });
  it('EDGE: spare count floors at 0 even if already 0 (no negative spares)', () => {
    const noSpares = inv({ spares: { Canvas: 0, Glossy: 0, Regular: 0, Sticky: 0, Outdoor: 0 } });
    const next = openNewRoll(noSpares, 'Glossy', 100, 0.75, 'n');
    expect(next.spares.Glossy).toBe(0);
  });
  it('EDGE: two rolls were somehow both loaded — both shelved, new one mounts', () => {
    const doubled = inv({
      rolls: [
        roll({ id: 'a', loaded: true }),
        roll({ id: 'b', loaded: true }),
      ],
    });
    const next = openNewRoll(doubled, 'Glossy', 100, 0.75, 'new');
    expect(next.rolls.filter((r) => r.loaded)).toHaveLength(1);
    expect(loadedRoll(next)!.id).toBe('new');
  });
  it('EDGE: preserves all existing shelf rolls', () => {
    const many = inv({
      rolls: [
        roll({ id: 'a', remainingFt: 40, loaded: true }),
        roll({ id: 'b', remainingFt: 20, loaded: false }),
        roll({ id: 'c', material: 'Canvas', remainingFt: 30, loaded: false }),
      ],
    });
    const next = openNewRoll(many, 'Glossy', 100, 0.75, 'new');
    expect(next.rolls).toHaveLength(4);
  });
});

/* =============================================================== switchRoll */

describe('switchRoll', () => {
  const twoRolls = inv({
    rolls: [
      roll({ id: 'a', remainingFt: 60, loaded: true }),
      roll({ id: 'b', remainingFt: 30, loaded: false }),
    ],
  });

  it('mounts the target and unloads the current', () => {
    const next = switchRoll(twoRolls, 'b', 0.75);
    expect(loadedRoll(next)!.id).toBe('b');
    expect(next.rolls.find((r) => r.id === 'a')!.loaded).toBe(false);
  });
  it('deducts load-waste trim from the target', () => {
    const next = switchRoll(twoRolls, 'b', 0.75);
    expect(loadedRoll(next)!.remainingFt).toBe(29.3);
  });
  it('does not change spares', () => {
    const next = switchRoll(twoRolls, 'b', 0.75);
    expect(next.spares).toEqual(twoRolls.spares);
  });
  // EDGE
  it('EDGE: unknown rollId → returns inventory unchanged (no silent unload)', () => {
    const next = switchRoll(twoRolls, 'does-not-exist', 0.75);
    expect(next).toBe(twoRolls);          // same reference — truly unchanged
    expect(loadedRoll(next)!.id).toBe('a');
  });
  it('EDGE: switching to the already-loaded roll trims and stays loaded', () => {
    // Operator physically removed and reinserted the same roll — skew trim fires.
    const next = switchRoll(twoRolls, 'a', 0.75);
    expect(loadedRoll(next)!.id).toBe('a');
    expect(loadedRoll(next)!.remainingFt).toBe(59.3);
  });
  it('EDGE: negative loadWaste treated as 0 — no trim', () => {
    const next = switchRoll(twoRolls, 'b', -5);
    expect(loadedRoll(next)!.remainingFt).toBe(30);
  });
  it('EDGE: loadWaste > remaining → remaining floors at 0, no negative footage', () => {
    const tiny = inv({
      rolls: [
        roll({ id: 'x', remainingFt: 60, loaded: true }),
        roll({ id: 'y', remainingFt: 0.5, loaded: false }),
      ],
    });
    const next = switchRoll(tiny, 'y', 2);
    expect(loadedRoll(next)!.remainingFt).toBe(0);
  });
  it('EDGE: exactly one loaded roll at all times even with many shelf rolls', () => {
    const many = inv({
      rolls: [
        roll({ id: 'a', loaded: true }),
        roll({ id: 'b', loaded: false }),
        roll({ id: 'c', loaded: false }),
        roll({ id: 'd', loaded: false }),
      ],
    });
    const next = switchRoll(many, 'd', 0.75);
    expect(next.rolls.filter((r) => r.loaded)).toHaveLength(1);
    expect(loadedRoll(next)!.id).toBe('d');
  });
  it('EDGE: empty rolls array with any id → returns same inventory', () => {
    const empty = inv({ rolls: [] });
    const next = switchRoll(empty, 'ghost', 0.75);
    expect(next).toBe(empty);
  });
});

/* ============================================================ consumeLoaded */

describe('consumeLoaded', () => {
  it('deducts printed feet from the loaded roll only', () => {
    const next = consumeLoaded(inv(), 10);
    expect(loadedRoll(next)!.remainingFt).toBe(50);
  });
  it('does not touch shelf rolls', () => {
    const two = inv({
      rolls: [
        roll({ id: 'loaded', remainingFt: 60, loaded: true }),
        roll({ id: 'shelf',  remainingFt: 40, loaded: false }),
      ],
    });
    const next = consumeLoaded(two, 10);
    expect(next.rolls.find((r) => r.id === 'shelf')!.remainingFt).toBe(40);
  });
  // EDGE
  it('EDGE: consuming more than remaining → floors at 0, never negative', () => {
    const next = consumeLoaded(inv({ rolls: [roll({ id: 'x', remainingFt: 3, loaded: true })] }), 100);
    expect(loadedRoll(next)!.remainingFt).toBe(0);
  });
  it('EDGE: consuming exactly the remaining → 0 (not -0 or epsilon)', () => {
    const next = consumeLoaded(inv({ rolls: [roll({ id: 'x', remainingFt: 10, loaded: true })] }), 10);
    expect(loadedRoll(next)!.remainingFt).toBe(0);
    expect(Object.is(loadedRoll(next)!.remainingFt, -0)).toBe(false);
  });
  it('EDGE: zero ft → inventory returned unchanged (same reference)', () => {
    const i = inv();
    const next = consumeLoaded(i, 0);
    expect(next).toBe(i);
  });
  it('EDGE: negative ft → no-op (cannot inflate footage)', () => {
    const i = inv();
    const next = consumeLoaded(i, -10);
    expect(next).toBe(i);
    expect(loadedRoll(next)!.remainingFt).toBe(60);
  });
  it('EDGE: NaN ft → no-op', () => {
    const i = inv();
    expect(consumeLoaded(i, NaN)).toBe(i);
  });
  it('EDGE: Infinity ft → no-op (not treated as "consume everything")', () => {
    const i = inv();
    expect(consumeLoaded(i, Infinity)).toBe(i);
  });
  it('EDGE: no loaded roll → all rolls untouched', () => {
    const noLoad = inv({ rolls: [roll({ id: 'x', remainingFt: 50, loaded: false })] });
    const next = consumeLoaded(noLoad, 10);
    expect(next.rolls[0].remainingFt).toBe(50);
  });
  it('EDGE: float precision — 10 × 0.1 ft prints do not accumulate error', () => {
    let i = inv({ rolls: [roll({ id: 'x', remainingFt: 10, loaded: true })] });
    for (let n = 0; n < 10; n++) i = consumeLoaded(i, 0.1);
    // Without round1() this would be 9.000000000000002 after first deduction
    expect(loadedRoll(i)!.remainingFt).toBe(9);
  });
});

/* ============================================================== recalibrate */

describe('recalibrate', () => {
  it('sets the measured value', () => {
    const i = inv({ rolls: [roll({ id: 'x', fullLengthFt: 100, remainingFt: 20, loaded: true })] });
    expect(recalibrate(i, 'x', 42).rolls[0].remainingFt).toBe(42);
  });
  it('clamps above fullLengthFt to fullLengthFt', () => {
    const i = inv({ rolls: [roll({ id: 'x', fullLengthFt: 100, remainingFt: 20, loaded: true })] });
    expect(recalibrate(i, 'x', 250).rolls[0].remainingFt).toBe(100);
  });
  it('clamps below 0 to 0', () => {
    const i = inv({ rolls: [roll({ id: 'x', fullLengthFt: 100, remainingFt: 20, loaded: true })] });
    expect(recalibrate(i, 'x', -5).rolls[0].remainingFt).toBe(0);
  });
  // EDGE
  it('EDGE: unknown rollId → all rolls unchanged', () => {
    const i = inv();
    const next = recalibrate(i, 'ghost', 50);
    expect(next.rolls[0].remainingFt).toBe(60);
  });
  it('EDGE: measuring exactly 0', () => {
    const i = inv({ rolls: [roll({ id: 'x', fullLengthFt: 100, remainingFt: 50, loaded: true })] });
    expect(recalibrate(i, 'x', 0).rolls[0].remainingFt).toBe(0);
  });
  it('EDGE: measuring exactly fullLengthFt', () => {
    const i = inv({ rolls: [roll({ id: 'x', fullLengthFt: 100, remainingFt: 50, loaded: true })] });
    expect(recalibrate(i, 'x', 100).rolls[0].remainingFt).toBe(100);
  });
  it('EDGE: NaN → clamps to 0', () => {
    const i = inv({ rolls: [roll({ id: 'x', fullLengthFt: 100, remainingFt: 50, loaded: true })] });
    expect(recalibrate(i, 'x', NaN).rolls[0].remainingFt).toBe(0);
  });
  it('EDGE: only the target roll is changed', () => {
    const i = inv({
      rolls: [
        roll({ id: 'target', remainingFt: 40, loaded: true }),
        roll({ id: 'other',  remainingFt: 70, loaded: false }),
      ],
    });
    const next = recalibrate(i, 'target', 25);
    expect(next.rolls.find((r) => r.id === 'other')!.remainingFt).toBe(70);
  });
});

/* ========================================================= receivePaper */

describe('receivePaper', () => {
  it('adds spare rolls to the right material', () => {
    expect(receivePaper(inv(), 'Glossy', 3).spares.Glossy).toBe(5);
  });
  it('does not affect other materials', () => {
    const next = receivePaper(inv(), 'Glossy', 3);
    expect(next.spares.Canvas).toBe(0);
  });
  // EDGE
  it('EDGE: zero qty → no change', () => {
    expect(receivePaper(inv(), 'Glossy', 0).spares.Glossy).toBe(2);
  });
  it('EDGE: negative qty → no change (no subtraction from stock)', () => {
    expect(receivePaper(inv(), 'Glossy', -5).spares.Glossy).toBe(2);
  });
  it('EDGE: fractional qty is truncated to integer rolls', () => {
    expect(receivePaper(inv(), 'Glossy', 2.9).spares.Glossy).toBe(4);
  });
  it('EDGE: receiving for a material currently at 0 spares', () => {
    expect(receivePaper(inv(), 'Canvas', 2).spares.Canvas).toBe(2);
  });
});

/* ============================================================ discardRoll */

describe('discardRoll', () => {
  it('removes the specified roll', () => {
    expect(discardRoll(inv(), 'gl').rolls).toHaveLength(0);
  });
  it('EDGE: unknown id → no-op, no crash', () => {
    const next = discardRoll(inv(), 'nope');
    expect(next.rolls).toHaveLength(1);
  });
  it('EDGE: discarding the currently loaded roll empties the printer', () => {
    const next = discardRoll(inv(), 'gl');
    expect(loadedRoll(next)).toBeUndefined();
  });
  it('EDGE: discarding one of many shelf rolls leaves others intact', () => {
    const many = inv({
      rolls: [
        roll({ id: 'a', loaded: true }),
        roll({ id: 'b', loaded: false }),
        roll({ id: 'c', loaded: false }),
      ],
    });
    const next = discardRoll(many, 'b');
    expect(next.rolls).toHaveLength(2);
    expect(next.rolls.find((r) => r.id === 'b')).toBeUndefined();
  });
});

/* ============================================================== selectors */

describe('selectors', () => {
  it('loadedRoll returns the single loaded roll', () => {
    expect(loadedRoll(inv())!.id).toBe('gl');
  });
  it('loadedRoll returns undefined when nothing is loaded', () => {
    expect(loadedRoll(inv({ rolls: [] }))).toBeUndefined();
  });
  it('rollsOfMaterial filters correctly', () => {
    expect(rollsOfMaterial(inv(), 'Glossy')).toHaveLength(1);
    expect(rollsOfMaterial(inv(), 'Canvas')).toHaveLength(0);
  });
  it('rollsOfMaterial returns both loaded and shelf rolls of that material', () => {
    const mix = inv({
      rolls: [
        roll({ id: 'a', material: 'Glossy', loaded: true }),
        roll({ id: 'b', material: 'Glossy', loaded: false }),
        roll({ id: 'c', material: 'Canvas', loaded: false }),
      ],
    });
    expect(rollsOfMaterial(mix, 'Glossy')).toHaveLength(2);
  });
  it('materialAvailableFt sums opened remaining + spares * full', () => {
    // 60 opened + 2 spares × 100 = 260
    expect(materialAvailableFt(inv(), 'Glossy', 100)).toBe(260);
  });
  // EDGE
  it('EDGE: materialAvailableFt with no opened rolls uses only spares', () => {
    const noOpen = inv({ rolls: [] });
    expect(materialAvailableFt(noOpen, 'Glossy', 100)).toBe(200);
  });
  it('EDGE: materialAvailableFt with 0 spares uses only opened remaining', () => {
    const noSpares = inv({ spares: { Canvas: 0, Glossy: 0, Regular: 0, Sticky: 0, Outdoor: 0 } });
    expect(materialAvailableFt(noSpares, 'Glossy', 100)).toBe(60);
  });
  it('EDGE: materialAvailableFt for a material with nothing at all → 0', () => {
    expect(materialAvailableFt(inv(), 'Canvas', 60)).toBe(0);
  });
  it('EDGE: materialAvailableFt sums multiple opened rolls correctly', () => {
    const multi = inv({
      rolls: [
        roll({ id: 'a', material: 'Glossy', remainingFt: 30, loaded: true }),
        roll({ id: 'b', material: 'Glossy', remainingFt: 15, loaded: false }),
      ],
      spares: { Canvas: 0, Glossy: 1, Regular: 0, Sticky: 0, Outdoor: 0 },
    });
    // 30 + 15 opened + 1 × 100 spare = 145
    expect(materialAvailableFt(multi, 'Glossy', 100)).toBe(145);
  });
});

/* ================================================================ ink ops */

describe('replaceInk', () => {
  it('resets to 100% and draws one spare', () => {
    const r = replaceInk(ink({ levelPct: 12, sparesInStock: 2 }), '2026-06-24');
    expect(r.levelPct).toBe(100);
    expect(r.sparesInStock).toBe(1);
  });
  it('EDGE: replacing with 0 spares → sparesInStock stays 0 (no negative)', () => {
    const r = replaceInk(ink({ sparesInStock: 0 }));
    expect(r.sparesInStock).toBe(0);
  });
  it('EDGE: immutable — original unchanged', () => {
    const orig = ink({ levelPct: 10, sparesInStock: 3 });
    replaceInk(orig);
    expect(orig.levelPct).toBe(10);
    expect(orig.sparesInStock).toBe(3);
  });
});

describe('receiveInk', () => {
  it('adds cartridges to stock', () => {
    expect(receiveInk(ink({ sparesInStock: 0 }), 2).sparesInStock).toBe(2);
  });
  it('EDGE: zero qty → no change', () => {
    expect(receiveInk(ink({ sparesInStock: 1 }), 0).sparesInStock).toBe(1);
  });
  it('EDGE: negative qty → no change', () => {
    expect(receiveInk(ink({ sparesInStock: 3 }), -2).sparesInStock).toBe(3);
  });
  it('EDGE: fractional qty truncated', () => {
    expect(receiveInk(ink({ sparesInStock: 1 }), 2.9).sparesInStock).toBe(3);
  });
});

/* ======================================================= calc derivations */

describe('rollPct', () => {
  it('percentage fill', () => {
    expect(rollPct(roll({ id: 'x', remainingFt: 25, fullLengthFt: 100 }))).toBe(25);
  });
  it('EDGE: fullLengthFt = 0 → returns 0, no division by zero', () => {
    expect(rollPct(roll({ id: 'x', remainingFt: 0, fullLengthFt: 0 }))).toBe(0);
  });
  it('EDGE: remainingFt > fullLengthFt (after bad recalibrate somehow) → > 100', () => {
    expect(rollPct(roll({ id: 'x', remainingFt: 110, fullLengthFt: 100 }))).toBe(110);
  });
  it('EDGE: exactly 0 remaining → 0%', () => {
    expect(rollPct(roll({ id: 'x', remainingFt: 0, fullLengthFt: 100 }))).toBe(0);
  });
  it('EDGE: exactly full → 100%', () => {
    expect(rollPct(roll({ id: 'x', remainingFt: 100, fullLengthFt: 100 }))).toBe(100);
  });
});

describe('rollState thresholds', () => {
  // Default settings: critical ≤ 10%, warning ≤ 25%
  it('good above 25%', () => {
    expect(rollState(roll({ id: 'x', remainingFt: 30, fullLengthFt: 100 }))).toBe('good');
  });
  it('warning at exactly 25%', () => {
    expect(rollState(roll({ id: 'x', remainingFt: 25, fullLengthFt: 100 }))).toBe('warning');
  });
  it('warning between 11% and 25%', () => {
    expect(rollState(roll({ id: 'x', remainingFt: 15, fullLengthFt: 100 }))).toBe('warning');
  });
  it('critical at exactly 10%', () => {
    expect(rollState(roll({ id: 'x', remainingFt: 10, fullLengthFt: 100 }))).toBe('critical');
  });
  it('critical below 10%', () => {
    expect(rollState(roll({ id: 'x', remainingFt: 6.2, fullLengthFt: 100 }))).toBe('critical');
  });
  it('EDGE: 0 remaining → critical', () => {
    expect(rollState(roll({ id: 'x', remainingFt: 0, fullLengthFt: 100 }))).toBe('critical');
  });
});

describe('inkState thresholds', () => {
  it('critical at exactly 20%', () => {
    expect(inkState(ink({ levelPct: 20 }))).toBe('critical');
  });
  it('critical below 20%', () => {
    expect(inkState(ink({ levelPct: 5 }))).toBe('critical');
  });
  it('warning between 21% and 35%', () => {
    expect(inkState(ink({ levelPct: 30 }))).toBe('warning');
  });
  it('good above 35%', () => {
    expect(inkState(ink({ levelPct: 80 }))).toBe('good');
  });
  it('EDGE: exactly 0% → critical', () => {
    expect(inkState(ink({ levelPct: 0 }))).toBe('critical');
  });
  it('EDGE: exactly 21% → warning (just over the low-ink threshold)', () => {
    expect(inkState(ink({ levelPct: 21 }))).toBe('warning');
  });
});

describe('rollCanFulfill', () => {
  it('true when remaining >= needed', () => {
    expect(rollCanFulfill(roll({ id: 'x', remainingFt: 20 }), { widthIn: 12, heightIn: 24, quantity: 5 })).toBe(true);
  });
  it('false when remaining < needed', () => {
    expect(rollCanFulfill(roll({ id: 'x', remainingFt: 6 }), { widthIn: 12, heightIn: 24, quantity: 5 })).toBe(false);
  });
  it('EDGE: remaining exactly equals needed → true (not wasteful to refuse)', () => {
    // 12in × 10 / 12 = 10ft needed; roll has 10ft
    expect(rollCanFulfill(roll({ id: 'x', remainingFt: 10 }), { widthIn: 6, heightIn: 12, quantity: 10 })).toBe(true);
  });
  it('EDGE: 0 remaining → false always', () => {
    expect(rollCanFulfill(roll({ id: 'x', remainingFt: 0 }), { widthIn: 1, heightIn: 1, quantity: 1 })).toBe(false);
  });
  it('EDGE: 0 height needed → true (degenerate job, non-zero roll)', () => {
    expect(rollCanFulfill(roll({ id: 'x', remainingFt: 10 }), { widthIn: 0, heightIn: 0, quantity: 5 })).toBe(true);
  });
});
