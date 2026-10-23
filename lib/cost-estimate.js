const DISCLAIMER = 'Approximate material cost only; labor, finishing, tax, and design time are not included. Final cost may change.';
const MAX_SHEET_DIMENSION_IN = 1000000;
const MAX_RATE_CENTS = 1000000000;

export const defaultPricing = Object.freeze({
  version: 'materials-v1',
  foamSheetWidthIn: 48,
  foamSheetLengthIn: 96,
  foamCentsPerInch: 1500,
  foamMinimumSheetCents: 1500,
  printInkCentsPerSquareFoot: 60,
  printMaterialCentsPerSquareFoot: Object.freeze({
    Standard: 40,
    Glossy: 80,
    Polypropylene: 100,
    Adhesive: 125,
    Canvas: 175,
  }),
});

function configuredCents(value, fallback, name) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > MAX_RATE_CENTS) throw new Error(`${name} must be a safe non-negative whole number of cents.`);
  return parsed;
}

function configuredPositiveNumber(value, fallback, name) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_SHEET_DIMENSION_IN) throw new Error(`${name} must be a safe positive dimension.`);
  return parsed;
}

export function pricingFromEnvironment(environment = {}) {
  return {
    version: String(environment.COST_ESTIMATE_VERSION || defaultPricing.version).trim() || defaultPricing.version,
    foamSheetWidthIn: configuredPositiveNumber(environment.COST_FOAM_SHEET_WIDTH_IN, defaultPricing.foamSheetWidthIn, 'COST_FOAM_SHEET_WIDTH_IN'),
    foamSheetLengthIn: configuredPositiveNumber(environment.COST_FOAM_SHEET_LENGTH_IN, defaultPricing.foamSheetLengthIn, 'COST_FOAM_SHEET_LENGTH_IN'),
    foamCentsPerInch: configuredCents(environment.COST_FOAM_CENTS_PER_INCH, defaultPricing.foamCentsPerInch, 'COST_FOAM_CENTS_PER_INCH'),
    foamMinimumSheetCents: configuredCents(environment.COST_FOAM_MIN_SHEET_CENTS, defaultPricing.foamMinimumSheetCents, 'COST_FOAM_MIN_SHEET_CENTS'),
    printInkCentsPerSquareFoot: configuredCents(environment.COST_PRINT_INK_CENTS_PER_SQFT, defaultPricing.printInkCentsPerSquareFoot, 'COST_PRINT_INK_CENTS_PER_SQFT'),
    printMaterialCentsPerSquareFoot: Object.fromEntries(Object.entries(defaultPricing.printMaterialCentsPerSquareFoot).map(([material, fallback]) => {
      const key = `COST_PRINT_${material.toUpperCase()}_CENTS_PER_SQFT`;
      return [material, configuredCents(environment[key], fallback, key)];
    })),
  };
}

const safeCents = (value, message) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(message);
  return value;
};
const money = cents => `$${(safeCents(cents, 'The cost estimate could not be formatted.') / 100).toFixed(2)}`;
const decimal = value => Number(value.toFixed(2));

function foamSheets(ticket, pricing) {
  const width = Number(ticket.width);
  const length = Number(ticket.length);
  const quantity = Number(ticket.quantity);
  const normal = Math.floor(pricing.foamSheetWidthIn / width) * Math.floor(pricing.foamSheetLengthIn / length);
  const rotated = Math.floor(pricing.foamSheetWidthIn / length) * Math.floor(pricing.foamSheetLengthIn / width);
  const piecesPerSheet = Math.max(normal, rotated);
  if (piecesPerSheet > 0) return Math.ceil(quantity / piecesPerSheet);
  const tiledNormal = Math.ceil(width / pricing.foamSheetWidthIn) * Math.ceil(length / pricing.foamSheetLengthIn);
  const tiledRotated = Math.ceil(width / pricing.foamSheetLengthIn) * Math.ceil(length / pricing.foamSheetWidthIn);
  return Math.min(tiledNormal, tiledRotated) * quantity;
}

export function estimateTicketCost(ticket, pricing = defaultPricing) {
  if (ticket.machine === 'printer') {
    const squareFeet = Number(ticket.quantity) * Number(ticket.width) * Number(ticket.length) / 144;
    const materialRate = pricing.printMaterialCentsPerSquareFoot[ticket.paperType];
    if (!Number.isFinite(squareFeet) || squareFeet <= 0 || !Number.isSafeInteger(materialRate)
      || !Number.isSafeInteger(pricing.printInkCentsPerSquareFoot)) throw new Error('The print cost estimate could not be calculated.');
    const paperCents = safeCents(Math.round(squareFeet * materialRate), 'The print cost estimate is too large.');
    const inkCents = safeCents(Math.round(squareFeet * pricing.printInkCentsPerSquareFoot), 'The print cost estimate is too large.');
    const amountCents = safeCents(paperCents + inkCents, 'The print cost estimate is too large.');
    return {
      version: pricing.version,
      currency: 'USD',
      amountCents,
      amountDisplay: money(amountCents),
      basis: `${decimal(squareFeet).toFixed(2)} sq ft of ${ticket.paperType.toLowerCase()} material plus ink`,
      components: [
        { label: `${ticket.paperType} material`, amountCents: paperCents },
        { label: 'Ink allowance', amountCents: inkCents },
      ],
      disclaimer: DISCLAIMER,
    };
  }
  if (ticket.machine === 'foam') {
    const sheets = foamSheets(ticket, pricing);
    if (!Number.isSafeInteger(sheets) || sheets < 1) throw new Error('The foam cost estimate could not be calculated.');
    const perSheetCents = Math.max(pricing.foamMinimumSheetCents, Math.round(Number(ticket.thickness) * pricing.foamCentsPerInch));
    safeCents(perSheetCents, 'The foam cost estimate is too large.');
    const amountCents = safeCents(sheets * perSheetCents, 'The foam cost estimate is too large.');
    return {
      version: pricing.version,
      currency: 'USD',
      amountCents,
      amountDisplay: money(amountCents),
      basis: `${sheets} estimated ${pricing.foamSheetWidthIn} × ${pricing.foamSheetLengthIn} in foam sheet${sheets === 1 ? '' : 's'} at ${Number(ticket.thickness)} in thick`,
      components: [{ label: 'Foam sheets', quantity: sheets, amountCents }],
      disclaimer: DISCLAIMER,
    };
  }
  throw new Error('The material cost estimate could not be calculated.');
}

export function formatCostEstimate(estimate) {
  return estimate ? `Approximate material cost: ${estimate.amountDisplay}\nBased on: ${estimate.basis}\n${estimate.disclaimer}` : '';
}
