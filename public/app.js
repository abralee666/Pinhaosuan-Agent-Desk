import {bindComposerKeys} from './composer-keys.js';
import {mountProjects} from './projects-ui.js';
import {renderDeliveryMessage,previewType,fileIcon,formatFileSize,bindDeliveryMenus,fileUrl as deliveryFileUrl} from './delivery-ui.js';
import {mountLocalSessions} from './local-sessions-ui.js';
import {mountSupportUI} from './support-ui.js';
import {mountDeviceUI} from './device-ui.js';
import {mountMembershipUI} from './membership-ui.js';
import {renderRelayUI,bindRelayUI} from './relay-ui.js';
import {renderAccountUI,bindAccountUI} from './account-ui.js';
import {renderExecutionTimeline,bindExecutionGroups} from './execution-ui.js';
const $ = id => document.getElementById(id);
const expandedExecutions = bindExecutionGroups($('timeline'));
const restoreDeliveryMenus=bindDeliveryMenus($('timeline'));
const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const names = { codex: 'Codex', antigravity: 'Antigravity' };
const launch = new URLSearchParams(location.search);
let state, mode = 'live', provider = launch.get('agent')==='antigravity'?'antigravity':'codex', selectedId, lastEventCount = 0, lastTaskId;
let preferences={};try{preferences=JSON.parse(localStorage.getItem('agent-desk-models')||'{}');}catch{}
const loadingModels=new Set();
let pendingAttachments=[],sendingAttachments=false;
let savedDrafts={};try{savedDrafts=JSON.parse(localStorage.getItem('agent-desk-drafts')||'{}');}catch{}
const drafts=new Map(Object.entries(savedDrafts||{}).slice(-100).filter(([,value])=>typeof value==='string').map(([key,text])=>[key,{text:text.slice(0,6000),attachments:[]}]));
function persistDrafts(){try{localStorage.setItem('agent-desk-drafts',JSON.stringify(Object.fromEntries([...drafts].slice(-100).map(([key,value])=>[key,value.text]))));}catch{}}
function draftKey(){return selectedId?'task:'+selectedId:'new:'+(state?.selectedProjectId||'independent');}
function saveDraft(){if(state)drafts.set(draftKey(),{text:$('prompt').value,attachments:[...pendingAttachments]});persistDrafts();}
function restoreDraft(){const draft=drafts.get(draftKey());$('prompt').value=draft?.text||'';pendingAttachments=[...(draft?.attachments||[])];renderAttachments();}
$('prompt').addEventListener('input',saveDraft);
let fastEnabled=false;
function renderAttachments(){
  $('composer-attachments').hidden=!pendingAttachments.length;
  $('composer-attachments').innerHTML=pendingAttachments.map((a,i)=>`<div class="attachment-chip"><span class="attachment-file-icon" aria-hidden="true">▤</span><div><strong>${escape(a.file.name)}</strong><small>${Math.max(1,Math.round(a.file.size/1024))} KB</small></div><button type="button" data-remove-attachment="${i}" aria-label="移除 ${escape(a.file.name)}">×</button></div>`).join('');
}
async function uploadAttachments(){
  const ids=[];
  for(const item of pendingAttachments){
    if(!item.id){
      const res=await fetch('/api/attachments',{method:'POST',headers:{'X-Agent-Desk':'1','X-File-Name':encodeURIComponent(item.file.name),'Content-Type':item.file.type||'application/octet-stream'},body:item.file});
      const value=await res.json();if(!res.ok)throw Error(value.error||'附件上传失败');item.id=value.id;
    }
    ids.push(item.id);
  }
  return ids;
}
const effortNames={none:'关闭',minimal:'极低',low:'低',medium:'中',high:'高',xhigh:'更高',max:'最高',ultra:'Ultra（自动委派）'};
let fileSearchQuery = '';

function openFilePreview(f, rawTextOnly = false) {
  const t = fileTask();
  const fileName = f?.name || '未知文件';
  $('file-title').textContent = fileName;
  $('file-dialog').querySelector('.file-dialog-meta .file-icon').innerHTML=fileIcon(fileName);
  const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')).toLowerCase() : '';
  const isWeb = previewType(fileName) === 'frame';
  const fileUrl = t ? `/api/task/file?taskId=${encodeURIComponent(t.id)}&path=${encodeURIComponent(fileName)}` : '#';

  const newTab = $('file-open-newtab');
  if (newTab) {
    newTab.href = fileUrl;
    newTab.hidden = !t;
  }

  const openFolderBtn = $('file-open-folder');
  if (openFolderBtn) {
    openFolderBtn.hidden = !t;
    openFolderBtn.onclick = async () => {
      if (!t) return;
      try {
        const res = await fetch(deliveryFileUrl(t.id,fileName,'reveal'),{method:'POST',headers:{'X-Agent-Desk':'1'}});
        const data = await res.json();
        if (data.ok) toast('已在 Windows 资源管理器中定位文件');
        else toast('定位失败: ' + (data.error || '未知错误'));
      } catch (err) {
        toast('定位失败: ' + err.message);
      }
    };
  }

  const toggle = $('file-view-toggle');
  const frame = $('file-frame');
  const code = $('file-content');
  if(['.html','.htm','.svg'].includes(ext))frame?.setAttribute('sandbox','allow-scripts allow-forms');
  else frame?.removeAttribute('sandbox');

  code.textContent = previewType(fileName)==='external' ? '此格式暂不支持应用内预览。请下载原文件，或使用系统默认应用打开。' : f?.content || '';
  $('file-download').href=deliveryFileUrl(t?.id,fileName,'download');
  $('file-system-open').onclick=()=>openDelivery(fileName,'open');
  if(!isWeb && previewType(fileName)==='text' && f?.content===undefined && t)fetch(deliveryFileUrl(t.id,fileName,'text')).then(r=>{if(!r.ok)throw Error('文件读取失败');return r.text();}).then(text=>{if($('file-title').textContent===fileName)code.textContent=text;}).catch(err=>{code.textContent=err.message;});

  if (isWeb && !rawTextOnly && t) {
    if (toggle) toggle.hidden = false;
    $('file-view-preview').classList.add('active');
    $('file-view-code').classList.remove('active');
    if (frame) {
      frame.src = fileUrl;
      frame.hidden = false;
    }
    if (code) code.hidden = true;

    $('file-view-preview').onclick = () => {
      $('file-view-preview').classList.add('active');
      $('file-view-code').classList.remove('active');
      if (frame) frame.hidden = false;
      if (code) code.hidden = true;
    };
    $('file-view-code').onclick = () => {
      $('file-view-code').classList.add('active');
      $('file-view-preview').classList.remove('active');
      if (frame) frame.hidden = true;
      if (code) code.hidden = false;
    };
  } else {
    if (toggle) toggle.hidden = true;
    if (frame) {
      frame.hidden = true;
      frame.removeAttribute('src');
    }
    if (code) code.hidden = false;
  }

  $('file-dialog').showModal();
}


function savePreferences(){localStorage.setItem('agent-desk-models',JSON.stringify(preferences));}
async function loadModels(){
  const agent=provider;
  if(loadingModels.has(agent))return;
  loadingModels.add(agent);renderModels();
  try{const result=await api('accounts/models',{provider:agent}); state.runtime.catalogs[agent]=result;if(result.error)toast(result.error);}catch(e){toast(e.message);}
  finally{loadingModels.delete(agent);renderModels();}
}
function modelSelection(){return {...(preferences[provider] || {model:'',effort:''}),serviceTier:provider==='codex'?(fastEnabled?'fast':'default'):undefined,executionMode:$('execution-select').value,networkAccess:$('execution-select').value==='full-access'||($('execution-select').value==='workspace'&&$('network-select').value==='on')};}
let accountModelFingerprint="";
function renderModels(){
  $('model-controls').hidden=mode!=='live';
  if(!state || mode!=='live')return;
  const group=state.accountManager.providers[provider],profile=group.accounts.find(a=>a.id===group.activeAccountId);
  const fingerprint=JSON.stringify([provider,profile?.id,profile?.modelPreferences]);
  if(fingerprint!==accountModelFingerprint){accountModelFingerprint=fingerprint;preferences[provider]={...(profile?.modelPreferences||{model:'',effort:''})};fastEnabled=profile?.modelPreferences?.serviceTier==='fast';}
  const catalog=state.runtime.catalogs?.[provider], models=catalog?.models||[];
  let settings=modelSelection();
  if(models.length && settings.model && !models.some(m=>m.id===settings.model)){
    const recommended=models.find(m=>m.isDefault)||models[0];
    settings={model:recommended.id,effort:recommended.defaultEffort||''};preferences[provider]=settings;savePreferences();
  }
  const model=models.find(m=>m.id===settings.model);
  const supportsFast=provider==='codex'&&model?.serviceTiers?.some(t=>['fast','priority'].includes(t));
  if(!supportsFast)fastEnabled=false;
  if(model && settings.effort && !model.efforts.includes(settings.effort)){
    settings.effort=model.defaultEffort||'';savePreferences();
  }
  $('model-select').innerHTML='<option value="">沿用账号默认</option>'+models.map(m=>`<option value="${escape(m.id)}">${escape(m.name)}</option>`).join('');
  $('model-select').value=settings.model||'';
  $('effort-select').innerHTML=model?.efforts.length?model.efforts.map(e=>`<option value="${escape(e)}">思考 · ${escape(effortNames[e]||e)}</option>`).join(''):`<option value="">默认强度</option>`;
  $('effort-select').value=settings.effort||'';
  const busy=!!state.runtime.busy||Object.values(state.accountManager.providers).some(p=>p.operation);
  $('fast-toggle').disabled=busy||!supportsFast;
  $('fast-toggle').setAttribute('aria-pressed',String(fastEnabled));
  $('fast-toggle').title=provider!=='codex'?'Antigravity 未提供 Fast 接口':!supportsFast?'该模型未返回 Fast 能力，可在权限设置中刷新模型列表':'Fast 快速模式：使用更多订阅额度，点击'+(fastEnabled?'关闭':'开启')+'；下次发送生效';
  $('execution-select').disabled=busy;
  if($('execution-select').value==='read-only')$('network-select').value='off';
  if($('execution-select').value==='full-access')$('network-select').value='on';
  $('network-select').disabled=busy||$('execution-select').value!=='workspace';
  $('execution-note').textContent=$('execution-select').value==='workspace'?'允许修改本任务文件和执行命令；'+($('network-select').value==='on'?'允许查询资料、安装依赖和调用任务接口，上传与发布仍遵守你的要求。':'要求禁止联网；当前 Windows 后台未通过断网验证，请勿将此选项当作系统级隔离。')+(provider==='antigravity'?'执行还受 Antigravity 官方沙箱设置约束。':'')+'权限变更在下次发送时生效，任务记录保留。':'仅生成回复。执行权限将在发送时应用，并随任务交接保留。';
  if(provider==='codex'&&$('execution-select').value==='workspace'&&state.runtime.codex.executionError)$('execution-note').textContent=state.runtime.codex.executionError;
  if($('execution-select').value==='full-access')$('execution-note').textContent='完全访问：允许访问工作区外的本机文件、执行系统命令并联网，工具调用自动放行。仅在信任当前任务时选择；上传、发布和删除仍遵守你的要求。下次发送时生效。';
  $('permission-label').textContent=({'read-only':'只读',workspace:'默认权限','full-access':'完全访问'})[$('execution-select').value];
  $('permission-label').classList.toggle('full-access',$('execution-select').value==='full-access');
  $('attachment-add').disabled=busy||sendingAttachments;
  $('provider-select').disabled=busy;$('model-select').disabled=busy||!models.length;
  $('effort-select').disabled=busy||!model?.efforts.length;
  $('refresh-models').disabled=busy||loadingModels.has(provider);
  $('model-note').textContent=loadingModels.has(provider)?'正在读取官方模型目录…':catalog?.error || (model ? '可选推理强度因模型而异 · 设置在下次发送时生效，不影响已有上下文' : '连接平台后读取官方模型目录；未选择时沿用后台默认配置');
}
mountLocalSessions({api,action,onAttached:async (id,attachedProvider)=>{state=await(await fetch('/api/state')).json();selectedId=id;provider=attachedProvider||'codex';mode='live';$('execution-select').value=task().executionMode||'read-only';$('network-select').value=task().networkAccess?'on':'off';render();if(launch.get("screenshot")==="1")events.close();toast('已接入原项目与会话历史，发送消息后继续。');}});
const labels = { idle:'准备开始', running:'正在执行', handoff:'任务交接中', completed:'已完成', failed:'执行失败', interrupted:'已停止',waiting_quota:'等待额度恢复',waiting_account:'等待可用账号' };
// null means an unsent new chat; undefined follows the server's initial selection.
const task = () => selectedId===null ? undefined : state?.tasks.find(t => t.id === (selectedId ?? state.selectedTaskId));
const projectsUI=mountProjects({api,action,toast,getState:()=>state,getTask:task,canSwitch:()=>!sendingAttachments,onSelection:next=>{state=next;state.tasks=state.tasks.filter(t=>!t.selfTest);selectedId=state.selectedTaskId||null;mode='live';restoreDraft();fileSearchQuery='';$('file-search-input').value='';if(task()){provider=task().agent;$('execution-select').value=task().executionMode||'read-only';$('network-select').value=task().networkAccess?'on':'off';}else{$('execution-select').value='read-only';$('network-select').value='off';}render();}});
const fileTask=()=>task()||state?.tasks.find(t=>t.projectId&&t.projectId===state.selectedProjectId);
const chatTitle = goal => {const text=String(goal||'新聊天').trim().split(/\r?\n/)[0].replace(/\s+/g,' ');const chars=Array.from(text);return chars.slice(0,36).join('')+(chars.length>36?'…':'');};
function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => $('toast').hidden = true, 4500); }
async function api(route, data = {}) {
  const res = await fetch('/api/' + route, { method:'POST', headers:{ 'Content-Type':'application/json', 'X-Agent-Desk':'1', 'X-Request-Id':crypto.randomUUID() }, body:JSON.stringify(data) });
  const value = await res.json(); if (!res.ok) throw new Error(value.error || '请求失败'); return value;
}
async function action(fn, button) { if (button) button.disabled = true; try { return await fn(); } catch(e) { toast(e.message); } finally { if (button) button.disabled = button.id==='send' ? !!state?.runtime.busy : false; } }
function renderAgents() { renderAccountUI(state,provider,task());renderRelayUI(state,task()); }

function setTargetProvider(target) {
  if (state?.runtime?.busy) return;
  provider = target;
  $('provider-select').value = provider;
  render();
  if (!state.runtime.catalogs?.[provider]?.checkedAt) void loadModels();
}

function renderMode() {
  $('mode-demo').classList.toggle('selected', mode === 'demo');
  $('mode-live').classList.toggle('selected', mode === 'live');
  $('provider-select').hidden = false;
  $('provider-select').value = provider;
  renderModels();

  const t = task();
  const currentAgent = t?.agent || provider;
  const isHandoff = Boolean(t && t.mode === 'live' && t.agent && provider !== t.agent);

  // Update target agent pills in composer
  $('target-pill-codex')?.classList.toggle('active', provider === 'codex');
  $('target-pill-antigravity')?.classList.toggle('active', provider === 'antigravity');

  // Handoff badge
  const badge = $('target-handoff-badge');
  if (badge) {
    badge.hidden = !isHandoff;
    if (isHandoff) {
      badge.textContent = `⇄ 任务将交接至 ${names[provider]}`;
    }
  }

  const connected = !!state?.accountManager?.providers[provider]?.activeAccountId;

  if (mode === 'demo') {
    $('mode-note').textContent = '统一管理账号状态、可用额度与共享任务上下文';
    $('composer-hint').textContent = `↳ 启动两个独立后台进程，接力验证 4 个执行步骤`;
    if (t?.mode === 'account-demo') {
      $('composer-hint').textContent = `↳ 同平台跨账号接力执行，共 ${t.totalSteps} 步；账号管理与额度见上方面板`;
      $('send').textContent = t.status === 'completed' ? '本次验证已全部完成' : t.status === 'waiting_quota' ? '等待额度恢复' : '继续账号验证 ↗';
    } else {
      $('send').innerHTML = `${t?.status === 'interrupted' ? '继续验证' : '开始验证'} <span>↗</span>`;
    }
  } else {
    // Live mode
    $('mode-note').textContent = '切换账号或平台时，自动保留任务进度并传递共享记忆';
    if (!connected) {
      $('send').innerHTML = `请先选择 ${names[provider]} 账号 <span>↗</span>`;
      $('composer-hint').textContent = `↳ 在上方账号列表中选择或添加 ${names[provider]} 账号后即可开始`;
    } else if (isHandoff) {
      $('send').innerHTML = `交接并发送至 ${names[provider]} <span>↗</span>`;
      $('composer-hint').textContent = `↳ 将自动保存 ${names[currentAgent]} 检查点与交接包，由 ${names[provider]} 接手继续执行`;
    } else if (t?.mode === 'account-preview' && ['waiting_account', 'waiting_quota', 'interrupted'].includes(t.status)) {
      $('send').innerHTML = `继续执行任务 <span>↗</span>`;
      $('composer-hint').textContent = `↳ 从最新检查点继续推进任务`;
    } else if (t) {
      $('send').innerHTML = `发送给 ${names[provider]} <span>↗</span>`;
      $('composer-hint').textContent = `↳ 由 ${names[provider]} 保持会话继续推进当前任务`;
    } else {
      $('send').innerHTML = `发送给 ${names[provider]} <span>↗</span>`;
      $('composer-hint').textContent = `↳ 开始与 ${names[provider]} 的新聊天`;
    }
  }
  const sendLabel = $('send').textContent.replace(/↗/g, '').trim();
  $('send').setAttribute('aria-label', sendLabel);
  $('send').title = sendLabel;
  $('send').setAttribute('aria-describedby', 'composer-hint');
  $('send').innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6"/></svg>';
}

function renderPool(){ renderAccountUI(state,provider,task()); }
function render() {
  if (!state) return;
  if(pendingAttachments.length&&pendingAttachments[0].taskId!==task()?.id&&!sendingAttachments){pendingAttachments=[];renderAttachments();}
  const t = task(); renderAgents(); renderMode(); renderPool();
  projectsUI.render();
  const independentTasks=state.tasks.filter(t=>!t.projectId);
  $('tasks').innerHTML = independentTasks.length ? independentTasks.map(t => `<button class="task-link ${t.id === task()?.id ? 'selected' : ''}" data-task="${t.id}"><span>${t.mode === 'live' ? '✳' : '⇄'}</span><span>${escape(chatTitle(t.goal))}</span></button>`).join('') : '<div class="empty-history">暂无聊天，点击上方“＋”开始。</div>';
  $('memory-count').textContent = state.memories.length;
  if ($('dock-badge-memory')) {
    $('dock-badge-memory').textContent = state.memories.length;
    $('dock-badge-memory').dataset.count = String(state.memories.length);
    $('dock-tip-memory').textContent = `全局记忆 · ${state.memories.length} 条`;
  }
  $('memories').innerHTML = state.memories.map(m => `<div class="memory-item"><p>${escape(m.text)}</p><small>USER MEMORY · 本地持久化保存</small><button data-memory-delete="${m.id}" title="删除这条记忆">×</button></div>`).join('') || '<p class="panel-description">暂无全局记忆。这里的偏好适用于所有项目；专属规则请在项目设置中填写。</p>';
  $('task-status').textContent = t?.mode==='live'&&t.status==='completed'?'本轮结束':t ? labels[t.status] : '新聊天'; $('task-status').className = 'status-label ' + (t?.status || '');
  $('active-agent').textContent = t ? `${t.agent === 'codex' ? 'Codex' : 'Antigravity'}${t.accountId?' · '+(t.accountPool?.find(a=>a.id===t.accountId)?.name||state.accountManager.providers[t.agent]?.accounts.find(a=>a.id===t.accountId)?.name||'已连接账号'):''}` : names[provider];
  $('task-summary').innerHTML = t ? `<div class="task-summary"><strong title="${escape(t.goal)}">${escape(chatTitle(t.goal))}</strong><span>${t.mode !== 'live' ? `${t.completed.length} / ${t.totalSteps||4} 步` : `${t.completed.length} 回合`}</span></div>` : '';
  const timeline = $('timeline'), nearBottom = timeline.scrollHeight-timeline.scrollTop-timeline.clientHeight < 90;
  if (!t) {
    const ready=!!state.accountManager.providers[provider].activeAccountId;
    const currentProject=state.projects?.find(p=>p.id===state.selectedProjectId);
    timeline.innerHTML=`<div class="welcome chat-welcome"><h2>${currentProject?escape(currentProject.archived?'此项目已归档':'在「'+currentProject.name+'」中开始新聊天'):'有什么想一起完成？'}</h2><p>${ready?(currentProject?'项目文件和规则已就绪，发送消息开始。':'发条消息，开始新的聊天。'):'连接一个账号后，就可以开始聊天。'}</p>${ready?'':'<button type="button" class="sample-button" id="welcome-connect">连接账号 ↗</button>'}</div>`;
  }
  else {
    const isStreamingDelta = lastTaskId === t.id && t.events.length === lastEventCount && state.runtime.busy;
    const lastEvent = t.events.at(-1);
    let handledStreamUpdate = false;
    if (isStreamingDelta && lastEvent && lastEvent.kind === 'message' && ['codex', 'antigravity'].includes(lastEvent.actor)) {
      const lastNode = timeline.querySelector('.event:last-child .event-body');
      if (lastNode) {
        let textContainer = lastNode.querySelector('.delivery-response, .event-text');
        if (textContainer) {
          textContainer.outerHTML = renderDeliveryMessage(String(lastEvent.text).replaceAll('模拟',''), t);
          handledStreamUpdate = true;
        }
      }
    }
    if (!handledStreamUpdate) {
      timeline.innerHTML = renderExecutionTimeline(t.events, {taskId:t.id, expanded:expandedExecutions, renderEvent:e => {
        if (e.actor === 'system') return `<div class="system-event ${e.kind}">${escape(String(e.text).replace(/thread [^\r\n]*already has an active writer/gi,'原生会话写入权已被其他客户端占用，本次指令未执行。当前接入不提供双端实时消息同步。').replaceAll('模拟',''))}</div>`;
        if (['step','process','context','tool'].includes(e.kind)) return `<div class="step-event"><span>${e.kind === 'step' ? '✓' : '↳'}</span>${escape(String(e.text).replaceAll('模拟',''))}</div>`;
        const name = e.actor === 'user' ? '你' : e.actor === 'codex' ? 'Codex' : 'Antigravity';
        return `<div class="event"><div class="avatar ${e.actor}">${e.actor === 'user' ? '你' : `<img src="/providers/${e.actor==='codex'?'codex':'antigravity'}.png" alt="" width="24" height="24">`}</div><div class="event-body"><div class="event-meta"><strong>${name}</strong>${e.actor !== 'user' && t.mode !== 'live' ? '<span class="sim">后台进程</span>' : ''}<time>${new Date(e.at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</time></div>${e.actor==='user'?`<div class="event-text">${escape(e.text)}</div>`:renderDeliveryMessage(String(e.text).replaceAll('模拟',''),t)}</div></div>`;
      }});
    }
  }
  if (t && (nearBottom || lastTaskId !== t.id)) timeline.scrollTop = timeline.scrollHeight;
  if(lastTaskId===t?.id)restoreDeliveryMenus();
  lastEventCount=t?.events.length || 0; lastTaskId=t?.id;

  // Workspace Files rendering with real-time search filter
  const fileSource=fileTask();
  const files = [...(fileSource?.deliveryFiles||[]),...(fileSource?.fileContents||[]).filter(f=>!(fileSource?.deliveryFiles||[]).some(d=>d.name===f.name))];
  const q = fileSearchQuery.trim().toLowerCase();
  const matchedFiles = q ? files.filter(f => f.name.toLowerCase().includes(q)) : files;
  if (q) {
    $('file-count').textContent = `${matchedFiles.length} / ${files.length} 个`;
  } else {
    $('file-count').textContent = `${files.length} 个`;
    if ($('dock-badge-files')) {
      $('dock-badge-files').textContent = files.length;
      $('dock-badge-files').dataset.count = String(files.length);
      $('dock-tip-files').textContent = `工作区文件 · ${files.length} 个文件`;
    }
  }
  if (!files.length) {
    $('files').innerHTML = '<div class="empty-files">当前任务尚未生成文件。<br>产出文件、检查点与交接包会显示在这里，点击即可预览。</div>';
  } else if (!matchedFiles.length) {
    $('files').innerHTML = `<div class="empty-files">未找到与 “${escape(fileSearchQuery)}” 匹配的文件。<br><button id="file-search-reset" class="outline-button" style="margin-top:8px;padding:3px 8px;font-size:10px;">清空筛选</button></div>`;
    const resetBtn = $('file-search-reset');
    if (resetBtn) resetBtn.onclick = () => { fileSearchQuery = ''; $('file-search-input').value = ''; render(); };
  } else {
    $('files').innerHTML = matchedFiles.map(f => {
      const fileUrl = `/api/task/file?taskId=${encodeURIComponent(fileSource.id)}&path=${encodeURIComponent(f.name)}`;
      return `<div class="file-item-row"><button class="file-row" data-file="${escape(f.name)}" title="点击在工作台内直接预览与交互"><span class="file-icon">${fileIcon(f.name)}</span><span class="file-name">${escape(f.name)}</span><small>${formatFileSize(f.size)}</small></button><a class="file-row-open" href="${fileUrl}" target="_blank" rel="noopener noreferrer" title="在新标签页直接打开 ↗">↗</a></div>`;
    }).join('');
  }

  const lastRun=t?.modelRuns?.findLast(r=>r.agent==='codex'),usage=lastRun?.tokenUsage;
  const num=v=>Number.isFinite(v)?v.toLocaleString('zh-CN'):'未知';
  const inputLine=lastRun?.inputStats?'本次发送 '+num(lastRun.inputStats.chars)+' 字符 · '+({message:'仅新消息',delta:'增量上下文',handoff:'会话交接'}[lastRun.inputStats.mode]||''):'';
  $('usage-note').textContent=(inputLine?inputLine+' ｜ ':'')+(usage?'最近调用：输入 '+num(usage.last.inputTokens)+' / 缓存命中 '+num(usage.last.cachedInputTokens)+' / 输出 '+num(usage.last.outputTokens)+' tokens':lastRun?.inputStats?'Token 用量待官方上报':'后续 Codex 回合将显示发送字符数与官方 Token 用量');
  $('usage-note').hidden=!lastRun||t?.agent!=='codex';
  $('usage-note').title='缓存命中是输入的一部分，推理是输出的一部分；最近调用可能只是本回合的一次调用。Token 数不直接等于订阅额度百分比。';
  $('workspace-path').textContent = t?.workspace || state.projects?.find(p=>p.id===state.selectedProjectId)?.workspace || '新建任务后生成独立工作区目录';
  $('handoff-count').textContent = t?.handoffs.length || 0;
  if ($('dock-badge-context')) {
    const hCount = t?.handoffs.length || 0;
    $('dock-badge-context').textContent = hCount;
    $('dock-badge-context').dataset.count = String(hCount);
    $('dock-tip-context').textContent = `任务交接包 · ${hCount} 个快照`;
  }
  const pack=t?.contexts.at(-1), receipt=t?.events.filter(e=>e.receipt).at(-1)?.receipt;
  $('context-details').innerHTML = pack ? `<div class="context-content"><div class="context-line"><span>接手平台</span><strong>${pack.target === 'codex' ? 'Codex' : 'Antigravity'}${''}</strong></div><div class="context-line"><span>包含共享记忆</span><strong>${pack.memories.length} 条</strong></div><div class="context-line"><span>已继承任务步骤</span><strong>${pack.completed.length} 个</strong></div><div class="context-line"><span>已保存检查点</span><strong>${t.checkpoints.length} 个</strong></div><span class="context-hash">SHA256 ${pack.hash.slice(0,16)}…</span>${receipt ? `<div class="context-receipt">✓ 后台进程 (PID ${receipt.pid}) 已确认接收交接包<br>✓ 已同步 ${receipt.memoryIds.length} 条共享记忆</div>` : '<div class="context-receipt">交接包已生成并发送，正在等待接手进程响应…</div>'}</div>` : '<div class="context-empty">运行任务或发生接力后，这里将显示最新交接包、<br>检查点哈希以及接手进程的接收凭据。</div>';
  $('run-status').textContent = state.runtime.busy ? (t&&state.runtime.activeTaskId===t.id?'● 正在回复，进度持续保存至本地…':'另一聊天正在执行，完成后可发送消息。') : t?.status === 'completed' ? (t.mode==='live'?'✓ 本轮对话已结束，请根据执行记录与产出文件确认结果。':'✓ 任务已完成，可点击右侧预览文件或导出交接包。') : '';
  const connected=!!state.accountManager.providers[provider].activeAccountId;
  $('send').disabled = !connected || state.runtime.busy || (!t&&state.projects?.some(p=>p.id===state.selectedProjectId&&p.archived)) || (mode==='demo'&&t?.mode==='account-demo'&&['completed','waiting_quota'].includes(t.status)); $('stop').hidden = !t||state.runtime.activeTaskId!==t.id;
  $('local-session-open').disabled=state.runtime.busy; $('new-task').disabled = sendingAttachments; $('new-task-top').disabled = sendingAttachments; $('export-context').disabled = !t||state.runtime.busy;
  if (t?.mode === 'live' && t.status === 'completed') {
    const receiptLine = $('context-details').querySelector('.context-receipt');
    if (receiptLine) receiptLine.textContent = `✓ ${t.agent==='codex'?'Codex':'Antigravity'} 会话回合已执行完成，任务记录与检查点已保存。`;
  }
  if(t?.mode==='live' && ['failed','interrupted'].includes(t.status)){
    const receiptLine=$('context-details').querySelector('.context-receipt');
    if(receiptLine)receiptLine.textContent=t.status==='failed'?'本回合执行失败，已有记录与上下文资料已保留至本地。':t.recovery?.reason==='stopped'?'本回合已手动停止，已有记录与上下文资料已保留至本地。':'本回合已中断，已有记录与上下文资料已保留至本地。';
  }
  const paused=t?.mode==='live'&&['failed','interrupted','waiting_account','waiting_agent','waiting_quota'].includes(t.status);
  $('resume-task').hidden=!paused; $('resume-task').disabled=state.runtime.busy||!connected;
  if(paused){const reason=t.recovery?.reason; $('run-status').textContent=reason==='writer_conflict'?'原生会话写入权仍被其他客户端占用，需要释放后才能续接。':reason==='authorization'?'登录已失效。请在管理账号中重新授权，或选择其他账号后继续。':reason==='restart'?'服务已恢复，任务进度已保留。核对已有成果后，可从检查点继续。':'任务已暂停，文件和记录已保留。可从检查点继续。';}
  if(t?.quotaWait&&['scheduled','needs_time','needs_auth'].includes(t.quotaWait.status)&&!state.runtime.busy)$('run-status').textContent=(t.quotaWait.provider==='codex'?'Codex':'Antigravity')+' 原账号'+(t.quotaWait.kind==='credits'?'工作区点数待官方确认。':'额度恢复待核验。')+(t.quotaWait.dueAt?'下次核验：'+new Date(t.quotaWait.dueAt).toLocaleString('zh-CN')+'；官方确认可执行后自动继续。':'请先恢复原账号登录。');
  document.dispatchEvent(new CustomEvent('agent-desk-membership',{detail:state.membership}));
  $('save-status').textContent = t ? '✓ 记录已保存至本机' : 'LOCAL-FIRST';
}
async function create(goal, currentAttachments = []) {
 const sourceDraftKey=draftKey();
 const attachmentIds=await uploadAttachments(currentAttachments);
 const result=await api('accounts/task',{provider,goal,projectId:state.selectedProjectId||null,...modelSelection(),attachmentIds});
 selectedId=result.taskId;
 if(result.state){state=result.state;state.tasks=state.tasks.filter(t=>!t.selfTest);}
 mode='live';
 drafts.delete(sourceDraftKey);
 drafts.delete(draftKey());
 persistDrafts();
 render();
}
$('composer-form').addEventListener('submit', e => {
  e.preventDefault();
  if(sendingAttachments)return;
  const prompt=$('prompt').value.trim()||(pendingAttachments.length?'请查看并分析所附文件。':''), t=task();
  if(!prompt && !(t?.mode==='account-preview'&&['waiting_account','waiting_quota','interrupted'].includes(t?.status))) return;

  const rawPrompt = prompt;
  const currentAttachments = [...pendingAttachments];

  // Immediate 0ms Optimistic UI: clear input and show user message bubble immediately
  $('prompt').value = '';
  $('prompt').style.height = 'auto';
  pendingAttachments = [];
  saveDraft();
  renderAttachments();

  const timeline = $('timeline');
  if (timeline && rawPrompt) {
    const welcome = timeline.querySelector('.welcome');
    if (welcome) welcome.remove();
    const optimisticBubble = document.createElement('div');
    optimisticBubble.className = 'event optimistic-user-event';
    optimisticBubble.innerHTML = `<div class="avatar user">你</div><div class="event-body"><div class="event-meta"><strong>你</strong><time>刚刚</time></div><div class="event-text"><p>${escape(rawPrompt)}</p></div></div>`;
    const pendingNotice = document.createElement('div');
    pendingNotice.className = 'system-event sending-notice';
    pendingNotice.innerHTML = '<span>●</span> 正在发送并启动模型…';
    timeline.append(optimisticBubble, pendingNotice);
    timeline.scrollTop = timeline.scrollHeight;
  }

  action(async()=>{
    sendingAttachments=true;
    $('attachment-add').disabled=true;
    try {
      if(t?.mode==='account-preview'&&['waiting_account','waiting_quota','interrupted'].includes(t.status)&&!rawPrompt){
        await api('run',{taskId:t.id});
      } else if(t?.mode==='live') {
        const attachmentIds=await uploadAttachments(currentAttachments);
        await api('run',{taskId:t.id,agent:provider,prompt:rawPrompt,...modelSelection(),attachmentIds});
      } else {
        await create(rawPrompt, currentAttachments);
      }
    } catch(err) {
      $('prompt').value = rawPrompt;
      pendingAttachments = currentAttachments;
      saveDraft();
      renderAttachments();
      document.querySelectorAll('.optimistic-user-event, .sending-notice').forEach(el => el.remove());
      throw err;
    } finally {
      sendingAttachments=false;
      $('attachment-add').disabled=!!state?.runtime.busy;
      $('new-task').disabled=false;
      $('new-task-top').disabled=false;
    }
  },$('send'));
});
bindComposerKeys($('prompt'),$('composer-form'),$('send'),()=>!!state&&!state.runtime.busy&&!sendingAttachments&&!!($('prompt').value.trim()||pendingAttachments.length));
let attachmentDraftTask;
$('attachment-add').onclick=()=>{attachmentDraftTask=draftKey();$('attachment-input').click();};
$('attachment-input').onchange=()=>{
  const files=[...$('attachment-input').files];$('attachment-input').value='';
  if(draftKey()!==attachmentDraftTask){toast('任务已切换，请重新添加附件');return;}
  if(pendingAttachments.length+files.length>8){toast('每次最多添加 8 个附件');return;}
  if(files.some(f=>!f.size||f.size>10*1024*1024)){toast('单个附件须为 1 字节至 10 MB');return;}
  if([...pendingAttachments.map(a=>a.file),...files].reduce((n,f)=>n+f.size,0)>40*1024*1024){toast('附件总大小不能超过 40 MB');return;}
  pendingAttachments.push(...files.map(file=>({file,taskId:task()?.id})));saveDraft();renderAttachments();
};
$('composer-attachments').onclick=e=>{const button=e.target.closest('[data-remove-attachment]');if(button&&!sendingAttachments){pendingAttachments.splice(Number(button.dataset.removeAttachment),1);saveDraft();renderAttachments();}};
$('memory-form').addEventListener('submit', e=>{ e.preventDefault(); action(async()=>{ await api('memory',{text:$('memory-input').value}); $('memory-input').value=''; toast('共享记忆已保存，后续执行或交接时均会自动注入。'); }); });
$('mode-demo').onclick=()=>{mode='demo';renderMode();}; $('mode-live').onclick=()=>{mode='live';renderMode();if(!state.runtime.catalogs?.[provider]?.checkedAt)void loadModels();};
$('provider-select').onchange=()=>{provider=$('provider-select').value;render();if(!state.runtime.catalogs?.[provider]?.checkedAt)void loadModels();};
$('refresh-models').onclick=()=>void loadModels();
bindRelayUI({api,action,getPreferences:()=>preferences});
bindAccountUI({api,action,toast,getSettings:modelSelection,onProvider:next=>{if(state.runtime.busy||Object.values(state.accountManager.providers).some(p=>p.operation))return;provider=next;render();if(!state.runtime.catalogs?.[provider]?.checkedAt)void loadModels();},onTask:id=>{selectedId=id;mode='live';render();}});
$('model-select').onchange=()=>{const model=state.runtime.catalogs[provider].models.find(m=>m.id===$('model-select').value);preferences[provider]={model:model?.id||'',effort:model?.defaultEffort||''};savePreferences();renderModels();renderAccountUI(state,provider,task());};
$('effort-select').onchange=()=>{preferences[provider]={...modelSelection(),effort:$('effort-select').value};savePreferences();};
$('fast-toggle').onclick=()=>{fastEnabled=!fastEnabled;renderModels();};
$('execution-select').onchange=()=>renderModels();
$('network-select').onchange=()=>renderModels();
$('resume-task').onclick=()=>action(()=>api('task/resume',{taskId:task().id,agent:provider}),$('resume-task'));
$('stop').onclick=()=>action(()=>api('stop',{taskId:state.runtime.activeTaskId}),$('stop'));
$('refresh-agents').onclick=()=>action(async()=>{const id=state.accountManager.providers[provider].activeAccountId;if(!id)throw new Error('请先选择要刷新的账号');await api('accounts/query',{provider,accountId:id});},$('refresh-agents'));
function newChat(projectId=task()?.projectId||state?.selectedProjectId||null){
  if(!state||sendingAttachments)return;
  saveDraft();
  selectedId=null;state.selectedProjectId=projectId;state.selectedTaskId=null;mode='live';
  void action(()=>api('select',{taskId:null,projectId}));
  $('execution-select').value='read-only';$('network-select').value='off';
  restoreDraft();
  fileSearchQuery='';$('file-search-input').value='';
  render();$('prompt').focus();
}
$('new-task').onclick=()=>newChat(null);
$('new-task-top').onclick=()=>newChat();
const closeFileDialog = () => {
  const frame = $('file-frame');
  if (frame) frame.removeAttribute('src');
  $('file-dialog').close();
};
$('close-file').onclick = closeFileDialog;
$('file-dialog').addEventListener('close', () => {
  const frame = $('file-frame');
  if (frame) frame.removeAttribute('src');
});
$('export-context').onclick=()=>action(async()=>{
  const res=await fetch('/api/context?taskId='+task().id), pack=await res.json();
  const blob=new Blob([JSON.stringify(pack,null,2)],{type:'application/json'}), url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='agent-desk-handoff.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  toast('交接包已导出为 JSON 文件，包含共享记忆、历史记录、产出文件与检查点。');
});

// Target Agent selection buttons in composer
$('target-pill-codex').onclick = () => setTargetProvider('codex');
$('target-pill-antigravity').onclick = () => setTargetProvider('antigravity');

// File search bar controls
$('file-search-toggle').onclick = () => {
  const bar = $('file-search-bar');
  const willShow = bar.hidden;
  bar.hidden = !willShow;
  $('file-search-toggle').classList.toggle('active', willShow);
  if (willShow) {
    $('file-search-input').focus();
  } else if (fileSearchQuery) {
    fileSearchQuery = '';
    $('file-search-input').value = '';
    render();
  }
};
$('file-search-input').oninput = e => {
  fileSearchQuery = e.target.value;
  render();
};
$('file-search-clear').onclick = () => {
  fileSearchQuery = '';
  $('file-search-input').value = '';
  $('file-search-input').focus();
  render();
};

// Collapsible Panels management
const collapsePanels = [
  { id: 'pool-panel', toggle: 'pool-collapse', key: 'desk_collapse_pool' },
  { id: 'sentinel-panel', toggle: 'sentinel-collapse', key: 'desk_collapse_sentinel' },
  { id: 'relay-panel', toggle: 'relay-collapse', key: 'desk_collapse_relay' },
  { id: 'memory-panel', toggle: 'memory-collapse', key: 'desk_collapse_memory' },
  { id: 'files-panel', toggle: 'files-collapse', key: 'desk_collapse_files' },
  { id: 'context-panel', toggle: 'context-collapse', key: 'desk_collapse_context' },
];
function initCollapsiblePanels() {
  const syncGroupVisibility = () => {
    const autoPanels = ['pool-panel', 'sentinel-panel', 'relay-panel'];
    const allAutoCollapsed = autoPanels.every(id => {
      const el = $(id);
      return !el || el.classList.contains('is-collapsed');
    });
    $('automation-controls')?.classList.toggle('is-all-collapsed', allAutoCollapsed);

    const contextPanels = ['memory-panel', 'files-panel', 'context-panel'];
    const allContextCollapsed = contextPanels.every(id => {
      const el = $(id);
      return !el || el.classList.contains('is-collapsed');
    });
    document.querySelector('.context-column')?.classList.toggle('is-all-collapsed', allContextCollapsed);
    $('grid-resizer')?.classList.toggle('is-hidden', allContextCollapsed);

    for (const p of collapsePanels) {
      const panelEl = $(p.id);
      const shortName = p.id.replace('-panel', '');
      const dockBtn = $('dock-btn-' + shortName);
      if (dockBtn && panelEl) {
        const isCollapsed = panelEl.classList.contains('is-collapsed');
        dockBtn.classList.toggle('is-active', !isCollapsed);
      }
    }
  };
  for (const p of collapsePanels) {
    const panelEl = $(p.id);
    const toggleBtn = $(p.toggle);
    if (!panelEl || !toggleBtn) continue;
    if (localStorage.getItem(p.key) === '1') {
      panelEl.classList.add('is-collapsed');
    }
    toggleBtn.innerHTML = '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 12 4-4 4 4"/></svg>';
    const title = panelEl.querySelector('strong')?.textContent || '面板';
    const syncToggle = () => {
      const collapsed = panelEl.classList.contains('is-collapsed');
      toggleBtn.setAttribute('aria-expanded', String(!collapsed));
      toggleBtn.setAttribute('aria-label', `${collapsed ? '展开' : '收起'}${title}`);
      toggleBtn.title = toggleBtn.getAttribute('aria-label');
      syncGroupVisibility();
    };
    syncToggle();
    toggleBtn.onclick = e => {
      e.stopPropagation();
      const isCollapsed = panelEl.classList.toggle('is-collapsed');
      localStorage.setItem(p.key, isCollapsed ? '1' : '0');
      syncToggle();
    };
  }

  document.querySelectorAll('.dock-item[data-dock-target]').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      const targetId = btn.dataset.dockTarget;
      const panelEl = $(targetId);
      if (!panelEl) return;
      const isCurrentlyCollapsed = panelEl.classList.contains('is-collapsed');
      panelEl.classList.toggle('is-collapsed', !isCurrentlyCollapsed);
      const item = collapsePanels.find(p => p.id === targetId);
      if (item) {
        localStorage.setItem(item.key, !isCurrentlyCollapsed ? '1' : '0');
        const toggleBtn = $(item.toggle);
        if (toggleBtn) {
          const nowCollapsed = panelEl.classList.contains('is-collapsed');
          toggleBtn.setAttribute('aria-expanded', String(!nowCollapsed));
        }
      }
      syncGroupVisibility();
    };
  });

  syncGroupVisibility();
}

// Workspace Resizers (Horizontal splitter and Vertical timeline)
function initResizers() {
  const resizer = $('grid-resizer');
  const sidebar = document.querySelector('.context-column');
  if (resizer && sidebar) {
    const savedWidth = localStorage.getItem('desk_sidebar_width');
    if (savedWidth && window.innerWidth > 940) {
      const w = Math.min(550, Math.max(240, parseInt(savedWidth, 10)));
      sidebar.style.width = w + 'px';
    }
    let isDragging = false, startX = 0, startWidth = 0;
    resizer.addEventListener('mousedown', e => {
      if (window.innerWidth <= 940) return;
      isDragging = true;
      startX = e.clientX;
      startWidth = sidebar.offsetWidth;
      resizer.classList.add('is-dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (!isDragging) return;
      const delta = e.clientX - startX;
      const newWidth = Math.min(550, Math.max(240, startWidth - delta));
      sidebar.style.width = newWidth + 'px';
    });
    document.addEventListener('mouseup', () => {
      if (!isDragging) return;
      isDragging = false;
      resizer.classList.remove('is-dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem('desk_sidebar_width', sidebar.offsetWidth);
    });
  }

  const timeline = $('timeline');
  if (timeline) {
    const savedHeight = localStorage.getItem('desk_timeline_height');
    if (savedHeight) timeline.style.height = savedHeight + 'px';
    if (window.ResizeObserver) {
      new ResizeObserver(entries => {
        for (const entry of entries) {
          if (entry.target === timeline) {
            const h = Math.round(entry.contentRect.height);
            if (h >= 240) localStorage.setItem('desk_timeline_height', h);
          }
        }
      }).observe(timeline);
    }
  }
}
initResizers();

async function openDelivery(name,action){
  try{const res=await fetch(deliveryFileUrl(fileTask().id,name,action),{method:'POST',headers:{'X-Agent-Desk':'1'}});const data=await res.json();if(!res.ok)throw Error(data.error);toast(action==='open'?'已交给系统默认应用打开':action==='reveal'?'已在资源管理器中选中文件':'已打开所在文件夹');}catch(err){toast(err.message);}
}
document.addEventListener('click', e=>{
  const link=e.target.closest('[data-delivery-preview]');
  if(link){e.preventDefault();const f=[...(fileTask()?.fileContents||[]),...(fileTask()?.deliveryFiles||[])].find(f=>f.name===link.dataset.deliveryPreview);if(f)openFilePreview(f);return;}
  const open=e.target.closest('[data-delivery-open]');if(open){void openDelivery(open.dataset.deliveryOpen,open.dataset.openAction);return;}
  const el=e.target.closest('button'); if(!el)return;
  if(el.id==='welcome-connect')$('account-add').click();
  if(el.dataset.task)action(async()=>{
    if(sendingAttachments)return;
    await api('select',{taskId:el.dataset.task});
    selectedId=el.dataset.task;
    restoreDraft();
    mode=['live','account-preview'].includes(task().mode)?'live':'demo';
    provider=task().agent || provider;
    $('execution-select').value=task().executionMode||'read-only';
    $('network-select').value=task().networkAccess?'on':'off';
    render();
  });
  if(el.dataset.memoryDelete)action(()=>api('memory/delete',{id:el.dataset.memoryDelete}));
  if(el.dataset.file){const f=[...(fileTask()?.fileContents||[]),...(fileTask()?.deliveryFiles||[])].find(f=>f.name===el.dataset.file);if(f)openFilePreview(f);}
  if(el.dataset.action==='connect-codex')action(async()=>{const c=await api('connect');toast(c.error || (c.loggedIn?'已连接 Codex，并获取当前登录身份与额度。':'Codex 后台已连接；未检测到登录，请完成官方登录。'));},el);
  if(el.dataset.action==='connect-antigravity')action(async()=>{const a=await api('connect-antigravity');toast(a.error || '已连接 Antigravity CLI，并获取官方 /usage 额度报告。');},el);
  if(el.dataset.action==='antigravity-report'){ openFilePreview({name:'Antigravity 官方 /usage 额度报告', content:state.runtime.antigravity.report}, true); }
  if(el.dataset.action==='login-codex')action(async()=>{const result=await api('login');if(result.authUrl){const url=new URL(result.authUrl);if(!['https:'].includes(url.protocol)||!['auth.openai.com','chatgpt.com'].includes(url.hostname))throw new Error('登录地址无法验证');window.open(url.href,'_blank','noopener');toast('已在浏览器打开官方登录页。完成登录后请点击“刷新当前账号与额度”。');}},el);
});
mountDeviceUI({toast});
mountMembershipUI({toast});
initCollapsiblePanels();

  const sidebar = document.querySelector('.sidebar');
  const sidebarToggle = $('sidebar-toggle');
  if (sidebar && sidebarToggle) {
    const urlParams = new URLSearchParams(window.location.search);
    const paramSidebar = urlParams.get('sidebar');
    const isSidebarCollapsed = paramSidebar === 'collapsed' ? true : paramSidebar === 'expanded' ? false : localStorage.getItem('desk_sidebar_collapsed') === '1';
    if (isSidebarCollapsed) sidebar.classList.add('is-collapsed');
    else sidebar.classList.remove('is-collapsed');
    sidebarToggle.setAttribute('aria-expanded', String(!isSidebarCollapsed));
    sidebarToggle.onclick = () => {
      const nowCollapsed = sidebar.classList.toggle('is-collapsed');
      localStorage.setItem('desk_sidebar_collapsed', nowCollapsed ? '1' : '0');
      sidebarToggle.setAttribute('aria-expanded', String(!nowCollapsed));
    };
  }

const events=new EventSource('/api/events');
events.addEventListener('state',e=>{const initial=!state,previousDraftKey=draftKey();state=JSON.parse(e.data);state.tasks=state.tasks.filter(t=>!t.selfTest);selectedId=state.selectedTaskId||null;if(initial||previousDraftKey!==draftKey())restoreDraft(); $('connection').textContent='服务已连接';if(initial&&task()){mode=['live','account-preview'].includes(task().mode)?'live':'demo';provider=task().agent;$('execution-select').value=task().executionMode||'read-only';$('network-select').value=task().networkAccess?'on':'off';}if(task()?.mode==='live'&&state.runtime.activeTaskId===task()?.id&&task()?.relayState?.to){provider=task().agent;const settings=task().modelSettings?.[provider];if(settings)preferences[provider]={model:settings.model||settings.resolvedModel||'',effort:settings.effort||''};}render();if(initial&&launch.get('setup')==='1'){$('account-add').click();history.replaceState(null,'','/workspace?agent='+provider);}if(initial&&!state.runtime.catalogs?.[provider]?.checkedAt)void loadModels();});
events.onerror=()=>{$('connection').textContent='服务连接中断';$('send').disabled=true;};

mountSupportUI();
