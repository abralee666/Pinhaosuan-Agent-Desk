export function mountLocalSessions({api,action,onAttached}){
  const $=id=>document.getElementById(id);
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let nextCursor=null,loading=false;
  async function load(append=false){
    if(loading)return;loading=true;$('local-session-load').disabled=true;$('local-session-more').disabled=true;$('local-session-provider').disabled=true;
    const provider=$('local-session-provider').value;
    $('local-session-status').textContent=`正在读取本机 ${provider==='codex'?'Codex':'Antigravity CLI'} 会话…`;
    try{
      const result=await api('local-sessions/list',{provider,search:$('local-session-search').value.trim(),cursor:append?nextCursor:null});
      if(provider!==$('local-session-provider').value)return;
      if(!append)$('local-session-list').innerHTML='';
      $('local-session-list').insertAdjacentHTML('beforeend',result.data.map(t=>`<article class="local-session-row"><div><strong>${escape(t.title.slice(0,160))}</strong><p>${escape(t.cwd)}</p><small>${escape(new Date(t.updatedAt*1000).toLocaleString('zh-CN'))}${t.model?' · '+escape(t.model):''}</small></div><button class="outline-button" data-local-session="${escape(t.id)}">接续此会话 ↗</button></article>`).join(''));
      nextCursor=result.nextCursor;$('local-session-more').hidden=!nextCursor;
      $('local-session-status').textContent=$('local-session-list').childElementCount?'接入时读取历史和原项目目录，不提供双端实时消息同步。发送消息前，原客户端需释放该会话的写入权。':'暂无匹配会话，可修改搜索词或继续加载。';
    }catch(error){$('local-session-status').textContent=error.message;}
    finally{loading=false;$('local-session-load').disabled=false;$('local-session-more').disabled=false;$('local-session-provider').disabled=false;}
  }
  $('local-session-open').onclick=()=>{$('local-session-dialog').showModal();void load();};
  $('local-session-provider').onchange=()=>{nextCursor=null;$('local-session-list').innerHTML='';void load();};
  $('local-history-enable').onclick=()=>void action(async()=>{
    await api('local-sessions/history-enable',{});
    $('local-session-status').textContent='已启用 Antigravity 历史查询。请重启官方 CLI；工作台下一次执行会加载工具。原 MCP 配置已保留备份。';
  },$('local-history-enable'));
  $('local-session-close').onclick=()=>$('local-session-dialog').close();
  $('local-session-search-form').onsubmit=e=>{e.preventDefault();void load();};
  $('local-session-more').onclick=()=>void load(true);
  $('local-session-list').onclick=e=>{
    const button=e.target.closest('[data-local-session]');if(!button)return;
    void action(async()=>{
      const result=await api('local-sessions/attach',{provider:$('local-session-provider').value,threadId:button.dataset.localSession,executionMode:'read-only',networkAccess:false});
      await onAttached(result.taskId,result.provider);$('local-session-dialog').close();
    },button);
  };
}
