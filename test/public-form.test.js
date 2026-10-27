import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let viteServer;
let TicketForm;
const originalLocation = globalThis.location;

test.before(async () => {
  globalThis.location = { hostname: 'localhost', pathname: '/' };
  viteServer = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  ({ TicketForm } = await viteServer.ssrLoadModule('/src/App.jsx'));
});

test.after(async () => {
  if (viteServer) await viteServer.close();
  globalThis.location = originalLocation;
});

function renderTicketForm(machine) {
  const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const originalDispatcher = internals.H;
  internals.H = {
    useEffect: () => {},
    useRef: value => ({ current: value }),
    useState: value => [typeof value === 'function' ? value() : value, () => {}],
  };
  try {
    return renderToStaticMarkup(TicketForm({ machine, onChangeMachine() {}, onTicket() {} }));
  } finally {
    internals.H = originalDispatcher;
  }
}

test('poster and foam customer forms do not ask for a needed-by date', () => {
  for (const machine of ['printer', 'foam']) {
    const html = renderTicketForm(machine);
    assert.doesNotMatch(html, /Needed by/i);
    assert.doesNotMatch(html, /name="neededBy"/i);
    assert.doesNotMatch(html, /type="date"/i);
  }
});
