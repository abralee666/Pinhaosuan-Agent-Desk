import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {CodexAccounts,accountThreadKey,nativeQuotaAvailable} from '../lib/codex-accounts.mjs';
import {Codex} from '../lib/codex.mjs';
import {relayEligibility} from '../lib/platform-relay.mjs';
class Fake extends EventEmitter{
  constructor(){super();this.calls=[];this.identity=null;this.quota={rateLimits:{primary:{windowDurationMins:300,usedPercent:10},secondary:{windowDurationMins:10080,usedPercent:20}}};}
  async start(){}stop(){}
  async request(method,params){this.calls.push({method,params});if(method==='account/read')return {account:this.identity};if(method==='account/rateLimits/read')return this.quota;if(method==='account/login/start')return {loginId:'login-1',authUrl:'https://auth.openai.com/authorize?state=test'};return {};}
}
test('reauthorization is limited to a connection explicitly marked expired',async t=>{
 const {pool}=fixture(t),a=pool.create();const c=pool.client(a.id);c.identity={type:'chatgpt',email:'expired@example.test',planType:'free'};
 await assert.rejects(pool.startLogin(a.id),/已有账号/);
 a.session='signed_out';a.loginStatus='登录已失效，请重新授权';
 const result=await pool.startLogin(a.id);assert.ok(result.authUrl);assert.equal(a.session,'signing_in');
 assert.ok(c.calls.every(v=>v.method!=='account/logout'));
});
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'codex-isolation-')),group={accounts:[],audit:[],activeAccountId:null},desktop=new Fake(),homes=[];
  const pool=new CodexAccounts({root,group,desktop,createClient:({home})=>{homes.push(home);return new Fake();}});
  t.after(()=>{pool.stop();fs.rmSync(root,{recursive:true,force:true});});return {pool,group,desktop,homes};}
test('independent connections use distinct homes and selection never logs out another account',async t=>{
  const {pool,homes,desktop}=fixture(t),a=pool.create('A'),b=pool.create('B'),ca=pool.client(a.id),cb=pool.client(b.id);
  ca.identity={type:'chatgpt',email:'a@example.test',planType:'plus'};cb.identity={type:'chatgpt',email:'b@example.test',planType:'plus'};
  await pool.activate(a.id);await pool.activate(b.id);
  assert.notEqual(homes[0],homes[1]);assert.equal(a.session,'signed_in');assert.equal(b.email,'b@example.test');assert.equal(a.quota.fiveHour.remaining,90);
  assert.notEqual(accountThreadKey(a),accountThreadKey(b));assert.equal(desktop.calls.length,0);
  assert.ok([...ca.calls,...cb.calls].every(c=>c.method!=='account/logout'));
});
test('browser login is serialized and cancellation targets only its own connection',async t=>{
  const {pool}=fixture(t),a=pool.create('A'),b=pool.create('B');await pool.startLogin(a.id);
  const reopened=await pool.startLogin(a.id);assert.ok(reopened.authUrl);assert.equal(pool.client(a.id).calls.filter(c=>c.method==='account/login/start').length,1);
  await assert.rejects(pool.startLogin(b.id),/已有账号/);await pool.cancelLogin(b.id);assert.equal(a.session,'signing_in');
  await pool.cancelLogin(a.id);assert.equal(a.session,'signed_out');assert.equal(pool.pending,null);
  assert.ok(pool.client(a.id).calls.some(c=>c.method==='account/login/cancel'&&c.params.loginId==='login-1'));
});
test('official completion verifies identity and quota without changing the selected account',async t=>{
  const {pool,group}=fixture(t),a=pool.create(),client=pool.client(a.id);await pool.startLogin(a.id);
  client.identity={type:'chatgpt',email:'verified@example.test',planType:'plus'};
  client.emit('notification',{method:'account/login/completed',params:{loginId:'login-1',success:true}});
  await new Promise(r=>setImmediate(r));assert.equal(a.email,'verified@example.test');assert.equal(a.name,'Codex PLUS');assert.equal(pool.pending,null);assert.equal(group.activeAccountId,null);
});
test('routing skips unknown, exhausted and expired accounts, and never loops',async t=>{
  const {pool}=fixture(t),a=pool.create('A'),b=pool.create('B'),c=pool.create('C');
  for(const p of [a,b,c])pool.client(p.id).identity={type:'chatgpt',email:p.name+'@example.test',planType:'plus'};
  pool.client(b.id).quota={rateLimits:{primary:{windowDurationMins:300,usedPercent:100},secondary:{windowDurationMins:10080,usedPercent:0}}};
  const task={accountId:a.id};assert.equal((await pool.next(task)).profile.id,c.id);assert.equal(await pool.next(task),null);
  c.checkedAt=new Date(Date.now()-6*60*1000).toISOString();assert.equal(nativeQuotaAvailable(c),false);c.quota=null;assert.equal(nativeQuotaAvailable(c),false);
});
test('isolated environment strips inherited authentication and keeps parent configuration intact',()=>{
  const saved=process.env.CODEX_ACCESS_TOKEN;process.env.CODEX_ACCESS_TOKEN='test-credential';
  try{const isolated=new Codex({home:path.resolve('isolated-test-home')}),env=isolated.environment();assert.equal(env.CODEX_ACCESS_TOKEN,undefined);assert.equal(env.CODEX_HOME,isolated.home);assert.equal(process.env.CODEX_ACCESS_TOKEN,'test-credential');assert.ok(isolated.config().includes('cli_auth_credentials_store="file"'));assert.equal(new Codex().home,null);}
  finally{if(saved===undefined)delete process.env.CODEX_ACCESS_TOKEN;else process.env.CODEX_ACCESS_TOKEN=saved;}
});
test('a historical desktop identity cannot be rebound to another logged-in user',async t=>{
  const {pool,group,desktop}=fixture(t);const a=pool.create('history');a.source='local-session';a.email='old@example.test';desktop.identity={type:'chatgpt',email:'new@example.test'};
  await assert.rejects(pool.activate(a.id),/当前未登录/);assert.equal(a.email,'old@example.test');assert.equal(group.activeAccountId,null);
});
test('expired authorization closes its own callback and exposes a specific retry status',async t=>{
  const {pool,group}=fixture(t);pool.loginTimeoutMs=10;const a=pool.create();const result=await pool.startLogin(a.id);
  assert.ok(Number.isFinite(Date.parse(result.expiresAt)));await new Promise(r=>setTimeout(r,40));
  assert.equal(pool.pending,null);assert.equal(a.session,'signed_out');assert.match(a.loginStatus,/已过期/);assert.equal(a.authExpiresAt,null);
  assert.ok(group.audit.some(e=>e.action==='isolated_login_expired'));assert.ok(pool.client(a.id).calls.some(c=>c.method==='account/login/cancel'));
});
test('monthly-only official quota can relay while zero or stale monthly quota cannot',()=>{
  const a={source:'isolated-session',provider:'codex',plan:'free',enabled:true,session:'signed_in',checkedAt:new Date().toISOString(),quota:{monthly:{remaining:100,capacity:100},fiveHour:null,weekly:null}};
  assert.equal(nativeQuotaAvailable(a),true);assert.equal(relayEligibility(a),null);
  a.quota.monthly.remaining=0;assert.equal(nativeQuotaAvailable(a),false);assert.match(relayEligibility(a),/耗尽/);
  a.quota.monthly.remaining=100;a.checkedAt=new Date(Date.now()-25*3600000).toISOString();assert.equal(nativeQuotaAvailable(a),false);assert.match(relayEligibility(a),/未知/);
});
