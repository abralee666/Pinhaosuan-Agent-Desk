import {test} from 'node:test';import assert from 'node:assert/strict';
import {prepareCodexInput,commitCodexInput} from '../lib/codex-input.mjs';
const event=(actor,text,extra={})=>({actor,text,kind:'message',...extra});
function fixture(){return {task:{goal:'完成任务，上传前审核',workspace:'X',events:[event('user','旧请求'),event('codex','旧回复'),{actor:'codex',kind:'tool_result',text:'tool log'.repeat(5000)}],completed:['plan'],checkpoints:[]},session:{threadId:'A',reason:'resumed'},prompt:'继续'};}
test('resuming a legacy native thread sends only the new message and keeps local history intact',()=>{
  const f=fixture(),before=JSON.stringify(f.task.events);f.task.events.push(event('user',f.prompt));
  const prepared=prepareCodexInput(f);assert.equal(prepared.text,'继续');assert.equal(prepared.mode,'message');assert.equal(f.task.codexDeliveries,undefined);
  commitCodexInput(f.task,prepared);assert.equal(JSON.stringify(f.task.events.slice(0,-1)),before);
  f.task.events.push(event('codex','new reply',{nativeThreadId:'A'}),event('user','next'));
  assert.equal(prepareCodexInput({...f,prompt:'next'}).text,'next');
});
test('full handoffs preserve user constraints but omit raw tool logs and complete file bodies',()=>{
  const f=fixture();f.session.reason='new';f.task.events.push(event('user','发布前交我审核'),event('user',f.prompt));
  const prepared=prepareCodexInput({...f,files:[{name:'large.txt',sha256:'hash',size:400000,content:'PRIVATE_FULL_BODY'.repeat(1000)}]});
  assert.equal(prepared.mode,'handoff');assert.match(prepared.text,/发布前交我审核/);assert.match(prepared.text,/large.txt/);
  assert.doesNotMatch(prepared.text,/tool log|PRIVATE_FULL_BODY/);assert.equal(prepared.text.match(/继续/g).length,1);
});
test('memory and file changes are sent once, including explicit removal, and rejected requests do not advance cursors',()=>{
  const f=fixture(),memories=[{id:'m',text:'中文'}],files=[{name:'a.txt',size:1,sha256:'1',content:'a'}];
  let p=prepareCodexInput({...f,memories,files});assert.equal(p.mode,'delta');assert.match(p.text,/中文/);assert.equal(f.task.codexDeliveries,undefined);
  assert.equal(prepareCodexInput({...f,memories,files}).text,p.text);commitCodexInput(f.task,p);
  assert.equal(prepareCodexInput({...f,memories,files}).text,'继续');
  p=prepareCodexInput(f);assert.match(p.text,/"sharedMemories":\[\]/);assert.match(p.text,/"workspaceFiles":\[\]/);
  commitCodexInput(f.task,p);assert.equal(prepareCodexInput(f).text,'继续');
  const restored=JSON.parse(JSON.stringify(f.task));assert.equal(prepareCodexInput({...f,task:restored}).text,'继续');
});
test('switching accounts/platforms retains messages missed by this thread without replaying its own replies',()=>{
  const f=fixture();commitCodexInput(f.task,prepareCodexInput(f));
  f.task.events.push(event('codex','A own',{nativeThreadId:'A'}),event('codex','B result',{nativeThreadId:'B'}),event('user','给B的要求'),event('antigravity','文案已完成'),event('user','继续'));
  const p=prepareCodexInput(f);assert.match(p.text,/B result|给B的要求|文案已完成/);assert.doesNotMatch(p.text,/A own|tool log/);
  commitCodexInput(f.task,p);assert.equal(prepareCodexInput(f).text,'继续');
  assert.equal(prepareCodexInput({...f,inheritedPack:{}}).mode,'handoff');
});
test('imported native history is not duplicated, while changes made on another platform after import are included',()=>{
  const f=fixture();f.task.nativeSession={threadId:'A',importEventCursor:f.task.events.length};
  f.task.events.push(event('antigravity','新平台结果'),event('user','继续'));
  const p=prepareCodexInput(f);assert.match(p.text,/新平台结果/);assert.doesNotMatch(p.text,/旧请求|旧回复/);
});
