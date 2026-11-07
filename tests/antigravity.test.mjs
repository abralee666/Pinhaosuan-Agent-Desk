import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanReport, parseAntigravityEvent, parseQuotaReport, aggregateQuotaRows } from '../lib/antigravity.mjs';
test('Antigravity stream keeps native conversation ids, deltas and terminal errors',()=>{
  assert.deepEqual(parseAntigravityEvent({event:'init',conversation_id:'native-42',init:{model:'example'}}),{type:'init',conversationId:'native-42',model:'example'});
  assert.deepEqual(parseAntigravityEvent({event:'step_update',step_update:{step_type:'agent_response',text_delta:'共享记忆已收到',step_index:3}}),{type:'delta',text:'共享记忆已收到',step:3});
  const end=parseAntigravityEvent({event:'result',result:{status:'ERROR',error:'authentication required'}});assert.equal(end.status,'ERROR');assert.equal(end.error,'authentication required');
  assert.equal(parseAntigravityEvent({event:'unknown'}),null);
});
test('quota reports remove terminal escapes and account email',()=>{
  const report=cleanReport('\x1b[32mQuota 89%\x1b[0m\nuser@example.com');assert.equal(report,'Quota 89%\n[账号邮箱已隐藏]');
});
test('official quota report interprets remaining rather than consumed percentages',()=>{
  const rows=parseQuotaReport('Gemini Models\tWeekly Limit Remaining\t79%\t2026-10-08T12:15:52Z\nGemini Models\tFive Hour Limit Remaining\t100%\t2026-10-07T21:30:26Z\nunknown 50%');
  assert.equal(rows.length,2);assert.equal(rows[0].remaining,79);assert.equal(rows[0].window,'weekly');assert.equal(rows[1].remaining,100);
  assert.deepEqual(parseQuotaReport('Gemini Models\tWeekly Limit Remaining\t109%\tinvalid'),[]);
});


test('model family quota is not overwritten by a later family with more remaining',()=>{
  const rows=[{group:'Gemini Models',window:'fiveHour',remaining:85,resetsAt:1900000000},{group:'Gemini Models',window:'weekly',remaining:76,resetsAt:1901000000},{group:'Claude and GPT models',window:'fiveHour',remaining:100,resetsAt:1900005000}];
  assert.equal(aggregateQuotaRows(rows).fiveHour.remaining,85);
  assert.deepEqual(aggregateQuotaRows(rows),aggregateQuotaRows([...rows].reverse()));
  assert.equal(aggregateQuotaRows(rows).weekly.remaining,76);
});
