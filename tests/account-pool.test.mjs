import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {demoAccount,chooseAccount,consumeStep,nextRecovery} from '../lib/account-pool.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
test('routing skips expired login, disabled, incompatible and unknown or exhausted quota',()=>{
  const pool=Array.from({length:6},(_,i)=>demoAccount('account '+i));
  pool[0].auth='expired';pool[1].enabled=false;pool[2].models=['other'];pool[3].fiveHour.remaining=0;pool[4].weekly.remaining=0;
  assert.equal(chooseAccount(pool,'demo-codex-model').id,pool[5].id);
  pool[5].fiveHour.remaining=null;assert.equal(chooseAccount(pool,'demo-codex-model'),null);
  assert.equal(chooseAccount(pool,'other').id,pool[2].id);
});
test('five-hour reset preserves weekly exhaustion and waits for the later window',()=>{
  const a=demoAccount('A');a.fiveHour.remaining=0;a.fiveHour.resetsAt=10;a.weekly.remaining=0;a.weekly.resetsAt=100;
  assert.equal(nextRecovery([a],'demo-codex-model'),100);
  assert.equal(chooseAccount([a],'demo-codex-model',null,20),null);assert.equal(a.fiveHour.remaining,2);assert.equal(a.weekly.remaining,0);
  assert.equal(chooseAccount([a],'demo-codex-model',null,101).id,a.id);
  consumeStep(a);assert.equal(a.fiveHour.remaining,1);assert.equal(a.weekly.remaining,19);
});
test('HTTP multi-account relay inherits checkpoints, pauses without retrying, survives restart and recovers',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'account-pool-test-')),port=16317+Math.floor(Math.random()*1000),origin=`http://127.0.0.1:${port}`;
  let child,cookie;
  async function start(){child=spawn(process.execPath,[path.join(root,'server.mjs')],{env:{...process.env,AGENT_DESK_EDITION:'commercial',PORT:String(port),AGENT_DESK_DATA:dir,AGENT_DESK_SEED_DEMO:'1'},windowsHide:true,stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);});const res=await fetch(origin);cookie=res.headers.get('set-cookie').split(';')[0];}
  async function stop(){if(child?.exitCode==null){const done=new Promise(resolve=>child.once('exit',resolve));child.kill();await done;}}
  t.after(async()=>{await stop();fs.rmSync(dir,{recursive:true,force:true});});
  const post=async(route,b={})=>{const res=await fetch(origin+'/api/'+route,{method:'POST',headers:{Cookie:cookie,Origin:origin,'X-Agent-Desk':'1','Content-Type':'application/json'},body:JSON.stringify(b)});const value=await res.json();if(!res.ok)throw new Error(value.error);return value;};
  const state=async()=>await(await fetch(origin+'/api/state',{headers:{Cookie:cookie}})).json();
  const wait=async(id,status)=>{for(let i=0;i<120;i++){const task=(await state()).tasks.find(t=>t.id===id);if(task.status===status)return task;if(task.status==='failed')throw new Error(task.events.at(-1).text);await new Promise(r=>setTimeout(r,80));}throw new Error('task timeout');};
  await start();await post('memory',{text:'账号间必须继承测试暗号-9182'});
  const relay=await post('demo/account-run',{scenario:'relay'});
  const task=await wait(relay.taskId,'completed');
  assert.equal(task.completed.length,6);assert.equal(task.handoffs.length,2);
  const receipts=task.events.filter(e=>e.receipt).map(e=>e.receipt);
  assert.equal(new Set(receipts.map(r=>r.pid)).size,3);assert.deepEqual(receipts.map(r=>r.completed.length),[0,2,4]);
  assert.ok(receipts.every(r=>r.model==='demo-codex-model'&&r.effort==='medium'));
  const verification=JSON.parse(task.fileContents.find(f=>f.name==='account-pool-verification.json').content);
  assert.ok(Object.values(verification.checks).every(Boolean));
  assert.equal(task.fileContents.filter(f=>/^account-step-/.test(f.name)).length,6);
  const exhausted=await post('demo/account-run',{scenario:'exhausted'});
  let waiting=await wait(exhausted.taskId,'waiting_quota');assert.equal(waiting.completed.length,3);
  const eventCount=waiting.events.length;await new Promise(r=>setTimeout(r,250));waiting=(await state()).tasks.find(t=>t.id===waiting.id);assert.equal(waiting.events.length,eventCount);
  await stop();await start();waiting=(await state()).tasks.find(t=>t.id===exhausted.taskId);assert.equal(waiting.status,'waiting_quota');assert.equal(waiting.completed.length,3);
  await post('demo/account-recover',{taskId:waiting.id});const recovered=await wait(waiting.id,'completed');assert.equal(recovered.completed.length,4);
  const finalReceipt=recovered.events.filter(e=>e.receipt).at(-1).receipt;assert.equal(finalReceipt.completed.length,3);
  assert.equal(recovered.accountPool[0].weekly.remaining,18);assert.equal(recovered.fileContents.filter(f=>/^account-step-/.test(f.name)).length,4);
});
