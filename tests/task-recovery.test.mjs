import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recoveryReason,recoveryPrompt,missingThread} from '../lib/task-recovery.mjs';
test('recovery distinguishes restart-adjacent disconnect, explicit stop and expired authorization',()=>{
 assert.equal(recoveryReason('Codex 后台连接中断'),'disconnect');
 assert.equal(recoveryReason('token expired'),'authorization');
 assert.equal(recoveryReason('401 unauthorized'),'authorization');
 assert.equal(recoveryReason('connection closed',true),'stopped');
 assert.equal(recoveryReason('request timeout'),'execution');
});
test('resume keeps the original request and guards uncertain side effects',()=>{
 const task={mode:'live',status:'interrupted',goal:'旧目标',currentPrompt:'当前请求',executionMode:'read-only'};
 const prompt=recoveryPrompt(task);assert.ok(prompt.includes('当前请求'));assert.ok(prompt.includes('先检查结果，不直接重复'));assert.equal(task.executionMode,'read-only');
 assert.throws(()=>recoveryPrompt({...task,status:'completed'}));assert.throws(()=>recoveryPrompt({...task,mode:'demo'}));
});
test('new native thread is allowed only for a missing thread, not auth or transport failures',()=>{
 assert.equal(missingThread('thread not found'),true);assert.equal(missingThread('no rollout found'),true);
 assert.equal(missingThread('401 unauthorized'),false);assert.equal(missingThread('connection closed'),false);
});
