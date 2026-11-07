import {test} from 'node:test';
import {paidFixture} from './paid-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {initialManager,quotaKnown,activate,selectForTask,removeAccount} from '../lib/account-manager.mjs';
test('provider sessions and daily quota cache are independent; logout precedes login',async()=>{
  const m=initialManager(),p=m.providers.codex,[a,b]=p.accounts;
  assert.equal(quotaKnown(a),false);await activate(p,a.id,{delay:0});assert.equal(quotaKnown(a),true);
  a.checkedAt=new Date(Date.now()-86400000).toISOString();assert.equal(quotaKnown(a),false);
  await activate(p,b.id,{delay:0});assert.equal(a.session,'signed_out');assert.equal(b.session,'signed_in');
  const actions=p.audit.slice(6).map(e=>e.action);assert.ok(actions.indexOf('logout_completed')<actions.indexOf('login_started'));
  assert.equal(m.providers.antigravity.activeAccountId,null);assert.equal(m.providers.antigravity.accounts[0].quota,null);
});
test('automatic switching is optional; manual selection resumes on the chosen account',async()=>{
  const p=initialManager().providers.antigravity,[a,b]=p.accounts;
  await activate(p,a.id,{delay:0});a.quota.fiveHour.remaining=0;
  assert.equal(await selectForTask(p,a.id,{delay:0}),null);assert.equal(b.checkedAt,null);
  p.autoSwitch=true;assert.equal((await selectForTask(p,a.id,{delay:0})).id,b.id);
  assert.equal(a.session,'signed_out');assert.equal(b.session,'signed_in');
  p.autoSwitch=false;assert.equal((await selectForTask(p,a.id,{delay:0})).id,b.id);
  b.quota.weekly.remaining=0;p.autoSwitch=true;assert.equal(await selectForTask(p,b.id,{delay:0}),null);
});
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
test('HTTP preview adds accounts without passwords; both providers log in, query and relay without upstream calls',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'account-manager-test-')),port=18317+Math.floor(Math.random()*1000),origin=`http://127.0.0.1:${port}`;
  const {publicKeyFile}=paidFixture(dir);
  const child=spawn(process.execPath,[path.join(root,'server.mjs')],{env:{...process.env,AGENT_DESK_EDITION:'commercial',PORT:String(port),AGENT_DESK_DATA:dir,AGENT_DESK_SEED_DEMO:'1',AGENT_DESK_LICENSE_PUBLIC_KEY_FILE:publicKeyFile},windowsHide:true,stdio:['ignore','pipe','pipe']});
  t.after(async()=>{if(child.exitCode==null){const ended=new Promise(r=>child.once('exit',r));child.kill();await ended;}fs.rmSync(dir,{recursive:true,force:true});});
  await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);});
  const first=await fetch(origin),cookie=first.headers.get('set-cookie').split(';')[0];
  const post=async(route,b)=>{const res=await fetch(origin+'/api/'+route,{method:'POST',headers:{Cookie:cookie,Origin:origin,'X-Agent-Desk':'1','Content-Type':'application/json'},body:JSON.stringify(b)});const body=await res.json();assert.equal(res.status,200,body.error);return body;};
  const state=async()=>await(await fetch(origin+'/api/state',{headers:{Cookie:cookie}})).json();
  const wait=async(id,status)=>{for(let i=0;i<180;i++){const task=(await state()).tasks.find(t=>t.id===id);if(task.status===status)return task;if(task.status==='failed')throw new Error(task.events.at(-1).text);await new Promise(r=>setTimeout(r,60));}throw new Error('timeout');};
  const added=await post('accounts/add',{provider:'antigravity',name:'另一个账号',identifier:'other@example.test',passwordProvided:true});
  assert.ok(added.accountId);
  const disposable=await post('accounts/add',{provider:'antigravity',name:'待移除',identifier:'remove@example.test',passwordProvided:true});
  await post('accounts/activate',{provider:'antigravity',accountId:disposable.accountId});
  await post('accounts/remove',{provider:'antigravity',accountId:disposable.accountId});
  const removedState=await state();
  assert.equal(removedState.accountManager.providers.antigravity.activeAccountId,null);
  assert.ok(!removedState.accountManager.providers.antigravity.accounts.some(a=>a.id===disposable.accountId));
  assert.ok(!removedState.membership.slots.some(a=>a.accountId===disposable.accountId));
  assert.equal((await fetch(origin+'/execution-ui.js')).status,200);
assert.ok(!fs.readFileSync(path.join(dir,'state.json'),'utf8').includes('passwordProvided'));
  for(const provider of ['codex','antigravity']){
    let s=await state();const account=s.accountManager.providers[provider].accounts[0];
    assert.equal(account.quota,null);await post('accounts/activate',{provider,accountId:account.id});
    const created=await post('accounts/task',{provider,goal:'关闭自动切换验证'});
    let paused=await wait(created.taskId,'waiting_account');assert.equal(paused.completed.length,2);
    await post('accounts/settings',{provider,autoSwitch:true});await post('run',{taskId:created.taskId});
    const completed=await wait(created.taskId,'completed');assert.equal(completed.completed.length,4);assert.equal(completed.handoffs.length,1);
    assert.equal(completed.agent,provider);assert.ok(completed.events.filter(e=>e.receipt).every(e=>e.actor===provider));
    s=await state();const p=s.accountManager.providers[provider];assert.equal(p.accounts[0].session,'signed_out');assert.equal(p.accounts[1].session,'signed_in');
    assert.equal(s.runtime.codex.connected,false);assert.equal(s.runtime.antigravity.connected,false);
  }
  await post('accounts/query',{provider:'antigravity',accountId:added.accountId});
  const extra=await post('accounts/task',{provider:'antigravity',exhaustAll:true});await wait(extra.taskId,'waiting_quota');
  const before=(await state()).accountManager.providers.antigravity.accounts.find(a=>a.id===added.accountId).quota.weekly.remaining;
  const progress=(await state()).tasks.find(t=>t.id===extra.taskId).completed.length;
  await post('accounts/recover',{provider:'antigravity',taskId:extra.taskId});const recovered=await wait(extra.taskId,'waiting_quota');assert.equal(recovered.completed.length,progress+2);
  const after=(await state()).accountManager.providers.antigravity.accounts.find(a=>a.id===added.accountId).quota.weekly.remaining;assert.ok(after<before);
});

test('removing an account archives its connection, clears selection and leaves other accounts intact',()=>{
  const p=initialManager().providers.codex,[a,b]=p.accounts;p.activeAccountId=a.id;
  a.source='local-session';a.localIdentityKey='user@example.test';
  const removed=removeAccount(p,a.id);
  assert.equal(removed.id,a.id);assert.equal(p.activeAccountId,null);
  assert.deepEqual(p.accounts,[b]);assert.equal(p.removedAccounts[0].enabled,false);
  assert.deepEqual(p.hiddenLocalIdentities,['user@example.test']);
  assert.throws(()=>removeAccount(p,a.id),/不存在/);
});
