import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createStore, validateNeededBy, validateTicket, publicQueue, machines } from '../lib/store.js';
import { createSheetsSync, csv } from '../lib/sheets.js';

const input = { machine:'foam', customerName:'Test Person', department:'Events', purpose:'Stage lettering', email:'requester@example.com', phone:'', quantity:'2', width:'20', length:'36', thickness:'2', neededBy:'Tomorrow' };
async function temp(t) { const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mandir-test-')); t.after(()=>fs.rm(dir,{recursive:true,force:true})); return dir; }

test('uses plain-language public machine names', () => {
  assert.deepEqual(machines, { printer:'Poster printing', foam:'Foam cutting' });
});

test('concurrent requests keep every ticket and assign independent, persistent queue numbers', async t => {
  const dir=await temp(t), store=await createStore(dir);
  const details=validateTicket(input,[]);
  const jobs=await Promise.all(Array.from({length:25},(_,i)=>store.create(details,'request-'+i)));
  assert.equal(new Set(jobs.map(j=>j.ticket.ticketNumber)).size,25);
  assert.equal(new Set(jobs.map(j=>j.ticket.trackingNumber)).size,25);
  assert.ok(jobs.every(job => /^DM-[A-HJ-NP-Z2-9]{12}$/.test(job.ticket.trackingNumber)));
  assert.equal(store.list().length,25);
  const duplicate=await store.create(details,'request-0');
  assert.equal(duplicate.duplicate,true); assert.equal(store.list().length,25);
  const restored=await createStore(dir);
  assert.equal((await restored.create(details,'next')).ticket.ticketNumber,'F-0026');
  const print=validateTicket({...input,machine:'printer',paperType:'Canvas'},[{originalName:'poster.pdf',storedName:'file.pdf',size:100}]);
  assert.equal((await restored.create(print,'print')).ticket.ticketNumber,'P-0001');
});
test('validates contact details, purpose, printer width, quantity and required print files',()=>{
  for(const patch of [{department:''},{purpose:''},{email:''},{email:'not-an-email'},{width:'-1'},{quantity:'1.5'},{thickness:'0'},{neededBy:'Invalid'},{neededBy:'2026-02-30'}]) assert.throws(()=>validateTicket({...input,...patch},[]));
  assert.throws(()=>validateTicket({...input,machine:'printer',paperType:'Standard',width:'25'},[{originalName:'a.pdf'}]));
  assert.throws(()=>validateTicket({...input,machine:'printer',paperType:'Standard'},[]));
  assert.equal(validateTicket(input,[]).machine,'foam');
  assert.equal(validateTicket({...input,neededBy:'2028-02-29'},[]).neededBy,'2028-02-29');
  assert.equal(validateTicket({...input,email:' Person@Example.COM '},[]).email,'person@example.com');
});
test('needed-by dates reject Delaware-local past dates while retaining legacy labels', () => {
  const now = new Date('2026-10-22T04:30:00.000Z'); // 12:30 AM in Delaware.
  assert.equal(validateNeededBy('2026-10-22', now), '2026-10-22');
  assert.throws(() => validateNeededBy('2026-10-21', now), /past/i);
  assert.equal(validateNeededBy('No rush', now), 'No rush');
});
test('status changes move queue positions, hide closed jobs, preserve history and private data',async t=>{
  const store=await createStore(await temp(t));
  const first=(await store.create(validateTicket(input,[]),'one')).ticket;
  const second=(await store.create(validateTicket(input,[]),'two')).ticket;
  await store.review(first.id,{decision:'approve',operator:'Admin'},first.revision);
  await store.review(second.id,{decision:'approve',operator:'Admin'},second.revision);
  await store.update(first.id,'ready');
  const queue=publicQueue(store.list())[1];
  assert.equal(queue.tickets.find(t=>t.ticketNumber===second.ticketNumber).position,1);
  assert.ok(!JSON.stringify(queue).includes('Test Person'));
  assert.ok(!JSON.stringify(queue).includes('Events'));
  await store.update(first.id,'collected');
  assert.equal(publicQueue(store.list())[1].tickets.length,1);
  assert.equal(store.list()[0].history.length,4);
  await assert.rejects(store.update(second.id,'bad'));
});
test('Sheets failure preserves pending records and retries latest status once',async t=>{
  const store=await createStore(await temp(t));
  const job=(await store.create(validateTicket(input,[]),'one')).ticket;
  let failed=true; const writes=[];
  const sheets=createSheetsSync(store,{url:'https://script.google.com/macros/s/test/exec',secret:'test',fetcher:async(_url,opts)=>{
    if(failed)throw new Error('offline');writes.push(JSON.parse(opts.body));return {ok:true,json:async()=>({ok:true})};
  }});
  await sheets.sync(); assert.equal(sheets.state().pending,1); assert.ok(sheets.state().lastError);
  await store.update(job.id,'ready'); failed=false;
  await sheets.sync(); await sheets.sync();
  assert.equal(sheets.state().pending,0);assert.equal(writes.length,1);assert.equal(writes[0].row[13],'ready');
});
test('a status update during Sheets delivery stays pending for the next sync',async t=>{
  const store=await createStore(await temp(t));
  const job=(await store.create(validateTicket(input,[]),'one')).ticket;
  const sheets=createSheetsSync(store,{url:'https://script.google.com/macros/s/test/exec',secret:'test',fetcher:async()=>{
    await store.update(job.id,'in-progress');return {ok:true,json:async()=>({ok:true})};
  }});
  await sheets.sync();assert.equal(sheets.state().pending,1);
  await sheets.sync();assert.equal(sheets.state().pending,0);
});
test('spreadsheet exports escape formulas, quotes, commas and newlines',()=>{
  const ticket={...validateTicket({...input,customerName:'=SUM(1,2)',purpose:'Line one\n"line two"'},[]),id:'id',ticketNumber:'F-0001',status:'queued',createdAt:'now',revision:1};
  const output=csv([ticket]);assert.ok(output.includes('"\'=SUM(1,2)"'));assert.ok(output.includes('"Line one\n""line two"""'));
});
test('Sheets can sync new tickets after starting with an empty queue', async t => {
  const store = await createStore(await temp(t));
  let writes = 0;
  const sheets = createSheetsSync(store, { url:'https://script.google.com/macros/s/test/exec', secret:'test', fetcher:async()=>{
    writes++; return {ok:true,json:async()=>({ok:true})};
  }});
  await sheets.sync();
  await store.create(validateTicket(input,[]),'after-empty');
  await sheets.sync();
  assert.equal(writes,1); assert.equal(sheets.state().pending,0);
});
test('reopening clears the old ready timestamp and survives a restart', async t => {
  const dir = await temp(t), store = await createStore(dir);
  const {ticket} = await store.create(validateTicket(input,[]),'reopen');
  assert.ok((await store.update(ticket.id,'ready')).completedAt);
  const reopened = await store.update(ticket.id,'queued');
  assert.equal(reopened.completedAt,null);
  assert.equal((await createStore(dir)).list()[0].status,'queued');
});
test('material estimate is stored with the ticket and does not change when rates change', async t => {
  const dir = await temp(t);
  const firstStore = await createStore(dir);
  const created = (await firstStore.create(validateTicket(input, []), 'priced')).ticket;
  assert.equal(created.costEstimate.amountDisplay, '$30.00');
  const higherPricing = {
    version: 'future-rates',
    foamSheetWidthIn: 48,
    foamSheetLengthIn: 96,
    foamCentsPerInch: 9999,
    foamMinimumSheetCents: 9999,
    printInkCentsPerSquareFoot: 9999,
    printMaterialCentsPerSquareFoot: { Standard: 9999, Glossy: 9999, Polypropylene: 9999, Adhesive: 9999, Canvas: 9999 },
  };
  const restored = await createStore(dir, { pricing: higherPricing });
  assert.equal(restored.list()[0].costEstimate.amountDisplay, '$30.00');
  assert.equal(restored.list()[0].costEstimate.version, 'materials-v1');
});
test('migration-added ticket codes and estimates force a Sheets re-sync', async t => {
  const dir = await temp(t);
  const legacy = {
    ...validateTicket(input, []), id: 'legacy-id', ticketNumber: 'F-0042', requestKey: 'legacy-request',
    status: 'queued', createdAt: '2026-10-20T12:00:00.000Z', updatedAt: '2026-10-20T12:00:00.000Z',
    revision: 3, syncedRevision: 3, history: [],
  };
  await fs.writeFile(path.join(dir, 'tickets.json'), JSON.stringify([legacy]));
  const migrated = await createStore(dir);
  const ticket = migrated.list()[0];
  assert.match(ticket.trackingNumber, /^DM-[A-HJ-NP-Z2-9]{12}$/);
  assert.equal(ticket.costEstimate.amountDisplay, '$30.00');
  assert.equal(ticket.syncedRevision, 2);
  assert.equal(ticket.legacyTicketNumberLookup, undefined);
});
test('HTTP flow: auth, uploads, receipt, privacy, tracking, status and export',async t=>{
  const dir=await temp(t);
  const child=spawn(process.execPath,['server.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,NODE_ENV:'test',APP_ORIGIN:'https://desk.example',COOKIE_SECURE:'true',CLAMSCAN_PATH:'',PORT:'0',DATA_DIR:dir,ADMIN_USERNAME:'admin',ADMIN_PASSWORD:'test-only-secret',STAFF_USERNAME:'workshop',STAFF_PASSWORD:'staff-test-secret',TEXTBEE_API_KEY:'',TEXTBEE_DEVICE_ID:'',WORKSHOP_GOOGLE_SCRIPT_URL:'',SHEETS_WEBHOOK_URL:'',SHEETS_SHARED_SECRET:'',MAX_UPLOAD_BYTES:'1048576',MAX_UPLOAD_FILES:'3',UPLOAD_IDLE_TIMEOUT_MS:'100',UPLOAD_REQUEST_TIMEOUT_MS:'5000'},stdio:['ignore','pipe','pipe']});
  t.after(async()=>{const exited=once(child,'exit');child.kill();await exited;});
  const port=await new Promise((resolve,reject)=>{child.stdout.on('data',d=>{const m=String(d).match(/port (\d+)/);if(m)resolve(m[1]);});child.once('error',reject);child.once('exit',()=>reject(new Error('Server exited before listening.')));});
  const base='http://127.0.0.1:'+port;
  const health=await(await fetch(base+'/api/health')).json(); assert.equal(health.ok,true); assert.ok(!Number.isNaN(Date.parse(health.time)));
  const preflight=await fetch(base+'/api/session',{method:'OPTIONS',headers:{origin:'https://desk.example','access-control-request-method':'POST'}});
  assert.equal(preflight.status,204); assert.equal(preflight.headers.get('access-control-allow-origin'),'https://desk.example');
  assert.equal(preflight.headers.get('access-control-allow-credentials'),'true');
  assert.equal((await fetch(base+'/api/tickets')).status,401);
  assert.equal((await fetch(base+'/api/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'admin',password:'bad'})})).status,401);
  const login=await fetch(base+'/api/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'admin',password:'test-only-secret'})});
  const cookie=login.headers.get('set-cookie').split(';')[0]; assert.match(login.headers.get('set-cookie'),/HttpOnly/); assert.match(login.headers.get('set-cookie'),/SameSite=None/); assert.match(login.headers.get('set-cookie'),/Secure/);
  const design = await fs.readFile(new URL('./print-sample.svg', import.meta.url), 'utf8');
  const form=()=>{const data=new FormData();for(const[k,v]of Object.entries({...input,machine:'printer',paperType:'Glossy'}))data.set(k,v);data.set('files',new Blob([design]),'sample.svg');return data;};
  assert.equal((await fetch(base+'/api/session',{method:'POST'})).status,400);
  assert.equal((await fetch(base+'/api/session',{method:'POST',headers:{'content-type':'application/json'},body:'{"password":'})).status,400);
  assert.equal((await fetch(base+'/api/tickets',{method:'POST',body:form()})).status,400);
  assert.equal((await fs.readdir(path.join(dir,'uploads'))).length,0);
  const stalled = await Promise.all(Array.from({length:4},(_,index)=>new Promise((resolve,reject)=>{
    const socket=net.createConnection({host:'127.0.0.1',port:Number(port)});
    socket.once('error',reject);
    socket.once('connect',()=>{
      socket.write(`POST /api/tickets HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nIdempotency-Key: stalled-upload-${index + 100}\r\nContent-Type: multipart/form-data; boundary=stall\r\nContent-Length: 100000000\r\nConnection: close\r\n\r\n--stall\r\nContent-Disposition: form-data; name="machine"\r\n\r\nf`);
      resolve(socket);
    });
  })));
  await Promise.all(stalled.map(socket=>once(socket,'close')));
  const response=await fetch(base+'/api/tickets',{method:'POST',headers:{'idempotency-key':'http-test-request-123'},body:form()});
  assert.equal(response.status,201);const receipt=await response.json();assert.match(receipt.ticket.trackingNumber,/^DM-[A-HJ-NP-Z2-9]{12}$/);assert.equal(receipt.ticket.ticketNumber,undefined);assert.equal(receipt.ticket.status,'pending-review');assert.equal(receipt.ticket.costEstimate,null);
  const retry=await fetch(base+'/api/tickets',{method:'POST',headers:{'idempotency-key':'http-test-request-123'},body:form()});assert.equal(retry.status,200);
  const list=await(await fetch(base+'/api/tickets',{headers:{cookie}})).json();assert.equal(list.tickets.length,0);assert.equal(list.sheets.configured,false);assert.equal(list.emailNotifications.configured,false);
  const adminList=await(await fetch(base+'/api/admin/requests',{headers:{cookie}})).json();
  const job=adminList.tickets[0], download=base+'/api/tickets/'+job.id+'/files/'+job.files[0].storedName;
  assert.equal((await fetch(download)).status,401);
  const downloaded = await fetch(download,{headers:{cookie}});
  assert.equal(downloaded.headers.get('content-type'),'application/octet-stream');
  assert.match(downloaded.headers.get('content-disposition'),/^attachment;/);
  assert.equal(await downloaded.text(),design);
  assert.equal((await fs.readdir(path.join(dir,'uploads'))).length,1);
  const review=await fetch(base+'/api/admin/requests/'+job.id+'/review',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({decision:'approve',operator:'Admin',fields:{paperType:'Glossy'},expectedRevision:job.revision})});
  assert.equal(review.status,200);const approved=(await review.json()).ticket;assert.equal(approved.status,'queued');assert.equal(approved.costEstimate.amountDisplay,'$14.00');
  const patch = body => fetch(base+'/api/tickets/'+job.id,{method:'PATCH',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await patch({status:'ready'})).status,400);
  assert.equal((await patch({status:'ready',expectedRevision:approved.revision})).status,409);
  const started=await patch({status:'in-progress',expectedRevision:approved.revision});assert.equal(started.status,200);const working=(await started.json()).ticket;
  const usage=await fetch(base+'/api/tickets/'+job.id+'/usage',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({requestKey:'http-usage-request-123',used:6,waste:1,operator:'Tester',note:'Print and setup trim',expectedRevision:working.revision})});assert.equal(usage.status,200);const measured=(await usage.json()).ticket;
  assert.equal((await patch({status:'ready',expectedRevision:measured.revision})).status,200);
  assert.equal((await patch({status:'cancelled',expectedRevision:job.revision})).status,409);
  const changed = form(); changed.set('quantity','99');
  assert.equal((await fetch(base+'/api/tickets',{method:'POST',headers:{'idempotency-key':'http-test-request-123'},body:changed})).status,409);
  const malicious = form(); malicious.set('files',new Blob(['<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>']),'attack.svg');
  assert.equal((await fetch(base+'/api/tickets',{method:'POST',headers:{'idempotency-key':'http-malicious-1234'},body:malicious})).status,400);
  const disguised = form(); disguised.set('files',new Blob(['not a pdf']),'bad.pdf');
  assert.equal((await fetch(base+'/api/tickets',{method:'POST',headers:{'idempotency-key':'http-disguised-1234'},body:disguised})).status,400);
  const oversized = form(); oversized.set('files',new Blob([new Uint8Array(1048577)]),'oversized.png');
  const oversizedResponse = await fetch(base+'/api/tickets',{method:'POST',headers:{'idempotency-key':'http-oversized-1234'},body:oversized});
  assert.equal(oversizedResponse.status,400); assert.match((await oversizedResponse.json()).error,/1 MB/);
  assert.equal((await fs.readdir(path.join(dir,'uploads'))).length,1);
  const tracked=await(await fetch(base+'/api/track/'+receipt.ticket.trackingNumber)).json();assert.equal(tracked.status,'ready');assert.equal(tracked.costEstimate.amountDisplay,'$14.00');
  assert.equal((await fetch(base+'/api/track/P-0001')).status,404);
  const queue=await(await fetch(base+'/api/queue')).text();assert.ok(!queue.includes('Test Person'));assert.ok(!queue.includes('requester@example.com'));assert.ok(!queue.includes('sample.pdf'));assert.ok(!queue.includes('P-0001'));assert.ok(!queue.includes(receipt.ticket.trackingNumber));
  assert.equal((await fetch(base+'/api/export')).status,401);assert.match(await(await fetch(base+'/api/export',{headers:{cookie}})).text(),/P-0001/);
  assert.equal((await fetch(base+'/api/session',{method:'POST',headers:{origin:'https://other.invalid','content-type':'application/json'},body:'{}'})).status,403);
  assert.equal((await fetch(base+'/api/session',{method:'POST',headers:{origin:base.replace('http:','https:'),'content-type':'application/json'},body:'{}'})).status,403);
  await fetch(base+'/api/session',{method:'DELETE',headers:{cookie}});assert.equal((await fetch(base+'/api/tickets',{headers:{cookie}})).status,401);
});
