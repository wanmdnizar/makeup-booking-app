// Node's test runner. Emulator integration only connects to loopback and a demo project.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {depositMet, catalogueQuote, fitsHours, minutes, cents, clientCalendarUrl} from './studio-core.js';

const main = {id:'bridal',name:'Bridal',price:1200,addon:false,durationMins:240};
const extra = {id:'touch',name:'Touch-up',price:150,addon:true,durationMins:60};
const date = '2030-12-25';
test('studio catalogue determines price and finish',()=>{
  const request={packageId:'bridal',packagePrice:1,durationMins:30,addons:[{id:'touch',name:'Touch-up',price:1}]};
  const quote=catalogueQuote(request,[main,extra]);
  assert.equal(quote.serviceTotal,1350);assert.equal(quote.duration,300);
  assert.throws(()=>catalogueQuote({...request,addons:[{name:'Retired add-on'}]},[main,extra]));
});
test('working hours and partial blocks allow exact boundaries',()=>{
  const rules={workingHours:Array(7).fill({start:'08:00',end:'18:00'}),timeBlocks:[{date,start:'13:00',end:'14:00'}]};
  assert.ok(fitsHours(rules,date,540,780));assert.ok(fitsHours(rules,date,840,1080));
  assert.equal(fitsHours(rules,date,541,781),false);assert.equal(fitsHours(rules,date,900,1081),false);
  assert.equal(fitsHours({workingHours:Array(7).fill({closed:true})},date,540,600),false);
});
test('payment stages work with partial, waived and older deposits',()=>{
  for(const [required,paid,expected] of [[200,100,false],[200,200,true],[0,0,true],[null,10,true],[null,0,false]]) {
    assert.equal(depositMet({depositRequired:required,depositPaid:paid}),expected);
  }
  const u=new URL(clientCalendarUrl({eventDate:date,startTime:'07:00',durationMins:240,packageName:'Bridal',venue:'Meru'}));
  assert.equal(u.searchParams.get('ctz'),'Asia/Kuala_Lumpur');assert.equal(u.searchParams.get('dates'),'20301225T070000/20301225T110000');
});

// Exercise the production approval transaction with the same Firestore API as the studio.
async function approvalFunction(bindings) {
  const html=await readFile(new URL('./index.html',import.meta.url),'utf8');
  const section=(from,to)=>html.slice(html.indexOf('    function '+from),html.indexOf(to,html.indexOf('    function '+from)));
  const source=section('bookingPax','    function normalizeBooking')+
    section('maxBookingsPerDay','    function capacityErrorMessage')+
    section('trackingId','    // Runs a Firestore write');
  const deps={...bindings,minutes,cents,fitsHours,timeToMinutes:minutes,num:Number,
    DATE_RE:/^\d{4}-\d\d-\d\d$/,TIME_RE:/^\d\d:\d\d$/,localDateStr:()=>'2030-01-01',currentUser:{uid:'owner'},
    navigator:{onLine:true},bookingsLoaded:true,bookingsServerLoaded:true,bookingsHasPendingWrites:false,
    DEFAULT_SETTINGS:{},appState:{bookings:[],requests:[],settings:{}}};
  const save=Function(...Object.keys(deps),source+'\nreturn Object.assign(saveBookingWithCapacity,{remove:deleteBookingWithCapacity,pax:bookingPax});')(...Object.values(deps));
  return save;
}
function appointment(id){return {id,clientName:'Test client',clientPhone:'0123456789',eventDate:date,startTime:'07:00',endTime:'11:00',
  packageName:'Bridal',venue:'Meru',subtotal:1250,depositRequired:200,depositPaid:0};}
function approvalOptions(id){return {requestId:id,revision:0,travelFee:50,enforceCapacity:true,enforceBlockedDate:true,enforceSlotConflict:true,catalogueItems:[main]};}

test('approval rejects a second appointment for the same time and publishes approved terms',async()=>{
  const docs=new Map([['requests/a',{guest:true,status:'pending',revision:0}],['requests/b',{guest:true,status:'pending',revision:0}],['studio/packages/bridal',main]]);
  const db={};const save=await approvalFunction({db,doc:(_db,...p)=>p.join('/'),userDoc:(...p)=>'studio/'+p.join('/'),serverTimestamp:()=>1,
    runTransaction:async(_,fn)=>{
      const changes=new Map();
      await fn({get:async k=>({exists:()=>docs.has(k),data:()=>docs.get(k)}),set:(k,d,o)=>changes.set(k,o?.merge?{...docs.get(k),...d}:d)});
      for(const [k,v] of changes)docs.set(k,v);
    }});
  await save(appointment('a'),approvalOptions('a'));
  assert.equal(docs.get('clientApprovals/a').depositRequired,200);
  await assert.rejects(()=>save(appointment('b'),approvalOptions('b')),/daily-time-conflict/);
  assert.equal(docs.get('requests/b').status,'pending');
});

// ---- Party-size, buffer, move/delete and older-booking checks (in-memory Firestore stand-in) ----
async function memoryStudio(settings={}) {
  const docs=new Map([['studio/packages/bridal',main],['studio/meta/profile',{bufferMins:90,maxBookingsPerDay:3,
    workingHours:Array(7).fill({start:'06:00',end:'20:00'}),...settings}]]);
  const db={};const save=await approvalFunction({db,doc:(_db,...p)=>p.join('/'),userDoc:(...p)=>'studio/'+p.join('/'),serverTimestamp:()=>1,
    runTransaction:async(_,fn)=>{
      const changes=new Map();
      await fn({get:async k=>({exists:()=>docs.has(k),data:()=>docs.get(k)}),
        set:(k,d,o)=>changes.set(k,o?.merge?{...docs.get(k),...d}:d),delete:k=>changes.set(k,null)});
      for(const [k,v] of changes) v===null?docs.delete(k):docs.set(k,v);
    }});
  return {docs,save};
}
const job=(id,start,end,pax,extra={})=>({...appointment(id),startTime:start,endTime:end,pax,...extra});
const saveOpts={allowOverwrite:true,enforceCapacity:true,enforceSlotConflict:true};

test('daily limit counts people: 2 booked leaves one place; a 3-person party fills the day',async()=>{
  const {save}=await memoryStudio();
  await save(job('a','06:00','08:00',1),saveOpts);await save(job('b','10:00','12:00',1),saveOpts);
  await save(job('c','14:00','16:00',1),saveOpts);                                   // third person fits
  await assert.rejects(()=>save(job('d','18:00','19:00',1),saveOpts),/daily-capacity-reached/);
  const two=await memoryStudio();
  await two.save(job('a','06:00','08:00',2),saveOpts);
  await assert.rejects(()=>two.save(job('b','12:00','16:00',2),saveOpts),/daily-capacity-reached/);
  await two.save(job('c','12:00','14:00',1),saveOpts);
  const three=await memoryStudio();
  await three.save(job('t','06:00','12:00',3),saveOpts);
  await assert.rejects(()=>three.save(job('x','16:00','17:00',1),saveOpts),/daily-capacity-reached/);
});

test('travel buffer: exactly the buffer apart is allowed, closer is not',async()=>{
  const {save}=await memoryStudio();
  await save(job('a','08:00','10:00',1),saveOpts);
  await assert.rejects(()=>save(job('b','11:00','13:00',1),saveOpts),/daily-time-conflict/);
  await save(job('c','11:30','13:30',1),saveOpts);
});

test('moving or deleting a booking frees its places on the original date',async()=>{
  const {docs,save}=await memoryStudio();
  await save(job('g','08:00','14:00',3),saveOpts);
  await assert.rejects(()=>save(job('h','16:00','17:00',1),saveOpts),/daily-capacity-reached/);
  await save(job('g','08:00','14:00',3,{eventDate:'2030-12-26'}),{mustExist:true,enforceCapacity:true});
  assert.equal(docs.get('studio/dailyCapacity/'+date).paxCount,0);
  await save(job('h','16:00','17:00',1),saveOpts);
  await save.remove('g');
  assert.equal(docs.get('studio/dailyCapacity/2030-12-26').paxCount,0);
});

test('older bookings without a stored headcount fall back predictably',async()=>{
  const {save}=await memoryStudio();
  for(const [booking,expected] of [[{},1],[{packageName:'Group makeup · 3 people'},3],[{notes:'Request NB-1 | 2 pax | x'},2],
    [{people:[{},{}]},2],[{pax:3},3],[{notes:'wants 3 pax'},1]]) assert.equal(save.pax(booking),expected);
});

test('Firestore Emulator: guest submission, private read, competing approvals and deposit recording',
  {skip:!process.env.FIRESTORE_EMULATOR_HOST},async()=>{
    const endpoint=new URL('http://'+process.env.FIRESTORE_EMULATOR_HOST);
    assert.ok(['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname));
    const {initializeTestEnvironment,assertFails}=await import('@firebase/rules-unit-testing');
    const sdk=await import('firebase/firestore');
    const rules=(await readFile(new URL('./firestore.rules',import.meta.url),'utf8')).replaceAll('PASTE_YOUR_ADMIN_UID_HERE','owner').replaceAll('lGzZypXcTogMF4FajXx7Oe2ntpE2','owner');
    const env=await initializeTestEnvironment({projectId:'demo-nureen-regression',firestore:{host:endpoint.hostname,port:Number(endpoint.port),rules}});
    try {
      await env.clearFirestore();
      const guest=env.authenticatedContext('guest').firestore(), owner=env.authenticatedContext('owner').firestore(), outsider=env.authenticatedContext('another').firestore();
      const ref=(db,...path)=>sdk.doc(db,...path);
      await sdk.setDoc(ref(owner,'studios','owner','packages','bridal'),main);
      const secret='1'.repeat(64);
      for(const id of ['a','b']){
        const batch=sdk.writeBatch(guest);
        batch.set(ref(guest,'guestKeys',id),{creator:'guest',secret});
        batch.set(ref(guest,'requests',id),{ref:'NB-TEST01',guest:true,revision:0,status:'pending',source:'public-page',termsAccepted:true,createdAt:sdk.serverTimestamp(),
          clientName:'Test client',phone:'0123456789',email:'',packageId:'bridal',packageName:'Bridal',packagePrice:1200,durationMins:240,addons:[],
          eventDate:date,startTime:'07:00',readyBy:'11:00',pax:1,venue:'Meru',mapLink:'',allergyStatus:'none',allergies:'',moodboardLink:'',notes:''});
        await batch.commit();
      }
      await sdk.setDoc(ref(guest,'guestSessions','guest','bookings','a'),{secret});
      await sdk.getDoc(ref(guest,'requests','a'));
      await assertFails(sdk.getDoc(ref(outsider,'requests','a')));
      await assertFails(sdk.updateDoc(ref(guest,'requests','a'),{venue:'Another venue'}));
      const save=await approvalFunction({db:owner,doc:sdk.doc,userDoc:(...p)=>ref(owner,'studios','owner',...p),runTransaction:sdk.runTransaction,serverTimestamp:sdk.serverTimestamp});
      const results=await Promise.allSettled(['a','b'].map(id=>save(appointment(id),approvalOptions(id))));
      assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
      assert.match(results.find(x=>x.status==='rejected').reason.message,/daily-time-conflict/);
      const id=results[0].status==='fulfilled'?'a':'b';
      await sdk.setDoc(ref(guest,'guestSessions','guest','bookings',id),{secret});
      await save({...appointment(id),depositPaid:100},{mustExist:true,enforceCapacity:true});
      const ticket=ref(guest,'clientApprovals',id);
      assert.equal(depositMet((await sdk.getDoc(ticket)).data()),false);
      await save({...appointment(id),depositPaid:200},{mustExist:true,enforceCapacity:true});
      assert.equal(depositMet((await sdk.getDoc(ticket)).data()),true);
      await assertFails(sdk.updateDoc(ticket,{depositPaid:500}));
    } finally {await env.cleanup();}
});
