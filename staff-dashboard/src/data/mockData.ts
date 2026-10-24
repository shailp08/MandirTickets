/* ===========================================================================
   Mock data for Phase 0. Replaced by the Sheets sync + SQLite in later phases.
   =========================================================================== */
import {
  Alert, InkCartridge, PrintJob, PrinterStatus,
} from '../types';

export const printerStatus: PrinterStatus = {
  online: true,
  model: 'HP DesignJet T-Series',
  widthIn: 24,
  state: 'Ready',
};

export const printJobs: PrintJob[] = [
  {
    id: 'job-001', content: 'Welcome Banner', material: 'Canvas',
    widthIn: 24, heightIn: 36, quantity: 2, department: 'Sabha',
    status: 'in_progress', submittedAt: '2026-06-23T14:14:00', requester: 'Nilay P.',
  },
  {
    id: 'job-002', content: 'Sponsor Logos', material: 'Glossy',
    widthIn: 18, heightIn: 24, quantity: 5, department: 'BKY',
    notes: 'Laminate after', status: 'pending', submittedAt: '2026-06-23T14:31:00',
    requester: 'Aarav S.',
  },
  {
    id: 'job-003', content: 'Stage Backdrop', material: 'Outdoor',
    widthIn: 24, heightIn: 48, quantity: 1, department: 'Deco',
    notes: 'Grommets needed', status: 'pending', submittedAt: '2026-06-23T15:02:00',
    requester: 'Priya M.',
  },
  {
    id: 'job-004', content: 'Name Tags', material: 'Sticky',
    widthIn: 4, heightIn: 3, quantity: 50, department: 'IBKY',
    status: 'pending', submittedAt: '2026-06-23T15:15:00', requester: 'Dev T.',
  },
  {
    id: 'job-005', content: 'Program Schedule', material: 'Glossy',
    widthIn: 11, heightIn: 17, quantity: 10, department: 'Sabha',
    status: 'completed', submittedAt: '2026-06-23T13:45:00', requester: 'Riya K.',
  },
];


export const inkCartridges: InkCartridge[] = [
  { color: 'Black', model: 'HP 712', capacityMl: 38, levelPct: 72, replacedAt: '2026-06-10', sparesInStock: 1 },
  { color: 'Cyan', model: 'HP 712', capacityMl: 29, levelPct: 58, replacedAt: '2026-06-10', sparesInStock: 2 },
  { color: 'Magenta', model: 'HP 712', capacityMl: 29, levelPct: 18, replacedAt: '2026-06-10', sparesInStock: 2 },
  { color: 'Yellow', model: 'HP 712', capacityMl: 29, levelPct: 45, replacedAt: '2026-06-10', sparesInStock: 3 },
];

/* Static alerts for Phase 0. Phase 4 derives these from live thresholds. */
export const alerts: Alert[] = [
  { id: 'a1', severity: 'critical', title: 'Glossy paper critical', detail: '6.2 ft left, next job needs 10 ft' },
  { id: 'a2', severity: 'critical', title: 'Magenta ink at 18%', detail: 'replace soon · 2 spares in stock' },
  { id: 'a3', severity: 'warning', title: 'Black cartridge spares low', detail: 'only 1 remaining' },
  { id: 'a4', severity: 'warning', title: 'Outdoor paper out of stock', detail: 'reorder needed' },
];
