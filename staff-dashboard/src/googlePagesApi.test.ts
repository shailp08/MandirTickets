import { GooglePagesError, googlePagesRequest, googleUsageCsv } from './googlePagesApi';

beforeEach(() => {
  Object.defineProperty(AbortSignal, 'timeout', { configurable: true, value: () => new AbortController().signal });
});

const storage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
};

const response = (data: object) => Promise.resolve({ ok: true, status: 200, json: async () => data } as Response);

test('Pages mode keeps the sign-in screen and loads Google tickets after login', async () => {
  const session = storage();
  const fetcher = jest.fn(() => response({ ok: true, tickets: [
    { id: 'review', status: 'pending-review' },
    { id: 'queue', status: 'queued' },
  ] })) as typeof fetch;
  await expect(googlePagesRequest('https://script.google.com/macros/s/test/exec', '/api/tickets', {}, session, fetcher)).rejects.toEqual(expect.objectContaining({ status: 401 }));
  await expect(googlePagesRequest('https://script.google.com/macros/s/test/exec', '/api/session', { method: 'POST', body: '{}' }, session, fetcher)).resolves.toEqual({ ok: true, role: 'admin' });
  const result = await googlePagesRequest('https://script.google.com/macros/s/test/exec', '/api/tickets', {}, session, fetcher);
  expect(result.tickets).toEqual([{ id: 'queue', status: 'queued' }]);
  expect(result.role).toBe('admin');
  const sent = JSON.parse(String((fetcher as jest.Mock).mock.calls[0][1].body));
  expect(sent).toMatchObject({ action: 'staffList', publicStaff: true });
});

test('Pages mode maps review, status and usage actions to Apps Script', async () => {
  const session = storage(); session.setItem('workshop.pagesSession', '1');
  const payloads: any[] = [];
  const fetcher = jest.fn((_url, options) => { payloads.push(JSON.parse(String(options?.body))); return response({ ok: true, ticket: { id: 'ticket' } }); }) as typeof fetch;
  const url = 'https://script.google.com/macros/s/test/exec';
  await googlePagesRequest(url, '/api/admin/requests/ticket/review', { method: 'POST', body: JSON.stringify({ decision: 'approve', operator: 'Admin', expectedRevision: 2 }) }, session, fetcher);
  await googlePagesRequest(url, '/api/tickets/ticket', { method: 'PATCH', body: JSON.stringify({ status: 'in-progress', expectedRevision: 3 }) }, session, fetcher);
  await googlePagesRequest(url, '/api/tickets/ticket/usage', { method: 'POST', body: JSON.stringify({ used: 2, waste: 1, expectedRevision: 4 }) }, session, fetcher);
  expect(payloads.map(value => value.action)).toEqual(['adminReview', 'staffUpdate', 'staffUsage']);
  expect(payloads[0].input).toEqual({ decision: 'approve', operator: 'Admin' });
  expect(payloads[2].input).toEqual({ used: 2, waste: 1 });
});

test('Pages usage export remains a spreadsheet-safe CSV', () => {
  const csv = googleUsageCsv([{ ticketNumber: 'P-0001', machine: 'printer', department: '=SUM(1,2)', usage: [{ material: 'Glossy', unit: 'linear ft', used: 2, waste: 0.5, operator: 'Volunteer', note: 'Run', at: '2026-10-24T12:00:00Z' }] }]);
  expect(csv).toContain('P-0001');
  expect(csv).toContain("'=SUM(1,2)");
  expect(csv).toContain('2.5');
});

test('Pages mode surfaces Google errors', async () => {
  const session = storage(); session.setItem('workshop.pagesSession', '1');
  const fetcher = jest.fn(() => response({ ok: false, status: 409, error: 'Refresh first.' })) as typeof fetch;
  await expect(googlePagesRequest('https://script.google.com/macros/s/test/exec', '/api/tickets', {}, session, fetcher)).rejects.toEqual(new GooglePagesError('Refresh first.', 409));
});
