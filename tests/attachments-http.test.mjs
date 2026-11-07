import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';

async function port(){const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const value=server.address().port;await new Promise(r=>server.close(r));return value;}
test('desktop attachments require auth and origin, bind unchanged bytes and never invoke a model',{timeout:20000},async t=>{
  const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),data=fs.mkdtempSync(path.join(os.tmpdir(),'desk-upload-http-'));
  const desktopPort=await port(),phonePort=await port(),origin=`http://127.0.0.1:${desktopPort}`;
  const child=spawn(process.execPath,['server.mjs'],{cwd:root,windowsHide:true,env:{...process.env,AGENT_DESK_EDITION:'commercial',PORT:String(desktopPort),AGENT_DESK_REMOTE_PORT:String(phonePort),AGENT_DESK_DATA:data,AGENT_DESK_TEST_NETWORK:'1'},stdio:['ignore','pipe','pipe']});
  t.after(async()=>{if(child.exitCode===null){const end=new Promise(r=>child.once('exit',r));child.kill();await end;}fs.rmSync(data,{recursive:true,force:true});});
  await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',code=>reject(Error('server exit '+code)));});
  const landing=await fetch(origin+'/workspace'),cookie=landing.headers.get('set-cookie').split(';')[0];
  const upload=(bytes,headers={})=>fetch(origin+'/api/attachments',{method:'POST',headers:{Cookie:cookie,Origin:origin,'X-Agent-Desk':'1','X-File-Name':encodeURIComponent('示例.txt'),'Content-Type':'text/plain',...headers},body:bytes});
  assert.equal((await upload('x',{Cookie:''})).status,401);
  assert.equal((await upload('x',{Origin:'https://example.com'})).status,403);
  assert.equal((await upload('x',{'X-File-Name':encodeURIComponent('../secret')})).status,400);
  const bytes=Buffer.alloc(250000,65),res=await upload(bytes);assert.equal(res.status,200);
  const item=await res.json();assert.equal(item.size,bytes.length);
  const create=await fetch(origin+'/api/task',{method:'POST',headers:{Cookie:cookie,Origin:origin,'X-Agent-Desk':'1','X-Request-Id':randomUUID(),'Content-Type':'application/json'},body:JSON.stringify({goal:'上传链路测试，不执行模型',mode:'live',attachmentIds:[item.id],executionMode:'full-access'})});
  assert.equal(create.status,200);const {taskId}=await create.json();
  const state=await(await fetch(origin+'/api/state',{headers:{Cookie:cookie}})).json(),task=state.tasks.find(t=>t.id===taskId);
  assert.equal(task.status,'idle');assert.equal(state.runtime.busy,false);
  assert.equal(task.executionMode,'full-access');assert.equal(task.networkAccess,true);
  assert.equal(task.currentAttachments.length,1);
  assert.ok(fs.readFileSync(path.join(task.workspace,task.currentAttachments[0].path)).equals(bytes));
  assert.equal(task.fileContents.some(f=>f.name.includes('.attachments')),false);
});
