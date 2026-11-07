import {test} from 'node:test';import assert from 'node:assert/strict';
import {recordTokenUsage} from '../lib/token-usage.mjs';
const counts=(n=0)=>({inputTokens:100+n,cachedInputTokens:80,cacheWriteInputTokens:0,outputTokens:20+n,reasoningOutputTokens:10,totalTokens:120+2*n});
test('official usage replaces repeated notifications and never adds cached or reasoning tokens twice',()=>{
  const task={modelRuns:[{threadId:'A',turnId:'1'}]};
  const p={threadId:'A',turnId:'1',tokenUsage:{total:counts(),last:counts()}};
  assert.equal(recordTokenUsage(task,p),true);recordTokenUsage(task,p);
  assert.equal(task.modelRuns[0].tokenUsage.total.totalTokens,120);assert.equal(task.modelRuns[0].tokenUsage.turn,null);
  task.modelRuns.push({threadId:'A',turnId:'2',usageBaseline:task.codexTokenTotals.A});
  recordTokenUsage(task,{...p,turnId:'2',tokenUsage:{total:counts(10),last:counts(10)}});
  assert.equal(task.modelRuns[1].tokenUsage.turn.inputTokens,10);assert.equal(task.modelRuns[1].tokenUsage.turn.outputTokens,10);
  recordTokenUsage(task,p);assert.equal(task.codexTokenTotals.A.totalTokens,140);
});
test('late usage updates are attached to the correct turn and missing reports stay unknown',()=>{
  const task={modelRuns:[{threadId:'A',turnId:'1'},{threadId:'A',turnId:'2'}]};
  assert.equal(recordTokenUsage(task,{threadId:'A',turnId:'1',tokenUsage:{total:counts(),last:counts()}}),true);
  assert.equal(task.modelRuns[1].tokenUsage,undefined);
  assert.equal(recordTokenUsage(task,{threadId:'A',turnId:'2',tokenUsage:{total:{},last:{}}}),false);
  assert.equal(recordTokenUsage(task,{threadId:'B',turnId:'2',tokenUsage:{total:counts(),last:counts()}}),false);
});
