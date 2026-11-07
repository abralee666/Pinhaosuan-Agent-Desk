import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {openDesktopFile} from '../lib/windows-shell.mjs';
test('desktop shell passes literal paths separately and propagates failures',async()=>{
 const name=path.resolve('报告 空格, $data (最终版).txt');
 for(const action of ['reveal','open-folder','open']){
  let complete=false;
  const result=await openDesktopFile(name,action,{platform:'win32',execute:async(executable,args,options)=>{
   assert.match(executable,/powershell\.exe$/);assert.ok(args.includes('-STA'));assert.ok(args.includes('-File'));assert.equal(options.windowsHide,true);
   assert.equal(options.env.AGENT_DESK_SHELL_PATH,action==='open-folder'?path.dirname(name):name);
   assert.equal(options.env.AGENT_DESK_SHELL_ACTION,action);assert.equal(args.includes(name),false);await Promise.resolve();complete=true;
  }});
  assert.equal(complete,true);assert.equal(result.action,action);
 }
 await assert.rejects(()=>openDesktopFile(name,'reveal',{platform:'win32',execute:async()=>{throw {stderr:'Explorer failed'};}}),/Explorer failed/);
 await assert.rejects(()=>openDesktopFile(name,'other',{platform:'win32'}),/不支持/);
});
