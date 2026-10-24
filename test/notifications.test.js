import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createNotifications} from '../lib/notifications.js';
import {validateTicket} from '../lib/store.js';
const event=(status='ready')=>({id:'ticket-id',ticketNumber:'P-0001',status,history:[{status,at:'2026-10-23T01:00:00Z',notification:{status,phone:'+13025550123',ticketNumber:'P-0001'}}]});
async function dir(t){const d=await fs.mkdtemp(path.join(os.tmpdir(),'sms-test-'));t.after(()=>fs.rm(d,{recursive:true,force:true}));return d;}
const response=(status,body)=>({ok:status<400,status,json:async()=>body});
test('Textbee acceptance is journaled once across retries and restarts, without claiming delivery',async t=>{
 const directory=await dir(t);let sends=0;
 const options={directory,apiKey:'private-test-key',deviceId:'dedicated-mandir-device',fetcher:async(url,opts)=>{
  sends++;assert.equal(url,'https://api.textbee.dev/api/v1/gateway/send-sms');assert.equal(opts.headers['x-api-key'],'private-test-key');
  const body=JSON.parse(opts.body);assert.equal(body.deviceId,'dedicated-mandir-device');assert.deepEqual(body.recipients,['+13025550123']);assert.match(body.message,/ready for pickup/);
  return response(200,{data:{success:true,smsBatchId:'batch-1'}});
 }};
 const n=await createNotifications(options);await Promise.all([n.reconcile([event()]),n.reconcile([event()])]);
 assert.equal(sends,1);assert.equal(n.decorate(event()).notifications[0].state,'accepted');assert.match(n.decorate(event()).notifications[0].detail,/not yet confirmed/);
 assert.equal(n.decorate(event()).notifications[0].phone,undefined);
 await (await createNotifications(options)).reconcile([event()]);assert.equal(sends,1);
});
test('free-tier rejection is visible and manually retryable, but never repeatedly auto-sent',async t=>{
 const directory=await dir(t);let sends=0;
 const n=await createNotifications({directory,apiKey:'key',deviceId:'device',fetcher:async()=>{sends++;return sends===1?response(429,{}):response(200,{data:{success:true,smsBatchId:'retry-batch'}});}});
 await n.reconcile([event('declined')]);await n.reconcile([event('declined')]);assert.equal(sends,1);
 const notice=n.decorate(event()).notifications[0];assert.equal(notice.state,'failed');assert.match(notice.detail,/limit/);
 await n.retry(notice.id,event('declined'));assert.equal(sends,2);
 await assert.rejects(n.retry(notice.id,event('declined')),e=>e.status===409);
});
test('network uncertainty and restart during send do not produce duplicate SMS',async t=>{
 const directory=await dir(t);let sends=0;
 const options={directory,apiKey:'key',deviceId:'device',fetcher:async()=>{sends++;throw new Error('timeout');}};
 const n=await createNotifications(options);await n.reconcile([event('cancelled')]);
 const notice=n.decorate(event()).notifications[0];assert.equal(notice.state,'unknown');
 await assert.rejects(n.retry(notice.id,event('cancelled')),e=>e.status===409);
 const disk=JSON.parse(await fs.readFile(path.join(directory,'notifications.json'),'utf8'));disk[notice.id].state='sending';await fs.writeFile(path.join(directory,'notifications.json'),JSON.stringify(disk));
 const restarted=await createNotifications(options);await restarted.reconcile([event('cancelled')]);assert.equal(sends,1);assert.equal(restarted.decorate(event()).notifications[0].state,'unknown');
});
test('unconfigured notifications remain pending; obsolete ready messages are not sent later',async t=>{
 const directory=await dir(t);const n=await createNotifications({directory});await n.reconcile([event()]);assert.equal(n.decorate(event()).notifications[0].state,'pending');
 let sends=0;const connected=await createNotifications({directory,apiKey:'key',deviceId:'device',fetcher:async()=>{sends++;return response(200,{})}});
 await connected.reconcile([{...event(),status:'collected'}]);assert.equal(sends,0);assert.equal(connected.decorate(event()).notifications[0].state,'superseded');
});
test('tickets without opt-in notification events send no texts; phone normalization requires valid consented number',async t=>{
 let sends=0;const n=await createNotifications({directory:await dir(t),apiKey:'key',deviceId:'device',fetcher:async()=>{sends++;}});
 await n.reconcile([{...event(),history:[]}]);assert.equal(sends,0);
 const details={machine:'foam',customerName:'Person',department:'Events',purpose:'Design',quantity:1,width:20,length:30,thickness:2,neededBy:'No rush',phone:'(302) 555-0123',smsConsent:'true'};
 assert.equal(validateTicket(details,[]).phone,'+13025550123');assert.throws(()=>validateTicket({...details,phone:'bad'},[]),/mobile number/);
 assert.equal(validateTicket({...details,smsConsent:false,phone:''},[]).smsConsent,false);
});
