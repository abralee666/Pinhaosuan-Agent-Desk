const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));

/** Adds the desktop-only pairing controls. Opening the panel does not enable LAN access. */
export function mountDeviceUI({toast} = {}) {
  if (document.getElementById('device-dialog')) return;
  const target = document.querySelector('.heading-actions') || document.querySelector('.topbar-right');
  if (!target) return;
  const trigger = document.createElement('button');
  trigger.id = 'device-open';
  trigger.type = 'button';
  trigger.className = 'outline-button device-open';
  trigger.textContent = '手机控制';
  trigger.setAttribute('aria-haspopup', 'dialog');
  const dialog = document.createElement('dialog');
  dialog.id = 'device-dialog';
  dialog.className = 'device-dialog';
  dialog.setAttribute('aria-labelledby', 'device-title');
  dialog.innerHTML = `<div class="device-heading"><div><h2 id="device-title">手机与电脑协同</h2><p>电脑执行任务，手机随时查看和控制。</p></div><button type="button" class="device-close" aria-label="关闭手机连接面板">×</button></div>
    <div class="device-service"><div><strong id="device-service-title">正在读取连接状态…</strong><p id="device-service-note">请稍候。</p></div><button type="button" class="device-action device-toggle" disabled>开启手机连接</button></div>
    <div class="device-error" role="alert" hidden></div>
    <section class="device-pair-section" hidden><div class="device-section-heading"><h3>连接新设备</h3><button type="button" class="device-action device-pair">生成二维码</button></div><p class="device-description">手机与电脑连接同一个可信 Wi-Fi，扫码后在这里确认设备。配对链接仅在短时间内有效。</p><div class="device-pair-content" hidden></div></section>
    <section class="device-list-section"><div class="device-section-heading"><h3>已连接设备</h3><button type="button" class="device-refresh" aria-label="刷新设备列表">刷新</button></div><div class="device-list"><p class="device-empty">正在读取设备列表…</p></div></section>
    <p class="device-footnote">电脑及工作台服务需要保持运行。关闭连接会断开手机；手机不接收官方账号的登录凭证。</p><div class="device-live" role="status" aria-live="polite"></div>`;
  target.append(trigger);
  document.body.append(dialog);
  const $ = selector => dialog.querySelector(selector);
  let status = {enabled:false,devices:[]};
  let pairing = null, timer = null, requestInFlight = false, busy = false, destroyed = false;
  const inform = message => { $('.device-live').textContent = message; if (toast) toast(message); };
  const report = error => { $('.device-error').textContent = error?.message || '请求失败，请重试。'; $('.device-error').hidden = false; };
  const clearError = () => { $('.device-error').hidden = true; $('.device-error').textContent = ''; };
  const id = () => globalThis.crypto?.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2,'0')).join('');
  async function request(route = '', body) {
    const response = await fetch('/api/devices' + (route ? '/' + route : ''), {method:body === undefined ? 'GET' : 'POST', headers:{'Content-Type':'application/json','X-Agent-Desk':'1','X-Request-Id':id()}, ...(body === undefined ? {} : {body:JSON.stringify(body)}), cache:'no-store'});
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || '连接操作失败，请重试。');
    return value;
  }
  function remaining() {
    const seconds = Math.max(0, Math.ceil((new Date(pairing?.expiresAt).getTime() - Date.now()) / 1000));
    return Number.isFinite(seconds) ? seconds : 0;
  }
  function renderPairing() {
    const content = $('.device-pair-content');
    if (!pairing) { content.hidden = true; content.replaceChildren(); return; }
    content.hidden = false;
    const seconds = remaining();
    if (!seconds) {
      content.innerHTML = '<p class="device-expired">配对链接已过期。请重新生成二维码。</p>';
      pairing = null;
      return;
    }
    const urls = [...new Set([pairing.url, ...(pairing.urls || [])].filter(Boolean))];
    const url = urls[0];
    content.innerHTML = `<div class="device-pair-grid"><div class="device-qr-wrap">${pairing.qrSvg ? '<img class="device-qr" alt="手机连接配对二维码">' : '<span class="device-qr-placeholder">用手机打开下方链接</span>'}</div><div class="device-pair-guide"><strong>1 扫码或打开链接</strong><span>2 在电脑上核对配对申请</span><span>3 在电脑上点击“允许连接”</span><small class="device-countdown">链接有效期：${Math.floor(seconds / 60)}分${String(seconds % 60).padStart(2,'0')}秒</small></div></div><label class="device-url-label">配对链接<div class="device-copy-row"><input class="device-url" aria-label="手机配对链接" readonly value="${escape(url)}"><button type="button" class="device-action device-copy" data-url="${escape(url)}">复制链接</button></div></label>${urls.length > 1 ? `<details class="device-alternate"><summary>其他网络地址（打不开时尝试）</summary>${urls.slice(1).map((other,index) => `<div class="device-copy-row"><input class="device-url" aria-label="其他配对链接 ${index+1}" readonly value="${escape(other)}"><button type="button" class="device-action device-copy" data-url="${escape(other)}">复制</button></div>`).join('')}</details>` : ''}`;
    if (pairing.qrSvg) $('.device-qr').src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(pairing.qrSvg);
  }
  function render() {
    const enabled = !!status.enabled;
    $('#device-service-title').textContent = enabled ? '手机连接已开启' : '手机连接未开启';
    $('#device-service-note').textContent = enabled ? '只有经过你确认的设备可以查看和控制任务。' : '开启后，已配对的手机可通过同一 Wi-Fi 访问工作台。';
    const toggle = $('.device-toggle');
    toggle.textContent = enabled ? '关闭连接' : '开启手机连接';
    toggle.classList.toggle('device-action-secondary', enabled);
    $('.device-pair-section').hidden = !enabled;
    if (!enabled) {pairing = null; renderPairing();}
    const devices = Array.isArray(status.devices) ? status.devices : [];
    const pending = devices.filter(device => ['pending','waiting'].includes(device.status)).length;
    trigger.textContent = pending ? `手机控制 · ${pending} 待确认` : '手机控制';
    $('.device-list').innerHTML = devices.length ? devices.map(device => {
      const waiting = ['pending','waiting'].includes(device.status);
      const revoked = device.status === 'revoked';
      const expired = device.status === 'expired';
      const label = waiting ? '等待你确认' : revoked ? '已撤销' : expired ? '授权已过期' : '已允许连接';
      const at = device.lastSeenAt || device.approvedAt || device.createdAt;
      const time = at && !Number.isNaN(new Date(at).getTime()) ? new Date(at).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
      return `<div class="device-row${waiting ? ' device-row-pending' : ''}"><div class="device-avatar" aria-hidden="true">▯</div><div class="device-row-info"><strong>${escape(device.name || '未命名手机')}</strong><span class="device-row-status">${label} · 连接码 ${escape(device.id.slice(0,6).toUpperCase())}${time ? ` · ${escape(time)}` : ''}</span></div><div class="device-row-actions">${waiting ? `<button type="button" class="device-action" data-device-action="approve" data-device-id="${escape(device.id)}">允许连接</button>` : ''}${!revoked && !expired ? `<button type="button" class="device-revoke" data-device-action="revoke" data-device-id="${escape(device.id)}">${waiting ? '拒绝' : '撤销'}</button>` : ''}</div></div>`;
    }).join('') : '<p class="device-empty">暂时没有设备。开启连接后，生成二维码配对手机。</p>';
    dialog.querySelectorAll('button:not(.device-close)').forEach(button => {button.disabled = busy;});
  }
  async function refresh() {
    if (destroyed || requestInFlight || busy) return;
    requestInFlight = true;
    try {status = await request(); clearError(); render(); if (pairing && !remaining()) renderPairing(); else if (pairing) {const countdown = $('.device-countdown'); const seconds = remaining(); if (countdown) countdown.textContent = `链接有效期：${Math.floor(seconds / 60)}分${String(seconds % 60).padStart(2,'0')}秒`;}}
    catch (error) {report(error);}
    finally {requestInFlight = false;}
  }
  async function act(callback) {
    if (busy) return;
    busy = true; clearError(); render();
    try {await callback();}
    catch (error) {report(error);}
    finally {busy = false; render(); await refresh();}
  }
  function stopPolling() {clearInterval(timer); timer = null;}
  trigger.addEventListener('click', () => {dialog.showModal(); void refresh(); stopPolling(); timer = setInterval(() => {if (!document.hidden && dialog.open) void refresh();}, 3000);});
  $('.device-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', stopPolling);
  dialog.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.classList.contains('device-toggle')) void act(async () => {
      const wasEnabled = !!status.enabled;
      status = await request(wasEnabled ? 'disable' : 'enable', {});
      if (wasEnabled) {pairing = null; renderPairing();}
      inform(wasEnabled ? '手机连接已关闭。' : '手机连接已开启，可以生成二维码。');
    });
    else if (button.classList.contains('device-pair')) void act(async () => {pairing = await request('pairing', {}); renderPairing();});
    else if (button.classList.contains('device-refresh')) void refresh();
    else if (button.dataset.deviceAction) void act(async () => {
      await request(button.dataset.deviceAction, {deviceId:button.dataset.deviceId});
      inform(button.dataset.deviceAction === 'approve' ? '已允许该设备连接。' : '该设备的访问权限已撤销。');
    });
    else if (button.classList.contains('device-copy')) void (async () => {
      const input = button.parentElement.querySelector('input');
      try {await navigator.clipboard.writeText(button.dataset.url); inform('配对链接已复制。');}
      catch {input.focus(); input.select(); inform('请复制已选中的链接，再用手机打开。');}
    })();
  });
  return {refresh, destroy() {destroyed = true; stopPolling(); dialog.remove(); trigger.remove();}};
}
