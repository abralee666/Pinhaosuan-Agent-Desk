const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const folder='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h4l3 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7h18"/></svg>';
export function mountProjects({api,action,toast,getState,getTask,onSelection,canSwitch=()=>true}){
 const $=id=>document.getElementById(id);let showArchived=false,editing=null,sourceTask=null;
 let expanded={};try{const saved=JSON.parse(localStorage.getItem('agent-desk-project-folders')||'{}');if(saved&&typeof saved==='object'&&!Array.isArray(saved))expanded=saved;}catch{}
 const rememberExpansion=()=>{try{localStorage.setItem('agent-desk-project-folders',JSON.stringify(expanded));}catch{}};

 function apply(result){onSelection(result.state);}
 function openEditor(project=null,fromTask=null){
  editing=project?.id||null;sourceTask=fromTask?.id||null;
  $('project-dialog-title').textContent=project?'项目设置':fromTask?'将此聊天设为项目':'新建项目';
  $('project-name').value=project?.name||'';$('project-rules').value=project?.instructions||'';
  $('project-location-mode').value=fromTask?'existing':'managed';
  $('project-location-mode').disabled=!!project||!!fromTask;
  $('project-directory').value=project?.workspace||fromTask?.workspace||'';
  $('project-directory').readOnly=!!project||!!fromTask;
  $('project-pick-folder').hidden=!!project||!!fromTask;
  $('project-location-options').hidden=!!project||!!fromTask;
  $('project-directory-row').hidden=!project&&!fromTask;
  $('project-archive').hidden=!project;$('project-archive').textContent=project?.archived?'恢复项目':'归档项目';
  $('project-save').textContent=project?'保存修改':'创建项目';
  $('project-form-error').textContent='';$('project-dialog').showModal();$('project-name').focus();
 }
 $('project-add').onclick=()=>openEditor();$('project-workspace-create').onclick=()=>openEditor(null,getTask());
 $('project-dialog-close').onclick=()=>$('project-dialog').close();$('project-cancel').onclick=()=>$('project-dialog').close();
 $('project-location-mode').onchange=()=>{$('project-directory-row').hidden=$('project-location-mode').value==='managed';};
 $('project-pick-folder').onclick=()=>void action(async()=>{const value=await api('projects/pick-folder');if(value.workspace)$('project-directory').value=value.workspace;},$('project-pick-folder'));
 $('project-form').onsubmit=async event=>{
  event.preventDefault();if(!canSwitch()){$('project-form-error').textContent='附件正在发送，请稍后切换项目。';return;}$('project-save').disabled=true;$('project-form-error').textContent='';
  try{
   const payload={name:$('project-name').value.trim(),instructions:$('project-rules').value};
   if(editing)payload.projectId=editing;
   else if(sourceTask)payload.fromTaskId=sourceTask;
   else if($('project-location-mode').value==='existing'){payload.workspace=$('project-directory').value.trim();if(!payload.workspace)throw Error('请选择或输入项目文件夹');}
   const result=await api(editing?'projects/update':'projects/create',payload);
   apply(result);$('project-dialog').close();toast(editing?'项目设置已保存，后续消息将使用最新规则。':'项目已创建，可以在项目中开始新聊天。');
  }catch(error){$('project-form-error').textContent=error.message;}finally{$('project-save').disabled=false;}
 };
 $('project-archive').onclick=()=>void action(async()=>{
  const project=getState().projects.find(p=>p.id===editing);
  const result=await api('projects/update',{projectId:editing,archived:!project.archived});apply(result);$('project-dialog').close();toast(project.archived?'项目已恢复':'项目已归档，目录和聊天均已保留');
 },$('project-archive'));
 $('project-show-archived').onclick=()=>{showArchived=!showArchived;render();};
 $('project-workspace-settings').onclick=()=>{const s=getState();openEditor(s.projects.find(p=>p.id===(getTask()?.projectId||s.selectedProjectId)));};
 $('projects').onclick=event=>{
  const toggle=event.target.closest('[data-project-toggle]');
  if(toggle){const id=toggle.dataset.projectToggle;expanded[id]=toggle.getAttribute('aria-expanded')!=='true';rememberExpansion();render();$(toggle.id)?.focus({preventScroll:true});return;}

  const edit=event.target.closest('[data-project-edit]');if(edit){openEditor(getState().projects.find(p=>p.id===edit.dataset.projectEdit));return;}
  const button=event.target.closest('[data-project-select]');if(!button)return;if(!canSwitch()){toast('附件正在发送，请稍后切换项目。');return;}
  expanded[button.dataset.projectSelect]=true;rememberExpansion();
  void action(async()=>apply(await api('projects/select',{projectId:button.dataset.projectSelect,newChat:button.dataset.projectNew==='true'})),button);
 };
 function render(){
  const state=getState();if(!state)return;
  const active=getTask()?.projectId||state.selectedProjectId,projects=state.projects||[];
  if(active&&typeof expanded[active]!=='boolean'){expanded[active]=true;rememberExpansion();}
  const visible=projects.filter(p=>showArchived?p.archived:!p.archived||p.id===active);
  const focusedId=$('projects').contains(document.activeElement)?document.activeElement.id:null;
  const scrollTop=$('projects').scrollTop;
  $('projects').innerHTML=visible.map(project=>{
   const selected=project.id===active;
   const isExpanded=typeof expanded[project.id]==='boolean'?expanded[project.id]:selected;
   const tasks=state.tasks.filter(t=>t.projectId===project.id).sort((a,b)=>(b.events.at(-1)?.at||b.createdAt).localeCompare(a.events.at(-1)?.at||a.createdAt));
   return `<section class="project-node${selected?' is-current':''}"><div class="project-row"><button type="button" id="project-toggle-${project.id}" class="project-select" data-project-toggle="${project.id}" title="${escape(project.workspace)}" aria-expanded="${isExpanded}" aria-controls="project-chats-${project.id}"><svg class="project-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m6 4 4 4-4 4"/></svg>${folder}<span>${escape(project.name)}</span>${project.archived?'<small>已归档</small>':''}</button><button type="button" id="project-edit-${project.id}" class="project-mini" data-project-edit="${project.id}" aria-label="${escape(project.name)} 项目设置" title="项目设置">···</button>${project.archived?'':`<button type="button" id="project-new-${project.id}" class="project-mini" data-project-select="${project.id}" data-project-new="true" aria-label="在 ${escape(project.name)} 中新建聊天" title="新建项目聊天">＋</button>`}</div><div id="project-chats-${project.id}" class="project-chats"${isExpanded?'':' hidden'}>${tasks.length?tasks.map(t=>`<button type="button" id="project-chat-${t.id}" class="project-chat${t.id===getTask()?.id?' selected':''}" data-task="${t.id}" aria-current="${t.id===getTask()?.id?'page':'false'}" title="${escape(t.goal)}"><span class="project-chat-dot${state.runtime.activeTaskId===t.id?' running':''}"></span><span>${escape(t.goal.split('\n')[0])}</span></button>`).join(''):'<p class="project-empty">项目已就绪，点击 ＋ 开始聊天</p>'}</div></section>`;
  }).join('')||`<button class="project-empty-action" id="project-empty-create">${folder}<span>添加项目<small>固定目录，持续协作</small></span><span>＋</span></button>`;
  $('projects').scrollTop=scrollTop;
  if(focusedId)$(focusedId)?.focus({preventScroll:true});
  if($('project-empty-create'))$('project-empty-create').onclick=()=>openEditor();
  $('project-show-archived').textContent=showArchived?'返回项目':'已归档项目';$('project-show-archived').hidden=!showArchived&&!projects.some(p=>p.archived);
  const project=projects.find(p=>p.id===active);
  $('workspace-breadcrumb').textContent=project?.name||'独立聊天';
  $('workspace-heading').textContent=getTask()?.goal.split('\n')[0].slice(0,42)||'新聊天';
  $('workspace-description').textContent=project?'在「'+project.name+'」中工作，共用目录和项目规则。':'独立聊天使用单独目录，也可以随时设为项目。';
  $('project-workspace-name').textContent=project?.name||'独立聊天';
  $('project-workspace-path').textContent=project?.workspace||'选择项目，让多个聊天共用同一个工作目录';
  $('project-workspace-path').title=project?.workspace||'';
  $('project-workspace-kind').textContent=project?(project.archived?'已归档':'本地项目'):'未关联项目';
  $('project-workspace-settings').hidden=!project;
  $('project-workspace-create').hidden=!!project;$('project-workspace-create').textContent=getTask()?'设为项目':'添加项目';
  $('project-chat-context').textContent=getTask()?.nativeSession?.source==='local'?'本机会话接续：接入时读取历史，未启用双端实时消息同步。':project?`新聊天共享「${project.name}」的文件和项目规则，消息记录独立保存。`:'独立聊天使用单独的工作目录。';
 }
 return {render};
}
