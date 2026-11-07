import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {randomUUID,randomBytes} from 'node:crypto';
import {Membership} from '../lib/membership.mjs';
import {distributionEdition} from '../lib/distribution.mjs';
import {agentExecutableOverride,detectLocalAgents} from '../lib/local-agents.mjs';
import {configureAccountBridge} from '../lib/antigravity-session.mjs';
import {createRelay} from '../remote-relay.mjs';
import {privacyFindings} from '../scripts/build-open-source.mjs';

function temporary(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'desk-open-source-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
test('open-source grants Max capacity without a license and without paid service promises',()=>{
 const m=new Membership({},{edition:'opensource'});assert.equal(m.plan().id,'max');assert.equal(m.plan().monthly,0);assert.equal(m.plan().humanSupportMonthly,0);assert.equal(m.plan().limitedAvailability,false);m.assertRemote();
 for(let i=0;i<50;i++)m.claim('provider'+i,'account');assert.equal(m.slots().length,50);assert.equal(m.snapshot().expiresAt,null);assert.equal(m.snapshot().plans.length,1);
 assert.equal(new Membership({}).plan().id,'free');
});
test('distribution defaults come from a portable config instead of author license data',t=>{
 const root=temporary(t);assert.equal(distributionEdition({root,env:{}}),'commercial');fs.writeFileSync(path.join(root,'distribution.json'),JSON.stringify({edition:'opensource'}));
 assert.equal(distributionEdition({root,env:{}}),'opensource');assert.equal(distributionEdition({root,env:{AGENT_DESK_EDITION:'commercial'}}),'commercial');
});
test('custom executables on another computer are used without publishing their paths',async t=>{
 const root=temporary(t),exe=path.join(root,'custom-agent.exe');fs.writeFileSync(exe,'test');const env={AGENT_DESK_CODEX_PATH:exe};
 assert.equal(agentExecutableOverride('codex',{env}),exe);assert.throws(()=>agentExecutableOverride('codex',{env:{AGENT_DESK_CODEX_PATH:'missing'}}),/绝对文件路径/);
 const report=await detectLocalAgents({env,lookupCommand:async()=>null,listProcesses:async()=>[],fileExists:p=>p===exe});assert.equal(report.agents.find(a=>a.id==='codex').canConnect,true);assert.equal(JSON.stringify(report).includes(exe),false);
});
test('account bridge is generated inside local data, including directories with spaces',t=>{
 const base=temporary(t),root=path.join(base,'Someone Else Project'),home=path.join(base,'Someone Else Home'),identity=path.join(base,'Local Data','identity.json');
 configureAccountBridge(root,identity,{home,platform:'win32',nodePath:'C:/Tools/Node/node.exe'});
 const config=JSON.parse(fs.readFileSync(path.join(home,'.gemini/antigravity-cli/settings.json'),'utf8'));
 assert.ok(config.statusLine.command.startsWith('"'));const wrapper=config.statusLine.command.slice(1,-1);assert.ok(wrapper.startsWith(path.dirname(identity)));assert.match(fs.readFileSync(wrapper,'utf8'),/Someone Else Project/);assert.equal(fs.existsSync(path.join(root,'scripts/agy-statusline.cmd')),false);
});
test('privacy scan rejects personal paths, non-example email and private keys',()=>{
 const findings=s=>privacyFindings('sample.txt',Buffer.from(s),{username:'sampleuser'});
 assert.ok(findings('sampleuser').includes('local-user-identifier'));
 assert.ok(findings('C:/Users/'+'SomeonePrivate/project').includes('personal-home-path'));
 assert.ok(findings('someone@'+'private.invalid').includes('non-example-email'));
 assert.ok(findings('-----BEGIN '+'PRIVATE KEY-----').includes('possible-secret'));
 assert.deepEqual(findings('user@example.test C:/Tools/agent.exe'),[]);
});
test('self-hosted open-source relay needs a registration key, then still enforces per-computer authentication',async t=>{
 assert.throws(()=>createRelay({edition:'opensource',publicOrigin:'http://127.0.0.1',test:true}),/REGISTRATION_KEY/);
 const reservation=net.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const origin=`http://127.0.0.1:${port}`,key=randomBytes(32).toString('hex'),server=createRelay({edition:'opensource',registrationKey:key,publicOrigin:origin,test:true});
 await new Promise(r=>server.listen(port,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const id=randomUUID(),secret=randomBytes(32).toString('hex');
 const call=(route,body,token=secret)=>fetch(origin+route,{method:'POST',headers:{'Content-Type':'application/json','X-Desktop-Id':id,Authorization:'Bearer '+token},body:JSON.stringify(body)});
 assert.equal((await call('/control/register',{registrationKey:'wrong'})).status,403);
 assert.equal((await call('/control/register',{registrationKey:key})).status,200);
 assert.equal((await call('/control/reply',{},'bad-token')).status,403);
 assert.equal((await call('/control/reply',{})).status,200);
});
