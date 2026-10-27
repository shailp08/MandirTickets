type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type FetchLike = typeof fetch;
type JsonpLike = (scriptUrl: string, parameters: Record<string, string>) => Promise<Record<string, any>>;
type PauseLike = (milliseconds: number) => Promise<void>;

export class GooglePagesError extends Error {
  constructor(message: string, public status: number, public transport = false) { super(message); }
}

const wait: PauseLike = milliseconds => new Promise(resolve => window.setTimeout(resolve, milliseconds));

const parseBody = (options: RequestInit) => {
  if (!options.body) return {};
  if (typeof options.body !== 'string') throw new GooglePagesError('The workshop request was not valid JSON.', 400);
  try { return JSON.parse(options.body); }
  catch { throw new GooglePagesError('The workshop request was not valid JSON.', 400); }
};

function callScriptJsonp(scriptUrl: string, parameters: Record<string, string>, timeout = 15000) {
  return new Promise<Record<string, any>>((resolve, reject) => {
    const callback = `__mandirStaff_${crypto.getRandomValues(new Uint32Array(2)).join('_')}`;
    const script = document.createElement('script');
    let settled = false;
    const finish = (error?: Error, value?: Record<string, any>) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      script.remove();
      delete (window as any)[callback];
      if (error) reject(error); else resolve(value || {});
    };
    const timer = window.setTimeout(() => finish(new GooglePagesError('Google took too long to return the tickets.', 503, true)), timeout);
    (window as any)[callback] = (value: Record<string, any>) => finish(undefined, value);
    script.onerror = () => finish(new GooglePagesError('Google could not return the tickets.', 503, true));
    const query = new URLSearchParams({ ...parameters, callback, cache: Date.now().toString() });
    script.src = `${scriptUrl}?${query}`;
    document.head.append(script);
  });
}

async function callScript(
  scriptUrl: string,
  action: string,
  body: object,
  fetcher: FetchLike,
  pause: PauseLike,
  attempts = 1,
  timeout = 30000,
) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetcher(scriptUrl, {
        method: 'POST',
        mode: 'cors',
        redirect: 'follow',
        cache: 'no-store',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ ...body, action, publicStaff: true }),
        signal: AbortSignal.timeout(timeout),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        throw new GooglePagesError(data?.error || 'Google did not confirm the workshop request.', Number(data?.status) || response.status || 503);
      }
      return data;
    } catch (error) {
      if (error instanceof GooglePagesError) throw error;
      if (attempt < attempts) await pause(Math.min(500 * (2 ** (attempt - 1)), 2000));
    }
  }
  throw new GooglePagesError('Google could not be reached. Check the connection and retry.', 503, true);
}

async function listTickets(scriptUrl: string, fetcher: FetchLike, jsonp: JsonpLike, pause: PauseLike) {
  try {
    // Keep the three CORS attempts plus JSONP fallback inside the one-minute
    // recovery target, including the bounded retry pauses.
    return await callScript(scriptUrl, 'staffList', {}, fetcher, pause, 3, 12000);
  } catch (error) {
    if (!(error instanceof GooglePagesError) || !error.transport) throw error;
    const data = await jsonp(scriptUrl, { action: 'staffList', publicStaff: 'true' });
    if (!data?.ok || !Array.isArray(data.tickets)) {
      throw new GooglePagesError(data?.error || 'Google did not return the workshop tickets.', Number(data?.status) || 503);
    }
    return data;
  }
}

export async function googlePagesRequest(
  scriptUrl: string,
  path: string,
  options: RequestInit = {},
  storage: StorageLike = window.sessionStorage,
  fetcher: FetchLike = fetch,
  jsonp: JsonpLike = callScriptJsonp,
  pause: PauseLike = wait,
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
    const data = await listTickets(scriptUrl, fetcher, jsonp, pause);
    return { ...data, tickets: data.tickets.filter((ticket: { status: string }) => !['pending-review', 'declined'].includes(ticket.status)), role: 'admin', source: 'google', updatedAt: new Date().toISOString() };
  }
  if (path === '/api/admin/requests' && method === 'GET') {
    const data = await listTickets(scriptUrl, fetcher, jsonp, pause);
    return { ...data, role: 'admin', source: 'google', updatedAt: new Date().toISOString() };
  }

  const body = parseBody(options);
  let match = /^\/api\/admin\/requests\/([^/]+)\/review$/.exec(path);
  if (match && method === 'POST') {
    const { expectedRevision, ...input } = body;
    return callScript(scriptUrl, 'adminReview', { id: decodeURIComponent(match[1]), expectedRevision, input }, fetcher, pause);
  }
  match = /^\/api\/tickets\/([^/]+)\/usage$/.exec(path);
  if (match && method === 'POST') {
    const { expectedRevision, ...input } = body;
    return callScript(scriptUrl, 'staffUsage', { id: decodeURIComponent(match[1]), expectedRevision, input }, fetcher, pause);
  }
  match = /^\/api\/tickets\/([^/]+)$/.exec(path);
  if (match && method === 'PATCH') return callScript(scriptUrl, 'staffUpdate', { id: decodeURIComponent(match[1]), ...body }, fetcher, pause);
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
