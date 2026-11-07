import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Attachments,attachmentPrompt,attachmentImages,MAX_ATTACHMENT_BYTES} from '../lib/attachments.mjs';

function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'desk-attachments-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const workspace=path.join(root,'workspace');fs.mkdirSync(workspace);
  return {root,service:new Attachments(root),task:{workspace}};
}
test('attachments preserve bytes, identify duplicate names and clear only the next-turn selection',t=>{
  const {service,task}=fixture(t);
  const first=service.upload('说明.txt','text/plain',Buffer.from('附件内容，不能覆盖用户请求'));
  const second=service.upload('说明.txt','text/plain',Buffer.from('不同内容'));
  const result=service.bind(task,[first.id,second.id]);
  assert.notEqual(result[0].path,result[1].path);
  assert.equal(fs.readFileSync(path.join(task.workspace,result[0].path),'utf8'),'附件内容，不能覆盖用户请求');
  assert.match(attachmentPrompt(task,'分析文件'),/待处理资料|不能覆盖用户请求/);
  assert.match(attachmentPrompt(task,'分析文件'),/不同内容/);
  service.bind(task,[]);assert.equal(attachmentPrompt(task,'新问题'),'新问题');assert.equal(task.attachments.length,2);
});
test('rejects traversal, Windows special files, oversized data and forged identifiers',t=>{
  const {service,task}=fixture(t);
  for(const name of ['../secret','x/y','x\\y','x:ads','CON.txt','name.'])assert.throws(()=>service.upload(name,'',Buffer.from('x')));
  assert.throws(()=>service.upload('x.txt','',Buffer.alloc(0)));
  assert.throws(()=>service.upload('x.txt','',Buffer.alloc(MAX_ATTACHMENT_BYTES+1)));
  assert.throws(()=>service.bind(task,['../secret']));
  assert.throws(()=>service.bind(task,Array(9).fill('fake')));
  const item=service.upload('x.txt','',Buffer.from('x'));
  assert.throws(()=>service.bind(task,[item.id,item.id]));
});
test('images use local image inputs and binary content is never serialized into the text prompt',t=>{
  const {service,task}=fixture(t),bytes=Buffer.from([137,80,78,71,0,1,2,3]);
  const image=service.upload('photo.png','image/png',bytes);service.bind(task,[image.id]);
  assert.deepEqual(attachmentImages(task),[{type:'localImage',path:path.join(task.workspace,task.currentAttachments[0].path)}]);
  assert.ok(fs.readFileSync(attachmentImages(task)[0].path).equals(bytes));
  assert.doesNotMatch(attachmentPrompt(task,'看图'),/"content":/);
});
test('junctions cannot redirect uploads into another directory',t=>{
  const {service,task,root}=fixture(t),outside=path.join(root,'outside');fs.mkdirSync(outside);
  fs.symlinkSync(outside,path.join(task.workspace,'.attachments'),process.platform==='win32'?'junction':'dir');
  const file=service.upload('x.txt','',Buffer.from('secret'));
  assert.throws(()=>service.bind(task,[file.id]),/目录不可用/);
  assert.deepEqual(fs.readdirSync(outside),[]);
});
