/* ===========================================================================
   PrintTrack domain types
   Phase 0: shapes the UI binds to. Backend/event-sourcing arrives in later
   phases — these stay the contract the frontend reads.
   =========================================================================== */

export type Material = 'Canvas' | 'Glossy' | 'Regular' | 'Sticky' | 'Outdoor';

export type Department = 'BKY' | 'Sabha' | 'Deco' | 'IBKY';

export type JobStatus = 'pending' | 'in_progress' | 'ready' | 'completed';

export interface PrintJob {
  id: string;
  content: string;        // what is being printed
  material: Material;
  widthIn: number;
  heightIn: number;
  quantity: number;
  department: Department;
  notes?: string;
  status: JobStatus;
  submittedAt: string;    // ISO timestamp
  requester?: string;
  fileId?: string;        // Drive file ID, present when an artwork file was uploaded
}

/* ---- Inventory: paper ----
   The T210 holds one 24-in roll at a time. We track every *opened* physical
   roll individually (so partial rolls can be reused to minimize waste), plus a
   count of unopened full spares per material. Exactly one RollInstance has
   loaded=true. */
export interface RollInstance {
  id: string;
  material: Material;
  fullLengthFt: number;     // length this roll was when fresh
  remainingFt: number;      // current remaining
  openedAt: string;         // ISO date this physical roll was first opened
  loaded: boolean;          // currently mounted on the printer
}

/* ---- Inventory: ink ---- */
export type InkColor = 'Black' | 'Cyan' | 'Magenta' | 'Yellow';

export interface InkCartridge {
  color: InkColor;
  model: string;            // e.g. "HP 712"
  capacityMl: number;
  levelPct: number;         // live level (0-100), from printer EWS later
  replacedAt: string;       // ISO date current cartridge was installed
  sparesInStock: number;
}

/* ---- Alerts (ticker) ---- */
export type AlertSeverity = 'critical' | 'warning';

export interface Alert {
  id: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
}

/* ---- Printer status ---- */
export interface PrinterStatus {
  online: boolean;
  model: string;
  widthIn: number;
  state: string;            // "Ready", "Printing", "Error", ...
}

/* ---- Inventory snapshot + event log -----------------------------------------
   The materialized state (rolls, inks) is what the UI renders. The append-only
   event log is the audit trail and the basis for the Phase 4 history screen.
   The T210 cannot report remaining paper, so paper state is owned here. */
export interface Inventory {
  rolls: RollInstance[];               // opened rolls (loaded + partials on shelf)
  spares: Record<Material, number>;    // unopened full rolls per material
  inks: InkCartridge[];
}

export type InventoryEvent =
  | { id: string; at: string; type: 'roll_loaded'; material: Material; rollId: string; fullLengthFt: number; loadWasteFt: number }
  | { id: string; at: string; type: 'roll_switched'; material: Material; rollId: string }
  | { id: string; at: string; type: 'roll_consumed'; material: Material; rollId: string; ft: number; jobId?: string }
  | { id: string; at: string; type: 'roll_recalibrated'; material: Material; rollId: string; measuredFt: number }
  | { id: string; at: string; type: 'roll_depleted'; material: Material; rollId: string }
  | { id: string; at: string; type: 'paper_received'; material: Material; qty: number }
  | { id: string; at: string; type: 'ink_replaced'; color: InkColor }
  | { id: string; at: string; type: 'ink_received'; color: InkColor; qty: number }
  | { id: string; at: string; type: 'reprint_logged'; jobId?: string; material: Material; reason: string; wastedFt: number };

/* ---- Maintenance log ---- */
export const MAINTENANCE_KINDS = [
  'Printhead cleaning',
  'Alignment / calibration',
  'Cutter service',
  'Firmware update',
  'Paper jam cleared',
  'Other',
] as const;
export type MaintenanceKind = typeof MAINTENANCE_KINDS[number];

export interface MaintenanceEntry {
  id: string;
  at: string;          // ISO timestamp
  kind: MaintenanceKind;
  notes: string;
  by?: string;         // operator (optional)
}

/* ---- Vendors / suppliers ---- */
export interface Vendor {
  id: string;
  name: string;
  supply: string;      // material name, ink color, or "General"
  contact?: string;    // phone / email
  url?: string;        // reorder link
  unitCost?: number;
  leadTimeDays?: number;
  notes?: string;
}

/** Reasons a job is reprinted — drives the waste-tracking breakdown. */
export const REPRINT_REASONS = [
  'Low resolution',
  'Color off',
  'Paper jam',
  'Misfeed / skew',
  'Damaged print',
  'Additional copies (not waste)',
  'Other',
] as const;
export type ReprintReason = typeof REPRINT_REASONS[number];
