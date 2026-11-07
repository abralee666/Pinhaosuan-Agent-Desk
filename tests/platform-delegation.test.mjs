import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PlatformDelegation,antigravityFailure} from '../lib/platform-delegation.mjs';
import {Codex} from '../lib/codex.mjs';
import {executionSession} from '../lib/execution-session.mjs';

function fixture(){
  const task={id:'task',goal:'准备文档，上传前审核',currentPrompt:'用指定 Gemini 整理文字',workspace:'task-workspace',executionMode:'workspace',networkAccess:true,agent:'codex',status:'running',threads:{antigravity:'old'},modelSettings:{}};
  const run={id:'turn',canceled:false},events=[],calls=[];let callback,close,killed=0;
  const ctx={task,run};
  const service=new PlatformDelegation({context:id=>{if(id!=='current'||run.canceled)throw Error('错误回合');return ctx;},prepare:async()=>({command:'host-agy',accountId:'agy-account',settings:{model:'gemini',effort:'medium',resolvedModel:'gemini-medium'}}),start:(...args)=>{calls.push(args);callback=args[3];close=args[4];return {kill(){killed++;}};},changed:(task,job,phase)=>events.push({phase,status:job.status})});
  return {task,run,service,events,calls,event:e=>callback(e),close:e=>close(e),killed:()=>killed};
}
const request={requestId:'docs-1',prompt:'读取 WRITING-BRIEF.md，准备 README',expectedFiles:[]};
test('delegation uses host launcher, binds workspace and returns actual model/output without completing the parent',async()=>{
  const f=fixture(),pending=f.service.call('current',request);await new Promise(setImmediate);
  const [command,task,prompt]=f.calls[0];assert.equal(command,'host-agy');assert.equal(task.workspace,f.task.workspace);assert.deepEqual(task.threads,{});
  assert.match(prompt,/上传前审核/);assert.match(prompt,/不上传、不发布/);
  f.event({type:'init',model:'gemini-medium',conversationId:'official-conversation'});
  f.event({type:'delta',text:'文档已准备'});f.event({type:'result',status:'SUCCESS'});
  assert.deepEqual(await pending,{jobId:f.task.delegations[0].id,status:'completed',model:'gemini-medium',effort:'medium',response:'文档已准备',error:null,delivery:{verified:true,files:[],error:null}});
  assert.equal(f.task.agent,'codex');assert.equal(f.task.status,'running');assert.equal(f.task.threads.antigravity,'old');assert.equal(f.killed(),1);
});
test('duplicate requests share result, conflicting or concurrent requests never spawn a second agent',async()=>{
  const f=fixture(),a=f.service.call('current',request),b=f.service.call('current',request);await new Promise(setImmediate);
  await assert.rejects(f.service.call('current',{...request,prompt:'different'}),/同一分工/);
  await assert.rejects(f.service.call('current',{...request,requestId:'docs-2'}),/正在执行/);
  f.event({type:'result',status:'SUCCESS',response:'done'});assert.deepEqual(await a,await b);
  assert.deepEqual(await f.service.call('current',request),await a);assert.equal(f.calls.length,1);
});
test('stale clients, read-only, offline and arbitrary paths are rejected before launching',async()=>{
  const f=fixture();await assert.rejects(f.service.call('old',request),/错误回合/);
  await assert.rejects(f.service.call('current',{requestId:'legacy',prompt:'准备文档'}),/显式填写 expectedFiles/);
  await assert.rejects(f.service.call('current',{...request,workspace:'outside'}),/不支持/);
  f.task.executionMode='read-only';await assert.rejects(f.service.call('current',request),/工作区执行/);
  f.task.executionMode='workspace';f.task.networkAccess=false;await assert.rejects(f.service.call('current',request),/允许联网/);
  assert.equal(f.calls.length,0);
});
test('official region denial propagates as failure and never counts as a completed parent or document',async()=>{
  const f=fixture(),p=f.service.call('current',request);await new Promise(setImmediate);
  f.event({type:'init',model:'gemini-medium'});f.event({type:'result',status:'ERROR',error:'FAILED_PRECONDITION: User location is not supported for the API use.'});
  const result=await p;assert.equal(result.status,'failed');assert.match(result.error,/当前访问地区不受支持/);assert.match(result.error,/FAILED_PRECONDITION/);assert.equal(f.task.status,'running');
});
test('a different actual model is stopped before its output can be accepted',async()=>{
  const f=fixture(),p=f.service.call('current',request);await new Promise(setImmediate);
  f.event({type:'init',model:'another-model'});f.event({type:'result',status:'SUCCESS',response:'wrong'});
  const result=await p;assert.equal(result.status,'failed');assert.match(result.error,/与指定模型.*不一致/);assert.equal(result.response,'');assert.equal(f.killed(),1);
});
test('upstream empty SUCCESS is a failed delegation, with upstream evidence retained',async()=>{
  const f=fixture(),p=f.service.call('current',{...request,expectedFiles:[]});await new Promise(setImmediate);
  f.event({type:'result',status:'SUCCESS',response:'',usage:{output_tokens:0}});
  const r=await p;assert.equal(r.status,'failed');assert.equal(r.delivery.verified,false);assert.match(r.error,/正文为空/);
  assert.equal(f.task.delegations[0].upstreamStatus,'SUCCESS');assert.equal(f.task.delegations[0].usage.output_tokens,0);
});
test('file delivery checks run before reporting completion, including silent real writes',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'desk-delegate-files-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const f=fixture();f.task.workspace=root;
  const p=f.service.call('current',{...request,expectedFiles:['README.md']});await new Promise(setImmediate);
  f.event({type:'result',status:'SUCCESS',response:'Created README'});assert.equal((await p).status,'failed');assert.equal((await p).delivery.files[0].state,'missing');
  const q=f.service.call('current',{...request,requestId:'real-write',expectedFiles:['README.md']});await new Promise(setImmediate);
  fs.writeFileSync(path.join(root,'README.md'),'# Real output');f.event({type:'result',status:'SUCCESS',response:''});
  assert.equal((await q).status,'completed');assert.equal((await q).delivery.files[0].state,'created');
});
test('parent stop cancels child and late success cannot overwrite cancellation; stop during preparation never launches',async()=>{
  const f=fixture(),p=f.service.call('current',request);await new Promise(setImmediate);f.service.cancel(f.run);
  f.event({type:'result',status:'SUCCESS',response:'late'});assert.equal((await p).status,'canceled');assert.equal(f.killed(),1);
  const g=fixture();let release;g.service.prepare=()=>new Promise(resolve=>release=resolve);
  const q=g.service.call('current',request);g.service.cancel(g.run);release({});await assert.rejects(q,/停止/);assert.equal(g.calls.length,0);
});
test('MCP relays only supported tool over authenticated loopback and reports upstream failure',async t=>{
  let forwarded;
  const server=http.createServer(async(req,res)=>{assert.equal(req.headers.authorization,'Bearer secret');let b='';for await(const c of req)b+=c;forwarded=JSON.parse(b);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:'failed',error:antigravityFailure('User location is not supported')}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  const child=spawn(process.execPath,['scripts/platform-mcp.mjs',`http://127.0.0.1:${server.address().port}/internal/delegate`,'current'],{env:{...process.env,AGENT_DESK_EDITION:'commercial',AGENT_DESK_PLATFORM_TOKEN:'secret'},windowsHide:true,stdio:['pipe','pipe','pipe']});t.after(()=>child.kill());
  const rows=new Map(),waiters=new Map();readline.createInterface({input:child.stdout}).on('line',line=>{const m=JSON.parse(line);rows.set(m.id,m);waiters.get(m.id)?.(m);});
  const call=(id,method,params={})=>new Promise(resolve=>{waiters.set(id,resolve);child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
  assert.equal((await call(1,'tools/list')).result.tools[0].annotations.readOnlyHint,false);
  const result=await call(2,'tools/call',{name:'delegate_antigravity',arguments:request});
  assert.equal(result.result.isError,true);assert.match(result.result.content[0].text,/地区/);assert.deepEqual(forwarded,{clientId:'current',args:request});
});
test('native background configuration exposes the bridge without passing its token to shell environment',async()=>{
  const c=new Codex({platform:{url:'http://127.0.0.1:4317/internal/delegate',token:'bridge-secret'}});
  assert.match(c.config().join('\n'),/agent_desk_platform.tool_timeout_sec=240/);assert.match(c.config().join('\n'),/tools.delegate_antigravity.approval_mode="approve"/);assert.equal(c.environment().AGENT_DESK_PLATFORM_TOKEN,undefined);
  let instructions;const client={platform:{},request:async(method,p)=>{instructions=p.developerInstructions;return {thread:{id:'new'}};}};
  const task={workspace:'workspace',executionMode:'workspace',networkAccess:true};await executionSession(client,task,'codex');assert.match(instructions,/delegate_antigravity/);
  task.networkAccess=false;await executionSession(client,task,'codex');assert.doesNotMatch(instructions,/delegate_antigravity/);
});

test('failure category distinguishes 未启动模型, 模型执行失败, and 交付文件缺失',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'desk-fail-cat-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const f1=fixture();const p1=f1.service.call('current',request);await new Promise(setImmediate);
  f1.close(new Error('Eligibility check failed: EOF'));
  const r1=await p1;assert.equal(r1.status,'failed');assert.equal(r1.failureCategory,'未启动模型');
  assert.equal(f1.task.delegations[0].failureCategory,'未启动模型');

  const f2=fixture();const p2=f2.service.call('current',request);await new Promise(setImmediate);
  f2.event({type:'init',model:'gemini-medium'});
  f2.event({type:'result',status:'ERROR',error:'server error'});
  const r2=await p2;assert.equal(r2.status,'failed');assert.equal(r2.failureCategory,'模型执行失败');
  assert.equal(f2.task.delegations[0].failureCategory,'模型执行失败');

  const f3=fixture();f3.task.workspace=root;
  const p3=f3.service.call('current',{...request,requestId:'req-deliv',expectedFiles:['missing.md']});await new Promise(setImmediate);
  f3.event({type:'init',model:'gemini-medium'});
  f3.event({type:'result',status:'SUCCESS',response:'All done'});
  const r3=await p3;assert.equal(r3.status,'failed');assert.equal(r3.failureCategory,'交付文件缺失');
  assert.equal(f3.task.delegations[0].failureCategory,'交付文件缺失');
});