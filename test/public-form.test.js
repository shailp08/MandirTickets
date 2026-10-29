import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let viteServer;
let TicketForm;
let TicketTracker;
const originalLocation = globalThis.location;

test.before(async () => {
  globalThis.location = { hostname: 'localhost', pathname: '/' };
  viteServer = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  ({ TicketForm, TicketTracker } = await viteServer.ssrLoadModule('/src/App.jsx'));
});

test.after(async () => {
  if (viteServer) await viteServer.close();
  globalThis.location = originalLocation;
});

function renderWithHooks(component) {
  const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const originalDispatcher = internals.H;
  internals.H = {
    useEffect: () => {},
    useRef: value => ({ current: value }),
    useState: value => [typeof value === 'function' ? value() : value, () => {}],
  };
  try {
    return renderToStaticMarkup(component());
  } finally {
    internals.H = originalDispatcher;
  }
}

function renderTicketForm(machine) {
  return renderWithHooks(() => TicketForm({ machine, onChangeMachine() {}, onTicket() {} }));
}

test('poster and foam customer forms do not ask for a needed-by date', () => {
  for (const machine of ['printer', 'foam']) {
    const html = renderTicketForm(machine);
    assert.doesNotMatch(html, /Needed by/i);
    assert.doesNotMatch(html, /name="neededBy"/i);
    assert.doesNotMatch(html, /type="date"/i);
  }
});

test('customer forms omit phone and make finished size optional', () => {
  for (const machine of ['printer', 'foam']) {
    const html = renderTicketForm(machine);
    assert.doesNotMatch(html, /name="phone"/i);
    for (const field of ['width', 'length']) {
      const input = html.match(new RegExp(`<input[^>]*name="${field}"[^>]*>`))?.[0];
      assert.ok(input, `${field} input should be rendered`);
      assert.doesNotMatch(input, /\srequired(?:=|\s|>)/i, `${field} should be optional`);
    }
  }
});

test('private tracker can regenerate a Telegram link with receipt credentials', () => {
  const html = renderWithHooks(() => TicketTracker());
  assert.match(html, /Private ticket tracking/i);
  assert.match(html, /name="ticket"/i);
  assert.match(html, /name="code"/i);
  assert.match(html, /new Telegram link/i);
});
