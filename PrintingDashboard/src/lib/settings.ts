/* ===========================================================================
   Editable settings (thresholds, load-waste, DPI).

   A module-level `current` snapshot lets the pure threshold helpers in calc.ts
   read settings without prop-drilling, while SettingsContext drives reactivity.
   Tests get the defaults (localStorage is empty in jsdom).
   =========================================================================== */
import { DEFAULT_LOAD_WASTE_FT, SETTINGS_KEY } from '../config';

export interface Settings {
  lowInkPct: number;       // ink critical at or below this %
  rollCriticalPct: number; // roll critical at or below this %
  rollWarningPct: number;  // roll warning at or below this %
  lowSpareThreshold: number; // reorder when spares at or below this count
  loadWasteFt: number;     // paper trimmed per roll load
  minDpi: number;          // resolution warning threshold
}

export const DEFAULT_SETTINGS: Settings = {
  lowInkPct: 20,
  rollCriticalPct: 10,
  rollWarningPct: 25,
  lowSpareThreshold: 1,
  loadWasteFt: DEFAULT_LOAD_WASTE_FT,
  minDpi: 150,
};

let current: Settings = load();

function load(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Current settings snapshot (sync read for pure helpers). */
export function getSettings(): Settings {
  return current;
}

/** Persist and update the in-memory snapshot. */
export function saveSettings(next: Settings): void {
  current = next;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    /* non-fatal */
  }
}
