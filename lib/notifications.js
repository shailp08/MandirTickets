import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
// One server process, persistent disk. Claim before sending; never auto-resend an
// uncertain outcome because Textbee does not document a send idempotency key.
export async function createNotifications({ directory, apiKey, deviceId, fetcher = fetch }) {
  const filename = path.join(directory, 'notifications.json');
  let records = {};
  try { records = JSON.parse(await fs.readFile(filename, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const save = async () => { const tmp = filename + '.tmp'; await fs.writeFile(tmp, JSON.stringify(records), {mode:0o600,flush:true}); await fs.rename(tmp,filename); };
  for (const n of Object.values(records)) if (n.state === 'sending') { n.state = 'unknown'; n.detail = 'Server restarted during send. Check Textbee before contacting the requester again.'; }
  await save();
  let tail = Promise.resolve();
  const serial = fn => { const p = tail.then(fn); tail = p.catch(() => {}); return p; };
  const configured = Boolean(apiKey && deviceId);
  const view = ticket => ({ ...ticket, notifications: Object.values(records).filter(n => n.ticketId === ticket.id).map(({ phone, ...n }) => n) });
  async function send(n) {
    n.state = 'sending'; n.detail = ''; await save();
    try {
      const message = `DE Mandir: ${n.ticketNumber} ${n.status === 'ready' ? 'is ready for pickup.' : n.status === 'declined' ? 'was declined. Please check your ticket for the reason.' : 'was cancelled. Please check your ticket for details.'}`;
      const response = await fetcher('https://api.textbee.dev/api/v1/gateway/send-sms', {method:'POST',headers:{'Content-Type':'application/json','x-api-key':apiKey},body:JSON.stringify({deviceId,recipients:[n.phone],message}),signal:AbortSignal.timeout(15000)});
      const body = await response.json().catch(() => ({}));
      if (response.ok && body.data?.success === true && typeof body.data.smsBatchId === 'string') {
        n.state = 'accepted'; n.batchId = body.data.smsBatchId; n.detail = 'Textbee accepted the text. Delivery is not yet confirmed; check the Textbee dashboard.';
      } else if ([400,401,403,404,429].includes(response.status)) {
        n.state = 'failed'; n.detail = response.status === 429 ? 'Textbee free-tier limit reached. Retry after the allowance resets, or contact the requester manually.' : `Textbee rejected this send (${response.status}). Check the account, API key, device and SIM before retrying.`;
      } else { n.state = 'unknown'; n.detail = 'Textbee did not confirm the outcome. Check its dashboard before contacting the requester again.'; }
    } catch { n.state = 'unknown'; n.detail = 'Connection interrupted during send. Check Textbee before contacting the requester again.'; }
    n.updatedAt = new Date().toISOString(); await save();
  }
  return {
    configured, decorate: view,
    reconcile: tickets => serial(async () => {
      for (const t of tickets) for (let i=0;i<(t.history || []).length;i++) {
        const h = t.history[i], e = h.notification;
        if (!e || !['ready','cancelled','declined'].includes(e.status) || !/^\+[1-9]\d{7,14}$/.test(e.phone || '')) continue;
        const key = crypto.createHash('sha256').update(`${t.id}:${i}:${h.at}:${e.status}`).digest('hex');
        records[key] ||= {id:key,ticketId:t.id,ticketNumber:e.ticketNumber,phone:e.phone,status:e.status,state:'pending',updatedAt:h.at,detail:configured ? 'Waiting to send.' : 'Textbee is not connected yet.'};
        const n = records[key];
        // Do not send a stale pickup message after the request was cancelled/collected.
        if (n.state === 'pending' && t.status !== n.status) { n.state = 'superseded'; n.detail = 'Ticket moved on before this notification was sent.'; }
        await save();
        if (n.state === 'pending' && configured) await send(n);
      }
    }),
    retry: (id, ticket) => serial(async () => {
      const n = records[id];
      if (!n || n.ticketId !== ticket.id) throw Object.assign(new Error('Notification not found.'),{status:404});
      if (!configured || n.state !== 'failed' || ticket.status !== n.status) throw Object.assign(new Error('Only a rejected notification for the current status can be retried. Check Textbee configuration and refresh.'),{status:409});
      await send(n); return view(ticket);
    }),
  };
}
