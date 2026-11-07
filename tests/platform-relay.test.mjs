import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../lib/store.mjs';
import {defaultRelay,relayTrigger,relayEligibility,relayTask,validateRelaySettings,quotaFailure} from '../lib/platform-relay.mjs';
const profile=()=>({id:'verified-account',source:'local-session',enabled:true,session:'signed_in',checkedAt:new Date().toISOString(),quota:{fiveHour:{remaining:80},weekly:{remaining:40}}});
function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'desk-relay-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new Store(dir,{empty:true});const task=store.createTask('finish the report','live');task.agent='codex';return {store,task};}
test('quota failure triggers relay while manual interruption and authentication errors do not',()=>{
  assert.equal(relayTrigger('failed',"You've hit your usage limit",defaultRelay()),'quota');
  assert.equal(relayTrigger('failed','usageLimitExceeded',defaultRelay()),'quota');
  assert.equal(relayTrigger('interrupted','已停止',defaultRelay()),null);
  assert.equal(relayTrigger('failed','login required',defaultRelay()),null);
  assert.equal(relayTrigger('interrupted','Codex 后台连接中断',defaultRelay()),null);
  assert.equal(relayTrigger('interrupted','Codex 后台连接中断',{onDisconnect:true}),'disconnect');
});
test('unknown quota needs opt-in; exhausted quota and fixture identities are never eligible',()=>{
  const p=profile();p.quota=null;assert.ok(relayEligibility(p));assert.equal(relayEligibility(p,true),null);
  p.quota={fiveHour:{remaining:0},weekly:{remaining:50}};assert.ok(relayEligibility(p,true));
  p.source='fixture';assert.ok(relayEligibility(p,true));
});
test('cross-provider transfer preserves memory, completed work, history and file hashes',async t=>{
  const {store,task}=setup(t);store.addMemory('Keep the report in Chinese');task.completed.push('Research finished');store.event(task,'codex','Partial answer already written');store.writeArtifact(task,'report.md','Verified research data');
  let inherited;
  const result=await relayTask(store,task,{...defaultRelay(),enabled:true},{reason:'quota',probe:async()=>({profile:profile(),settings:{resolvedModel:'other-provider-model',effort:'high'}}),launch:async(target,settings,pack)=>{assert.equal(target,'antigravity');assert.equal(settings.effort,'high');inherited=pack;}});
  assert.equal(result,true);assert.equal(task.agent,'antigravity');assert.equal(task.handoffs.length,1);assert.equal(task.accountId,'verified-account');
  assert.equal(inherited.memories[0].text,'Keep the report in Chinese');assert.deepEqual(inherited.completed,['Research finished']);
  assert.ok(JSON.stringify(inherited).includes('Partial answer already written'));assert.ok(JSON.stringify(inherited).includes('Verified research data'));
  assert.equal(task.handoffs[0].contextHash,inherited.hash);
  const reopened=new Store(store.root);assert.equal(reopened.task(task.id).handoffs[0].contextHash,inherited.hash);
});
test('no available platform saves progress and waits without launching or looping',async t=>{
  const {store,task}=setup(t);let probes=0,launches=0;
  const hooks={probe:async()=>{probes++;return {error:'not connected'};},launch:async()=>launches++};
  await relayTask(store,task,defaultRelay(),hooks);
  assert.equal(task.status,'waiting_agent');assert.equal(probes,1);assert.equal(launches,0);assert.ok(task.checkpoints.length);
  task.relayAttempted=['codex','antigravity'];await relayTask(store,task,defaultRelay(),hooks);assert.equal(probes,1);
});
test('stopping while a platform is being checked prevents launch and preserves interrupted status',async t=>{
  const {store,task}=setup(t);let stopped=false,launches=0;
  await relayTask(store,task,defaultRelay(),{cancelled:()=>stopped,probe:async()=>{stopped=true;task.status='interrupted';return {profile:profile()};},launch:async()=>launches++});
  assert.equal(launches,0);assert.equal(task.status,'interrupted');
});
test('priority order is validated and model preferences remain platform-specific',()=>{
  assert.throws(()=>validateRelaySettings({order:['codex','codex']}));
  const config=validateRelaySettings({...defaultRelay(),models:{codex:{model:'codex-model',effort:'high'},antigravity:{model:'gemini-model',effort:'low'}}});
  assert.equal(config.models.codex.model,'codex-model');assert.equal(config.models.antigravity.effort,'low');
});
test('real workspace-credit and EOF diagnostics are classified separately',()=>{
 const text='Your workspace is out of credits. Ask your workspace owner to refill in order to continue.';
 assert.equal(quotaFailure(text),'credits');assert.equal(relayTrigger('failed',text,defaultRelay()),'credits');
 assert.equal(quotaFailure('Eligibility check failed: EOF'),null);assert.equal(relayTrigger('failed','Eligibility check failed: EOF',{onDisconnect:true}),'disconnect');
});
test('handoff is pending until execution confirmation, and a failed launch stays failed',async t=>{
 const {store,task}=setup(t);let pending;
 const ok=await relayTask(store,task,defaultRelay(),{probe:async()=>({profile:profile()}),launch:async()=>{pending=task.relayState.phase;throw Error('Eligibility check failed: EOF');}});
 assert.equal(ok,false);assert.equal(pending,'launching');assert.equal(task.relayState.phase,'failed');assert.equal(task.status,'waiting_agent');
 assert.ok(!task.events.some(e=>e.text.includes('任务已从')));
});
test('manual retry may retry the failed current platform after other candidates are unavailable',async t=>{
 const {store,task}=setup(t);task.agent='antigravity';let launched;
 await relayTask(store,task,defaultRelay(),{retryCurrent:true,probe:async provider=>provider==='codex'?{error:'额度未知'}:{profile:profile()},launch:async provider=>{launched=provider;}});
 assert.equal(launched,'antigravity');assert.equal(task.relayState.phase,'launching');
});
