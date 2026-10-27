import { pathToFileURL } from 'node:url';

const EXEC_URL = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;

export async function verifyGoogleScript(url, {
  fetcher = fetch,
  timeout = 15000,
} = {}) {
  if (!EXEC_URL.test(String(url || ''))) {
    throw new Error('VITE_GOOGLE_SCRIPT_URL must be a deployed Google Apps Script /exec URL.');
  }

  const callback = 'mandirWorkflowHealth';
  const healthUrl = new URL(url);
  healthUrl.searchParams.set('action', 'health');
  healthUrl.searchParams.set('callback', callback);
  healthUrl.searchParams.set('cache', Date.now().toString());

  const response = await fetcher(healthUrl, {
    redirect: 'follow',
    cache: 'no-store',
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`Apps Script health check returned HTTP ${response.status}.`);

  const source = (await response.text()).trim();
  const prefix = `${callback}(`;
  if (!source.startsWith(prefix) || !source.endsWith(');')) {
    throw new Error('Apps Script health check did not return the expected JSONP response.');
  }
  const data = JSON.parse(source.slice(prefix.length, -2));
  if (data?.ok !== true) throw new Error('Apps Script health check did not report ready.');
  return data;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    await verifyGoogleScript(process.env.VITE_GOOGLE_SCRIPT_URL);
    console.log('Apps Script health check passed.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
