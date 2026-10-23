import {
  createContext, useContext, useEffect, useState,
} from 'react';
import { fetchPrinterStatus, PrinterState } from '../services/printerService';

/** Polls the backend for live printer status (state + detected errors).
 *  Null when the backend is unreachable. */
const PrinterContext = createContext<PrinterState | null>(null);

const POLL_MS = 20_000;

export function PrinterProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<PrinterState | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const s = await fetchPrinterStatus();
      if (alive) setStatus(s);
    };
    poll();
    const id = window.setInterval(poll, POLL_MS);
    return () => { alive = false; window.clearInterval(id); };
  }, []);

  return <PrinterContext.Provider value={status}>{children}</PrinterContext.Provider>;
}

export function usePrinter(): PrinterState | null {
  return useContext(PrinterContext);
}
