const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names={codex:'Codex',antigravity:'Antigravity'};
const dateKey=timestamp=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(timestamp);
const known=a=>Boolean((a?.quota&&a?.checkedAt)||a?.ordinaryUsageAllowed===false);
const percent=(a,key)=>{ const w=a?.quota?.[key]; if(w?.capacity>0&&Number.isFinite(w.remaining))return `${Math.round(w.remaining/w.capacity*100)}%`; if(a?.ordinaryUsageAllowed===false){ if(key==='fiveHour'||w?.remaining===0)return '0%'; if(a?.credits?.hasCredits===false||a?.rateLimitReachedType==='workspace_member_credits_depleted')return '0%'; } return '未知'; };
const mask=s=>s.includes('@')?s.replace(/^(.).*(@.*)$/,'$1***$2'):s.slice(0,2)+'***';
const real=a=>['local-session','isolated-session'].includes(a?.source);
const quotaWindows=a=>{
  if(a?.quota?.monthly)return [{key:'monthly',label:'月额度'}];
  const windows=[];
  if(a?.quota?.fiveHour)windows.push({key:'fiveHour',label:'5 小时'});
  if(a?.quota?.weekly&&(a?.quota?.weekly?.capacity>0||a?.quota?.weekly?.resetsAt||a?.quota?.weekly?.remaining!==undefined))windows.push({key:'weekly',label:'周额'});
  if(!windows.length)windows.push({key:'fiveHour',label:'5 小时'});
  return windows;
};
export function formatQuotaReset(value,key,account){
  if(Number.isFinite(value)&&value>=1e12){
    const date=new Date(value);
    if(Number.isFinite(date.getTime())){
      const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
      const get=type=>parts.find(p=>p.type===type)?.value;
      const day=`${get('year')}-${get('month')}-${get('day')}`;
      return key==='fiveHour'?`${day} ${get('hour')}:${get('minute')}`:day;
    }
  }
  if(account?.credits?.hasCredits===false||account?.executionError?.includes('out of credits')||account?.rateLimitReachedType==='workspace_member_credits_depleted')return '工作区点数已耗尽';
  if(account?.ordinaryUsageAllowed===false||account?.executionError?.includes('quota')||account?.rateLimitReachedType)return '额度已用尽';
  return '重置时间未知';
}
export function renderQuotaSummary(account){
  return (account?.quotaLabel?`<span class="quota-family">${esc(account.quotaLabel)}</span>`:'')+quotaWindows(account).map(w=>{
    const reset=formatQuotaReset(account?.quota?.[w.key]?.resetsAt,w.key,account);
    return `<div class="quota-window"><span class="quota-value"><span>${w.key==='fiveHour'?'5h':w.key==='weekly'?'周额':'月额'}</span><strong>${account?percent(account,w.key):'未知'}</strong></span><time class="quota-reset" title="北京时间 · ${esc(reset)}">${esc(reset)}${reset.includes('未知')||reset.includes('耗尽')||reset.includes('用尽')?'':' 重置'}</time></div>`;
  }).join('');
}
let view;
const refreshing=new Set();
export function quotaForModel(rows,model=''){
  const family=/gemini/i.test(model)?'gemini':/claude|gpt/i.test(model)?'claude':null;
  if(!family)return null;
  const selected=rows.filter(row=>family==='gemini'?/gemini/i.test(row.group):/claude|gpt/i.test(row.group));
  const quota={};for(const row of selected)if(['fiveHour','weekly'].includes(row.window))quota[row.window]={remaining:row.remaining,capacity:100,resetsAt:row.resetsAt*1000};
  return Object.keys(quota).length?{label:family==='gemini'?'Gemini':'Claude / GPT',quota}:null;
}
function displayedQuota(a,state,model){
  if(a?.provider!=='antigravity'||a.source!=='local-session')return a;
  const selected=quotaForModel(state.runtime.antigravity?.quotaRows||[],model);
  return selected?{...a,quota:selected.quota,quotaLabel:selected.label}:a;
}

const accountEmail=a=>real(a)?(a.email||a.desktopEmail||'未完成连接'):mask(a.identifier||'');
const planLabel=a=>a.plan?String(a.plan).toUpperCase():a.session==='signed_in'?'已连接':'待授权';
function accountRow(a,activeId,busy){
 const authorized=a.session==='signed_in';
 const login=a.source==='isolated-session'&&!authorized?`<button class="account-query" data-account-login="${esc(a.id)}" ${busy?'disabled':''}>授权 ↗</button>${a.session==='signing_in'?`<button class="account-query" data-account-cancel="${esc(a.id)}" ${busy?'disabled':''}>取消</button>`:''}`:'';
 return `<div class="pool-account account-compact-row ${a.id===activeId?'current':''}"><div class="profile-identity"><strong title="${esc(accountEmail(a))}">${esc(accountEmail(a))}</strong><span class="account-plan">${esc(planLabel(a))}</span>${a.customName?`<small>${esc(a.name)}</small>`:''}</div><div class="account-mini-quota">${quotaWindows(a).map(w=>`<span>${w.label} <b>${percent(a,w.key)}</b></span>`).join('')}</div><div class="profile-actions"><button class="account-config-btn" data-account-config="${esc(a.id)}" ${busy?'disabled':''}>设置 · ${a.priority?'第 '+a.priority+' 优先':'未设置'}</button>${login}<button class="account-query" data-account-query="${esc(a.id)}" ${busy||(a.source==='isolated-session'&&!authorized)?'disabled':''} aria-label="刷新 ${esc(accountEmail(a))} 额度" title="刷新额度">↻</button><button class="account-remove" data-account-remove="${esc(a.id)}" ${busy?'disabled':''} aria-label="移除 ${esc(accountEmail(a))}" title="移除账号">移除</button></div></div>`;
}
function showAuth(result){for(const id of ['account-identifier','account-password']){$(id).required=false;$(id).closest('label').hidden=true;}const url=new URL(result.authUrl);if(url.protocol!=='https:'||!['auth.openai.com','chatgpt.com'].includes(url.hostname))throw Error('登录地址无法验证');const link=$('account-auth-link');link.href=url.href;link.dataset.accountId=result.accountId;link.hidden=false;$('account-submit').hidden=true;$('account-auth-note').textContent='在官方页面选择要连接的账号。授权完成后独立保存，现有桌面登录会保留。'+(result.expiresAt?'请在 '+new Date(result.expiresAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})+' 前完成；过期后请重新打开授权。':'');$('account-dialog').showModal();}
export function renderAccountUI(state,provider,task){
  view={state,provider,task};const authorized=state.accountManager.providers.codex.accounts.find(a=>a.id===$('account-auth-link').dataset.accountId&&a.session==='signed_in');if(authorized){$('account-auth-link').hidden=true;$('account-auth-note').textContent='授权成功，已读取账号信息。关闭此窗口，在账号列表选择这个连接即可使用。';}else{const pendingProfile=state.accountManager.providers.codex.accounts.find(a=>a.id===$('account-auth-link').dataset.accountId);if(pendingProfile&&pendingProfile.session==='signed_out'&&$('account-dialog').open){$('account-auth-link').hidden=true;$('account-auth-note').textContent=pendingProfile.loginStatus||'授权已结束，请在已有账号卡片重新打开官方授权。';}}const p=state.accountManager.providers[provider],busy=state.runtime.busy||Object.values(state.accountManager.providers).some(p=>p.operation);
  $('pool-title').textContent=names[provider];
  $('account-select').innerHTML='<option value="">请选择账号</option>'+p.accounts.map(a=>`<option value="${a.id}" ${a.source==='isolated-session'&&a.session!=='signed_in'?'disabled':''}>${esc(a.name)} · ${esc(real(a)?(a.email||(a.desktopEmail?a.desktopEmail+'（桌面账号）':'邮箱未知')):mask(a.identifier))}</option>`).join('');
  $('account-select').value=p.activeAccountId||'';$('account-select').disabled=busy;
  $('account-auto').checked=p.autoSwitch;$('account-auto').disabled=busy||(provider!=='codex'&&real(p.accounts.find(a=>a.id===p.activeAccountId)));
  const model=$('model-select')?.value||task?.modelSettings?.antigravity?.resolvedModel||task?.modelSettings?.antigravity?.model||'';
  const current=displayedQuota(p.accounts.find(a=>a.id===p.activeAccountId),state,model);
  $('account-selected').innerHTML=current?`<span class="account-selected-email" title="${esc(accountEmail(current))}">${esc(accountEmail(current))}</span><span class="account-plan">${esc(planLabel(current))}</span><svg class="account-picker-chevron" width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 8 5 5 5-5"/></svg>`:'<span>选择账号</span><svg class="account-picker-chevron" width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 8 5 5 5-5"/></svg>';
  $('account-picker').classList.toggle('is-disabled',!!busy);
  $('account-options').innerHTML=p.accounts.map(a=>`<div class="account-option-row"><button type="button" class="account-option ${a.id===p.activeAccountId?'selected':''}" data-account-activate="${esc(a.id)}" ${busy||(a.source==='isolated-session'&&a.session!=='signed_in')?'disabled':''}><span class="account-option-check" aria-hidden="true">${a.id===p.activeAccountId?'✓':''}</span><span class="account-option-email">${esc(accountEmail(a))}</span><span class="account-plan">${esc(planLabel(a))}</span></button><button type="button" class="account-option-remove" data-account-remove="${esc(a.id)}" ${busy?'disabled':''} aria-label="移除 ${esc(accountEmail(a))}" title="移除账号">×</button></div>`).join('')||'<p class="account-picker-empty">暂无账号，请添加连接。</p>';
  const demo=task?.gameDemo;const labels={building:'第一阶段：制作基础游戏',waiting:'模拟限额中 · 等待约 30 秒后官方核验',continuing:'第二阶段：接手并升级游戏',delivered:'文件已交付 · 请打开游戏试玩',failed:'执行未完成',canceled:'演示已停止'};
  $('game-demo-status').innerHTML=demo?'<strong>'+esc(labels[demo.phase]||'演示处理中')+'</strong>'+(demo.error?'<p>'+esc(demo.error)+'</p>':'')+((task.fileContents||[]).some(f=>f.name==='index.html')?'<button type="button" class="outline-button" data-game-preview="'+esc(task.id)+'">打开游戏 ↗</button>':''):'';
  document.querySelectorAll('[data-game-demo]').forEach(button=>button.disabled=busy||state.tasks.some(t=>t.gameDemo&&['building','waiting','continuing'].includes(t.gameDemo.phase)));
  $('account-manage').setAttribute('aria-expanded',String($('account-directory').open));
  $('account-directory-label').textContent=`管理 · ${p.accounts.length}`;
  if ($('dock-tip-pool')) {
    const pEmail = current ? (real(current) ? (current.email || current.desktopEmail || '已连接') : mask(current.identifier || '')) : '未选择';
    $('dock-tip-pool').textContent = `${names[provider]} (${pEmail}) · 5h: ${current?percent(current,'fiveHour'):'未知'} · 周额: ${current?percent(current,'weekly'):'未知'}`;
    const w = current?.quota?.fiveHour;
    const ratio = (w?.capacity > 0 && Number.isFinite(w.remaining)) ? Math.max(0, Math.min(1, w.remaining / w.capacity)) : (current?.ordinaryUsageAllowed === false ? 0 : 0.96);
    const arc = $('dock-gauge-fill');
    if (arc) {
      arc.style.strokeDashoffset = (53.4 * (1 - ratio)).toFixed(1);
      const isLow = ratio < 0.20 || current?.ordinaryUsageAllowed === false;
      const color = isLow ? '#ef4444' : '#16a34a';
      const glow = isLow ? 'drop-shadow(0 0 3px rgba(239, 68, 68, 0.85))' : 'drop-shadow(0 0 2.5px rgba(34, 197, 94, 0.75))';
      arc.style.stroke = color;
      arc.style.filter = glow;
      const dot = $('dock-gauge-dot');
      if (dot) {
        dot.style.fill = color;
        dot.style.filter = glow;
      }
    }
  }
  $('account-current-quota').innerHTML=renderQuotaSummary(current)+(current?'<button class="quota-refresh '+(refreshing.has(current.id)?'is-refreshing':'')+'" data-account-query="'+current.id+'" aria-label="刷新当前账号额度" title="刷新当前账号额度" '+(busy||refreshing.has(current.id)?'disabled':'')+'>'+(refreshing.has(current.id)?'刷新中…':'↻')+'</button>':'');
  $('pool-accounts').innerHTML=p.accounts.map(a=>accountRow(displayedQuota(a,state,model),p.activeAccountId,busy||refreshing.has(a.id))).join('')||'<p class="account-picker-empty">暂无账号</p>';
  $('pool-status').hidden=!(provider==='antigravity'&&state.runtime.antigravity?.error);
  $('pool-status').textContent=provider==='antigravity'&&state.runtime.antigravity?.error?state.runtime.antigravity.error:p.operation?`${{signing_out:'正在退出当前账号',signing_in:'正在登录所选账号',querying_quota:'正在查询当前额度'}[p.operation.phase]}…`:real(current)?state.runtime.antigravity?.identityError&&provider==='antigravity'?state.runtime.antigravity.identityError:current.desktopEmail&&!current.email?'邮箱来自 Antigravity 桌面最近登录记录；当前 CLI 登录已验证，邮箱与 CLI 会话的对应关系尚未核实。':'已连接本机官方会话，额度以官方接口返回为准。':provider==='codex'?'额度未查询时显示未知；选择已授权的独立连接即可切换，其他账号保持登录。':'今日未查询的额度显示为未知；查询其他账号前会先切换登录会话。';
  for(const id of ['account-add','account-verify','account-exhaust','account-recover'])$(id).disabled=busy;
  $('agents').innerHTML=Object.entries(state.accountManager.providers).map(([id,group])=>{
    const current=displayedQuota(group.accounts.find(a=>a.id===group.activeAccountId),state,provider==='antigravity'?model:(task?.modelSettings?.antigravity?.model||''));
    return `<button class="agent-card agent-provider ${id===provider?'provider-selected':''}" data-provider="${id}"><div class="agent-row"><span class="agent-logo ${id==='antigravity'?'google':''}"><img src="/providers/${id}.png" alt="" width="28" height="28"></span><div><div class="agent-name">${names[id]}</div><div class="agent-caption">${group.accounts.length} 个账号</div></div></div><div class="quota-row"><span>${esc(current?.name||(group.accounts.length?'未选定当前账号':'尚未添加账号'))}</span><strong>${current?percent(current,current.quota?.monthly?'monthly':'fiveHour'):'未知'}</strong></div><div class="agent-detail">${group.autoSwitch?'额度耗尽自动换号':'手动选择账号'}</div></button>`;
  }).join('');
}
export function bindAccountUI({api,action,toast,onProvider,onTask,getSettings}){
  let removal=null,configAccount=null;
  const gamePreview=document.createElement('dialog');gamePreview.className='game-preview-dialog';gamePreview.innerHTML='<header><strong>贪吃蛇 · 游戏试玩</strong><button type="button" class="outline-button" id="game-preview-close">关闭</button></header><iframe title="游戏预览（隔离运行）" sandbox="allow-scripts"></iframe>';document.body.append(gamePreview);
  $('game-preview-close').onclick=()=>{gamePreview.querySelector('iframe').srcdoc='';gamePreview.close();};
  document.addEventListener('click',e=>{const button=e.target.closest('[data-game-demo]');if(button)void action(async()=>{const result=await api('automation/game-demo',{kind:button.dataset.gameDemo});onProvider('codex');onTask(result.taskId);$('account-directory').open=true;toast('已开始贪吃蛇流程演示，真实模型会使用额度。');},button);const preview=e.target.closest('[data-game-preview]');if(preview)void action(async()=>{const response=await fetch('/api/game-demo/preview?taskId='+encodeURIComponent(preview.dataset.gamePreview));const result=await response.json();if(!response.ok)throw Error(result.error);gamePreview.querySelector('iframe').srcdoc='<meta http-equiv="Content-Security-Policy" content="default-src '+"'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'"+'">'+result.html;gamePreview.showModal();},preview);});
  const configDialog=document.createElement('dialog');configDialog.className='account-policy-dialog';configDialog.innerHTML="<form id=\"account-policy-form\"><header class=\"policy-header\"><div><h3>账号设置</h3><p>模型偏好与自动切换顺序</p></div><button type=\"button\" id=\"policy-dismiss\" class=\"policy-dismiss\" aria-label=\"关闭账号设置\">×</button></header><div class=\"policy-fields\"><label>优先顺序<input id=\"policy-priority\" type=\"number\" min=\"1\" max=\"999\" value=\"999\" required><small>第 1 优先级最高，相同顺序保持列表顺序。</small></label><label>默认模型<select id=\"policy-model\"></select></label><div class=\"policy-columns\"><label>思考强度<select id=\"policy-effort\"></select></label><label>速度模式<select id=\"policy-speed\"><option value=\"default\">默认速度</option><option value=\"fast\">Fast</option></select></label></div><p class=\"policy-note\">自动切换使用此账号的配置。模型不再可用时沿用官方默认，任务权限与联网设置保持不变。</p><p id=\"policy-error\" class=\"policy-error\" role=\"alert\" hidden></p></div><footer class=\"policy-footer\"><button type=\"button\" id=\"policy-close\" class=\"policy-cancel\">取消</button><button type=\"submit\" id=\"policy-save\" class=\"policy-save\">保存设置</button></footer></form>";document.body.append(configDialog);
  const fillEfforts=()=>{const model=view.state.runtime.catalogs?.[view.provider]?.models.find(m=>m.id===$('policy-model').value);$('policy-effort').innerHTML='<option value="">官方默认</option>'+(model?.efforts||[]).map(e=>'<option value="'+esc(e)+'">'+esc(e)+'</option>').join('');};
  $('policy-model').onchange=fillEfforts;$('policy-close').onclick=()=>configDialog.close();$('policy-dismiss').onclick=()=>configDialog.close();
  $('account-policy-form').onsubmit=async e=>{e.preventDefault();const save=$('policy-save');if(save.disabled)return;save.disabled=true;save.textContent='保存中…';$('policy-error').hidden=true;try{await api('accounts/preferences',{provider:view.provider,accountId:configAccount,priority:Number($('policy-priority').value),model:$('policy-model').value,effort:$('policy-effort').value,serviceTier:$('policy-speed').value});configDialog.close();toast('账号设置已保存，下一回合生效。');}catch(error){$('policy-error').textContent=error.message.includes('接口不存在')?'后台仍为旧版本，请重启拼好算后重试。':error.message;$('policy-error').hidden=false;}finally{save.disabled=false;save.textContent='保存设置';}};
  document.addEventListener('click',e=>{const button=e.target.closest('[data-account-config]');if(!button)return;const a=view.state.accountManager.providers[view.provider].accounts.find(a=>a.id===button.dataset.accountConfig);if(!a)return;configAccount=a.id;$('policy-error').hidden=true;$('policy-priority').value=a.priority||999;const models=view.state.runtime.catalogs?.[view.provider]?.models||[];const saved=a.modelPreferences||{};const options=[...models];if(saved.model&&!options.some(m=>m.id===saved.model))options.push({id:saved.model,name:saved.model});$('policy-model').innerHTML='<option value="">官方默认模型</option>'+options.map(m=>'<option value="'+esc(m.id)+'">'+esc(m.name||m.id)+'</option>').join('');$('policy-model').value=saved.model||'';fillEfforts();$('policy-effort').value=saved.effort||'';$('policy-speed').value=saved.serviceTier||'default';configDialog.showModal();});
  $('account-remove-confirm').onclick=()=>action(async()=>{
    if(!removal)return;const target={...removal};
    await api('accounts/remove',target);$('account-remove-dialog').close();removal=null;toast('账号已移除，聊天记录已保留。');
  },$('account-remove-confirm'));
  document.addEventListener('click',e=>{
    const button=e.target.closest('button');
    if(button?.dataset.accountActivate){$('account-picker').open=false;action(()=>api('accounts/activate',{provider:view.provider,accountId:button.dataset.accountActivate}));}
    if(button?.dataset.accountRemove){const a=view.state.accountManager.providers[view.provider].accounts.find(a=>a.id===button.dataset.accountRemove);if(!a)return;removal={provider:view.provider,accountId:a.id};$('account-remove-name').textContent=accountEmail(a);$('account-picker').open=false;$('account-remove-dialog').showModal();}
    if(!e.target.closest('#account-picker'))$('account-picker').open=false;
  });
  $('account-picker').addEventListener('keydown',e=>{if(e.key==='Escape'){$('account-picker').open=false;$('account-selected').focus();}});
  const op=()=>({provider:view.provider});
  $('account-manage').onclick=()=>{const directory=$('account-directory');directory.open=!directory.open;$('account-manage').setAttribute('aria-expanded',String(directory.open));};
  $('account-add').onclick=()=>{$('account-dialog-title').textContent=`添加 ${names[view.provider]} 账号`;$('account-form').reset();const native=view.provider==='codex';$('account-name-label').textContent=native?'连接备注（选填）':'账号名称';$('account-name').required=!native;$('account-name').placeholder=native?'选填，例如：工作账号':'例如：工作账号';for(const id of ['account-identifier','account-password']){$(id).required=!native;$(id).closest('label').hidden=native;}$('account-auth-link').hidden=true;$('account-submit').hidden=false;$('account-auth-note').textContent=native?'通过官方页面授权，首次连接需要登录。切换已授权账号无需登出当前账号。':'';$('account-submit').textContent=native?'连接官方账号':'确认添加账号';$('account-dialog').showModal();};
  $('account-close').onclick=()=>{$('account-password').value='';$('account-dialog').close();};
  $('account-dialog').addEventListener('close',()=>{$('account-password').value='';});
  $('account-form').onsubmit=e=>{e.preventDefault();action(async()=>{
    if(view.provider==='codex'){const created=await api('accounts/codex-create',{...op(),name:$('account-name').value});const result=await api('accounts/codex-login',{...op(),accountId:created.accountId});showAuth(result);toast('独立连接已创建，请打开官方页面授权。');return;}
    // Credentials are never sent or persisted by the preview adapter.
    const data={...op(),name:$('account-name').value,identifier:$('account-identifier').value,passwordProvided:!!$('account-password').value};
    $('account-password').value='';await api('accounts/add',data);$('account-dialog').close();toast('账号已添加至本地列表。如需获取额度，请点击“切换并查询额度”。');
  });};
  $('account-select').onchange=()=>{const id=$('account-select').value;if(id)action(()=>api('accounts/activate',{...op(),accountId:id}));};
  $('account-auto').onchange=()=>action(()=>api('accounts/settings',{...op(),autoSwitch:$('account-auto').checked}));
  document.addEventListener('click',e=>{const button=e.target.closest('button');if(button?.dataset.accountQuery){const id=button.dataset.accountQuery;if(!refreshing.has(id))action(async()=>{const target=op();refreshing.add(id);renderAccountUI(view.state,view.provider,view.task);try{await api('accounts/query',{...target,accountId:id});toast('额度已刷新');}finally{refreshing.delete(id);renderAccountUI(view.state,view.provider,view.task);}});} if(button?.dataset.accountLogin)action(async()=>{const result=await api('accounts/codex-login',{...op(),accountId:button.dataset.accountLogin});showAuth(result);});if(button?.dataset.accountCancel)action(()=>api('accounts/codex-cancel',{...op(),accountId:button.dataset.accountCancel}));if(button?.dataset.provider)onProvider(button.dataset.provider);});
  const verify=exhaustAll=>action(async()=>{const result=await api('accounts/task',{...op(),...getSettings(),goal:`${names[view.provider]} 账号接力任务`,exhaustAll});onTask(result.taskId);});
  $('account-verify').onclick=()=>verify(false);$('account-exhaust').onclick=()=>verify(true);
  $('account-recover').onclick=()=>action(()=>api('accounts/recover',{...op(),taskId:view.task?.mode==='account-preview'?view.task.id:null}));
}
