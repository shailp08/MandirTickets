import { createContext, useCallback, useContext, useState } from 'react';
import { MAINTENANCE_KEY, VENDORS_KEY } from '../config';
import { genId } from '../services/inventoryStore';
import { MaintenanceEntry, MaintenanceKind, Vendor } from '../types';

/* Maintenance log + vendor list — local persistent ops data. */

function loadList<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveList<T>(key: string, list: T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* non-fatal */
  }
}

interface OpsContextValue {
  maintenance: MaintenanceEntry[];
  addMaintenance: (kind: MaintenanceKind, notes: string, by?: string) => void;
  deleteMaintenance: (id: string) => void;
  vendors: Vendor[];
  addVendor: (v: Omit<Vendor, 'id'>) => void;
  deleteVendor: (id: string) => void;
}

const OpsContext = createContext<OpsContextValue | null>(null);

export function OpsProvider({ children }: { children: React.ReactNode }) {
  const [maintenance, setMaintenance] = useState<MaintenanceEntry[]>(() => loadList(MAINTENANCE_KEY));
  const [vendors, setVendors] = useState<Vendor[]>(() => loadList(VENDORS_KEY));

  const addMaintenance = useCallback((kind: MaintenanceKind, notes: string, by?: string) => {
    setMaintenance((prev) => {
      const next = [...prev, { id: genId(), at: new Date().toISOString(), kind, notes, by }];
      saveList(MAINTENANCE_KEY, next);
      return next;
    });
  }, []);

  const deleteMaintenance = useCallback((id: string) => {
    setMaintenance((prev) => {
      const next = prev.filter((m) => m.id !== id);
      saveList(MAINTENANCE_KEY, next);
      return next;
    });
  }, []);

  const addVendor = useCallback((v: Omit<Vendor, 'id'>) => {
    setVendors((prev) => {
      const next = [...prev, { ...v, id: genId() }];
      saveList(VENDORS_KEY, next);
      return next;
    });
  }, []);

  const deleteVendor = useCallback((id: string) => {
    setVendors((prev) => {
      const next = prev.filter((v) => v.id !== id);
      saveList(VENDORS_KEY, next);
      return next;
    });
  }, []);

  return (
    <OpsContext.Provider value={{ maintenance, addMaintenance, deleteMaintenance, vendors, addVendor, deleteVendor }}>
      {children}
    </OpsContext.Provider>
  );
}

export function useOps(): OpsContextValue {
  const ctx = useContext(OpsContext);
  if (!ctx) throw new Error('useOps must be used within an OpsProvider');
  return ctx;
}
