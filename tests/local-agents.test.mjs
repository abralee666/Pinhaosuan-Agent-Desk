import {test} from 'node:test';
import assert from 'node:assert/strict';
import {detectLocalAgents} from '../lib/local-agents.mjs';
const defaults={platform:'win32',env:{LOCALAPPDATA:'C:/Local'},fileExists:()=>false,lookupCommand:async()=>null};
test('Antigravity default install directory works even when parent process PATH is stale',async()=>{
  const report=await detectLocalAgents({...defaults,fileExists:p=>p.endsWith(pathEnding()),listProcesses:async()=>[]});
  const agent=report.agents.find(a=>a.id==='antigravity');assert.equal(agent.canConnect,true);assert.equal(agent.installed,true);
});
function pathEnding(){return 'agy'+(process.platform==='win32'?'\\':'/')+'bin'+(process.platform==='win32'?'\\':'/')+'agy.exe';}
test('running application is discovered without assuming login or a usable connection',async()=>{
  const report=await detectLocalAgents({...defaults,listProcesses:async()=>['Antigravity.exe','Cursor.exe','not-codex.exe']});
  const ag=report.agents.find(a=>a.id==='antigravity');
  assert.equal(ag.installed,true);assert.equal(ag.running,true);assert.equal(ag.canConnect,false);assert.equal(ag.login,'unknown');
  assert.equal(report.agents.find(a=>a.id==='codex').installed,false);
  assert.equal(report.agents.find(a=>a.id==='cursor').available,false);
});
test('installed background command enables supported connection without exposing executable paths',async()=>{
  const report=await detectLocalAgents({...defaults,lookupCommand:async id=>id==='codex'?'C:/private/codex.exe':null,listProcesses:async()=>[]});
  const codex=report.agents.find(a=>a.id==='codex');
  assert.equal(codex.installed,true);assert.equal(codex.running,false);assert.equal(codex.canConnect,true);assert.equal(codex.login,'unknown');
  assert.equal(JSON.stringify(report).includes('C:/private'),false);
});
test('failure to enumerate processes reports unknown rather than stopped',async()=>{
  const report=await detectLocalAgents({...defaults,listProcesses:async()=>{throw new Error('access denied');}});
  assert.ok(report.processError);assert.ok(report.agents.every(a=>a.running===null));
});
