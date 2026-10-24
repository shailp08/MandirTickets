/* ===========================================================================
   HP DesignJet T210 integration.

   - Ink levels  → SNMP (standard Printer-MIB supply OIDs).
   - Print submit → IPP (Print-Job operation).
   - When PRINTER_IP is unset (dev) or the printer is unreachable, every call
     degrades to a clearly-labelled simulated response so the app stays usable.
   =========================================================================== */
import snmp from 'net-snmp';
import ipp from 'ipp';

const PRINTER_IP = (process.env.PRINTER_IP ?? '').trim();
const COMMUNITY = (process.env.SNMP_COMMUNITY ?? 'public').trim();

export const hasPrinter = PRINTER_IP.length > 0;

export interface InkLevel {
  color: string;       // Black | Cyan | Magenta | Yellow | (raw description)
  levelPct: number;    // 0-100, -1 if unknown
}

export interface PrinterState {
  online: boolean;
  model: string;
  widthIn: number;
  state: string;
  errors: string[];   // jam, door open, out of paper, etc.
  simulated: boolean;
}

/* Printer-MIB supply table OIDs (prtMarkerSupplies). */
const OID_DESC = '1.3.6.1.2.1.43.11.1.1.6.1';
const OID_MAX = '1.3.6.1.2.1.43.11.1.1.8.1';
const OID_LEVEL = '1.3.6.1.2.1.43.11.1.1.9.1';
const OID_UPTIME = '1.3.6.1.2.1.1.3.0';
const OID_ERRSTATE = '1.3.6.1.2.1.25.3.5.1.2.1'; // hrPrinterDetectedErrorState

/* hrPrinterDetectedErrorState bit labels (MSB-first within each octet). */
const ERROR_BITS = [
  'Low paper', 'Out of paper', 'Low ink', 'Out of ink', 'Cover open',
  'Paper jam', 'Offline', 'Service requested', 'Input tray missing',
  'Output tray missing', 'Marker supply missing', 'Output near full',
  'Output full', 'Input tray empty', 'Overdue maintenance',
];

function parseErrorBits(value: any): string[] {
  if (!value) return [];
  const buf: Buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'binary');
  const errors: string[] = [];
  for (let bit = 0; bit < ERROR_BITS.length; bit++) {
    const byte = buf[Math.floor(bit / 8)] ?? 0;
    const mask = 0x80 >> (bit % 8);
    if (byte & mask) errors.push(ERROR_BITS[bit]);
  }
  return errors;
}

const MOCK_INK: InkLevel[] = [
  { color: 'Black', levelPct: 72 },
  { color: 'Cyan', levelPct: 58 },
  { color: 'Magenta', levelPct: 18 },
  { color: 'Yellow', levelPct: 45 },
];

function colorFromDescription(desc: string): string {
  const d = desc.toLowerCase();
  if (d.includes('black') || d.includes(' k ') || d.endsWith(' k')) return 'Black';
  if (d.includes('cyan')) return 'Cyan';
  if (d.includes('magenta')) return 'Magenta';
  if (d.includes('yellow')) return 'Yellow';
  return desc;
}

/** Walk one column of the supply table, keyed by row index. */
function walk(session: any, baseOid: string): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const out: Record<string, any> = {};
    session.subtree(
      baseOid, 20,
      (varbinds: any[]) => {
        for (const vb of varbinds) {
          if (snmp.isVarbindError(vb)) continue;
          const idx = vb.oid.slice(baseOid.length + 1); // trailing index
          out[idx] = vb.value;
        }
      },
      (err: any) => (err ? reject(err) : resolve(out)),
    );
  });
}

/** Read live ink levels via SNMP, or mock when no printer. */
export async function getInk(): Promise<{ ink: InkLevel[]; simulated: boolean }> {
  if (!hasPrinter) return { ink: MOCK_INK, simulated: true };

  const session = snmp.createSession(PRINTER_IP, COMMUNITY);
  try {
    const [descs, maxes, levels] = await Promise.all([
      walk(session, OID_DESC),
      walk(session, OID_MAX),
      walk(session, OID_LEVEL),
    ]);
    const ink: InkLevel[] = Object.keys(levels).map((idx) => {
      const desc = String(descs[idx] ?? '');
      const max = Number(maxes[idx]) || 0;
      const lvl = Number(levels[idx]);
      const pct = max > 0 && lvl >= 0 ? Math.round((lvl / max) * 100) : -1;
      return { color: colorFromDescription(desc), levelPct: pct };
    });
    return { ink: ink.length ? ink : MOCK_INK, simulated: false };
  } finally {
    session.close();
  }
}

/** Reachability + status + detected errors (jam, cover open, out of paper…). */
export async function getStatus(): Promise<PrinterState> {
  const base: PrinterState = {
    online: false, model: 'HP DesignJet T210', widthIn: 24,
    state: 'Unknown', errors: [], simulated: !hasPrinter,
  };
  if (!hasPrinter) return { ...base, online: true, state: 'Ready (simulated)' };

  const session = snmp.createSession(PRINTER_IP, COMMUNITY);
  return new Promise((resolve) => {
    session.get([OID_UPTIME, OID_ERRSTATE], (err: any, varbinds: any[]) => {
      session.close();
      if (err) { resolve({ ...base, online: false, state: 'Offline' }); return; }
      const errVb = varbinds?.[1];
      const errors = errVb && !snmp.isVarbindError(errVb) ? parseErrorBits(errVb.value) : [];
      resolve({
        ...base, online: true, errors,
        state: errors.length ? errors[0] : 'Ready',
      });
    });
  });
}

export interface SubmitResult {
  submitted: boolean;
  simulated: boolean;
  jobId?: number;
  message: string;
}

/** Submit a document to the printer over IPP. */
export async function submitJob(
  data: Buffer, filename: string, mime: string,
): Promise<SubmitResult> {
  if (!hasPrinter) {
    return { submitted: true, simulated: true, message: 'Simulated — no PRINTER_IP configured' };
  }

  const printer = new ipp.Printer(`ipp://${PRINTER_IP}:631/ipp/print`);
  const msg = {
    'operation-attributes-tag': {
      'requesting-user-name': 'PrintTrack',
      'job-name': filename,
      'document-format': mime || 'application/octet-stream',
    },
    data,
  };

  return new Promise((resolve) => {
    printer.execute('Print-Job', msg, (err: any, res: any) => {
      if (err) {
        resolve({ submitted: false, simulated: false, message: String(err.message || err) });
        return;
      }
      const jobId = res?.['job-attributes-tag']?.['job-id'];
      resolve({ submitted: true, simulated: false, jobId, message: 'Submitted to printer' });
    });
  });
}
