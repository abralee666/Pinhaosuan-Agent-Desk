const headset = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 13v-2a8 8 0 0 1 16 0v2M4 12H3v6h4v-6H4Zm16 0h1v6h-4v-6h3Zm0 6v1a2 2 0 0 1-2 2h-4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function mountSupportUI() {
  if (document.getElementById('support-dialog')) return;
  const target = document.querySelector('.topbar-right') || document.querySelector('.start-header');
  if (!target) return;
  const entry = document.createElement('button');
  entry.type = 'button'; entry.className = 'support-entry'; entry.id = 'support-open';
  entry.setAttribute('data-support-intent', 'consult');
  entry.innerHTML = headset + '<span>在线客服</span>';
  if (target.matches('.start-header')) {
    const actions = document.createElement('div'); actions.className = 'support-header-actions';
    actions.append(entry, target.querySelector('.workspace-link')); target.append(actions);
  } else target.prepend(entry);

  const dialog = document.createElement('dialog');
  dialog.id = 'support-dialog'; dialog.className = 'support-dialog';
  dialog.setAttribute('aria-labelledby', 'support-title');
  dialog.innerHTML = `<header class="support-heading"><div class="support-symbol">${headset}</div><div><h2 id="support-title">在线客服</h2><p>使用咨询与一对一技术支持</p></div><button type="button" class="support-close" aria-label="关闭客服面板">×</button></header>
    <p class="support-preview" role="status">界面预览 · 暂未接通人工客服</p>
    <div class="support-tabs" role="tablist" aria-label="客服服务"><button type="button" role="tab" id="support-consult-tab" aria-controls="support-consult-panel" aria-selected="true" data-support-tab="consult">在线咨询</button><button type="button" role="tab" id="support-remote-tab" aria-controls="support-remote-panel" aria-selected="false" tabindex="-1" data-support-tab="remote">一对一服务</button></div>
    <div id="support-consult-panel" role="tabpanel" aria-labelledby="support-consult-tab"><div class="support-intro"><strong>有什么可以帮你？</strong><p>付费用户可咨询日常使用、平台连接与套餐权益。需要协助配置或排障时，可另行预约一对一远程服务。</p></div><div class="support-faq"><details><summary>在线咨询与一对一有什么区别？</summary><p>在线咨询解答日常使用疑问；一对一服务通过预约提供远程配置或排障协助。</p></details><details><summary>Max包含哪些人工服务？</summary><p>Max含Pro全部软件权益及每月2次一对一远程支持，年付同样按月提供，每月限量开放。</p></details></div><label class="support-message-label" for="support-message">问题描述</label><textarea id="support-message" rows="3" maxlength="2000" placeholder="例如：连接平台时遇到问题，想了解如何配置…"></textarea><div class="support-compose"><small>当前不会发送消息或创建工单。</small><button type="button" disabled>发送</button></div></div>
    <div id="support-remote-panel" role="tabpanel" aria-labelledby="support-remote-tab" hidden><div class="support-service-price"><div><span>人工一对一远程支持</span><strong>¥99<small> / 次</small></strong></div><span class="support-duration">预约服务</span></div><p class="support-service-description">协助完成环境安装、平台授权配置与故障排查。需提前预约，具体服务范围以预约确认内容为准。</p><p class="support-max-note">Max每月已含2次；其他套餐或超出当月次数后，可单独加购。</p><button type="button" class="support-book" disabled>预约暂未开放</button><p class="support-footnote">当前仅展示服务方案，尚未接入支付、预约和远程协助。</p></div>`;
  document.body.append(dialog);
  const select = intent => {
    for (const tab of dialog.querySelectorAll('[data-support-tab]')) {
      const active = tab.dataset.supportTab === intent;
      tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
    }
    dialog.querySelector('#support-consult-panel').hidden = intent !== 'consult';
    dialog.querySelector('#support-remote-panel').hidden = intent !== 'remote';
  };
  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-support-intent]');
    if (!trigger) return;
    select(trigger.dataset.supportIntent === 'remote' ? 'remote' : 'consult');
    if (!dialog.open) dialog.showModal();
  });
  dialog.querySelector('.support-close').onclick = () => dialog.close();
  dialog.querySelector('.support-tabs').onclick = event => {
    const tab = event.target.closest('[data-support-tab]'); if (tab) select(tab.dataset.supportTab);
  };
  dialog.querySelector('.support-tabs').onkeydown = event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const intent = event.key === 'Home' ? 'consult' : event.key === 'End' ? 'remote' : dialog.querySelector('#support-consult-tab').getAttribute('aria-selected') === 'true' ? 'remote' : 'consult';
    select(intent); dialog.querySelector(`#support-${intent}-tab`).focus();
  };
}
