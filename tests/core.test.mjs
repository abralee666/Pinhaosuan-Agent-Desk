import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store, digest } from '../lib/store.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agent-desk-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return new Store(dir);
}
test('memory, history and verified files survive a checkpoint and process restart',t=>{
  const s=fixture(t), memory=s.addMemory('交接测试暗号：青桥-7319'), task=s.createTask('验证接力');
  s.writeArtifact(task,'spec.md','已有成果');task.completed.push('第一步');s.checkpoint(task,'codex');
  s.event(task,'codex','已有决定：保留接口格式');s.save();
  const reopened=new Store(s.root), pack=reopened.context(reopened.task(task.id),'antigravity');
  assert.ok(pack.memories.some(m=>m.id===memory.id));assert.equal(pack.completed.length,1);
  assert.equal(pack.files[0].content,'已有成果');assert.equal(pack.files[0].sha256,digest('已有成果'));
  assert.ok(pack.history.some(e=>e.text.includes('保留接口')));
});
test('handoff context avoids recursive export and preserves long file integrity',t=>{
  const s=fixture(t), task=s.createTask('长文件验证');
  s.writeArtifact(task,'spec.md','x'.repeat(16000));s.writeArtifact(task,'context-latest.json','旧的交接包');
  const pack=s.context(task,'antigravity');assert.equal(pack.files.length,1);
  assert.equal(pack.files[0].content.length,16000);assert.equal(digest(pack.files[0].content),pack.files[0].sha256);
});
test('restart turns an active task into a recoverable interrupted task',t=>{
  const s=fixture(t),task=s.createTask('恢复');task.status='running';task.completed.push('已完成');s.save();
  const restarted=new Store(s.root);assert.equal(restarted.task(task.id).status,'interrupted');assert.equal(restarted.task(task.id).completed.length,1);
  assert.equal(restarted.task(task.id).recovery.reason,'restart');assert.equal(restarted.task(task.id).checkpoints.length,1);
});
test('worker rejects a tampered handoff instead of acknowledging it',async t=>{
  const s=fixture(t),task=s.createTask('校验');const pack=s.context(task,'antigravity');pack.goal='被修改';
  const child=spawn(process.execPath,[path.join(root,'lib/demo-worker.mjs'),'antigravity'],{windowsHide:true});
  let output='';child.stdout.on('data',b=>output+=b);child.stdin.end(JSON.stringify(pack)+'\n');
  const code=await new Promise(resolve=>child.on('exit',resolve));assert.equal(code,1);assert.match(output,/交接包校验失败/);assert.doesNotMatch(output,/received/);
});
test('HTTP flow uses two processes, preserves memory, blocks overlapping writes and persists on restart',async t=>{
  const s=fixture(t),port=14317+Math.floor(Math.random()*1000),origin=`http://127.0.0.1:${port}`;
  let child,cookie;
  async function start(){
    child=spawn(process.execPath,[path.join(root,'server.mjs')],{env:{...process.env,AGENT_DESK_EDITION:'commercial',PORT:String(port),AGENT_DESK_DATA:s.root},windowsHide:true,stdio:['ignore','pipe','pipe']});
    await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',code=>reject(new Error('server exit '+code)));});
    const res=await fetch(origin);cookie=res.headers.get('set-cookie').split(';')[0];
  }
  async function stop(){if(child?.exitCode==null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}}
  t.after(stop);
  const post=async(route,b)=>{const res=await fetch(origin+'/api/'+route,{method:'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json','X-Agent-Desk':'1'},body:JSON.stringify(b)});return {status:res.status,body:await res.json()};};
  const state=async()=>await (await fetch(origin+'/api/state',{headers:{Cookie:cookie}})).json();
  await start();
  assert.equal((await fetch(origin+'/api/state')).status,401);
  const rejected=await fetch(origin+'/api/memory',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({text:'不应写入'})});assert.equal(rejected.status,403);
  await post('memory',{text:'跨进程验证记忆-8421'});
  const created=await post('task',{goal:'验证额度耗尽后接力',mode:'demo'}),id=created.body.taskId;
  assert.equal((await post('run',{taskId:id})).status,200);
  assert.equal((await post('run',{taskId:id})).status,409);
  await post('memory',{text:'执行期间新增：后继 Agent 必须读到这条记忆'});
  let current;
  for(let i=0;i<160;i++){current=(await state()).tasks.find(t=>t.id===id);if(current.status==='completed')break;if(current.status==='failed')throw new Error(current.events.at(-1).text);await new Promise(r=>setTimeout(r,100));}
  assert.equal(current.status,'completed');assert.equal(current.completed.length,4);assert.equal(current.handoffs.length,1);
  const receipts=current.events.filter(e=>e.receipt).map(e=>e.receipt);assert.equal(receipts.length,2);assert.notEqual(receipts[0].pid,receipts[1].pid);
  assert.equal(receipts[1].completed.length,2);
  for(const mid of receipts[0].memoryIds)assert.ok(receipts[1].memoryIds.includes(mid));
  assert.equal(receipts[1].memoryIds.length,receipts[0].memoryIds.length+1);
  const file=current.fileContents.find(f=>f.name==='handoff-receipt.json');assert.ok(JSON.parse(file.content).receivedMemories.some(m=>m.text==='跨进程验证记忆-8421'));
  await stop();await start();const persisted=(await state()).tasks.find(t=>t.id===id);assert.equal(persisted.status,'completed');assert.equal(persisted.completed.length,4);
  const interrupted=await post('task',{goal:'停止后续跑',mode:'demo'}),iid=interrupted.body.taskId;
  await post('run',{taskId:iid});await post('stop',{});assert.equal((await state()).tasks.find(t=>t.id===iid).status,'interrupted');
  assert.equal((await post('run',{taskId:iid})).status,200);await post('stop',{});
});
