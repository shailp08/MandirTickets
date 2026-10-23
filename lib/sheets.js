import { machines } from './store.js';

export const headers = ['Ticket ID', 'Queue number', 'Machine', 'Name', 'Department', 'Purpose', 'Phone', 'Quantity', 'Paper', 'Width (in)', 'Length (in)', 'Thickness (in)', 'Needed by', 'Status', 'Notes', 'Files', 'Created', 'Updated', 'Revision', 'Customer email', 'Tracking number', 'Approx. cost (USD)', 'Cost basis', 'Cost estimate version'];
export function sheetRow(t) {
  return [t.id, t.ticketNumber, machines[t.machine], t.customerName, t.department, t.purpose, t.phone || '', t.quantity || 1,
    t.paperType || '', t.width || '', t.length || '', t.thickness || '', t.neededBy, t.status, t.notes || '',
    t.files.map(f => f.originalName).join('; '), t.createdAt, t.updatedAt || t.createdAt, t.revision, t.email || '',
    t.trackingNumber || '', t.costEstimate ? t.costEstimate.amountCents / 100 : '', t.costEstimate?.basis || '', t.costEstimate?.version || ''];
}
export const safeCell = value => /^[\s]*[=+@-]/.test(String(value)) ? `'${value}` : String(value ?? '');
export function csv(tickets) {
  return '\uFEFF' + [headers, ...tickets.map(sheetRow)].map(row => row.map(value => `"${safeCell(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
}
export function createSheetsSync(store, { url, secret, fetcher = fetch } = {}) {
  if (url && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) throw new Error('SHEETS_WEBHOOK_URL must be a Google Apps Script deployment URL ending in /exec.');
  const configured = Boolean(url && secret);
  let running = null;
  let lastError = null;
  let lastSuccess = null;
  const state = () => ({ configured, pending: store.list().filter(t => t.syncedRevision < t.revision).length, lastError, lastSuccess });
  function sync() {
    if (!configured) return Promise.resolve(state());
    if (running) return running;
    running = (async () => {
      try {
        for (const ticket of store.list().filter(t => t.syncedRevision < t.revision)) {
          const response = await fetcher(url, { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ secret, headers, row: sheetRow(ticket) }), signal: AbortSignal.timeout(20000) });
          const result = await response.json();
          if (!response.ok || result.ok !== true) throw new Error('Sheets did not confirm the record. Check the deployment and shared secret.');
          await store.markSynced(ticket.id, ticket.revision);
        }
        lastError = null; lastSuccess = new Date().toISOString();
      } catch { lastError = 'Sheets could not be reached or did not accept the record. Tickets are saved locally and will retry automatically.'; }
      return state();
    })().finally(() => { running = null; });
    return running;
  }
  return { sync, state };
}
