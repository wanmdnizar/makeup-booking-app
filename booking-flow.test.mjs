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
  const source=section('maxBookingsPerDay','    function capacityErrorMessage')+
    section('trackingId','    async function deleteBookingWithCapacity');
  const deps={...bindings,minutes,cents,fitsHours,timeToMinutes:minutes,num:Number,
    DATE_RE:/^\d{4}-\d\d-\d\d$/,TIME_RE:/^\d\d:\d\d$/,localDateStr:()=>'2030-01-01',currentUser:{uid:'owner'},
    navigator:{onLine:true},bookingsLoaded:true,bookingsServerLoaded:true,bookingsHasPendingWrites:false,
    DEFAULT_SETTINGS:{},appState:{bookings:[],requests:[],settings:{}}};
  return Function(...Object.keys(deps),source+'\nreturn saveBookingWithCapacity;')(...Object.values(deps));
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

test('Firestore Emulator: guest submission, private read, competing approvals and deposit recording',
  {skip:!process.env.FIRESTORE_EMULATOR_HOST},async()=>{
    const endpoint=new URL('http://'+process.env.FIRESTORE_EMULATOR_HOST);
    assert.ok(['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname));
    const {initializeTestEnvironment,assertFails}=await import('@firebase/rules-unit-testing');
    const sdk=await import('firebase/firestore');
    const rules=(await readFile(new URL('./firestore.rules',import.meta.url),'utf8')).replaceAll('PASTE_YOUR_ADMIN_UID_HERE','owner');
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
