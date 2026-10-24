type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type FetchLike = typeof fetch;

export class GooglePagesError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

const parseBody = (options: RequestInit) => {
  if (!options.body) return {};
  if (typeof options.body !== 'string') throw new GooglePagesError('The workshop request was not valid JSON.', 400);
  try { return JSON.parse(options.body); }
  catch { throw new GooglePagesError('The workshop request was not valid JSON.', 400); }
};

async function callScript(scriptUrl: string, action: string, body: object, fetcher: FetchLike) {
  const response = await fetcher(scriptUrl, {
    method: 'POST',
    mode: 'cors',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...body, action, publicStaff: true }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw new GooglePagesError(data?.error || 'Google did not confirm the workshop request.', Number(data?.status) || response.status || 503);
  return data;
}

export async function googlePagesRequest(
  scriptUrl: string,
  path: string,
  options: RequestInit = {},
  storage: StorageLike = window.sessionStorage,
  fetcher: FetchLike = fetch,
) {
  const method = String(options.method || 'GET').toUpperCase();
  if (path === '/api/session' && method === 'POST') {
    storage.setItem('workshop.pagesSession', '1');
    return { ok: true, role: 'admin' };
  }
  if (path === '/api/session' && method === 'DELETE') {
    storage.removeItem('workshop.pagesSession');
    return { ok: true };
  }
  if (storage.getItem('workshop.pagesSession') !== '1') throw new GooglePagesError('Sign in to the staff desk.', 401);

  if (path === '/api/tickets' && method === 'GET') {
    const data = await callScript(scriptUrl, 'staffList', {}, fetcher);
    return { ...data, tickets: data.tickets.filter((ticket: { status: string }) => !['pending-review', 'declined'].includes(ticket.status)), role: 'admin', source: 'google', updatedAt: new Date().toISOString() };
  }
  if (path === '/api/admin/requests' && method === 'GET') {
    const data = await callScript(scriptUrl, 'staffList', {}, fetcher);
    return { ...data, role: 'admin', source: 'google', updatedAt: new Date().toISOString() };
  }

  const body = parseBody(options);
  let match = /^\/api\/admin\/requests\/([^/]+)\/review$/.exec(path);
  if (match && method === 'POST') {
    const { expectedRevision, ...input } = body;
    return callScript(scriptUrl, 'adminReview', { id: decodeURIComponent(match[1]), expectedRevision, input }, fetcher);
  }
  match = /^\/api\/tickets\/([^/]+)\/usage$/.exec(path);
  if (match && method === 'POST') {
    const { expectedRevision, ...input } = body;
    return callScript(scriptUrl, 'staffUsage', { id: decodeURIComponent(match[1]), expectedRevision, input }, fetcher);
  }
  match = /^\/api\/tickets\/([^/]+)$/.exec(path);
  if (match && method === 'PATCH') return callScript(scriptUrl, 'staffUpdate', { id: decodeURIComponent(match[1]), ...body }, fetcher);
  throw new GooglePagesError('This workshop action is not available on GitHub Pages.', 404);
}

export function googleUsageCsv(tickets: Array<Record<string, any>>) {
  const cell = (value: unknown) => `"${String(value ?? '').replace(/^[\s]*[=+@-]/, "'$&").replaceAll('"', '""')}"`;
  const rows: unknown[][] = [['Ticket', 'Machine', 'Department', 'Material', 'Unit', 'Used', 'Waste', 'Total consumed', 'Operator', 'Note', 'Recorded at']];
  tickets.forEach(ticket => (ticket.usage || []).forEach((usage: Record<string, unknown>) => rows.push([
    ticket.ticketNumber, ticket.machine, ticket.department, usage.material, usage.unit, usage.used, usage.waste,
    Number(usage.used) + Number(usage.waste), usage.operator, usage.note, usage.at,
  ])));
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n');
}
