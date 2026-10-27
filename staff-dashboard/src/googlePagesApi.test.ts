import { googlePagesRequest, googleUsageCsv } from './googlePagesApi';

beforeEach(() => {
  Object.defineProperty(AbortSignal, 'timeout', { configurable: true, value: jest.fn(() => new AbortController().signal) });
});

const storage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
};

const response = (data: object, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => data } as Response);
const url = 'https://script.google.com/macros/s/test/exec';

test('Pages mode keeps a browser session and reads approved tickets directly from Apps Script', async () => {
  const session = storage();
  const fetchMock = jest.fn((_input: RequestInfo | URL, _init?: RequestInit) => response({ ok: true, tickets: [
    { id: 'approved', status: 'queued' },
    { id: 'review', status: 'pending-review' },
  ] }));
  const fetcher = fetchMock as typeof fetch;

  await expect(googlePagesRequest(url, '/api/tickets', {}, session, fetcher)).rejects.toEqual(expect.objectContaining({ status: 401 }));
  await expect(googlePagesRequest(url, '/api/session', { method: 'POST', body: '{}' }, session, fetcher)).resolves.toEqual({ ok: true, role: 'admin' });
  const result = await googlePagesRequest(url, '/api/tickets', {}, session, fetcher);

  expect(result.tickets).toEqual([{ id: 'approved', status: 'queued' }]);
  expect(AbortSignal.timeout).toHaveBeenCalledWith(12000);
  const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
  expect(body).toEqual({ action: 'staffList', publicStaff: true });
});

test('ticket reads retry transport failures and fall back to JSONP', async () => {
  const session = storage(); session.setItem('workshop.pagesSession', '1');
  const fetchMock = jest.fn((_input: RequestInfo | URL, _init?: RequestInit) => Promise.reject(new Error('CORS unavailable')));
  const fetcher = fetchMock as typeof fetch;
  const jsonp = jest.fn(() => Promise.resolve({ ok: true, tickets: [{ id: 'ticket', status: 'queued' }] }));
  const pauses: number[] = [];

  const result = await googlePagesRequest(url, '/api/tickets', {}, session, fetcher, jsonp, async value => { pauses.push(value); });

  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(pauses).toEqual([500, 1000]);
  expect(jsonp).toHaveBeenCalledWith(url, { action: 'staffList', publicStaff: 'true' });
  expect(result.tickets).toHaveLength(1);
});

test('staff mutations map to one Apps Script request and are not automatically replayed', async () => {
  const session = storage(); session.setItem('workshop.pagesSession', '1');
  const fetchMock = jest.fn((_input: RequestInfo | URL, _init?: RequestInit) => response({ ok: true, ticket: { id: 'ticket', status: 'in-progress' } }));
  const fetcher = fetchMock as typeof fetch;

  await googlePagesRequest(url, '/api/tickets/ticket', {
    method: 'PATCH',
    body: JSON.stringify({ status: 'in-progress', expectedRevision: 2 }),
  }, session, fetcher);

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
    action: 'staffUpdate',
    publicStaff: true,
    id: 'ticket',
    status: 'in-progress',
    expectedRevision: 2,
  });
});

test('Pages usage export remains a spreadsheet-safe CSV', () => {
  const csv = googleUsageCsv([{ ticketNumber: 'P-0001', machine: 'printer', department: '=SUM(1,2)', usage: [{ material: 'Glossy', unit: 'linear ft', used: 2, waste: 0.5, operator: 'Volunteer', note: 'Run', at: '2026-10-24T12:00:00Z' }] }]);
  expect(csv).toContain('P-0001');
  expect(csv).toContain("'=SUM(1,2)");
  expect(csv).toContain('2.5');
});
