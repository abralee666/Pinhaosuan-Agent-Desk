const backgroundKinds = new Set(['step', 'process', 'context', 'tool', 'tool_result']);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Group only adjacent background records, preserving messages and alerts in order.
export function renderExecutionTimeline(events, { taskId, renderEvent, expanded = new Set() }) {
  let html = '';
  for (let index = 0; index < events.length;) {
    if (!backgroundKinds.has(events[index].kind)) {
      html += renderEvent(events[index++]);
      continue;
    }
    const start = index;
    while (index < events.length && backgroundKinds.has(events[index].kind)) index++;
    const group = events.slice(start, index);
    const key = JSON.stringify([taskId, group[0].id ?? start]);
    const steps = group.filter(event => event.kind !== 'tool_result').length;
    const results = group.filter(event => event.kind === 'tool_result').length;
    const count = [steps ? `${steps} 个步骤` : '', results ? `${results} 条输出` : ''].filter(Boolean).join(' · ');
    html += `<details class="execution-group" data-execution-key="${escape(key)}"${expanded.has(key) ? ' open' : ''}><summary><span class="execution-chevron" aria-hidden="true">›</span><span>执行过程</span><span class="execution-count">${count}</span></summary><div class="execution-content">${group.map(event => `<div class="execution-entry${event.kind === 'tool_result' ? ' execution-output' : ''}"><span class="execution-entry-label">${event.kind === 'tool_result' ? '命令输出' : '后台步骤'}</span><pre>${escape(String(event.text ?? '').replaceAll('模拟', ''))}</pre></div>`).join('')}</div></details>`;
  }
  return html;
}

export function bindExecutionGroups(timeline) {
  const expanded = new Set();
  timeline.addEventListener('toggle', event => {
    const details = event.target;
    if (!details.matches?.('details[data-execution-key]') || !timeline.contains(details)) return;
    if (details.open) expanded.add(details.dataset.executionKey);
    else expanded.delete(details.dataset.executionKey);
  }, true);
  return expanded;
}
