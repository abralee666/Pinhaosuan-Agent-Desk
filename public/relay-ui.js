const $=id=>document.getElementById(id);
const names={codex:'Codex',antigravity:'Antigravity'};
let view;
export function renderRelayUI(state,task){
  view={state,task};const config=state.platformRelay;const busy=state.runtime.busy;
  $('relay-enabled').checked=config.enabled;$('relay-order').value=config.order.join(',');
  const relayTip=$('dock-tip-relay');
  if(relayTip){const orderText=config.order.map(p=>names[p]||p).join(' → ');relayTip.textContent=`跨平台接力 · ${orderText} (${config.enabled?'自动接力开启':'未开启'})`;}
  const relayIcon = document.getElementById('dock-icon-relay') || document.querySelector('#dock-btn-relay .dock-icon');
  if (relayIcon) {
    relayIcon.classList.toggle('glow-green', Boolean(config.enabled));
    relayIcon.classList.toggle('glow-red', !config.enabled);
  }
  $('relay-disconnect').checked=config.onDisconnect;$('relay-unknown').checked=config.allowUnknownQuota;
  for(const id of ['relay-enabled','relay-order','relay-disconnect','relay-unknown'])$(id).disabled=busy;
  $('relay-resume').disabled=busy||task?.mode!=='live'||!['failed','interrupted','waiting_agent'].includes(task?.status);
  $('relay-availability').textContent=config.order.map(id=>`${names[id]}：${state.runtime.activeTaskId===task?.id&&task?.agent===id?'执行中':state.runtime[id]?.executionError?(/地区|User location is not supported/i.test(state.runtime[id].executionError)?'执行受阻：官方服务不支持当前访问地区':'执行失败：'+state.runtime[id].executionError.slice(0,100)):state.runtime[id]?.connected&&state.runtime[id]?.loggedIn?'已登录（执行待确认）':state.runtime[id]?.connected?'未登录':'未连接'}`).join(' / ');
  $('relay-availability').title=config.order.map(id=>`${names[id]}：${state.runtime[id]?.executionError||'暂无执行错误'}`).join('\n');
  $('relay-models').textContent=config.order.map(id=>{const pref=config.models?.[id];return `${names[id]}：${pref?.model||'官方默认模型'}${pref?.effort?' ('+pref.effort+')':''}`;}).join('；');
  const relay=task?.relayState;
  const phaseNames={checking:'正在检查接手平台可用性',launching:'正在启动接手平台，尚未确认执行',failed:'接手平台执行失败',transferred:'接手平台已开始执行',waiting:'无可接手平台，任务已暂停'};
  $('relay-status').textContent=relay?`${task?.status==='running'&&['waiting','failed'].includes(relay.phase)?'当前已由'+names[task.agent]+'恢复执行；此前接力状态：':''}${phaseNames[relay.phase]||relay.phase}${relay.to?' · '+names[relay.from]+' → '+names[relay.to]:''}${relay.error?'；失败原因：'+relay.error:''}${relay.skipped?.length?'；未采用原因：'+relay.skipped.map(s=>names[s.provider]+'（'+s.reason+'）').join('，'):''}`:config.enabled?'跨平台自动接力已开启：当前平台额度耗尽时，系统将保存检查点并按顺序交由下一平台；无可用平台时保留进度并暂停。':'跨平台自动接力未开启。注：同平台内的换号规则在上方账号面板中单独设置。';
}
export function bindRelayUI({api,action,getPreferences}){
  const save=()=>action(()=>api('relay/settings',{...view.state.platformRelay,enabled:$('relay-enabled').checked,order:$('relay-order').value.split(','),onDisconnect:$('relay-disconnect').checked,allowUnknownQuota:$('relay-unknown').checked,models:getPreferences()}));
  for(const id of ['relay-enabled','relay-order','relay-disconnect','relay-unknown'])$(id).addEventListener('change',save);
  $('relay-resume').onclick=()=>action(()=>api('relay/resume',{taskId:view.task.id}),$('relay-resume'));
}
