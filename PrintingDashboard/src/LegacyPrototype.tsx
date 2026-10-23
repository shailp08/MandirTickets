import { HashRouter, Route, Routes } from 'react-router-dom';
import AppLayout from './components/AppLayout';
import QueuePage from './pages/QueuePage';
import InventoryPage from './pages/InventoryPage';
import HistoryPage from './pages/HistoryPage';
import MaintenancePage from './pages/MaintenancePage';
import SuppliersPage from './pages/SuppliersPage';
import SettingsPage from './pages/SettingsPage';
import './App.css';

/* HashRouter is used so client-side routing works on GitHub Pages without
   server-side rewrite rules. */
export function LegacyPrototype() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<QueuePage />} />
          <Route path="inventory" element={<InventoryPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="maintenance" element={<MaintenancePage />} />
          <Route path="suppliers" element={<SuppliersPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
