const planNames = {free:'Free',basic:'Plus',plus:'Ultra',unlimited:'Pro',max:'Max'};
const planName = plan => planNames[plan.id] || plan.name;
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sentinelDescription = '启用后，系统会在任务因额度不足暂停时记录平台返回的刷新时间，并在到期后重新查询额度。确认额度可用后，将基于原任务的检查点和执行权限发送继续指令。';
const sentinelConditions = '电脑与工作台需保持运行。刷新时间未知时会定期重新核验；登录失效时等待重新授权。工作区点数需官方明确确认恢复，额度百分比不能替代。关闭哨兵模式将取消现有的自动续接计划。';
function information(id) {
  return `<span class="sentinel-information"><button type="button" class="sentinel-info" aria-label="哨兵模式说明" aria-describedby="${id}" aria-expanded="false"><svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" stroke-width="1.35"/><path d="M10 5.8v5.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="10" cy="14" r=".85" fill="currentColor"/></svg></button><span class="sentinel-tooltip" id="${id}" role="tooltip"><strong>哨兵模式</strong><span>${sentinelDescription}</span><span>${sentinelConditions}</span></span></span>`;
}
export function mountMembershipUI({toast} = {}) {
  const target = document.querySelector('.heading-actions') || document.querySelector('.topbar-right');
  if (!target || document.getElementById('membership-dialog')) return;
  const button = document.createElement('button');
  button.className = 'outline-button'; button.textContent = '订阅方案'; button.id = 'membership-open'; target.append(button);
  const sentinel = document.createElement('section'); sentinel.className = 'sentinel-block'; sentinel.id = 'sentinel-panel'; sentinel.setAttribute('aria-label','哨兵模式');
  sentinel.innerHTML = `<div class="sentinel-content"><div class="sentinel-title"><label for="sentinel-enabled">哨兵模式</label>${information('sentinel-help')}</div><p>额度恢复后，自动发送继续指令。</p></div><label class="sentinel-checkbox"><input type="checkbox" id="sentinel-enabled" disabled><span>启用</span></label><button type="button" id="sentinel-collapse" class="panel-collapse-btn" aria-label="收起哨兵模式" title="收起哨兵模式">⌄</button>`;
  const automation = document.getElementById('automation-controls');
  if (automation) document.getElementById('pool-panel').after(sentinel);
  else document.querySelector('.mode-bar')?.after(sentinel);
  const dialog = document.createElement('dialog'); dialog.className = 'membership-dialog'; dialog.id = 'membership-dialog'; dialog.setAttribute('aria-labelledby','membership-title');
  dialog.innerHTML = `<button type="button" class="membership-close" aria-label="关闭">×</button>
    <header class="membership-heading"><span class="membership-eyebrow">拼好算</span><h2 id="membership-title">选择适合你的方案</h2><p>从单账号续接到多平台协同，按需选择。</p><div class="membership-current" aria-live="polite"></div></header>
    <div class="membership-tabs" role="tablist" aria-label="订阅与设置"><button type="button" role="tab" id="plans-tab" aria-controls="plans-panel" aria-selected="true" data-tab="plans">订阅方案</button><button type="button" role="tab" id="settings-tab" aria-controls="settings-panel" aria-selected="false" tabindex="-1" data-tab="settings">连接与设置</button></div>
    <div class="membership-error" role="alert" hidden></div>
    <div id="plans-panel" role="tabpanel" aria-labelledby="plans-tab">
      <div class="membership-billing" role="group" aria-label="计费周期"><button type="button" data-billing="monthly" aria-pressed="true">月付</button><button type="button" data-billing="annual" aria-pressed="false">年付 <span>更优惠</span></button></div>
      <div class="membership-plans"></div>
      <div class="membership-service-addon"><div><strong>人工一对一远程支持 <span>¥99 / 次</span></strong><p>环境安装、授权配置与故障排查 · 按需加购</p></div><button type="button" data-support-intent="remote">咨询预约 <span aria-hidden="true">↗</span></button></div>
      <p class="membership-shared">所有方案均包含哨兵模式、本地任务记录、共享记忆、检查点与交接包导出。</p>
      <div class="membership-disclosures"><p>账号上限按每个平台计算。套餐费用不包含上游模型订阅或 API 调用费用。</p><p>目前支持 Codex 与 Antigravity；Antigravity 为本机单会话，其他平台尚未开放。接入数量以适配器的实际能力为准。</p><p>Max 每月限量开放，含每月 2 次人工一对一远程支持，年付同样按月提供。其他套餐或超出当月次数后可按 ¥99 / 次加购。</p><p>所有付费方案含日常在线咨询。客服、预约与支付暂未接通；当前可使用授权码激活付费方案。</p></div>
    </div>
    <div id="settings-panel" role="tabpanel" aria-labelledby="settings-tab" hidden>
      <section class="membership-sentinel-settings"><div class="sentinel-title"><h3>哨兵模式</h3>${information('sentinel-settings-help')}</div><label class="membership-check"><input type="checkbox" id="quota-auto">自动核验恢复后的额度并继续任务</label><div class="membership-waits"></div></section>
      <section><h3>跨网络手机控制 <small>付费方案</small></h3><p class="membership-note">连接公网中继后，手机可在不同网络查看和控制电脑任务。扫码后仍需在电脑确认设备。</p><form id="remote-form"><label>中继地址<input name="url" type="url" placeholder="https://relay.example.com" required></label><button class="membership-action">连接中继</button></form><div class="membership-remote"></div><div class="membership-pair" hidden></div></section>
      <section><h3>接入名额</h3><p class="membership-note">释放名额后保留历史记录；再次使用该账号时需重新占用名额。</p><div class="membership-slots"></div></section>
      <details class="membership-license"><summary>激活授权</summary><p class="membership-note">使用服务端签发的授权码激活方案。安装编号用于绑定本机，不包含官方账户凭证。</p><code class="membership-installation"></code><form id="license-form"><label>授权码<textarea name="license" rows="3" required autocomplete="off"></textarea></label><button class="membership-action">验证并激活</button></form></details>
    </div>`;
  document.body.append(dialog);
  const $ = selector => dialog.querySelector(selector);
  let data, busy = false, timer, billing = 'monthly';
  function syncSentinel(value) {
    if (typeof value === 'boolean') {
      document.getElementById('sentinel-enabled').checked = value;
      $('#quota-auto').checked = value;
      const shield = document.querySelector('#dock-btn-sentinel .dock-sentinel-icon');
      const beacon = document.getElementById('dock-sentinel-beacon');
      if (shield) {
        shield.classList.toggle('glow-green', value);
        shield.classList.toggle('glow-red', !value);
      }
      if (beacon) {
        beacon.classList.toggle('glow-green', value);
        beacon.classList.toggle('glow-red', !value);
        beacon.classList.toggle('is-active', value);
      }
      const tip = document.getElementById('dock-tip-sentinel');
      if (tip) tip.textContent = `哨兵模式 · ${value ? '已启用（额度恢复自动继续）' : '未启用'}`;
    }
  }
  async function request(route, body) {
    const response = await fetch('/api/' + route, {method:body ? 'POST' : 'GET',headers:{'Content-Type':'application/json','X-Agent-Desk':'1','X-Request-Id':crypto.randomUUID()},...(body ? {body:JSON.stringify(body)} : {}),cache:'no-store'});
    const value = await response.json(); if (!response.ok) throw Error(value.error || '请求失败'); return value;
  }
  function showTab(name) {
    for (const tab of dialog.querySelectorAll('[data-tab]')) { const active = tab.dataset.tab === name; tab.setAttribute('aria-selected',String(active)); tab.tabIndex = active ? 0 : -1; }
    $('#plans-panel').hidden = name !== 'plans'; $('#settings-panel').hidden = name !== 'settings';
  }
  function renderPlans() {
    if (!data) return;
    if(data.edition==='opensource'){
      $('.membership-plans').innerHTML='<article class="membership-plan selected"><h3>Max · 开源版</h3><p>全部软件功能默认开放，无需付费授权码。</p><ul><li>多账号与跨平台任务接力</li><li>哨兵自动恢复、共享记忆与检查点</li><li>局域网手机控制与自建公网中继</li></ul><p>使用你本机安装的 Agent 和你自己的模型账号。人工支持服务单独提供。</p></article>';
      return;
    }
    const descriptions = {free:'单平台的日常任务',basic:'双平台交替使用',plus:'多个账号持续接力',unlimited:'更灵活的多平台工作流',max:'Pro 全部权益与人工辅助'};
    $('.membership-plans').innerHTML = data.plans.map(p => {
      const current = p.id === data.plan.id, annual = billing === 'annual' && p.monthly > 0;
      const features = [p.platforms === null ? '不限平台接入数量' : `最多接入 ${p.platforms} 个平台`,p.accounts === null ? '每个平台不限账号数量' : `每个平台最多 ${p.accounts} 个账号`,'哨兵模式：额度恢复后继续','局域网手机控制',...(p.remote ? ['跨网络手机控制','多账号与跨平台接力','日常在线客服咨询'] : []),...(p.humanSupportMonthly ? [`每月 ${p.humanSupportMonthly} 次人工一对一远程支持`] : []),...(p.limitedAvailability ? ['每月限量开放'] : [])];
      const savings = Math.round((1 - p.annual / (p.monthly * 12)) * 100);
      return `<article class="membership-plan ${current ? 'selected' : ''}" data-plan="${p.id}"><div class="membership-plan-heading"><h3>${escape(planName(p))}</h3>${current ? '<span class="membership-badge">当前方案</span>' : ''}</div><p class="membership-plan-description">${descriptions[p.id]}</p><div class="membership-price"><span>¥</span><strong>${annual ? p.annual : p.monthly}</strong><small>/ ${annual ? '年' : '月'}</small></div><p class="membership-price-note">${p.monthly ? annual ? `折合 ¥${(p.annual / 12).toFixed(2)} / 月，按年计费` : `年付 ¥${p.annual}，省约 ${savings}%` : '免费使用，无需订阅'}</p><button type="button" class="membership-plan-cta" ${current || !p.remote ? 'disabled' : ''} ${!current && p.remote ? `data-activate="${p.id}"` : ''}>${current ? '当前方案' : !p.remote ? '基础方案' : '激活 ' + planName(p)}</button><ul class="membership-features">${features.map(f => `<li><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${f}</span></li>`).join('')}</ul></article>`;
    }).join('');
    for (const b of dialog.querySelectorAll('[data-billing]')) b.setAttribute('aria-pressed',String(b.dataset.billing === billing));
  }
  function render() {
    if (!data) return;
    const open=data.edition==='opensource';
    button.textContent=open?'Max · 开源版':'订阅方案';
    $('#membership-title').textContent=open?'开源版功能与连接':'选择适合你的方案';
    for(const selector of ['.membership-billing','.membership-service-addon','.membership-disclosures','.membership-license'])$(selector).hidden=open;
    $('.membership-shared').textContent=open?'开源版本默认开放 Max 软件功能；模型额度由你自己的上游账号提供。':'所有方案均包含哨兵模式、本地任务记录、共享记忆、检查点与交接包导出。';
    $('.membership-current').textContent = `当前：${planName(data.plan)}${data.expiresAt ? ' · 有效至 ' + new Date(data.expiresAt).toLocaleDateString('zh-CN') : ''}`;
    renderPlans(); syncSentinel(data.quotaResume);
    document.getElementById('sentinel-enabled').disabled = busy; $('#quota-auto').disabled = busy;
    $('.membership-installation').textContent = data.installationId;
    $('.membership-slots').innerHTML = data.slots.length ? data.slots.map(s => `<div class="membership-row"><span>${escape(s.provider)} · ${escape(s.accountId.slice(0,8))}</span><button type="button" data-release="${escape(s.accountId)}" data-provider="${escape(s.provider)}">释放名额</button></div>`).join('') : '<p class="membership-note">尚未占用接入名额。</p>';
    $('.membership-waits').innerHTML = data.waiting.length ? data.waiting.map(t => `<div class="membership-row"><span>${escape(t.goal.slice(0,60))}<small>${t.quotaWait.provider==='codex'?'Codex':'Antigravity'} · ${t.quotaWait.kind==='credits'?'工作区点数 · ':''}${t.quotaWait.dueAt ? '预计 ' + new Date(t.quotaWait.dueAt).toLocaleString('zh-CN') + ' 核验额度' : t.quotaWait.status === 'needs_auth' ? '原账号需要重新登录' : t.quotaWait.kind === 'credits' ? '工作区点数待官方确认；定期核验，不按额度百分比推断' : t.quotaWait.status === 'needs_time' ? '刷新时间未知，正在定期重新核验' : '多次核验未恢复，请检查账户'}</small></span><button type="button" data-check="${escape(t.id)}">立即核验</button><button type="button" data-cancel="${escape(t.id)}">取消续接</button></div>`).join('') : '<p class="membership-note">暂无等待续接的任务。</p>';
    $('.membership-remote').innerHTML = `<div class="membership-row"><span>${data.remote.online ? '中继已连接' : data.remote.enabled ? '正在重连' : '尚未连接中继'}${data.remote.error ? '<small>' + escape(data.remote.error) + '</small>' : ''}</span>${data.remote.enabled ? '<button type="button" data-disconnect>断开</button>' : ''}${data.remote.online ? '<button type="button" data-pair>生成跨网络二维码</button>' : ''}</div>`;
    $('#remote-form button').disabled = !data.plan.remote || busy;
  }
  async function refresh() {
    try { data = await request('membership'); render(); }
    catch (error) { $('.membership-error').hidden = false; $('.membership-error').textContent = error.message; }
  }
  async function act(work) {
    if (busy) return; busy = true; $('.membership-error').hidden = true;
    document.getElementById('sentinel-enabled').disabled = true; $('#quota-auto').disabled = true;
    dialog.querySelectorAll('button:not(.membership-close):not(.sentinel-info)').forEach(b => b.disabled = true);
    try { await work(); toast?.('设置已更新'); }
    catch (error) { $('.membership-error').hidden = false; $('.membership-error').textContent = error.message; if (!dialog.open) toast?.(error.message); }
    finally { busy = false; dialog.querySelectorAll('button:not(.membership-close):not(.sentinel-info)').forEach(b => b.disabled = false); render(); await refresh(); }
  }
  const setSentinel = enabled => act(async () => { const result = await request('quota-resume/settings',{enabled}); if (data) data.quotaResume = result.enabled; syncSentinel(result.enabled); });
  button.onclick = () => { showTab('plans'); dialog.showModal(); void refresh(); clearInterval(timer); timer = setInterval(() => {if (!busy && !document.hidden) void refresh();},5000); };
  $('.membership-close').onclick = () => dialog.close(); dialog.onclose = () => clearInterval(timer);
  document.getElementById('sentinel-enabled').onchange = e => void setSentinel(e.target.checked);
  $('#quota-auto').onchange = e => void setSentinel(e.target.checked);
  document.addEventListener('agent-desk-membership', e => {if (!busy && typeof e.detail?.quotaResume === 'boolean') {syncSentinel(e.detail.quotaResume); document.getElementById('sentinel-enabled').disabled = false;}});
  for (const info of document.querySelectorAll('.sentinel-info')) {
    info.onclick = () => info.setAttribute('aria-expanded',String(info.getAttribute('aria-expanded') !== 'true'));
    info.onkeydown = e => {if (e.key === 'Escape') {info.setAttribute('aria-expanded','false'); info.blur(); e.stopPropagation();}};
  }
  document.addEventListener('click', e => {for (const info of document.querySelectorAll('.sentinel-info')) if (!info.closest('.sentinel-information').contains(e.target)) {info.setAttribute('aria-expanded','false'); if (document.activeElement === info) info.blur();}});
  $('.membership-tabs').onkeydown = e => { if (!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return; e.preventDefault(); const name = e.key === 'Home' ? 'plans' : e.key === 'End' ? 'settings' : $('#plans-tab').getAttribute('aria-selected') === 'true' ? 'settings' : 'plans'; showTab(name); $('#' + name + '-tab').focus(); };
  $('#remote-form').onsubmit = e => {e.preventDefault(); void act(() => request('remote/connect',{url:new FormData(e.target).get('url')}));};
  $('#license-form').onsubmit = e => {e.preventDefault(); void act(async () => {await request('membership/activate',{license:new FormData(e.target).get('license').trim()}); e.target.reset();});};
  dialog.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.tab) showTab(b.dataset.tab);
    if (b.dataset.billing) {billing = b.dataset.billing; renderPlans();}
    if (b.dataset.activate) {showTab('settings'); $('.membership-license').open = true; $('#license-form textarea').focus();}
    if (b.dataset.release) void act(() => request('membership/release',{provider:b.dataset.provider,accountId:b.dataset.release}));
    if (b.dataset.check) void act(() => request('quota-resume/check',{taskId:b.dataset.check}));
    if (b.dataset.cancel) void act(() => request('stop',{taskId:b.dataset.cancel}));
    if (b.hasAttribute('data-disconnect')) void act(() => request('remote/disconnect',{}));
    if (b.hasAttribute('data-pair')) void act(async () => {const result = await request('remote/pairing',{}); const holder = $('.membership-pair'); holder.hidden = false; holder.innerHTML = '<img alt="跨网络手机配对二维码"><p>扫码后在“手机控制”中确认设备。链接两分钟内有效。</p><input readonly aria-label="跨网络配对链接">'; holder.querySelector('img').src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(result.qrSvg); holder.querySelector('input').value = result.url;});
  };
  void refresh();
}
