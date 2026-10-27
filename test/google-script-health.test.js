import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyGoogleScript } from '../scripts/verify-google-script.js';

const url = 'https://script.google.com/macros/s/deployment_id/exec';

test('deployment health check accepts the expected Apps Script JSONP response', async () => {
  const calls = [];
  const result = await verifyGoogleScript(url, {
    fetcher: async (request, options) => {
      calls.push({ request, options });
      return { ok: true, status: 200, text: async () => 'mandirWorkflowHealth({"ok":true,"service":"Mandir Workshop Tickets"});' };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(calls[0].request.searchParams.get('action'), 'health');
  assert.equal(calls[0].request.searchParams.get('callback'), 'mandirWorkflowHealth');
});

test('deployment health check rejects dead URLs and invalid responses', async () => {
  await assert.rejects(verifyGoogleScript('https://example.com/not-apps-script'), /\/exec URL/);
  await assert.rejects(verifyGoogleScript(url, {
    fetcher: async () => ({ ok: false, status: 404, text: async () => '<html>Not found</html>' }),
  }), /HTTP 404/);
  await assert.rejects(verifyGoogleScript(url, {
    fetcher: async () => ({ ok: true, status: 200, text: async () => '<html>Sign in</html>' }),
  }), /expected JSONP/);
});
