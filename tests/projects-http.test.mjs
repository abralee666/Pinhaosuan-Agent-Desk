import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {Store} from '../lib/store.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
async function port(){const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const value=server.address().port;await new Promise(r=>server.close(r));return value;}
test('project HTTP flow shares real files, persists empty drafts, isolates rules and keeps archived history',{timeout:20000},async t=>{
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'desk-project-http-')),store=new Store(data,{empty:true});const legacy=store.createTask('保留的聊天','live');
 const desktop=await port(),remote=await port(),origin=`http://127.0.0.1:${desktop}`;
 let child,cookie;
 async function start(){child=spawn(process.execPath,['server.mjs'],{cwd:root,windowsHide:true,env:{...process.env,PORT:String(desktop),AGENT_DESK_REMOTE_PORT:String(remote),AGENT_DESK_DATA:data,AGENT_DESK_TEST_NETWORK:'1'},stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',c=>reject(Error('server exit '+c)));});const landing=await fetch(origin+'/workspace');cookie=landing.headers.get('set-cookie').split(';')[0];}
 async function stop(){if(child?.exitCode===null){const exit=new Promise(r=>child.once('exit',r));child.kill();await exit;}}
 t.after(async()=>{await stop();fs.rmSync(data,{recursive:true,force:true});});await start();
 const post=async(route,input,headers={})=>{const r=await fetch(origin+'/api/'+route,{method:'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json','X-Agent-Desk':'1','X-Request-Id':randomUUID(),...headers},body:JSON.stringify(input)});return {status:r.status,body:await r.json()};};
 const state=async()=>await(await fetch(origin+'/api/state',{headers:{Cookie:cookie}})).json();
 assert.equal((await post('projects/create',{name:'未经授权'},{Cookie:''})).status,401);
 const made=await post('projects/create',{name:'项目甲',instructions:'仅此项目中文报告'});assert.equal(made.status,200);const project=made.body.project;
 assert.equal(made.body.state.selectedTaskId,null);assert.equal(made.body.state.selectedProjectId,project.id);
 const a=(await post('task',{goal:'聊天甲',mode:'live',projectId:project.id})).body.taskId,b=(await post('task',{goal:'聊天乙',mode:'live',projectId:project.id})).body.taskId;
 const current=await state(),ta=current.tasks.find(t=>t.id===a),tb=current.tasks.find(t=>t.id===b);assert.equal(ta.workspace,tb.workspace);assert.notEqual(ta.storageWorkspace,tb.storageWorkspace);assert.equal(current.runtime.busy,false);
 fs.writeFileSync(path.join(project.workspace,'共享成果.txt'),'共享成果');
 const file=await fetch(`${origin}/api/task/file?taskId=${b}&path=${encodeURIComponent('共享成果.txt')}`,{headers:{Cookie:cookie}});assert.equal(file.status,200);assert.equal(await file.text(),'共享成果');
 const manifest=(await state()).tasks.find(t=>t.id===b).deliveryFiles;assert.ok(manifest.some(f=>f.name==='共享成果.txt'));
 const context=await(await fetch(`${origin}/api/context?taskId=${a}`,{headers:{Cookie:cookie}})).json();assert.match(JSON.stringify(context.memories),/仅此项目中文报告/);assert.equal(context.project.id,project.id);
 const independent=await(await fetch(`${origin}/api/context?taskId=${legacy.id}`,{headers:{Cookie:cookie}})).json();assert.doesNotMatch(JSON.stringify(independent),/仅此项目中文报告/);
 await post('projects/select',{projectId:project.id,newChat:true});assert.equal((await state()).selectedTaskId,null);
 await stop();await start();const restarted=await state();assert.equal(restarted.selectedProjectId,project.id);assert.equal(restarted.selectedTaskId,null);
 assert.equal((await post('projects/update',{projectId:project.id,archived:true})).status,200);
 assert.equal((await post('task',{goal:'禁止',mode:'live',projectId:project.id})).status,400);
 await post('projects/update',{projectId:project.id,archived:false,name:'改名项目'});assert.equal((await state()).tasks.find(t=>t.id===a).workspace,project.workspace);
 const adopted=await post('projects/create',{name:'原聊天项目',fromTaskId:legacy.id});assert.equal(adopted.status,200);assert.equal(adopted.body.project.workspace,legacy.workspace);
 assert.equal((await fetch(origin+'/projects-ui.js')).status,200);
});
