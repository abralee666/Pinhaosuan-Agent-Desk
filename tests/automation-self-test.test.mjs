import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../lib/store.mjs';
import {QuotaResume} from '../lib/quota-resume.mjs';
import {relayTask} from '../lib/platform-relay.mjs';
import {createAutomationTest,selfTestProfile,finishAutomationTest} from '../lib/automation-self-test.mjs';

function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'desk-self-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new Store(dir,{empty:true});return store;}
test('sentinel self-test waits, refreshes the real profile and resumes once without mutating account quota',async t=>{
 const store=fixture(t);let now=1800000000000,refreshes=0,resumes=0;
 const profile={id:'account',session:'signed_in',enabled:true,checkedAt:new Date(now).toISOString(),quota:{fiveHour:{remaining:100}}};
 const before=structuredClone(profile);
 const task=createAutomationTest(store,{kind:'sentinel',provider:'codex',accountId:'account',now});
 const q=new QuotaResume({tasks:()=>[task],enabled:()=>true,busy:()=>false,profile:()=>selfTestProfile(task,profile,now),now:()=>now,publish:()=>{},refresh:async()=>{refreshes++;profile.checkedAt=new Date(now).toISOString();},resume:async()=>{resumes++;task.selfTest.phase='launching';task.status='running';}});
 q.schedule(task);await q.tick();now+=29000;await q.tick();assert.equal(resumes,0);assert.deepEqual(profile,before);
 now+=1001;await Promise.all([q.tick(),q.tick()]);assert.equal(refreshes,1);assert.equal(resumes,1);assert.equal(task.quotaWait.status,'continued');assert.equal(task.selfTest.phase,'launching');assert.equal(profile.quota.fiveHour.remaining,100);
 assert.equal(task.executionMode,'read-only');assert.equal(task.workspace.includes(task.id),true);
});
test('empty or wrong replies never pass; actual target exact reply does',t=>{
 const store=fixture(t),task=createAutomationTest(store,{kind:'relay',provider:'codex'});task.agent='antigravity';
 finishAutomationTest(store,task,'completed');assert.equal(task.selfTest.phase,'failed');
 store.event(task,'codex',task.selfTest.token);store.event(task,'antigravity','done '+task.selfTest.token);
 finishAutomationTest(store,task,'completed');assert.equal(task.selfTest.phase,'failed');
 store.event(task,'antigravity',task.selfTest.token);finishAutomationTest(store,task,'completed');assert.equal(task.selfTest.phase,'passed');
});
test('cancel stops waiting test; native startup error stops self-test retry loop',async t=>{
 const store=fixture(t);let now=1800000000000,resumes=0;
 const task=createAutomationTest(store,{kind:'sentinel',provider:'codex',now});
 const profile={session:'signed_in',checkedAt:new Date(now).toISOString(),quota:{fiveHour:{remaining:100}}};
 const q=new QuotaResume({tasks:()=>[task],enabled:()=>true,busy:()=>false,now:()=>now,profile:()=>selfTestProfile(task,profile,now),publish:()=>{},refresh:async()=>{throw Error('Eligibility check failed: EOF');},resume:async()=>resumes++,onError:(task,error)=>{q.cancel(task);finishAutomationTest(store,task,'failed',error.message);}});
 q.schedule(task);q.cancel(task);now+=31000;await q.tick();assert.equal(resumes,0);assert.equal(task.selfTest.phase,'canceled');
 task.selfTest.phase='waiting';q.schedule(task);now+=61000;await q.tick();await q.tick();assert.equal(task.selfTest.phase,'failed');assert.match(task.selfTest.error,/EOF/);assert.equal(task.quotaWait.status,'canceled');
});
test('relay self-test uses existing relay scheduler and preserves real destination checks',async t=>{
 const store=fixture(t),task=createAutomationTest(store,{kind:'relay',provider:'codex'});let launches=0;
 const settings={order:['codex','antigravity'],models:{},allowUnknownQuota:false};
 const result=await relayTask(store,task,settings,{reason:'self-test',probe:async()=>({error:'Eligibility check failed: EOF'}),launch:async()=>launches++});
 assert.equal(result,false);assert.equal(launches,0);assert.match(task.relayState.skipped[0].reason,/EOF/);assert.equal(task.agent,'codex');
});
