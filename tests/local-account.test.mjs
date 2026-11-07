import {test} from 'node:test';
import assert from 'node:assert/strict';
import {syncLocalAccount,normalizeLocalQuota} from '../lib/local-account.mjs';
const manager=()=>({providers:{codex:{accounts:[],activeAccountId:null,audit:[]}}});
test('authenticated local identity becomes the selected account without copying secrets',()=>{
  const m=manager();const a=syncLocalAccount(m,'codex',{email:'user@example.test',name:'User',planType:'plus',password:'secret',accessToken:'secret'},null);
  assert.equal(m.providers.codex.accounts.length,1);assert.equal(m.providers.codex.activeAccountId,a.id);
  assert.equal(a.email,'user@example.test');assert.equal(a.name,'User');assert.equal(a.plan,'plus');assert.equal(a.session,'signed_in');
  assert.equal(JSON.stringify(m).includes('secret'),false);assert.equal(a.quota,null);assert.equal(a.checkedAt,null);
});
test('reconnection updates the same identity and upgrades an existing manually added account',()=>{
  const m=manager();const a=syncLocalAccount(m,'codex',{email:'user@example.test'},null);
  const b=syncLocalAccount(m,'codex',{email:'USER@example.test',displayName:'Updated'},null);
  assert.equal(a.id,b.id);assert.equal(m.providers.codex.accounts.length,1);assert.equal(b.name,'Updated');
  const other=manager();other.providers.codex.accounts.push({id:'existing',identifier:'user@example.test'});
  assert.equal(syncLocalAccount(other,'codex',{email:'user@example.test'},null).id,'existing');
});
test('logging out clears active local identity but preserves account history',()=>{
  const m=manager();const a=syncLocalAccount(m,'codex',{email:'user@example.test'},null);
  syncLocalAccount(m,'codex',null,null);
  assert.equal(m.providers.codex.accounts.length,1);assert.equal(a.session,'signed_out');assert.equal(m.providers.codex.activeAccountId,null);
});
test('unknown identity fields remain unknown rather than invented',()=>{
  const m=manager();const a=syncLocalAccount(m,'codex',{},null);
  assert.equal(a.email,null);assert.equal(a.displayName,null);assert.equal(a.plan,null);
});
test('official quota consumed percentage is converted to remaining; absent windows stay unknown',()=>{
  const quota=normalizeLocalQuota({rateLimits:{primary:{windowDurationMins:300,usedPercent:27,resetsAt:1000}}});
  assert.equal(quota.fiveHour.remaining,73);assert.equal(quota.fiveHour.resetsAt,1000000);assert.equal(quota.weekly,null);
  assert.equal(normalizeLocalQuota({primary:{windowDurationMins:60,usedPercent:30}}),null);
});
test('official 30-day quota is preserved as monthly rather than unknown five-hour quota',()=>{
  const quota=normalizeLocalQuota({rateLimits:{primary:{windowDurationMins:43200,usedPercent:0,resetsAt:1794143272},secondary:null}});
  assert.equal(quota.monthly.remaining,100);assert.equal(quota.monthly.capacity,100);assert.equal(quota.monthly.resetsAt,1794143272000);
  assert.equal(quota.fiveHour,null);assert.equal(quota.weekly,null);
});

test('removed desktop identity stays hidden until explicitly reconnected',()=>{
  const m=manager();m.providers.codex.hiddenLocalIdentities=['user@example.test'];
  assert.equal(syncLocalAccount(m,'codex',{email:'USER@example.test'},null),null);
  assert.equal(m.providers.codex.accounts.length,0);
  m.providers.codex.hiddenLocalIdentities=[];
  assert.ok(syncLocalAccount(m,'codex',{email:'user@example.test'},null));
});

test('rateLimitsByLimitId schema and exhausted quota are normalized as 0% rather than unknown',()=>{
  const byIdQuota=normalizeLocalQuota({rateLimitsByLimitId:{codex:{primary:{windowDurationMins:300,usedPercent:100,resetsAt:1000}}}});
  assert.equal(byIdQuota.fiveHour.remaining,0);
  assert.equal(byIdQuota.fiveHour.resetsAt,1000000);

  const exhausted=normalizeLocalQuota({ordinaryUsageAllowed:false,rateLimitsByLimitId:{codex:{rateLimitReachedType:'primary_window',resetsAt:2000}}});
  assert.equal(exhausted.fiveHour.remaining,0);
  assert.equal(exhausted.fiveHour.resetsAt,2000000);
});
