import {mountSupportUI} from './support-ui.js';
let provider=null;
const start=document.getElementById('start-connect');
const official=document.getElementById('provider-official');
for(const choice of document.querySelectorAll('[data-provider]'))choice.addEventListener('click',()=>{
  const ready=choice.dataset.ready==='true';
  provider=ready?choice.dataset.provider:null;
  for(const button of document.querySelectorAll('[data-provider]'))button.setAttribute('aria-pressed',String(button===choice));
  start.disabled=!ready;
  start.innerHTML=ready?`连接 ${choice.dataset.name} 账号并进入工作台 <span>↗</span>`:`${choice.dataset.name} 接入能力开发中`;
  document.getElementById('next-title').textContent=ready?'连接账号并查询额度':`${choice.dataset.name} 暂未开放连接`;
  document.getElementById('next-description').textContent=ready?'连接后可查询账号的可用额度；尚未查询或平台未返回时，将明确标注为“未知”。':'该平台的后台连接能力正在开发中。你可以先访问平台官网了解详情，或选择已支持的平台开始使用。';
  official.hidden=ready;
  official.href=choice.dataset.url;
});
start.addEventListener('click',()=>{if(provider)window.location.href='/workspace?agent='+provider+'&setup=1';});

const scan=document.getElementById('detect-agents');
const results=document.getElementById('local-agent-results');
const scanStatus=document.getElementById('detection-status');
let detected=[];
const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function localApi(endpoint,data){
  const response=await fetch('/api/'+endpoint,data?{method:'POST',headers:{'Content-Type':'application/json','X-Agent-Desk':'1'},body:JSON.stringify(data)}:{});
  const value=await response.json();if(!response.ok)throw new Error(value.error||'连接失败');return value;
}
function renderDetected(){
  results.hidden=false;
  results.innerHTML=detected.map(agent=>`<article class="local-agent-row"><div><strong>${safe(agent.name)}</strong><span>${agent.running===true?'正在运行':agent.running===null?'运行状态未知':'已安装 · 未运行'}</span><small>${safe(agent.message||agent.detail)}${!agent.message?' · 登录状态未知':''}</small>${agent.authUrl?`<a target="_blank" rel="noopener noreferrer" href="${safe(agent.authUrl)}">打开官方登录页面 ↗</a>`:''}</div>${agent.connected?`<a class="local-connect" href="/workspace?agent=${agent.id}">进入工作台 ↗</a>`:agent.canConnect?`<button type="button" class="local-connect" data-local-connect="${agent.id}" ${agent.connecting?'disabled':''}>${agent.connecting?'正在验证…':'验证并连接会话'}</button>`:'<span class="local-unavailable">'+(agent.available?'缺少后台连接命令':'接入能力开发中')+'</span>'}${agent.loginRequired&&agent.id==='codex'?'<button class="local-login" data-local-login="codex">前往官方登录</button>':''}</article>`).join('');
}
async function connectLocal(agent){
  agent.connecting=true;agent.message='正在验证本机登录会话…';agent.authUrl=null;renderDetected();
  try{
    const status=await localApi('local-connect',{provider:agent.id});
    agent.connected=status.connected;agent.loginRequired=status.loginRequired;
    agent.message=status.connected?'已成功连接 · '+(status.account?.name||status.account?.email||'已验证本机登录状态'):status.error||'未检测到有效登录，请先通过官方平台登录后再连接';
  }catch(error){agent.connected=false;agent.message=error.message;}
  finally{agent.connecting=false;renderDetected();}
}
scan.addEventListener('click',async()=>{
  scan.disabled=true;scan.textContent='正在扫描…';scanStatus.hidden=false;scanStatus.textContent='正在检测本机已安装的 Agent 与命令行工具…';results.hidden=true;
  try{
    const report=await localApi('local-agents');detected=report.agents.filter(a=>a.installed);
    scanStatus.textContent=report.processError||(detected.length?`已发现 ${detected.length} 个本机 Agent。注意：检测到应用运行不等于已登录，请点击连接进行验证。`:'未检测到本机已安装的 Agent。你可以直接在下方选择支持的平台。');
    renderDetected();
    if(document.getElementById('auto-connect-local').checked){
      for(const agent of detected.filter(a=>a.canConnect))await connectLocal(agent);
      scanStatus.textContent=`扫描完成，已成功连接 ${detected.filter(a=>a.connected).length} 个账号会话。`;
    }
  }catch(error){scanStatus.textContent=error.message;}
  finally{scan.disabled=false;scan.textContent='重新扫描 ↻';}
});
results.addEventListener('click',async event=>{
  const connect=event.target.closest('[data-local-connect]');
  if(connect){const agent=detected.find(a=>a.id===connect.dataset.localConnect);if(agent&&!agent.connecting)await connectLocal(agent);}
  const login=event.target.closest('[data-local-login]');
  if(login){
    const agent=detected.find(a=>a.id==='codex');login.disabled=true;
    try{const status=await localApi('login',{});const url=new URL(status.authUrl);if(url.protocol!=='https:')throw new Error('官方登录地址不可用，请稍后重试');agent.authUrl=url.href;agent.message='请点击下方链接打开官方登录页，完成登录后再点击“验证并连接会话”。';}
    catch(error){agent.message=error.message;}
    renderDetected();
  }
});

const moreProviders=document.getElementById('toggle-providers');
moreProviders.addEventListener('click',()=>{
  const expanded=moreProviders.getAttribute('aria-expanded')!=='true';
  moreProviders.setAttribute('aria-expanded',String(expanded));
  moreProviders.setAttribute('aria-label',expanded?'收起更多 Agent 平台':'展开更多 Agent 平台');
  for(const choice of document.querySelectorAll('.provider-extra'))choice.hidden=!expanded;
});

mountSupportUI();
