const $ = id => document.getElementById(id);
const remoteBase = location.pathname.match(/^\/d\/[a-f0-9-]{36}/)?.[0] || '';
let remotePoll;
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names = {codex:'Codex', antigravity:'Antigravity', user:'你', system:'系统'};
const labels = {idle:'等待执行', running:'正在执行', handoff:'正在交接', completed:'本轮完成', failed:'执行失败', interrupted:'已暂停', waiting_quota:'等待额度', waiting_account:'等待账号', waiting_agent:'等待平台'};
let state, device, selectedId, stream, statusTimer;
let connected = false, operation = null, retryOperation = null, lastTaskId, lastEvents = 0, lastTimeline;
let pairingBusy = false, pairRetryOperation = null, checkingDevice = null, authEpoch = 0;
let currentTab = 'timeline';
let pendingAttachments = [];

const selectedTask = () => state?.tasks?.find(t => t.id === selectedId);
const pausedStatuses = ['interrupted','failed','waiting_account','waiting_agent','waiting_quota'];

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.hidden = true, 4000);
}

function connection(text, kind = '') {
  const el = $('connection');
  el.textContent = '';
  const dot = document.createElement('i');
  el.append(dot, text);
  el.className = 'connection-status ' + kind;
}

function closeStream() { if (stream) stream.close(); stream = null; clearTimeout(remotePoll); }
function stopPolling() { clearTimeout(statusTimer); statusTimer = null; }
function pairError(message) { $('pair-error').textContent = message; $('pair-error').hidden = !message; }

function clearWorkspace() {
  state = null; selectedId = null; lastTaskId = null; lastEvents = 0; lastTimeline = '';
  pendingAttachments = []; renderAttachments();
  $('task-select').innerHTML = '<option value="">暂无任务</option>';
  $('task-goal').textContent = '从电脑上的任务开始'; $('task-status').textContent = '准备开始';
  $('task-status').className = 'status-label'; $('provider').value = 'codex'; $('execution').value = 'read-only';
  $('active-agent').textContent = '暂无任务'; $('task-note').textContent = '';
  $('timeline').innerHTML = '<div class="empty-state"><div class="empty-icon">💬</div><p>暂无执行记录<br><small>在下方输入指令或上传文件开始交互</small></p></div>';
  $('files').innerHTML = '<p class="empty-state">当前任务还没有成果文件</p>';
  $('event-count').textContent = '0'; $('file-count').textContent = '0';
  $('prompt').value = ''; $('new-goal').value = ''; $('file-content').textContent = ''; $('file-title').textContent = '文件预览';
  $('recovery-note').textContent = ''; $('send-note').textContent = ''; $('device-caption').textContent = '任务与文件保存在电脑上';
  $('file-dialog').close(); $('new-dialog').close(); $('retry-dialog').close();
  clearTimeout(toast.timer); $('toast').hidden = true; $('toast').textContent = '';
}

function showPair(message = '', {keepPairRequest = false} = {}) {
  authEpoch++;
  closeStream(); stopPolling(); connected = false; state = null; device = null; selectedId = null;
  retryOperation = null;
  if (!keepPairRequest) pairRetryOperation = null;
  clearWorkspace();
  $('workspace').hidden = true; $('pair-panel').hidden = false; $('pair-pending').hidden = true;
  $('pair-form').hidden = false; $('check-pair').hidden = false;
  $('pair-title').textContent = '连接你的电脑';
  $('pair-description').textContent = remoteBase
    ? '在电脑端生成跨网络配对二维码，扫码后等待电脑确认。电脑与中继服务需要保持在线。'
    : '在电脑端打开“手机控制”，开启局域网连接，再用手机扫描配对二维码。手机与电脑需要连接同一网络。';
  $('check-pair').textContent = pairRetryOperation ? '重试配对申请' : '重新检查连接';
  connection('未连接'); pairError(message);
}

async function responseJSON(response) {
  let result; try { result = await response.json(); } catch { throw new Error('电脑返回了无法读取的响应，请稍后重试'); }
  if (!response.ok) { const error = new Error(result.error || '请求失败'); error.status = response.status; error.result = result; throw error; }
  return result;
}

async function read(route) {
  if (remoteBase && route === 'state' && selectedId) {
    const query = new URLSearchParams({taskId:selectedId});
    if (state?.projectionTaskId === selectedId && Number.isInteger(state?.revision)) query.set('revision', state.revision);
    route += '?' + query;
  }
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
  try { return await responseJSON(await fetch(remoteBase + '/api/' + route, {credentials:'same-origin', cache:'no-store', signal:controller.signal})); }
  finally { clearTimeout(timer); }
}

function requestId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  if (!globalThis.crypto?.getRandomValues) throw new Error('当前浏览器无法安全生成操作编号，请换用系统浏览器');
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

async function post(op) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 35000);
  try {
    return await responseJSON(await fetch(remoteBase + '/api/' + op.route, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {'Content-Type':'application/json', 'X-Agent-Desk':'1', 'X-Request-Id':op.id},
      body: JSON.stringify(op.data),
      signal: controller.signal
    }));
  } finally { clearTimeout(timer); }
}

async function uploadFileToDesktop(file) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(remoteBase + '/api/attachments', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-File-Name': encodeURIComponent(file.name),
        'X-Agent-Desk': '1'
      },
      body: file,
      signal: controller.signal
    });
    return await responseJSON(res);
  } finally {
    clearTimeout(timer);
  }
}

async function operate(route, data, done) {
  if (operation) return;
  if (retryOperation) { if (!$('retry-dialog').open) $('retry-dialog').showModal(); return; }
  try { return await perform({route, data, id:requestId(), done}); }
  catch (error) { toast(error.message); }
}

async function perform(op) {
  if (operation) return;
  const epoch = authEpoch;
  operation = op; render();
  try {
    const result = await post(op);
    if (epoch !== authEpoch || device?.status !== 'approved') return;
    retryOperation = null;
    if (op.done) op.done(result);
    await loadState().catch(() => { if (epoch === authEpoch) { toast('操作已确认，状态正在重新同步'); void checkDevice(); } });
  } catch (error) {
    if (epoch !== authEpoch) return;
    const isDeviceAuthError = error.status === 401 || ['device_session_required', 'device_pending', 'device_revoked', 'device_access_disabled'].includes(error.result?.code);
    if (isDeviceAuthError) { retryOperation = null; showPair(error.message); }
    else if (!error.status || error.status >= 500) {
      retryOperation = op; toast('连接中断，这条操作的结果尚未确认');
      if (!$('retry-dialog').open) $('retry-dialog').showModal();
    } else { retryOperation = null; toast(error.message); await loadState().catch(()=>{}); }
  } finally { operation = null; render(); }
}

async function claim(token) {
  if (pairingBusy || operation) return;
  let op;
  try { op = typeof token === 'string' ? {route:'device/pair', data:{token, name:'我的手机'}, id:requestId()} : token; }
  catch (error) { pairError(error.message); return; }
  pairingBusy = true; let confirmed = false;
  pairRetryOperation = op;
  showPair('', {keepPairRequest:true});
  const epoch = authEpoch;
  pairError(''); $('pair-submit').disabled = true; $('check-pair').disabled = true;
  history.replaceState(null, '', location.pathname + location.search);
  $('pair-link').value = '';
  try {
    const result = await post(op);
    if (epoch !== authEpoch) return;
    confirmed = true; pairRetryOperation = null; device = result.device;
    await acceptDevice(result);
  } catch (error) {
    if (epoch !== authEpoch) return;
    if (!error.status || error.status >= 500) {
      showPair(confirmed ? '配对已确认，暂时无法同步电脑状态。请点击“重新检查连接”。' : '配对响应尚未确认。点击“重试配对申请”会沿用原操作编号，不会重复申请。', {keepPairRequest:!confirmed});
    } else showPair(error.message || '配对失败，请在电脑端生成新链接');
  } finally { pairingBusy = false; $('pair-submit').disabled = false; $('check-pair').disabled = false; }
}

async function acceptDevice(result) {
  const epoch = authEpoch;
  device = result.device;
  if (!device || ['revoked','expired'].includes(device.status) || result.enabled === false) { showPair('电脑已关闭连接或取消了这台设备的授权'); return; }
  pairError('');
  if (device.status === 'pending') {
    closeStream(); clearWorkspace();
    $('pair-code').textContent = device.id.slice(0, 6).toUpperCase();
    connected = false; $('workspace').hidden = true; $('pair-panel').hidden = false; $('pair-pending').hidden = false; $('pair-form').hidden = true;
    $('pair-title').textContent = '配对申请已发送'; $('pair-description').textContent = '这台手机正在申请访问电脑上的拼好算。请在电脑端确认后继续。'; connection('等待确认');
    clearTimeout(statusTimer); statusTimer = setTimeout(checkDevice, 1800); return;
  }
  if (device.status !== 'approved') { showPair('设备尚未获得访问权限，请重新配对'); return; }
  $('pair-panel').hidden = true; $('workspace').hidden = false;
  $('device-caption').textContent = `${device.name || '我的手机'} · 任务与文件保存在电脑上`;
  const deviceId = device.id;
  await loadState();
  if (epoch !== authEpoch || device?.id !== deviceId || device.status !== 'approved') return;
  if (!stream || stream.readyState === EventSource.CLOSED) connectStream();
  clearTimeout(statusTimer); statusTimer = setTimeout(checkDevice, 8000);
}

async function checkDevice() {
  clearTimeout(statusTimer);
  if (pairingBusy || checkingDevice) return checkingDevice;
  const epoch = authEpoch;
  const current = (async () => {
    try { const result = await read('device/status'); if (epoch === authEpoch) { pairRetryOperation = null; await acceptDevice(result); } }
    catch (error) {
      if (epoch !== authEpoch) return;
      if (error.status === 401 && pairRetryOperation) { await claim(pairRetryOperation); return; }
      if ([401,403,404].includes(error.status)) { showPair(error.message); return; }
      connected = false; connection('正在重连', 'reconnecting'); render();
      pairError(remoteBase?'暂时无法连接电脑。请确认电脑工作台和公网中继仍在运行。':'暂时无法连接电脑。请确认电脑上的服务仍在运行，且两台设备连接同一网络。');
      statusTimer = setTimeout(checkDevice, 4000);
    }
  })();
  checkingDevice = current;
  try { await current; } finally { if (checkingDevice === current) checkingDevice = null; }
}

function applyState(next) {
  state = next; connected = true; connection('已同步', 'connected');
  if (!state.tasks?.some(t => t.id === selectedId)) selectedId = state.runtime?.activeTaskId || state.selectedTaskId || state.tasks?.[0]?.id;
  render();
}

async function loadState() {
  if (!device || device.status !== 'approved') return;
  const epoch = authEpoch, deviceId = device.id;
  try {
    const next = await read('state');
    if (epoch === authEpoch && device?.id === deviceId && device.status === 'approved') {
      if (next.unchanged) { connected = true; connection('已同步', 'connected'); render(); }
      else applyState(next);
    }
  } catch (error) {
    if (epoch !== authEpoch) return;
    connected = false; render();
    if ([401,403].includes(error.status)) { showPair(error.message); throw error; }
    connection('正在重连', 'reconnecting'); throw error;
  }
}

function connectStream() {
  closeStream();
  if (device?.status !== 'approved') return;
  const epoch = authEpoch;
  if (remoteBase) {
    stream = {readyState:1, close(){clearTimeout(remotePoll);}};
    const poll = async () => {
      if (epoch !== authEpoch || device?.status !== 'approved') return;
      try { await loadState(); } catch {}
      if (epoch === authEpoch && device?.status === 'approved') remotePoll = setTimeout(poll, 2500);
    };
    remotePoll = setTimeout(poll, 2500);
    return;
  }
  const source = new EventSource('/api/events'); stream = source;
  source.addEventListener('state', e => {
    if (source !== stream || epoch !== authEpoch || device?.status !== 'approved') return;
    try { applyState(JSON.parse(e.data)); }
    catch { toast('状态更新暂时无法读取，正在重新获取'); void loadState().catch(()=>{}); }
  });
  source.addEventListener('device', e => {
    if (source !== stream || epoch !== authEpoch) return;
    try { const event = JSON.parse(e.data); if (event.status && event.status !== 'approved') showPair('电脑已取消设备授权，请重新配对'); } catch {}
  });
  source.onerror = () => {
    if (source !== stream) return;
    connected = false; connection('正在重连', 'reconnecting'); render(); void checkDevice();
  };
}

function providerReady(provider) {
  const group = state?.accountManager?.providers?.[provider];
  return !!group?.activeAccountId;
}

function busy() {
  return !!state?.runtime?.busy || Object.values(state?.accountManager?.providers || {}).some(p => p.operation);
}

function formatMarkdown(text) {
  const raw = String(text ?? '').replaceAll('模拟', '');
  if (!raw.trim()) return '';
  const blocks = raw.split(/```/g);
  let html = '';
  for (let i = 0; i < blocks.length; i++) {
    if (i % 2 === 1) {
      // Code block
      const firstLineBreak = blocks[i].indexOf('\n');
      const lang = firstLineBreak > 0 ? blocks[i].slice(0, firstLineBreak).trim() : '';
      const code = firstLineBreak > 0 ? blocks[i].slice(firstLineBreak + 1) : blocks[i];
      html += `<pre><code>${escape(code.trim())}</code></pre>`;
    } else {
      // Normal markdown text
      const lines = blocks[i].split('\n');
      let inList = false;
      for (const line of lines) {
        const trimmed = line.trim();
        if (/^[-*•]\s+/.test(trimmed)) {
          if (!inList) { html += '<ul>'; inList = true; }
          const itemText = trimmed.replace(/^[-*•]\s+/, '');
          html += `<li>${formatInline(itemText)}</li>`;
        } else if (/^\d+\.\s+/.test(trimmed)) {
          if (!inList) { html += '<ol>'; inList = true; }
          const itemText = trimmed.replace(/^\d+\.\s+/, '');
          html += `<li>${formatInline(itemText)}</li>`;
        } else {
          if (inList) { html += inList ? '</ul>' : ''; inList = false; }
          if (trimmed) html += `<p>${formatInline(trimmed)}</p>`;
        }
      }
      if (inList) html += '</ul>';
    }
  }
  return html;
}

function formatInline(str) {
  return escape(str)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function renderAttachments() {
  const tray = $('composer-attachments');
  const badge = $('attachment-badge');
  if (!pendingAttachments.length) {
    tray.hidden = true; tray.innerHTML = '';
    if (badge) badge.hidden = true;
    return;
  }
  if (badge) {
    badge.textContent = String(pendingAttachments.length);
    badge.hidden = false;
  }
  tray.hidden = false;
  tray.innerHTML = pendingAttachments.map((item, idx) => `
    <div class="attachment-chip">
      <span class="attachment-chip-icon">📎</span>
      <span class="attachment-chip-name" title="${escape(item.name)}">${escape(item.name)}</span>
      <span class="attachment-chip-size">${Math.max(1, Math.ceil(item.size / 1024))} KB</span>
      <button type="button" class="attachment-chip-remove" data-remove-attachment="${idx}" title="移除附件">×</button>
    </div>
  `).join('');
}

function fileIcon(name = '') {
  const ext = name.split('.').pop().toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) return '🖼️';
  if (['js', 'mjs', 'ts', 'py', 'json', 'html', 'css', 'go', 'rs', 'c', 'cpp'].includes(ext)) return '💻';
  if (['pdf'].includes(ext)) return '📕';
  if (['doc', 'docx', 'txt', 'md'].includes(ext)) return '📄';
  if (['zip', 'tar', 'gz', '7z'].includes(ext)) return '📦';
  return '▤';
}

function render() {
  if (!state) return;
  const task = selectedTask(), globallyBusy = busy(), locked = !!operation || !!retryOperation || !connected;
  const tasks = state.tasks || [];

  $('task-select').innerHTML = tasks.length ? tasks.map(t => `<option value="${escape(t.id)}">${escape(t.goal)}</option>`).join('') : '<option value="">暂无任务</option>';
  $('task-select').value = selectedId || ''; $('task-select').disabled = !tasks.length;

  if (lastTaskId !== task?.id) {
    $('provider').value = task?.agent || 'codex'; $('execution').value = task?.executionMode || 'read-only'; $('network').value = task?.networkAccess ? 'on' : 'off';
    $('prompt').value = ''; lastTaskId = task?.id; lastEvents = 0; lastTimeline = '';
    pendingAttachments = []; renderAttachments();
  }

  $('task-goal').textContent = task?.goal || '从电脑上的任务开始';
  $('task-status').textContent = task ? labels[task.status] || task.status : '准备开始';
  $('task-status').className = 'status-label ' + (task?.status || '');
  $('active-agent').textContent = task ? `${names[task.agent] || 'Agent'}${task.mode !== 'live' ? ' · 演示任务' : ''}` : '暂无任务';

  const completeCount = task?.completed?.length || 0;
  $('task-note').textContent = task ? task.mode === 'live' ? `已保存 ${completeCount} 个执行回合、${task.checkpointCount || 0} 个检查点` : `已完成 ${completeCount} / ${task.totalSteps || 4} 步；演示任务不会调用真实模型` : '可以查看进度、补充指令，也可以新建一个待执行的任务。';

  const activeThisTask = globallyBusy && state.runtime?.activeTaskId === task?.id;
  const waitingAuto = task?.status === 'waiting_quota' && task?.quotaWait?.status === 'scheduled';
  $('stop-task').hidden = !activeThisTask && !waitingAuto;
  $('stop-task').disabled = locked || (globallyBusy && !activeThisTask);
  $('stop-task').querySelector('span').textContent = waitingAuto ? '取消自动续接' : '暂停任务';

  const paused = task && pausedStatuses.includes(task.status);
  $('resume-task').hidden = !paused;
  $('resume-task').disabled = locked || globallyBusy || (task.mode === 'live' && !providerReady($('provider').value));
  $('recovery-note').hidden = !paused;
  $('recovery-note').textContent = task?.mode === 'live' ? `继续执行会沿用该任务上次的${task.executionMode === 'full-access' ? '完全访问' : task.executionMode === 'workspace' ? '文件修改' + (task.networkAccess ? '与联网' : '、禁止联网') : '仅回复'}权限，先核对已有成果。` : '点击继续，将从已完成的演示步骤接着执行。';
  if (waitingAuto) $('recovery-note').textContent = '预计 ' + new Date(task.quotaWait.dueAt).toLocaleString('zh-CN') + ' 核验额度，可用后自动继续。你也可以取消自动续接。';

  // Timeline events rendering
  const timeline = $('timeline');
  const nearBottom = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 120;
  const events = task?.events || [];
  const timelineHTML = events.length ? events.map(event => {
    const time = new Date(event.at).toLocaleTimeString('zh-CN', {hour:'2-digit', minute:'2-digit'});
    if (event.actor === 'user') {
      return `
        <article class="chat-msg user">
          <div class="msg-bubble">${escape(event.text)}</div>
          <div class="msg-meta"><span>你</span> · <time>${time}</time></div>
        </article>
      `;
    }
    if (event.actor === 'system') {
      const isFailed = event.kind === 'failed';
      return `<div class="system-event-pill ${isFailed ? 'failed' : ''}">${escape(event.text)}</div>`;
    }
    // Agent message
    const agentName = names[event.actor] || 'Agent';
    const avatar = `/providers/${event.actor === 'codex' ? 'codex' : 'antigravity'}.png`;
    return `
      <article class="chat-msg agent">
        <div class="agent-card">
          <div class="agent-card-header">
            <img class="agent-avatar" src="${avatar}" alt="${agentName}">
            <span class="agent-name-tag">${agentName}</span>
            <time class="agent-time">${time}</time>
          </div>
          <div class="agent-card-body">${formatMarkdown(event.text)}</div>
        </div>
      </article>
    `;
  }).join('') : '<div class="empty-state"><div class="empty-icon">💬</div><p>暂无执行记录<br><small>在下方输入指令或上传文件开始交互</small></p></div>';

  if (timelineHTML !== lastTimeline) {
    timeline.innerHTML = timelineHTML;
    if (nearBottom || lastEvents === 0) timeline.scrollTop = timeline.scrollHeight;
    lastTimeline = timelineHTML;
  }
  lastEvents = events.length;
  $('event-count').textContent = String(events.length);

  // Files rendering
  const files = task?.fileContents || [];
  $('file-count').textContent = String(files.length);
  $('files').innerHTML = files.length ? files.map((file, index) => `
    <button type="button" class="file-item-card" data-file="${index}">
      <div class="file-badge-icon">${fileIcon(file.name)}</div>
      <div class="file-details">
        <div class="file-title-text" title="${escape(file.name)}">${escape(file.name)}</div>
        <div class="file-meta-text">${Math.max(1, Math.ceil(file.size / 1024))} KB · 轻触预览</div>
      </div>
      <span class="file-arrow-btn" aria-hidden="true">›</span>
    </button>
  `).join('') : '<p class="empty-state">当前任务还没有成果文件</p>';

  // Buttons & Controls
  $('new-task').disabled = locked || globallyBusy;
  $('create-task').disabled = locked || globallyBusy;
  $('provider').disabled = locked || globallyBusy;
  $('execution').disabled = locked || globallyBusy;

  const isDemo = task && task.mode !== 'live';
  $('execution').closest('.setting-item').hidden = !!isDemo;
  $('network').closest('.setting-item').hidden = !!isDemo;
  if ($('execution').value === 'read-only') $('network').value = 'off';
  if ($('execution').value === 'full-access') $('network').value = 'on';
  $('network').disabled = locked || globallyBusy || $('execution').value !== 'workspace';
  $('execution-note').textContent = isDemo
    ? '当前是演示任务，点击按钮后继续演示流程。'
    : $('execution').value === 'full-access'
      ? '当前任务已由电脑端授权完全访问：允许访问工作区外文件、执行命令并联网。'
      : $('execution').value === 'workspace'
        ? '允许修改任务文件和执行命令；' + ($('network').value === 'on' ? '允许联网。' : '要求禁止联网。')
        : '仅生成回复。切换为“允许修改任务文件”后，Agent 才能在电脑的任务工作区内读写文件。';

  $('prompt').disabled = locked || globallyBusy || !task || isDemo;
  $('attachment-btn').disabled = locked || globallyBusy || !task || isDemo;

  const finishedDemo = isDemo && (task.completed?.length || 0) >= (task.totalSteps || 4);
  const canSend = !locked && !globallyBusy && task && !finishedDemo && (isDemo || providerReady($('provider').value));
  $('send').disabled = !canSend;

  $('send-note').textContent = retryOperation
    ? '上一次操作结果尚未确认。点击刷新状态或重试后再发送。'
    : globallyBusy
      ? activeThisTask ? '电脑正在执行本任务中…' : '电脑正在执行另一个任务…'
      : !task ? '先选择任务，或点击右上角“＋ 新建”。'
      : !isDemo && !providerReady($('provider').value) ? '当前平台没有可用账号，请在电脑端连接。'
      : '指令在电脑工作区执行，成果实时同步。';

  // 更新任务切换触控按钮与底部抽屉列表
  const pickerLabel = $('task-picker-label');
  if (pickerLabel) {
    pickerLabel.textContent = task ? (task.goal || '未命名任务') : '暂无任务';
  }
  const pickerTrigger = $('task-picker-trigger');
  if (pickerTrigger) {
    pickerTrigger.disabled = !tasks.length && (locked || globallyBusy);
  }

  const sheetCounter = $('task-sheet-counter');
  if (sheetCounter) {
    sheetCounter.textContent = `${tasks.length} 个任务`;
  }

  const sheetList = $('task-sheet-list');
  if (sheetList) {
    if (!tasks.length) {
      sheetList.innerHTML = `
        <div class="sheet-empty-state">
          <div class="empty-icon" style="font-size:32px;margin-bottom:8px">📋</div>
          <p>暂无可用任务</p>
          <button type="button" class="button primary sheet-create-first" id="sheet-empty-new">创建第一个任务</button>
        </div>`;
      const emptyBtn = sheetList.querySelector('#sheet-empty-new');
      if (emptyBtn) emptyBtn.onclick = () => { closeTaskSheet(); $('new-goal').value = ''; $('new-dialog').showModal(); $('new-goal').focus(); };
    } else {
      sheetList.innerHTML = tasks.map(t => {
        const isSelected = t.id === (selectedId || task?.id);
        const title = t.goal || '未命名任务';
        const statusLabel = labels[t.status] || t.status || '准备开始';
        const statusClass = t.status || 'created';
        const agentName = names[t.agent] || 'Codex';
        const stepText = t.mode === 'live'
          ? (t.checkpointCount ? `${t.checkpointCount} 个检查点` : '已接入实时环境')
          : `已完成 ${t.completed?.length || 0} / ${t.totalSteps || 4} 步`;
        return `
          <div class="sheet-task-card ${isSelected ? 'active' : ''}" data-task-id="${escape(t.id)}" role="option" aria-selected="${isSelected}">
            <div class="sheet-task-main">
              <div class="sheet-task-meta">
                <span class="status-label ${statusClass}">${escape(statusLabel)}</span>
                <span class="agent-tag">${escape(agentName)}</span>
                <span class="sheet-step-badge">${escape(stepText)}</span>
              </div>
              <div class="sheet-task-title">${escape(title)}</div>
            </div>
            <div class="sheet-task-check">
              ${isSelected ? `
                <span class="sheet-selected-pill">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                  <span>当前</span>
                </span>
              ` : `
                <div class="sheet-unselected-circle"></div>
              `}
            </div>
          </div>`;
      }).join('');

      sheetList.querySelectorAll('.sheet-task-card').forEach(card => {
        card.addEventListener('click', () => {
          const id = card.dataset.taskId;
          if (id && id !== selectedId) {
            selectedId = id;
            $('task-select').value = id;
            $('task-select').dispatchEvent(new Event('change'));
          }
          closeTaskSheet();
        });
      });
    }
  }

  // 同步执行配置的分段式胶囊与卡片按钮状态
  document.querySelectorAll('.segmented-pill-group, .segmented-cards-group').forEach(group => {
    const targetId = group.dataset.target;
    const targetSelect = $(targetId);
    if (!targetSelect) return;
    const currentVal = targetSelect.value;
    group.querySelectorAll('button[data-val]').forEach(btn => {
      const isMatch = btn.dataset.val === currentVal;
      btn.classList.toggle('active', isMatch);
      btn.setAttribute('aria-pressed', isMatch ? 'true' : 'false');
      btn.disabled = targetSelect.disabled || btn.classList.contains('is-disabled');
    });
  });
}

// Tab Switching
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    currentTab = tab;
    document.querySelectorAll('.tab-btn').forEach(b => {
      const active = b === btn;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', String(active));
    });
    $('tab-timeline-panel').hidden = tab !== 'timeline';
    $('tab-files-panel').hidden = tab !== 'files';
    $('tab-settings-panel').hidden = tab !== 'settings';
    if (tab === 'timeline') {
      const timeline = $('timeline');
      timeline.scrollTop = timeline.scrollHeight;
    }
  });
});

// Attachment handling
$('attachment-btn').addEventListener('click', () => {
  if (busy() || !selectedTask()) {
    toast('请先选择或创建任务');
    return;
  }
  $('attachment-input').click();
});

$('attachment-input').addEventListener('change', () => {
  const files = [...$('attachment-input').files];
  $('attachment-input').value = '';
  if (!files.length) return;
  if (pendingAttachments.length + files.length > 8) {
    toast('最多同时添加 8 个附件');
    return;
  }
  for (const f of files) {
    if (!f.size || f.size > 10 * 1024 * 1024) {
      toast(`文件 "${f.name}" 超过 10 MB 限制`);
      return;
    }
    pendingAttachments.push(f);
  }
  renderAttachments();
  toast(`已添加 ${files.length} 个附件，随指令一同发送`);
});

$('composer-attachments').addEventListener('click', e => {
  const btn = e.target.closest('[data-remove-attachment]');
  if (!btn) return;
  const idx = Number(btn.dataset.removeAttachment);
  if (!Number.isNaN(idx)) {
    pendingAttachments.splice(idx, 1);
    renderAttachments();
  }
});

// Auto-grow textarea
$('prompt').addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 120) + 'px';
});

$('task-select').addEventListener('change', () => {
  selectedId = $('task-select').value;
  render();
  if (remoteBase) void loadState().catch(()=>{});
});

$('provider').addEventListener('change', render);
$('execution').addEventListener('change', render);
$('network').addEventListener('change', render);

$('new-task').addEventListener('click', () => {
  $('new-goal').value = '';
  $('new-dialog').showModal();
  $('new-goal').focus();
});

$('new-form').addEventListener('submit', e => {
  e.preventDefault();
  const goal = $('new-goal').value.trim();
  if (!goal) return;
  void operate('task', {goal, mode:'live', executionMode:'read-only'}, result => {
    selectedId = result.taskId;
    $('new-dialog').close();
    toast('任务已创建，确认后再开始执行');
  });
});

// Composer form submit (supports attachment uploading)
$('composer-form').addEventListener('submit', async e => {
  e.preventDefault();
  const task = selectedTask();
  if (!task || $('send').disabled) return;
  const prompt = $('prompt').value.trim();

  if (task.mode !== 'live') {
    void operate('run', {taskId:task.id});
    return;
  }
  if (!prompt && task.status !== 'idle' && !pendingAttachments.length) {
    toast('请输入需要补充的指令或添加附件');
    $('prompt').focus();
    return;
  }

  let attachmentIds = [];
  if (pendingAttachments.length > 0) {
    $('send').disabled = true;
    toast('正在上传附件至电脑…');
    try {
      for (const item of pendingAttachments) {
        const uploaded = await uploadFileToDesktop(item);
        if (uploaded?.id) attachmentIds.push(uploaded.id);
      }
    } catch (err) {
      $('send').disabled = false;
      toast('附件上传失败：' + err.message);
      return;
    }
  }

  const payload = {
    taskId: task.id,
    agent: $('provider').value,
    prompt: prompt || task.goal,
    executionMode: $('execution').value,
    networkAccess: $('execution').value === 'full-access' || ($('execution').value === 'workspace' && $('network').value === 'on'),
    attachmentIds: attachmentIds.length ? attachmentIds : undefined
  };

  void operate('run', payload, () => {
    $('prompt').value = '';
    $('prompt').style.height = 'auto';
    pendingAttachments = [];
    renderAttachments();
  });
});

$('stop-task').addEventListener('click', () => {
  const task = selectedTask();
  if (task && (state.runtime.activeTaskId === task.id || task.status === 'waiting_quota')) {
    void operate('stop', {taskId:task.id}, () => toast('停止请求已确认，任务记录会保留'));
  }
});

$('resume-task').addEventListener('click', () => {
  const task = selectedTask();
  if (!task || $('resume-task').disabled) return;
  void operate(task.mode === 'live' ? 'task/resume' : 'run', {taskId:task.id, ...(task.mode === 'live' ? {agent:$('provider').value} : {})});
});

$('refresh-state').addEventListener('click', () => {
  if (retryOperation) { $('retry-dialog').showModal(); return; }
  void loadState().then(() => toast('状态已同步最新')).catch(error => toast(error.message));
});

$('check-pair').addEventListener('click', () => { pairError(''); void checkDevice(); });

$('pair-form').addEventListener('submit', e => {
  e.preventDefault();
  try {
    const url = new URL($('pair-link').value.trim());
    if (url.origin !== location.origin) throw new Error('这条链接属于另一台电脑，请直接在浏览器中打开这条新链接');
    const token = new URLSearchParams(url.hash.slice(1)).get('pair');
    if (!token) throw new Error('链接中没有配对信息，请复制电脑端的完整链接');
    void claim(token);
  } catch (error) {
    pairError(error.message === 'Invalid URL' ? '请粘贴电脑端的完整配对链接' : error.message);
  }
});

// File Click & Copy
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.close) $(button.dataset.close).close();
  const fileCard = event.target.closest('.file-item-card') || button.closest('[data-file]');
  if (fileCard && fileCard.dataset.file !== undefined) {
    const file = selectedTask()?.fileContents?.[Number(fileCard.dataset.file)];
    if (file) {
      $('file-title').textContent = file.name;
      $('file-content').textContent = file.content;
      $('file-dialog').showModal();
    }
  }
});

$('copy-file-btn')?.addEventListener('click', () => {
  const content = $('file-content').textContent;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(content).then(() => toast('已复制文件内容到剪贴板')).catch(() => toast('复制失败，请手动长按选择'));
  } else {
    toast('当前浏览器不支持快速复制');
  }
});

$('retry-command').addEventListener('click', () => {
  $('retry-dialog').close();
  if (retryOperation) void perform(retryOperation);
});

$('dismiss-retry').addEventListener('click', () => {
  $('retry-dialog').close();
  toast('上次操作仍未确认，确认后才能发送新操作');
});

window.addEventListener('online', () => { void checkDevice(); });
window.addEventListener('offline', () => {
  connected = false;
  connection('网络已断开', 'reconnecting');
  render();
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) void checkDevice(); });

const token = new URLSearchParams(location.hash.slice(1)).get('pair');
if (token) void claim(token);
else void checkDevice();


// 底部抽屉 (Bottom Sheet) 交互逻辑
function openTaskSheet() {
  const sheet = $('task-sheet');
  if (!sheet) return;
  sheet.hidden = false;
  const trigger = $('task-picker-trigger');
  if (trigger) trigger.setAttribute('aria-expanded', 'true');
  requestAnimationFrame(() => {
    sheet.classList.add('is-open');
  });
  document.body.style.overflow = 'hidden';
}

function closeTaskSheet() {
  const sheet = $('task-sheet');
  if (!sheet) return;
  sheet.classList.remove('is-open');
  const trigger = $('task-picker-trigger');
  if (trigger) trigger.setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
  setTimeout(() => {
    if (!sheet.classList.contains('is-open')) {
      sheet.hidden = true;
    }
  }, 280);
}

const pickerTrigger = $('task-picker-trigger');
if (pickerTrigger) pickerTrigger.addEventListener('click', openTaskSheet);

const sheetClose = $('task-sheet-close');
if (sheetClose) sheetClose.addEventListener('click', closeTaskSheet);

const sheetBackdrop = $('task-sheet-backdrop');
if (sheetBackdrop) sheetBackdrop.addEventListener('click', closeTaskSheet);

const sheetNewBtn = $('task-sheet-new-btn');
if (sheetNewBtn) sheetNewBtn.addEventListener('click', () => {
  closeTaskSheet();
  $('new-goal').value = '';
  $('new-dialog').showModal();
  $('new-goal').focus();
});

// 执行配置分段按钮点击交互
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-target] button[data-val]');
  if (!btn || btn.disabled) return;
  const group = btn.closest('[data-target]');
  if (!group) return;
  const targetId = group.dataset.target;
  const targetSelect = $(targetId);
  if (!targetSelect) return;
  targetSelect.value = btn.dataset.val;
  targetSelect.dispatchEvent(new Event('change'));
});

// 支持按 Esc 键关闭抽屉
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const sheet = $('task-sheet');
    if (sheet && !sheet.hidden) {
      closeTaskSheet();
    }
  }
});

// URL 快捷参数支持 (预览/深层链接)
try {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('openSheet') === '1') {
    setTimeout(() => openTaskSheet(), 200);
  }
  const targetTab = urlParams.get('tab');
  if (targetTab) {
    setTimeout(() => {
      const tabBtn = document.querySelector(`.tab-btn[data-tab="${targetTab}"]`);
      if (tabBtn) tabBtn.click();
    }, 200);
  }
} catch (_) {}
