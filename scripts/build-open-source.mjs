import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const hash=data=>createHash('sha256').update(data).digest('hex');
export function privacyFindings(name,bytes,{username=os.userInfo().username}={}){
  if(!/\.(?:mjs|js|json|md|txt|html|css|ps1|cmd|sh|yml|svg)$|(?:LICENSE|gitignore|env\.example)$/.test(name))return [];
  const text=bytes.toString('utf8'),findings=[];
  const escaped=username.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  if(username.length>2&&new RegExp(`(?<![\\w])${escaped}(?![\\w])`,'i').test(text))findings.push('local-user-identifier');
  if(/(?:[A-Z]:[\\/]Users[\\/](?!(?:example|test|user|Public|Default)(?:[\\/]|\b))[^\s"'`]+|\/Users\/(?!example\/|test\/|user\/)[^\s"'`]+|\/home\/(?!example\/|test\/|user\/)[^\s"'`]+)/i.test(text))findings.push('personal-home-path');
  const emails=text.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g)||[];
  if(emails.some(e=>!/(?:@|\.)example\.(?:test|com|org|net)$|@(?:example|localhost)\.invalid$/i.test(e)))findings.push('non-example-email');
  if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/.test(text))findings.push('possible-secret');
  return findings;
}
export function buildOpenSource(output){
  const target=path.resolve(output);if(fs.existsSync(target))throw Error('输出目录已存在，请选择新的空目录');
  const entries=new Map();
  const add=(from,to=from)=>{const source=path.join(root,from),stat=fs.lstatSync(source);if(!stat.isFile()||stat.isSymbolicLink())throw Error('只允许普通源码文件：'+from);entries.set(to,fs.readFileSync(source));};
  for(const file of ['server.mjs','remote-relay.mjs','package.json','package-lock.json','Start-Agent-Desk.ps1','Stop-Agent-Desk.ps1','Launch-Antigravity.ps1'])add(file);
  for(const dir of ['lib','tests','scripts'])for(const name of fs.readdirSync(path.join(root,dir)))if(/\.(mjs|ps1)$/.test(name))add(`${dir}/${name}`);
  for(const name of fs.readdirSync(path.join(root,'public')))if(/\.(js|css|html)$/.test(name))add('public/'+name);
  for(const name of fs.readdirSync(path.join(root,'public/providers')))if(/\.(svg|png|ico|json)$/.test(name))add('public/providers/'+name);
  for(const name of ['pinghaosuan-eight-arms-v11.png','pinghaosuan-layout-v12.png','pinghaosuan-compact-v13.png','pinghaosuan-logo-selected.png'])add('public/brand/'+name);
  for(const name of fs.readdirSync(path.join(root,'distribution/opensource')))add('distribution/opensource/'+name);
  for(const [source,dest] of [['README.md','README.md'],['PRODUCT.md','docs/PRODUCT.md'],['CHANGELOG.md','CHANGELOG.md'],['DEPLOYMENT.md','docs/DEPLOYMENT.md'],['RELEASE.md','docs/RELEASE.md'],['LICENSE','LICENSE'],['.gitignore','.gitignore'],['.env.example','.env.example']])add('distribution/opensource/'+source,dest);
  entries.set('distribution.json',Buffer.from(JSON.stringify({edition:'opensource'},null,2)+'\n'));
  entries.set('.github/workflows/test.yml',Buffer.from('name: Test\non: [push, pull_request]\njobs:\n  test:\n    runs-on: windows-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 22\n          cache: npm\n      - run: npm ci\n      - run: npm test\n'));
  const violations=[...entries].flatMap(([name,bytes])=>privacyFindings(name,bytes).map(rule=>({file:name,rule})));
  if(violations.length)throw Error('隐私检查未通过：'+JSON.stringify(violations));
  const manifest=[];
  for(const [name,bytes]of [...entries].sort(([a],[b])=>a.localeCompare(b))){fs.mkdirSync(path.dirname(path.join(target,name)),{recursive:true});fs.writeFileSync(path.join(target,name),bytes);manifest.push({path:name,bytes:bytes.length,sha256:hash(bytes)});}
  fs.writeFileSync(path.join(target,'SOURCE-MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n');
  return {files:manifest.length,privacyFindings:0,edition:'opensource',defaultPlan:'max'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(!process.argv[2])throw Error('请指定新的输出目录');
 console.log(JSON.stringify(buildOpenSource(process.argv[2])));
}
