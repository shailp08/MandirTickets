import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultPricing, estimateTicketCost, pricingFromEnvironment } from '../lib/cost-estimate.js';

test('printing estimate includes material and ink for the full printed area', () => {
  const estimate = estimateTicketCost({
    machine: 'printer',
    paperType: 'Glossy',
    quantity: 2,
    width: 24,
    length: 36,
  });
  assert.equal(estimate.amountCents, 1680);
  assert.equal(estimate.amountDisplay, '$16.80');
  assert.match(estimate.basis, /12\.00 sq ft.*glossy.*ink/i);
  assert.deepEqual(estimate.components.map(component => component.amountCents), [960, 720]);
});

test('foam estimate packs rotated pieces and tiles pieces larger than one sheet', () => {
  const packed = estimateTicketCost({ machine: 'foam', quantity: 5, width: 20, length: 36, thickness: 2 });
  assert.equal(packed.amountCents, 6000);
  assert.match(packed.basis, /2 estimated 48 × 96/);

  const tiled = estimateTicketCost({ machine: 'foam', quantity: 1, width: 100, length: 100, thickness: 1 });
  assert.equal(tiled.amountCents, 9000);
  assert.match(tiled.basis, /6 estimated/);
});

test('pricing configuration accepts zero rates but rejects unusable sheet dimensions', () => {
  const freeInk = pricingFromEnvironment({ COST_PRINT_INK_CENTS_PER_SQFT: '0' });
  assert.equal(freeInk.printInkCentsPerSquareFoot, 0);
  assert.throws(() => pricingFromEnvironment({ COST_FOAM_SHEET_WIDTH_IN: '0' }), /positive/);
  assert.throws(() => pricingFromEnvironment({ COST_PRINT_CANVAS_CENTS_PER_SQFT: '-1' }), /non-negative/);
  assert.throws(() => pricingFromEnvironment({ COST_PRINT_CANVAS_CENTS_PER_SQFT: '1.5' }), /whole number/);
  assert.throws(() => pricingFromEnvironment({ COST_PRINT_INK_CENTS_PER_SQFT: '1e309' }), /whole number/);
  assert.throws(() => pricingFromEnvironment({ COST_PRINT_INK_CENTS_PER_SQFT: String(Number.MAX_SAFE_INTEGER) }), /whole number/);
  assert.throws(() => pricingFromEnvironment({ COST_FOAM_SHEET_WIDTH_IN: '1e309' }), /safe positive/);
  assert.equal(defaultPricing.version, 'materials-v1');
});

test('calculated estimates reject overflow instead of formatting Infinity', () => {
  const unsafePricing = {
    ...defaultPricing,
    printInkCentsPerSquareFoot: Number.MAX_SAFE_INTEGER,
    printMaterialCentsPerSquareFoot: { ...defaultPricing.printMaterialCentsPerSquareFoot, Canvas: Number.MAX_SAFE_INTEGER },
  };
  assert.throws(() => estimateTicketCost({
    machine: 'printer', paperType: 'Canvas', quantity: 10000, width: 24, length: 100000,
  }, unsafePricing), /too large|could not be calculated/i);
  assert.throws(() => estimateTicketCost({
    machine: 'foam', quantity: 10000, width: 10000, length: 100000, thickness: 1000,
  }, { ...defaultPricing, foamCentsPerInch: Number.MAX_SAFE_INTEGER }), /too large/i);
});
