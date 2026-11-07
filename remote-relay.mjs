import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash,timingSafeEqual} from 'node:crypto';
import {verifyLicense} from './lib/membership.mjs';
import {distributionEdition} from './lib/distribution.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const digest=s=>createHash('sha256').update(s).digest();
const routes=new Set(['/api/device/pair','/api/device/status','/api/state','/api/task','/api/run','/api/stop','/api/task/resume','/api/attachments']);
export function createRelay({publicKey,publicOrigin,publicRoot=path.join(root,'public'),test=false,now=Date.now,edition='commercial',registrationKey=process.env.RELAY_REGISTRATION_KEY}){
  if(edition==='opensource'&&(typeof registrationKey!=='string'||registrationKey.length<32))throw Error('开源中继需设置至少 32 字符的 RELAY_REGISTRATION_KEY');
  const origin=new URL(publicOrigin);
  if(origin.protocol!=='https:'&&!(test&&origin.hostname==='127.0.0.1'))throw Error('生产中继必须使用 HTTPS 公网地址');
  const desktops=new Map();const requests=new Map();const streams=new Set();
  const send=(res,status,body,headers={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(body));};
  const read=async(req,max=250000)=>{let bytes=0;const chunks=[];for await(const b of req){bytes+=b.length;if(bytes>max)throw Object.assign(Error('请求过大'),{statusCode:413});chunks.push(b);}return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');};
  const valid=d=>d&&(edition==='opensource'||verifyLicense(d.license,publicKey,d.id,now()));
  function authenticate(req){const d=desktops.get(req.headers['x-desktop-id']);const token=req.headers.authorization?.replace(/^Bearer /,'')||'';if(!valid(d)||!timingSafeEqual(d.secretHash,digest(token)))throw Object.assign(Error('中继授权无效或已到期'),{statusCode:403});d.seenAt=now();return d;}
  async function submit(d,req,route,body={}){
    if(!valid(d))return {status:403,body:{error:'跨网络授权无效或已到期'}};
    if(now()-d.seenAt>45000)return {status:503,body:{error:'电脑离线，请确认工作台仍在运行'}};
    if(d.queue.length>=64||requests.size>=512)return {status:429,body:{error:'请求较多，请稍后重试'}};
    const id=randomUUID();return new Promise(resolve=>{
      const timer=setTimeout(()=>{requests.delete(id);d.queue=d.queue.filter(j=>j.id!==id);resolve({status:504,body:{error:'电脑响应超时；请通过操作重试确认结果'}});},22000);
      requests.set(id,{desktopId:d.id,resolve:reply=>{clearTimeout(timer);requests.delete(id);resolve(reply);}});
      d.queue.push({id,route,method:req.method,body,cookie:(req.headers.cookie||'').slice(0,2000),requestId:req.headers['x-request-id']});d.wake?.();
    });
  }
  const server=http.createServer(async(req,res)=>{
    try{
      if(req.headers.host!==origin.host)return send(res,403,{error:'访问地址不匹配'});
      if(!test&&req.socket.encrypted!==true&&req.headers['x-forwarded-proto']!=='https')return send(res,403,{error:'需要 HTTPS'});
      const url=new URL(req.url,origin);
      if(url.pathname.startsWith('/control/')){
        if(req.method!=='POST')return send(res,405,{error:'不支持该请求'});
        if(url.pathname==='/control/register'){
          const b=await read(req),id=req.headers['x-desktop-id'],secret=req.headers.authorization?.replace(/^Bearer /,'')||'';
          const admitted=edition==='opensource'?typeof b.registrationKey==='string'&&timingSafeEqual(digest(b.registrationKey),digest(registrationKey)):verifyLicense(b.license,publicKey,id,now());
          if(!/^[a-f0-9-]{36}$/.test(id||'')||!admitted||!/^[a-f0-9]{64}$/.test(secret))return send(res,403,{error:'授权或安装编号无效'});
          const old=desktops.get(id);if(old&&!timingSafeEqual(old.secretHash,digest(secret)))return send(res,403,{error:'电脑连接密钥不匹配'});
          if(!old&&desktops.size>=1000)return send(res,503,{error:'中继容量已满'});
          const d=old||{id,secretHash:digest(secret),queue:[],seenAt:now()};d.license=b.license;d.seenAt=now();desktops.set(id,d);return send(res,200,{ok:true});
        }
        const d=authenticate(req);const b=await read(req,10000000);
        if(url.pathname==='/control/poll'){
          if(!d.queue.length)await new Promise(resolve=>{const timer=setTimeout(resolve,18000);d.wake=()=>{clearTimeout(timer);resolve();};req.on('close',()=>{clearTimeout(timer);resolve();});});
          d.wake=null;d.seenAt=now();if(!valid(d))return send(res,403,{error:'授权已到期'});return send(res,200,{jobs:d.queue.splice(0,8)});
        }
        if(url.pathname==='/control/reply'){
          const pending=requests.get(b.id);if(pending&&pending.desktopId===d.id&&b.reply&&Number.isInteger(b.reply.status)&&b.reply.status>=200&&b.reply.status<=599)pending.resolve(b.reply);
          return send(res,200,{ok:true});
        }
        return send(res,404,{error:'接口不存在'});
      }
      const match=url.pathname.match(/^\/d\/([a-f0-9-]{36})(\/.*)$/);if(!match)return send(res,404,{error:'请使用电脑生成的配对链接'});
      const [,id,route]=match,base=`/d/${id}`,d=desktops.get(id);
      if(req.headers.origin&&req.headers.origin!==origin.origin||req.headers['sec-fetch-site']==='cross-site')return send(res,403,{error:'请求来源不受支持'});
      const assets={'/mobile':['mobile.html','text/html'],'/mobile.js':['mobile.js','text/javascript'],'/mobile.css':['mobile.css','text/css'],'/brand/pinghaosuan-logo-selected.png':['brand/pinghaosuan-logo-selected.png','image/png']};
      if(req.method==='GET'&&assets[route]){
        const [file,type]=assets[route];let data=fs.readFileSync(path.join(publicRoot,file));if(file==='mobile.html')data=Buffer.from(data.toString().replaceAll('="/','="'+base+'/').replace('手机与电脑需要连接同一网络。','使用跨网络连接时，手机与电脑可以连接不同网络。'));
        res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'"});return res.end(data);
      }
      if(!routes.has(route)||!['GET','POST'].includes(req.method))return send(res,403,{error:'此操作只能在电脑端完成'});
      const getRoutes=new Set(['/api/state','/api/device/status']);if(getRoutes.has(route)!==(req.method==='GET'))return send(res,405,{error:'请求方法不正确'});
      if(req.method==='POST'&&(req.headers.origin!==origin.origin||req.headers['x-agent-desk']!=='1'))return send(res,403,{error:'请求来源不受支持'});
      let payload;
      if (req.method === 'POST') {
        if (route === '/api/attachments') {
          let bytes = 0; const chunks = [];
          for await (const b of req) {
            bytes += b.length;
            if (bytes > 10500000) throw Object.assign(Error('附件不能超过 10 MB'), {statusCode: 413});
            chunks.push(b);
          }
          payload = {
            name: decodeURIComponent(String(req.headers['x-file-name'] || '')),
            type: req.headers['content-type'] || 'application/octet-stream',
            data: Buffer.concat(chunks).toString('base64'),
          };
        } else {
          payload = await read(req);
        }
      } else {
        payload = {taskId:url.searchParams.get('taskId')||null,revision:url.searchParams.get('revision')};
      }
      const reply=await submit(d,req,route,payload);
      const headers={};if(reply.headers?.['Set-Cookie'])headers['Set-Cookie']=reply.headers['Set-Cookie'].replace('Path=/;',`Path=${base}/;${test?'':' Secure;'}`);
      return send(res,reply.status,reply.body,headers);
    }catch(error){if(!res.headersSent)send(res,error.statusCode||400,{error:error.message});else res.end();}
  });
  server.headersTimeout=15000;server.requestTimeout=30000;
  server.on('close',()=>{for(const pending of requests.values())pending.resolve({status:503,body:{error:'中继服务停止'}});for(const d of desktops.values())d.wake?.();for(const s of streams)s.end();});
  return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const edition=distributionEdition();
  const publicKey=edition==='opensource'?'':fs.readFileSync(process.env.RELAY_PUBLIC_KEY_FILE||'license-public.pem','utf8');
  const server=createRelay({publicKey,publicOrigin:process.env.RELAY_PUBLIC_ORIGIN,edition});
  server.listen(Number(process.env.RELAY_PORT||4320),'127.0.0.1',()=>console.log('公网中继已启动；需通过 HTTPS 反向代理访问。'));
}
