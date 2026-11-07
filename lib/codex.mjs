import { spawn, spawnSync, execFile } from 'node:child_process';
import readline from 'node:readline';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {antigravityEnvironment as localAgentEnvironment} from './agent-env.mjs';
import {agentExecutableOverride} from './local-agents.mjs';
const backgroundConfig = () => ['-c', `mcp_servers.node_repl.command=${JSON.stringify(process.execPath)}`, '-c', 'mcp_servers.node_repl.enabled=false', '-c', `mcp_servers.cua_repl.command=${JSON.stringify(process.execPath)}`, '-c', 'mcp_servers.cua_repl.enabled=false', '-c', 'notify=[]', '-c', 'shell_environment_policy.exclude=["HTTP_PROXY","HTTPS_PROXY","ALL_PROXY","http_proxy","https_proxy","all_proxy"]'];
const backgroundEnvironment = () => ({...localAgentEnvironment(),CODEX_MCP_NODE_PATH:process.execPath});

export function findExecutable(name) {
  const result = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [name], { encoding: 'utf8', windowsHide: true });
  return result.status === 0 ? result.stdout.trim().split(/\r?\n/).find(x => !x.endsWith('.ps1')) || null : null;
}
export function detectAntigravity() {
  const command = agentExecutableOverride('antigravity') || findExecutable('agy') || [path.join(process.env.LOCALAPPDATA || '', 'agy', 'bin', 'agy.exe')].find(p => fs.existsSync(p)) || null;
  const desktop = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'antigravity', 'Antigravity.exe');
  return { command, desktopInstalled: fs.existsSync(desktop), ready: !!command, connected: false, loggedIn: false, report: null, error: null,
    detail: command ? '已检测到官方 agy CLI；点击连接，检查桌面登录是否可复用。' : '已检测到桌面应用，未检测到 agy 后台命令。真实额度暂不可读取。' };
}
export function findCodexExecutable(){
  const override=agentExecutableOverride('codex');if(override)return override;
  if(process.platform==='win32'){
    const arch=process.arch==='arm64'?'arm64':'x64',triple=arch==='arm64'?'aarch64-pc-windows-msvc':'x86_64-pc-windows-msvc';
    const bundled=fileURLToPath(new URL(`../node_modules/@openai/codex-win32-${arch}/vendor/${triple}/bin/codex.exe`,import.meta.url));
    if(fs.existsSync(bundled))return bundled;
  }
  return findExecutable('codex');
}
export class Codex extends EventEmitter {
  constructor({home=null,history=null,platform=null}={}) { super(); this.home=home;this.history=history;this.platform=platform;this.platformId=randomUUID(); this.command = findCodexExecutable(); this.pending = new Map(); this.serial = 0; this.child = null; this.starting = null; }
  environment(){const env=backgroundEnvironment();if(this.home){env.CODEX_HOME=this.home;for(const key of ['CODEX_ACCESS_TOKEN','OPENAI_API_KEY','OPENAI_ACCESS_TOKEN'])delete env[key];}return env;}
  config(){
    const history=this.history?['-c',`mcp_servers.agent_desk_history.command=${JSON.stringify(process.execPath)}`,'-c',`mcp_servers.agent_desk_history.args=${JSON.stringify([fileURLToPath(new URL('../scripts/history-mcp.mjs',import.meta.url)),this.history.dataFile,this.history.localHome])}`,'-c','mcp_servers.agent_desk_history.enabled=true','-c','mcp_servers.agent_desk_history.required=true']:[];
    const platform=this.platform?['-c',`mcp_servers.agent_desk_platform.command=${JSON.stringify(process.execPath)}`,'-c',`mcp_servers.agent_desk_platform.args=${JSON.stringify([fileURLToPath(new URL('../scripts/platform-mcp.mjs',import.meta.url)),this.platform.url,this.platformId])}`,'-c',`mcp_servers.agent_desk_platform.env.AGENT_DESK_PLATFORM_TOKEN=${JSON.stringify(this.platform.token)}`,'-c','mcp_servers.agent_desk_platform.tool_timeout_sec=240','-c','mcp_servers.agent_desk_platform.enabled_tools=["delegate_antigravity"]','-c','mcp_servers.agent_desk_platform.tools.delegate_antigravity.approval_mode="approve"','-c','mcp_servers.agent_desk_platform.enabled=true','-c','mcp_servers.agent_desk_platform.required=true']:[];
    return [...backgroundConfig(),...(this.home?['-c','cli_auth_credentials_store="file"']:[]),...history,...platform];
  }
  async start() {
    if (this.starting) return this.starting;
    if (this.child) return;
    this.starting = this.launch();
    try { await this.starting; } finally { this.starting = null; }
  }
  async launch() {
    if (!this.command) throw new Error('未检测到 Codex 命令');
    // Keep desktop computer-use services out of background workspace sessions.
    const child = spawn(this.command, [...this.config(), 'app-server', '--listen', 'stdio://'], { windowsHide: true, env:this.environment(), stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    child.stdin.on('error', () => {});
    child.stderr.on('data', () => {}); // Never expose credentials or raw upstream diagnostics.
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', line => {
      let msg; try { msg = JSON.parse(line); } catch { return; }
      if (msg.id != null && !msg.method) {
        const request = this.pending.get(String(msg.id));
        if (request) { clearTimeout(request.timer); this.pending.delete(String(msg.id)); msg.error ? request.reject(new Error(msg.error.message)) : request.resolve(msg.result); }
      } else if (msg.method && msg.id != null) {
        // Execution scope is selected before each turn; never silently grant escalation.
        this.send({ id: msg.id, error: { code: -32601, message: 'Agent Desk does not grant interactive permission escalation.' } });
        this.emit('notice', { method: msg.method, text: '后台请求额外授权；当前工作区权限不包含该操作，已拒绝。' });
      } else this.emit('notification', msg);
    });
    const closed = error => {
      if (this.child !== child) return;
      this.child = null;
      for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error || new Error('Codex 后台已退出')); }
      this.pending.clear(); this.emit('closed');
    };
    child.once('error', closed); child.once('close', () => closed());
    try {
      await this.request('initialize', { clientInfo: { name: 'agent_desk_local', title: 'Agent Desk Local', version: '0.1.0' } });
      this.send({ method: 'initialized' });
    } catch (e) { this.stop(); throw e; }
  }
  send(msg) { if (!this.child?.stdin.writable) throw new Error('Codex 未连接'); this.child.stdin.write(JSON.stringify(msg) + '\n'); }
  async checkWorkspace(workspace) {
    if(process.platform!=='win32')return;
    await new Promise((resolve,reject)=>{
      execFile(this.command,['sandbox','-P',':workspace',...this.config(),'-C',workspace,process.execPath,'-e','process.stdout.write("AGENT_DESK_SANDBOX_READY")'],{cwd:workspace,env:this.environment(),windowsHide:true,timeout:20000,maxBuffer:16000},(error,stdout,stderr)=>{
        if(!error&&stdout.includes('AGENT_DESK_SANDBOX_READY'))return resolve();
        const locked=/setup refresh|helper_unknown_error/.test(stderr||'');
        reject(new Error(locked?'Codex Windows 沙箱初始化失败（setup refresh）。当前运行时存在文件占用，请检查工作台所用 CLI 的修复版本；现有登录和任务记录会保留。':'Codex 工作区沙箱检查未通过，本回合未调用模型。请检查官方 CLI 的沙箱设置后重试。'));
      });
    });
  }
  request(method, params = {}, timeout = 20000) {
    const id = String(++this.serial);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} 请求超时`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); } catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
    });
  }
  stop() { this.child?.kill(); }
}
