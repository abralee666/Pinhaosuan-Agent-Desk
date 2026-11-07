import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../lib/store.mjs';import {QuotaResume} from '../lib/quota-resume.mjs';import {relayTask,defaultRelay,quotaFailure} from '../lib/platform-relay.mjs';
test('credits exhausted, target EOF, restart, verified source recovery continues once using the original account',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'desk-recovery-flow-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store=new Store(root,{empty:true}),task=store.createTask('准备开源资料，上传前审核','live');let now=1800000000000;
 task.accountId='source-account';task.status='failed';task.recovery={reason:quotaFailure('Your workspace is out of credits. Ask your workspace owner to refill in order to continue.')};
 let source={enabled:true,session:'signed_in',ordinaryUsageAllowed:false,usageCheckedAt:new Date(now).toISOString(),quota:{fiveHour:{remaining:100}}};let resumes=0,refreshes=0;
 const factory=tasks=>new QuotaResume({tasks:()=>tasks,enabled:()=>true,busy:()=>false,now:()=>now,publish:()=>{},profile:(_task,wait)=>{assert.equal(wait.provider,'codex');assert.equal(wait.accountId,'source-account');return source;},refresh:async(_task,wait)=>{assert.equal(wait.accountId,'source-account');refreshes++;source.usageCheckedAt=new Date(now).toISOString();},resume:async(target,wait)=>{assert.equal(wait.provider,'codex');assert.equal(wait.accountId,'source-account');resumes++;target.status='running';}});
 const scheduler=factory([task]);scheduler.schedule(task);
 await relayTask(store,task,defaultRelay(),{reason:'credits',probe:async()=>({profile:{id:'target-account',source:'local-session',enabled:true,session:'signed_in',checkedAt:new Date().toISOString(),quota:{fiveHour:{remaining:100},weekly:{remaining:100}}}}),launch:async()=>{task.recovery={reason:'disconnect'};throw Error('Eligibility check failed: EOF');}});
 assert.equal(task.agent,'antigravity');assert.equal(task.relayState.phase,'failed');assert.equal(task.quotaWait.provider,'codex');
 now+=61000;await scheduler.tick();assert.equal(resumes,0);assert.equal(refreshes,1);
 store.save();const restored=new Store(root,{empty:true}).task(task.id),afterRestart=factory([restored]);
 source.ordinaryUsageAllowed=true;source.usageCheckedAt=new Date(now).toISOString();await Promise.all([afterRestart.tick(),afterRestart.tick()]);
 assert.equal(resumes,1);assert.equal(restored.quotaWait.status,'continued');await afterRestart.tick();assert.equal(resumes,1);
 assert.match(restored.goal,/上传前审核/);
});
test('dependency caches do not displace actual task outputs in checkpoints or handoff packs',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'desk-cache-filter-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store=new Store(root,{empty:true}),task=store.createTask('handoff','live');fs.mkdirSync(path.join(task.workspace,'.npm-cache'));fs.writeFileSync(path.join(task.workspace,'.npm-cache','index'),'cache');fs.writeFileSync(path.join(task.workspace,'REVIEW.md'),'review before upload');
 assert.deepEqual(store.context(task,'antigravity').files.map(f=>f.name),['REVIEW.md']);assert.deepEqual(store.checkpoint(task,'codex').files.map(f=>f.name),['REVIEW.md']);
});
