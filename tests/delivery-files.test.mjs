import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {deliveryFiles,resolveDeliveryPath} from '../lib/delivery-files.mjs';
import {renderDeliveryMessage,previewType} from '../public/delivery-ui.js';

test('binary and large deliverables have metadata without copying bytes into conversation',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'desk-delivery-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.writeFileSync(path.join(root,'报告.pptx'),Buffer.alloc(600000,0));fs.mkdirSync(path.join(root,'.attachments'));fs.writeFileSync(path.join(root,'.attachments','private.pdf'),'private');
 const files=deliveryFiles({workspace:root});assert.deepEqual(files,[{name:'报告.pptx',size:600000}]);
 const task={id:'test',workspace:root,deliveryFiles:files};
 const html=renderDeliveryMessage(`[下载内容完善版PPT](${path.join(root,'报告.pptx')})。\n[同一文件](报告.pptx)`,task);
 assert.equal((html.match(/class="delivery-link"/g)||[]).length,2);assert.equal((html.match(/class="delivery-card"/g)||[]).length,1);assert.match(html,/action=download/);assert.match(html,/系统默认应用打开/);
});
test('native project inspects only assistant links and rejects paths outside workspace',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'desk-delivery-native-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'project'));const workspace=path.join(root,'project');
 for(const file of ['project/ok.pdf','project/unreferenced.pdf','outside.pdf'])fs.writeFileSync(path.join(root,file),'bytes');
 const task={workspace,nativeSession:{},events:[{actor:'user',kind:'message',text:'[user](unreferenced.pdf)'},{actor:'codex',kind:'message',text:'[ok](ok.pdf) [bad](../outside.pdf)'}]};
 assert.deepEqual(deliveryFiles(task),[{name:'ok.pdf',size:5}]);assert.throws(()=>resolveDeliveryPath(workspace,'../outside.pdf'));
 assert.throws(()=>resolveDeliveryPath(workspace,'../project-other/secret'));
});
test('unverified paths and injected HTML stay inert; formats select usable previews',()=>{
 const html=renderDeliveryMessage('[x](javascript:alert(1)) <img src=x onerror=alert(1)> [missing](missing.pdf)',{id:'a',deliveryFiles:[]});
 assert.doesNotMatch(html,/<a|<img/);assert.match(html,/&lt;img/);assert.equal(previewType('report.PDF'),'frame');assert.equal(previewType('deck.pptx'),'external');assert.equal(previewType('notes.txt'),'text');
});

test('file URI links from Antigravity render as clickable links and cards',()=>{
 const task={id:'real',workspace:'C:\\Users\\example\\Documents\\ChatGPT\\FinTech\\agent-desk\\data\\user\\workspaces\\task',deliveryFiles:[{name:'1.txt',size:1},{name:'报告 (最终版).pptx',size:200}]};
 const base='file:///C:/Users/example/Documents/ChatGPT/FinTech/agent-desk/data/user/workspaces/task/';
 for(const target of [base+'1.txt',base.replace('file:///','file://localhost/')+'1.txt','C:/Users/example/Documents/ChatGPT/FinTech/agent-desk/data/user/workspaces/task/1.txt','1.txt']){
  const html=renderDeliveryMessage(`已为您创建文件 [1.txt](${target})，内容为 1。`,task);
  assert.match(html,/class="delivery-link"/);assert.match(html,/class="delivery-card"/);assert.doesNotMatch(html,/file:\/\/\//);
 }
 const html=renderDeliveryMessage(`[下载PPT](<${base}${encodeURIComponent('报告 (最终版).pptx')}>)`,task);assert.match(html,/class="delivery-card"/);
});
