import {test} from 'node:test';
import assert from 'node:assert/strict';
import {quotaForModel,formatQuotaReset,renderQuotaSummary} from '../public/account-ui.js';
test('displayed quota follows the selected model family without mixing reset times',()=>{
  const rows=[{group:'Gemini Models',window:'fiveHour',remaining:85,resetsAt:1900000000},{group:'Gemini Models',window:'weekly',remaining:76,resetsAt:1901000000},{group:'Claude and GPT models',window:'fiveHour',remaining:100,resetsAt:1900005000}];
  const gemini=quotaForModel(rows,'gemini-3.8-flash');
  assert.equal(gemini.quota.fiveHour.remaining,85);assert.equal(gemini.quota.weekly.remaining,76);
  assert.equal(gemini.quota.fiveHour.resetsAt,1900000000000);
  assert.equal(quotaForModel(rows,'claude-sonnet-4-6').quota.fiveHour.remaining,100);
  assert.equal(quotaForModel(rows,'gpt-example').quota.fiveHour.remaining,100);
  assert.equal(quotaForModel(rows,'unknown'),null);assert.equal(quotaForModel([],'gemini-example'),null);
});

test('quota reset dates use Shanghai time with clock time only for the five-hour window',()=>{
  const reset=Date.parse('2026-10-28T17:05:00Z');
  assert.equal(formatQuotaReset(reset,'fiveHour'),'2026-10-29 01:05');
  assert.equal(formatQuotaReset(reset,'weekly'),'2026-10-29');
  assert.equal(formatQuotaReset(reset,'monthly'),'2026-10-29');
  assert.equal(formatQuotaReset(null,'weekly'),'重置时间未知');
  assert.equal(formatQuotaReset(NaN,'fiveHour'),'重置时间未知');
  const html=renderQuotaSummary({quota:{monthly:{remaining:70,capacity:100,resetsAt:reset}},checkedAt:new Date().toISOString()});
  assert.match(html,/月额/);assert.match(html,/70%/);assert.match(html,/2026-10-29 重置/);assert.doesNotMatch(html,/01:05/);
});
