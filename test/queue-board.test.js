import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer, loadEnv } from 'vite';

let viteServer;
let QueueBoard;
let fetchQueueApi;
let readCachedQueue;

test.before(async () => {
  viteServer = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  const mod = await viteServer.ssrLoadModule('/src/QueueBoard.jsx');
  QueueBoard = mod.default;
  fetchQueueApi = mod.fetchQueueApi;
  readCachedQueue = mod.readCachedQueue;
});

test.after(async () => {
  if (viteServer) await viteServer.close();
});

function renderQueueBoardWithState(props = {}, stateOverrides = {}) {
  const defaultState = {
    data: null,
    error: '',
    machine: 'printer',
    loading: false,
    refresh: 0,
    ...stateOverrides,
  };

  const stateOrder = ['data', 'error', 'machine', 'loading', 'refresh'];
  let stateIdx = 0;
  const currentStates = stateOrder.map(key => defaultState[key]);

  const origDispatcher = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H;
  React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H = {
    useState: (initial) => {
      const val = stateIdx < currentStates.length ? currentStates[stateIdx++] : initial;
      return [val, () => {}];
    },
    useEffect: () => {},
  };

  try {
    const tree = QueueBoard(props);
    return renderToStaticMarkup(tree);
  } finally {
    React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H = origDispatcher;
  }
}

async function runQueueBoardEffect({ props = {}, stateOverrides = {}, fetchImpl } = {}) {
  const origFetch = globalThis.fetch;
  if (fetchImpl) globalThis.fetch = fetchImpl;

  const defaultState = {
    data: null,
    error: '',
    machine: 'printer',
    loading: false,
    refresh: 0,
    ...stateOverrides,
  };

  const state = { ...defaultState };
  const stateOrder = ['data', 'error', 'machine', 'loading', 'refresh'];
  let stateIdx = 0;
  const effects = [];

  const origDispatcher = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H;
  React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H = {
    useState: (initial) => {
      const key = stateOrder[stateIdx++] || 'state_' + stateIdx;
      if (!(key in state)) state[key] = initial;
      const setter = (val) => {
        state[key] = typeof val === 'function' ? val(state[key]) : val;
      };
      return [state[key], setter];
    },
    useEffect: (fn, deps) => {
      effects.push({ fn, deps });
    },
  };

  let cleanup;
  try {
    stateIdx = 0;
    QueueBoard(props);
    const loadEffect = effects[1];
    if (loadEffect) {
      cleanup = loadEffect.fn();
    }
    await new Promise(r => setTimeout(r, 60));
    return { state };
  } finally {
    if (cleanup) cleanup();
    React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H = origDispatcher;
    globalThis.fetch = origFetch;
  }
}

// ---------------------------------------------------------------------------
// 1. RUNTIME CRASHES (TypeError / White Screen)
// ---------------------------------------------------------------------------

test('CRASH BUG 1.1: machine.tickets being null causes TypeError in filter', () => {
  assert.doesNotThrow(() => {
    renderQueueBoardWithState({}, {
      data: {
        machines: [
          { id: 'printer', waiting: 0, inReview: 0, tickets: null },
        ],
      },
    });
  }, TypeError, 'QueueBoard crashed with TypeError when machine.tickets is null (selected?.tickets.filter is not safe)');
});

test('CRASH BUG 1.2: machine.tickets being undefined causes TypeError in filter', () => {
  assert.doesNotThrow(() => {
    renderQueueBoardWithState({}, {
      data: {
        machines: [
          { id: 'printer', waiting: 0, inReview: 0, tickets: undefined },
        ],
      },
    });
  }, TypeError, 'QueueBoard crashed with TypeError when machine.tickets is undefined (selected?.tickets.filter is not safe)');
});

test('CRASH BUG 1.3: data being empty object {} crashes data.machines.find', () => {
  assert.doesNotThrow(() => {
    renderQueueBoardWithState({}, {
      data: {},
    });
  }, TypeError, 'QueueBoard crashed with TypeError when data is {} because data?.machines.find calls undefined.find');
});

test('COLLISION BUG 1.4: missing t.ticketNumber causes duplicate key warnings and false your-ticket highlight', () => {
  const html = renderQueueBoardWithState({ recentTicket: {} }, {
    data: {
      machines: [
        {
          id: 'printer',
          waiting: 2,
          inReview: 0,
          tickets: [
            { status: 'queued', position: 1 },
            { status: 'queued', position: 2 },
          ],
        },
      ],
    },
  });

  // When ticketNumber is undefined on ticket and recentTicket has no ticketNumber,
  // undefined === undefined evaluates to true!
  assert.equal(
    html.includes('your-ticket'),
    false,
    'Tickets missing ticketNumber must NOT match recentTicket={} and receive your-ticket class',
  );
  assert.equal(
    html.includes('<strong><span></span>'),
    false,
    'Tickets missing ticketNumber must display a placeholder rather than an empty <span></span>',
  );
});

// ---------------------------------------------------------------------------
// 2. DATA & MATH DISPLAY BUGS
// ---------------------------------------------------------------------------

test('MATH BUG 2.1: null, undefined, 0, or negative position renders "-1 jobs ahead" or "NaN jobs ahead"', () => {
  const badPositions = [null, undefined, 0, -1];
  for (const pos of badPositions) {
    const html = renderQueueBoardWithState({}, {
      data: {
        machines: [
          {
            id: 'printer',
            waiting: 1,
            inReview: 0,
            tickets: [
              { ticketNumber: 'T-99', status: 'queued', position: pos },
            ],
          },
        ],
      },
    });

    assert.equal(
      html.includes('-1 jobs ahead'),
      false,
      `Position ${pos} rendered "-1 jobs ahead" (expression: \`\${t.position - 1} jobs ahead\`)`,
    );
    assert.equal(
      html.includes('NaN jobs ahead'),
      false,
      `Position ${pos} rendered "NaN jobs ahead"`,
    );
    assert.equal(
      html.includes('-2 jobs ahead'),
      false,
      `Position ${pos} rendered "-2 jobs ahead"`,
    );
  }
});

test('DISPLAY BUG 2.2: in-progress ticket renders "No jobs ahead" or "X jobs ahead" instead of active production label', () => {
  const html = renderQueueBoardWithState({}, {
    data: {
      machines: [
        {
          id: 'printer',
          waiting: 1,
          inReview: 0,
          tickets: [
            { ticketNumber: 'T-100', status: 'in-progress', position: 1 },
          ],
        },
      ],
    },
  });

  // An in-progress job is currently being made on the printer, NOT waiting in queue with "jobs ahead"
  assert.equal(
    html.includes('No jobs ahead'),
    false,
    'In-progress ticket must not state "No jobs ahead" while actively being made',
  );
});

test('LABEL BUG 2.3: capitalized status "Queued" or unmapped status is silently dropped or renders blank label', () => {
  const html = renderQueueBoardWithState({}, {
    data: {
      machines: [
        {
          id: 'printer',
          waiting: 1,
          inReview: 0,
          tickets: [
            { ticketNumber: 'T-101', status: 'Queued', position: 1 },
          ],
        },
      ],
    },
  });

  // Ticket with capitalized status should be visible and not dropped by case-sensitive filter
  assert.ok(
    html.includes('T-101'),
    'Ticket with capitalized status "Queued" was silently dropped by selected?.tickets.filter',
  );
  assert.equal(
    html.includes('<span></span>'),
    false,
    'Status label rendered empty <span></span> because labels["Queued"] is undefined',
  );
});

test('NAME BUG 2.4: whitespace customerName renders empty whitespace instead of fallback text', () => {
  const html = renderQueueBoardWithState({}, {
    data: {
      machines: [
        {
          id: 'printer',
          waiting: 1,
          inReview: 0,
          tickets: [
            { ticketNumber: 'T-102', customerName: '   ', status: 'queued', position: 1 },
          ],
        },
      ],
    },
  });

  assert.equal(
    html.includes('<small class="queue-requester-name">   </small>'),
    false,
    'Whitespace-only customerName should fall back to "Requester name unavailable"',
  );
  assert.ok(
    html.includes('Requester name unavailable'),
    'Fallback requester text must be displayed when name is only whitespace',
  );
});

test('queue controls and rows expose clear accessible labels', () => {
  const html = renderQueueBoardWithState({}, {
    data: {
      machines: [
        {
          id: 'printer',
          name: 'Poster printing',
          waiting: 2,
          inReview: 1,
          tickets: [
            { ticketNumber: 'P-100', customerName: 'One', status: 'queued', position: 1 },
            { ticketNumber: 'P-101', customerName: 'Two', status: 'in-progress', position: 2 },
            { ticketNumber: 'P-102', customerName: 'Three', status: 'pending-review', position: null },
          ],
        },
      ],
    },
  });

  assert.match(html, /role="tablist"/);
  assert.match(html, /role="tab"[^>]*aria-selected="true"/);
  assert.match(html, /role="table"[^>]*aria-label="Poster printing queue"/);
  for (const heading of ['Position', 'Ticket', 'Status', 'Progress']) {
    assert.ok(html.includes(`role="columnheader">${heading}`), `Missing ${heading} queue heading`);
  }
  assert.ok(html.includes('<strong>1</strong> waiting'));
  assert.ok(html.includes('<strong>1</strong> being made'));
  assert.ok(html.includes('<strong>1</strong> in review'));
  assert.ok(html.includes('<strong>Pending</strong>'));
});

// ---------------------------------------------------------------------------
// 3. NETWORK & ERROR MESSAGE BUGS
// ---------------------------------------------------------------------------

test('NOTICE BUG 3.1: initial load failure claims positions are shown below when no positions exist', () => {
  const html = renderQueueBoardWithState({}, {
    data: null,
    error: 'Queue updates are unavailable. Any positions shown below are from the last successful update. Please refresh before relying on them.',
  });

  // On initial load failure, data is null, so NO positions are rendered at all
  assert.equal(
    html.includes('public-queue'),
    false,
    'No positions are rendered on initial load failure',
  );
  assert.equal(
    html.includes('Any positions shown below are from the last successful update'),
    false,
    'Notice misleadingly claims positions are shown below when none exist',
  );
});

test('ERROR BUG 3.2: backend error details from HTTP 500 or JSON error are swallowed', async () => {
  const { state } = await runQueueBoardEffect({
    props: { apiBase: 'http://localhost:3000' },
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: 'Database locked during maintenance' }),
    }),
  });

  assert.ok(
    state.error.includes('Database locked') || state.error.includes('503'),
    `Specific backend error details were swallowed and replaced with: "${state.error}"`,
  );
});

test('queue API uses a browser-compatible timeout and aborts a hung request', async () => {
  const hungFetch = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  });
  await assert.rejects(
    fetchQueueApi('http://localhost:3000', { fetcher: hungFetch, timeout: 5 }),
    /timed out/i,
  );
});

test('recent queue snapshots load instantly but stale or malformed snapshots are ignored', () => {
  const entries = new Map();
  const storage = {
    getItem: key => entries.get(key) || null,
    setItem: (key, value) => entries.set(key, value),
  };
  const key = 'mandir-queue:test';
  const data = { ok: true, machines: [] };
  entries.set(key, JSON.stringify({ savedAt: 1_000_000, data }));
  assert.deepEqual(readCachedQueue(storage, key, 1_000_001), data);
  assert.equal(readCachedQueue(storage, key, 1_000_000 + 5 * 60 * 1000 + 1), null);
  entries.set(key, '{bad json');
  assert.equal(readCachedQueue(storage, key, 1_000_001), null);
});

test('PROXY BUG 3.3: vite.config.js does not configure server.proxy for /api', async () => {
  const viteConfig = (await import('../vite.config.js')).default;
  assert.ok(
    viteConfig.server?.proxy?.['/api'],
    'vite.config.js is missing server.proxy for /api (requests to /api/queue 404 in local Vite dev server)',
  );
});

test('ENV BUG 3.4: WORKSHOP_GOOGLE_SCRIPT_URL in .env is not exposed to Vite client import.meta.env', () => {
  const clientEnv = loadEnv('development', process.cwd(), 'VITE_');
  assert.ok(
    Boolean(clientEnv.VITE_GOOGLE_SCRIPT_URL),
    'WORKSHOP_GOOGLE_SCRIPT_URL in .env is ignored by Vite because it lacks the VITE_ prefix; VITE_GOOGLE_SCRIPT_URL is unset',
  );
});
