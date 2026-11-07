import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderExecutionTimeline} from '../public/execution-ui.js';

const render = (events, options = {}) => renderExecutionTimeline(events, {taskId:'task-a', renderEvent:event => `<message>${event.text}</message>`, ...options});
test('background steps and long command output collapse together without swallowing replies or errors', () => {
  const html = render([
    {id:'a', kind:'tool', text:'后台执行：commandExecution'},
    {kind:'tool_result', text:'<script>alert(1)</script>\ncommand output'},
    {kind:'message', text:'正式回复'},
    {kind:'error', text:'需要处理的错误'},
    {id:'b', kind:'tool', text:'后台执行：reasoning'},
  ]);
  assert.equal((html.match(/<details /g) || []).length, 2);
  assert.doesNotMatch(html, / open>/);
  assert.match(html, /1 个步骤 · 1 条输出/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<\/details><message>正式回复<\/message><message>需要处理的错误<\/message><details/);
});
test('expanded group stays open when new output arrives and expansion is isolated by task', () => {
  const events = [{id:'a', kind:'tool', text:'command'}, {kind:'tool_result', text:'output'}];
  const expanded = new Set([JSON.stringify(['task-a','a'])]);
  assert.match(render(events, {expanded}), / open>/);
  assert.doesNotMatch(render(events, {expanded, taskId:'task-b'}), / open>/);
  assert.match(render([...events, {kind:'tool', text:'next step'}], {expanded}), / open>/);
});
