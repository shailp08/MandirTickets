import { Outlet } from 'react-router-dom';
import AlertTicker from './AlertTicker';
import Sidebar from './Sidebar';
import { JobsProvider, useJobs } from '../context/JobsContext';
import { InventoryProvider, useInventory } from '../context/InventoryContext';
import { SettingsProvider, useSettings } from '../context/SettingsContext';
import { OpsProvider } from '../context/OpsContext';
import { PrinterProvider, usePrinter } from '../context/PrinterContext';
import { LangProvider } from '../i18n';
import { deriveAlerts, derivePrinterAlerts } from '../lib/alerts';
import { printerStatus } from '../data/mockData';
import './AppLayout.css';

function LayoutInner() {
  const { jobs } = useJobs();
  const { inventory } = useInventory();
  const printer = usePrinter();
  useSettings(); // re-derive alerts when thresholds change
  const pendingCount = jobs.filter((j) => j.status === 'pending').length;
  const alerts = [...derivePrinterAlerts(printer?.errors ?? []), ...deriveAlerts(inventory)];

  return (
    <div className="app">
      <AlertTicker alerts={alerts} />
      <div className="shell">
        <Sidebar printer={printerStatus} pendingCount={pendingCount} />
        <main className="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default function AppLayout() {
  return (
    <LangProvider>
      <SettingsProvider>
        <JobsProvider>
          <InventoryProvider>
            <OpsProvider>
              <PrinterProvider>
                <LayoutInner />
              </PrinterProvider>
            </OpsProvider>
          </InventoryProvider>
        </JobsProvider>
      </SettingsProvider>
    </LangProvider>
  );
}
