import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Store} from '../lib/store.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
async function port(){const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const value=server.address().port;await new Promise(r=>server.close(r));return value;}
test('delivery endpoint preserves bytes, downloads Chinese names and blocks traversal and GET side effects',{timeout:20000},async t=>{
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'desk-delivery-http-'));const store=new Store(data,{empty:true}),task=store.createTask('交付文件测试','live');
 const bytes=Buffer.from([0,1,2,255]);fs.writeFileSync(path.join(task.workspace,'汇报.pptx'),bytes);fs.writeFileSync(path.join(task.workspace,'预览.pdf'),'%PDF-1.4');fs.mkdirSync(task.workspace+'-other');fs.writeFileSync(path.join(task.workspace+'-other','secret.txt'),'secret');
 store.event(task,'codex','[下载汇报](汇报.pptx)');store.save();
 const desktop=await port(),remote=await port(),origin=`http://127.0.0.1:${desktop}`;
 const child=spawn(process.execPath,['server.mjs'],{cwd:root,windowsHide:true,env:{...process.env,PORT:String(desktop),AGENT_DESK_REMOTE_PORT:String(remote),AGENT_DESK_DATA:data,AGENT_DESK_TEST_NETWORK:'1'},stdio:['ignore','pipe','pipe']});
 t.after(async()=>{if(child.exitCode===null){const exit=new Promise(r=>child.once('exit',r));child.kill();await exit;}fs.rmSync(data,{recursive:true,force:true});});
 await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',c=>reject(Error('server exit '+c)));});
 const landing=await fetch(origin+'/workspace'),cookie=landing.headers.get('set-cookie').split(';')[0];
 const request=(name,action='',options={})=>fetch(`${origin}/api/task/file?taskId=${task.id}&path=${encodeURIComponent(name)}&action=${action}`,{headers:{Cookie:cookie},...options});
 const download=await request('汇报.pptx','download');assert.equal(download.status,200);assert.match(download.headers.get('content-disposition'),/attachment; filename\*=UTF-8''%/);assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);
 assert.equal((await request('预览.pdf')).headers.get('content-type'),'application/pdf');
 assert.equal((await request(`../${task.id}-other/secret.txt`)).status,404);
 assert.equal((await request('汇报.pptx','open')).status,405);
 assert.equal((await request('汇报.pptx','open',{method:'POST',headers:{Cookie:cookie,Origin:'https://example.com','X-Agent-Desk':'1'}})).status,403);
 const state=await(await fetch(origin+'/api/state',{headers:{Cookie:cookie}})).json();assert.equal(state.tasks[0].deliveryFiles.find(f=>f.name==='汇报.pptx').size,4);
 assert.equal((await fetch(origin+'/delivery-ui.js')).status,200);
});
