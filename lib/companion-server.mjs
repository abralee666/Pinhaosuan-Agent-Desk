import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import {DeviceAccess, DeviceAccessError, SESSION_COOKIE, parseCookies} from './device-access.mjs';

const mobileCommands = new Set(['/api/task', '/api/run', '/api/stop', '/api/task/resume']);
const privateIPv4 = ip => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
const json = (res, status, value, headers = {}) => {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', ...headers});
  res.end(JSON.stringify(value));
};
const assetHeaders = {
  'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

export function lanAddresses(interfaces = os.networkInterfaces()) {
  const rank = name => /vmware|vbox|virtual|tap|tun|vpn|docker|wsl|hyper-v|cfw|speedcat|corplink/i.test(name) ? 3
    : /wi-?fi|wlan|wireless|无线/i.test(name) ? 0 : /ethernet|以太网|^en\d|^eth\d/i.test(name) ? 1 : 2;
  return [...new Set(Object.entries(interfaces).sort(([a],[b]) => rank(a)-rank(b))
    .flatMap(([,addresses]) => addresses || [])
    .filter(a => a.family === 'IPv4' && !a.internal && privateIPv4(a.address)).map(a => a.address))];
}

/** A deliberately opt-in LAN listener. It never serves the local account-management UI. */
export class CompanionServer {
  constructor({port, publicRoot, getSnapshot, executeCommand, uploadAttachment, testNetwork = false}) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('手机连接端口无效');
    this.port = port;
    this.publicRoot = publicRoot;
    this.getSnapshot = getSnapshot;
    this.executeCommand = executeCommand;
    this.uploadAttachment = uploadAttachment;
    this.testNetwork = testNetwork;
    this.devices = new DeviceAccess();
    this.server = null;
    this.clients = new Map();
    this.sockets = new Set();
    this.hosts = new Set();
  }

  status() {
    return {enabled:this.devices.enabled, port:this.port,
      addresses:lanAddresses().map(ip => `http://${ip}:${this.port}`), devices:this.devices.list()};
  }

  async enable() {
    if (this.server) return this.status();
    const addresses = lanAddresses();
    this.hosts = new Set([...addresses, '127.0.0.1'].map(ip => `${ip}:${this.port}`));
    const server = http.createServer((req, res) => this.handle(req, res));
    server.headersTimeout = 15_000;
    server.requestTimeout = 20_000;
    server.on('connection', socket => { this.sockets.add(socket); socket.on('close', () => this.sockets.delete(socket)); });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(this.port, '0.0.0.0', resolve); });
    server.on('error', () => {});
    this.server = server;
    this.devices.enable();
    return this.status();
  }

  closeDeviceStreams(deviceId) {
    for (const [res, client] of this.clients) {
      if (!deviceId || client.deviceId === deviceId) { res.end(); this.clients.delete(res); }
    }
  }

  close() {
    this.devices.disable();
    this.closeDeviceStreams();
    const server = this.server;
    this.server = null;
    server?.close();
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    return this.status();
  }

  async localCommand(route, b) {
    if (route === '/api/devices/enable') return {status:200, body:await this.enable()};
    if (route === '/api/devices/disable') return {status:200, body:this.close()};
    if (route === '/api/devices/approve') { this.devices.approve(b.deviceId); return {status:200, body:this.status()}; }
    if (route === '/api/devices/revoke') {
      this.devices.revoke(b.deviceId); this.closeDeviceStreams(b.deviceId);
      return {status:200, body:this.status()};
    }
    if (route === '/api/devices/pairing') {
      const bases = this.status().addresses;
      if (!bases.length && this.testNetwork) bases.push(`http://127.0.0.1:${this.port}`);
      if (!bases.length) throw new DeviceAccessError('没有找到局域网地址，请让电脑连接 Wi-Fi 后重试');
      this.hosts = new Set([...bases.map(base => new URL(base).host), `127.0.0.1:${this.port}`]);
      const invitation = this.devices.createPairing();
      const urls = bases.map(base => `${base}/mobile#pair=${invitation.token}`);
      return {status:200, body:{url:urls[0], urls, expiresAt:invitation.expiresAt,
        qrSvg:await QRCode.toString(urls[0], {type:'svg', errorCorrectionLevel:'M', margin:3})}};
    }
    return null;
  }

  authorize(sessionToken) {
    const device = this.devices.lookupSession(sessionToken);
    if (!device) throw new DeviceAccessError('连接已失效，请在电脑端重新配对', 401, 'device_session_required');
    if (device.status !== 'approved') throw new DeviceAccessError('请等待电脑确认连接', 403, 'device_pending');
    return device;
  }

  // This narrow RPC surface is called by the authenticated outbound relay bridge.
  // It shares device approval and command idempotency with LAN control.
  async remoteRPC(job) {
    const route=job.route, b=job.body||{};
    const sessionToken=parseCookies(job.cookie)[SESSION_COOKIE];
    if(job.method==='POST'&&route==='/api/device/pair'){
      const response=await this.executeCommand(route,b,{callerId:'remote-pair',requestId:job.requestId,remote:true,internet:true,pairing:true,
        action:()=>{const result=this.devices.claim(b.token,b.name);return {status:200,body:{device:result.device},headers:{'Set-Cookie':`${SESSION_COOKIE}=${result.sessionToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(this.devices.sessionTtlMs/1000)}`}};}});
      if(response.status===200&&!this.devices.lookupSession(parseCookies(response.headers?.['Set-Cookie'])[SESSION_COOKIE]))return {status:410,body:{error:'配对已失效，请重新生成链接'}};
      return response;
    }
    if(job.method==='GET'&&route==='/api/device/status'){
      const device=this.devices.lookupSession(sessionToken);return device?{status:200,body:{enabled:true,device}}:{status:401,body:{error:'请重新配对'}};
    }
    const device=this.authorize(sessionToken);
    if(job.method==='GET'&&route==='/api/state')return {status:200,body:this.getSnapshot({...b,compact:true})};
    if(job.method==='POST'&&route==='/api/attachments'){
      const {name, type, data} = b;
      const buffer = Buffer.from(data, 'base64');
      if (buffer.length > 10 * 1024 * 1024) throw new DeviceAccessError('附件不能超过 10 MB', 413);
      const item = this.uploadAttachment ? this.uploadAttachment(name, type, buffer) : null;
      if (!item) throw new DeviceAccessError('附件服务不可用', 500);
      return {status: 200, body: item};
    }
    if(job.method!=='POST'||!mobileCommands.has(route))return {status:403,body:{error:'此操作只能在电脑端完成'}};
    if(route==='/api/stop'&&!b.taskId)throw new DeviceAccessError('请选择要停止的任务');
    return this.executeCommand(route,b,{callerId:device.id,requestId:job.requestId,remote:true,internet:true,sessionToken});
  }

  publish() {
    let data;
    for (const [res, client] of this.clients) {
      try { this.authorize(client.sessionToken); }
      catch { res.end(); this.clients.delete(res); continue; }
      data ||= `event: state\ndata: ${JSON.stringify(this.getSnapshot())}\n\n`;
      res.write(data);
    }
  }

  heartbeat() {
    for (const [res, client] of this.clients) {
      try { this.authorize(client.sessionToken); res.write(': keepalive\n\n'); }
      catch { res.end(); this.clients.delete(res); }
    }
  }

  async handle(req, res) {
    try {
      const address = req.socket.remoteAddress?.replace(/^::ffff:/, '');
      const validHost = this.hosts.has(req.headers.host) || (this.hosts = new Set([...lanAddresses(), '127.0.0.1'].map(ip => `${ip}:${this.port}`))).has(req.headers.host);
      if (!this.devices.enabled || !validHost || !(privateIPv4(address || '') || address === '127.0.0.1')) {
        return json(res, 403, {error:'该访问地址不受支持'});
      }
      const origin = `http://${req.headers.host}`;
      const url = new URL(req.url, origin);
      if (req.headers.origin && req.headers.origin !== origin || req.headers['sec-fetch-site'] === 'cross-site') {
        return json(res, 403, {error:'请求来源不受支持'});
      }
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET') return json(res, 405, {error:'不支持该请求'});
        const assets = {'/mobile':['mobile.html','text/html'], '/':['mobile.html','text/html'],
          '/mobile.js':['mobile.js','text/javascript'], '/mobile.css':['mobile.css','text/css'],
          '/brand/pinghaosuan-logo-selected.png':['brand/pinghaosuan-logo-selected.png','image/png']};
        const asset = assets[url.pathname];
        if (!asset) return json(res, 404, {error:'页面不存在'});
        res.writeHead(200, {...assetHeaders, 'Content-Type':asset[1]+'; charset=utf-8'});
        res.end(fs.readFileSync(path.join(this.publicRoot, asset[0]))); return;
      }
      if (req.method === 'POST' && ((req.headers.origin && req.headers.origin !== origin) || req.headers['x-agent-desk'] !== '1')) {
        return json(res, 403, {error:'请求来源不受支持'});
      }
      const sessionToken = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      if (req.method === 'GET' && url.pathname === '/api/device/status') {
        const device = this.devices.lookupSession(sessionToken);
        if (!device) return json(res, 401, {error:'请重新配对'});
        return json(res, 200, {enabled:true, device});
      }
      if (req.method === 'POST' && url.pathname === '/api/device/pair') {
        const b = await readBody(req);
        // Pairing retries share the response and Set-Cookie, even if the first response was lost.
        const response = await this.executeCommand(url.pathname, b, {
          callerId:`pair:${address}`, requestId:req.headers['x-request-id'], remote:true, pairing:true,
          action:() => {
            const result = this.devices.claim(b.token, b.name);
            return {status:200, body:{device:result.device}, headers:{'Set-Cookie':`${SESSION_COOKIE}=${result.sessionToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(this.devices.sessionTtlMs / 1000)}`}};
          },
        });
        if (response.status === 200) {
          const returnedToken = parseCookies(response.headers?.['Set-Cookie'])[SESSION_COOKIE];
          const current = this.devices.lookupSession(returnedToken);
          if (!current) return json(res, 410, {error:'这次配对已失效，请在电脑上重新生成二维码'});
          return json(res, 200, {device:current}, response.headers);
        }
        return json(res, response.status, response.body, response.headers);
      }
      const device = this.authorize(sessionToken);
      if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, this.getSnapshot());
      if (req.method === 'GET' && url.pathname === '/api/events') {
        res.writeHead(200, {'Content-Type':'text/event-stream', 'Cache-Control':'no-cache', Connection:'keep-alive'});
        this.clients.set(res, {deviceId:device.id, sessionToken});
        res.write(`event: state\ndata: ${JSON.stringify(this.getSnapshot())}\n\n`);
        req.on('close', () => this.clients.delete(res)); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/attachments') {
        const name = decodeURIComponent(String(req.headers['x-file-name'] || ''));
        const chunks = []; let bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 10 * 1024 * 1024) throw new DeviceAccessError('附件不能超过 10 MB', 413);
          chunks.push(chunk);
        }
        const item = this.uploadAttachment ? this.uploadAttachment(name, req.headers['content-type'], Buffer.concat(chunks)) : null;
        if (!item) throw new DeviceAccessError('附件服务不可用', 500);
        return json(res, 200, item);
      }
      if (req.method !== 'POST' || !mobileCommands.has(url.pathname)) return json(res, 403, {error:'请在电脑端完成此操作'});
      const b = await readBody(req);
      if (url.pathname === '/api/stop' && !b.taskId) throw new DeviceAccessError('请选择要停止的任务');
      const response = await this.executeCommand(url.pathname, b, {callerId:device.id, requestId:req.headers['x-request-id'], remote:true, sessionToken});
      return json(res, response.status, response.body, response.headers);
    } catch (error) {
      if (!res.headersSent) json(res, error.statusCode || 400, {error:error.message, code:error.code});
      else res.end();
    }
  }
}

async function readBody(req) {
  const chunks = []; let bytes = 0;
  for await (const chunk of req) { bytes += chunk.length; if (bytes > 200_000) throw new DeviceAccessError('请求内容过大', 413); chunks.push(chunk); }
  const data = Buffer.concat(chunks).toString('utf8');
  const value = data ? JSON.parse(data) : {};
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new DeviceAccessError('请求参数应为对象');
  return value;
}
