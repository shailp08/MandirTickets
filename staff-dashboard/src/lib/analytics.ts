/* ===========================================================================
   Summarize the inventory event log into analytics for the History screen.
   Pure + tested.
   =========================================================================== */
import { InventoryEvent, Material } from '../types';
import { round1 } from './calc';

export interface Analytics {
  totalPaperUsedFt: number;
  paperUsedByMaterial: Array<{ material: Material; ft: number }>;
  rollsLoaded: number;
  paperReceived: number;          // spare rolls received
  inkReplacements: number;
  inkReplacementsByColor: Array<{ color: string; count: number }>;
  jobsPrinted: number;            // distinct jobs that consumed paper
  reprints: number;
  wastedFt: number;               // paper lost to reprints
  reprintsByReason: Array<{ reason: string; count: number }>;
}

export function buildAnalytics(events: InventoryEvent[]): Analytics {
  const paperByMat: Record<string, number> = {};
  const inkByColor: Record<string, number> = {};
  const reasonCounts: Record<string, number> = {};
  const jobIds = new Set<string>();
  let totalFt = 0;
  let rollsLoaded = 0;
  let paperReceived = 0;
  let inkReplacements = 0;
  let reprints = 0;
  let wastedFt = 0;

  for (const e of events) {
    switch (e.type) {
      case 'roll_consumed':
        paperByMat[e.material] = (paperByMat[e.material] ?? 0) + e.ft;
        totalFt += e.ft;
        if (e.jobId) jobIds.add(e.jobId);
        break;
      case 'roll_loaded':
        rollsLoaded += 1;
        break;
      case 'paper_received':
        paperReceived += e.qty;
        break;
      case 'ink_replaced':
        inkReplacements += 1;
        inkByColor[e.color] = (inkByColor[e.color] ?? 0) + 1;
        break;
      case 'reprint_logged':
        reprints += 1;
        wastedFt += e.wastedFt;
        paperByMat[e.material] = (paperByMat[e.material] ?? 0) + e.wastedFt;
        totalFt += e.wastedFt;
        reasonCounts[e.reason] = (reasonCounts[e.reason] ?? 0) + 1;
        break;
      default:
        break;
    }
  }

  return {
    totalPaperUsedFt: round1(totalFt),
    paperUsedByMaterial: Object.entries(paperByMat)
      .map(([material, ft]) => ({ material: material as Material, ft: round1(ft) }))
      .sort((a, b) => b.ft - a.ft),
    rollsLoaded,
    paperReceived,
    inkReplacements,
    inkReplacementsByColor: Object.entries(inkByColor)
      .map(([color, count]) => ({ color, count }))
      .sort((a, b) => b.count - a.count),
    jobsPrinted: jobIds.size,
    reprints,
    wastedFt: round1(wastedFt),
    reprintsByReason: Object.entries(reasonCounts)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
  };
}

/** Human-readable one-liner for an event row in the audit log. */
export function describeEvent(e: InventoryEvent): { icon: string; text: string } {
  switch (e.type) {
    case 'roll_loaded':
      return { icon: 'ti-rollercoaster', text: `Opened new ${e.material} roll (${e.fullLengthFt} ft, −${e.loadWasteFt} ft trim)` };
    case 'roll_switched':
      return { icon: 'ti-switch-horizontal', text: `Mounted a ${e.material} roll from the shelf` };
    case 'roll_consumed':
      return { icon: 'ti-printer', text: `Printed ${e.ft} ft of ${e.material}` };
    case 'roll_recalibrated':
      return { icon: 'ti-ruler-2', text: `Recalibrated ${e.material} roll to ${e.measuredFt} ft` };
    case 'roll_depleted':
      return { icon: 'ti-trash', text: `Removed an empty ${e.material} roll` };
    case 'paper_received':
      return { icon: 'ti-package-import', text: `Received ${e.qty} × ${e.material} roll${e.qty === 1 ? '' : 's'}` };
    case 'ink_replaced':
      return { icon: 'ti-droplet', text: `Replaced ${e.color} cartridge` };
    case 'ink_received':
      return { icon: 'ti-package-import', text: `Received ${e.qty} × ${e.color} cartridge${e.qty === 1 ? '' : 's'}` };
    case 'reprint_logged':
      return {
        icon: 'ti-rotate-clockwise',
        text: e.wastedFt > 0
          ? `Reprint — ${e.reason} (${e.wastedFt} ft ${e.material} wasted)`
          : `Reprint — ${e.reason}`,
      };
    default:
      return { icon: 'ti-point', text: 'Event' };
  }
}
