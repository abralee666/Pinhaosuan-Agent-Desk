import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve)); return port;
}
async function eventually(check, timeout = 12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 70)); }
  throw new Error('等待状态超时');
}

test('phone pairing, two-device updates, guarded commands and revocation work through HTTP', {timeout:35000}, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-companion-'));
  const port = await freePort(), remotePort = await freePort();
  const origin = `http://127.0.0.1:${port}`, mobile = `http://127.0.0.1:${remotePort}`;
  let errors = '';
  const child = spawn(process.execPath, [path.join(root, 'server.mjs')], {windowsHide:true,
    env:{...process.env,AGENT_DESK_EDITION:'commercial', PORT:String(port), AGENT_DESK_REMOTE_PORT:String(remotePort), AGENT_DESK_DATA:directory, AGENT_DESK_SEED_DEMO:'0', AGENT_DESK_TEST_NETWORK:'1'}, stdio:['ignore','pipe','pipe']});
  child.stderr.on('data', data => errors += data);
  t.after(async () => {
    if (child.exitCode === null) { const ended = new Promise(resolve => child.once('exit', resolve)); child.kill(); await ended; }
    fs.rmSync(directory, {recursive:true,force:true});
  });
  await new Promise((resolve, reject) => {child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',code=>reject(new Error(`Server exit ${code}: ${errors}`)));});
  const landing = await fetch(origin);
  const desktopCookie = landing.headers.get('set-cookie').split(';')[0];
  const get = (base, route, cookie) => fetch(base + route, {headers:{Cookie:cookie || ''}});
  const post = (base, route, payload, cookie, id=randomUUID(), extra={}) => fetch(base + route, {method:'POST',
    headers:{Cookie:cookie || '', Origin:base, 'X-Agent-Desk':'1', 'X-Request-Id':id, 'Content-Type':'application/json', ...extra}, body:JSON.stringify(payload)});
  const desktop = async (route, payload={}) => { const res = await post(origin, route, payload, desktopCookie); assert.equal(res.status,200, await res.clone().text()); return res.json(); };
  const devices = async () => (await get(origin, '/api/devices', desktopCookie)).json();
  assert.equal((await devices()).enabled,false);
  await assert.rejects(fetch(mobile + '/mobile'));
  await desktop('/api/devices/enable');
  assert.equal((await get(mobile,'/mobile')).status,200);
  assert.equal((await get(mobile,'/workspace')).status,404);
  assert.equal((await get(mobile,'/app.js')).status,404);
  assert.equal((await get(mobile,'/api/state')).status,401);
  assert.equal((await post(mobile,'/api/device/pair',{token:'bad'},'',randomUUID(),{Origin:'http://evil.test'})).status,403);
  const badHost = await new Promise((resolve,reject) => {
    const request = http.get(mobile+'/mobile',{headers:{Host:`evil.test:${remotePort}`}}, res => {res.resume();resolve(res.statusCode);});
    request.on('error',reject);
  });
  assert.equal(badHost,403);
  const invitation = await desktop('/api/devices/pairing');
  assert.match(invitation.qrSvg,/<svg/);
  const token = new URLSearchParams(new URL(invitation.url).hash.slice(1)).get('pair');
  const pairId = randomUUID();
  const paired = await post(mobile,'/api/device/pair',{token,name:'测试手机'},'',pairId);
  assert.equal(paired.status,200);
  const cookie = paired.headers.get('set-cookie').split(';')[0];
  const {device} = await paired.json();
  const retryPair = await post(mobile,'/api/device/pair',{name:'测试手机',token},'',pairId);
  assert.equal(retryPair.headers.get('set-cookie').split(';')[0],cookie);
  assert.equal((await retryPair.json()).device.id,device.id);
  assert.equal((await post(mobile,'/api/device/pair',{token},'')).status,403);
  assert.equal((await get(mobile,'/api/device/status',cookie)).status,200);
  assert.equal((await get(mobile,'/api/state',cookie)).status,403);
  assert.equal((await post(mobile,'/api/task',{goal:'不应创建',mode:'demo'},cookie)).status,403);
  await desktop('/api/devices/approve',{deviceId:device.id});
  assert.equal((await get(mobile,'/api/state',cookie)).status,200);
  assert.equal((await post(mobile,'/api/shutdown',{},cookie)).status,403);
  assert.equal((await post(mobile,'/api/accounts/codex-login',{},cookie)).status,403);
  assert.equal((await post(mobile,'/api/devices/approve',{deviceId:device.id},cookie)).status,403);
  const abort = new AbortController();
  const eventResponse = await fetch(mobile+'/api/events',{headers:{Cookie:cookie},signal:abort.signal});
  const reader = eventResponse.body.getReader();
  let streamText = new TextDecoder().decode((await reader.read()).value);
  assert.match(streamText,/event: state/);
  const id = randomUUID(), payload = {goal:'手机与电脑测试同一份进度',mode:'demo'};
  const simultaneous = await Promise.all([post(mobile,'/api/task',payload,cookie,id),post(mobile,'/api/task',payload,cookie,id)]);
  assert.deepEqual(simultaneous.map(res=>res.status),[200,200]);
  const first = await simultaneous[0].json(), second = await simultaneous[1].json();
  assert.equal(first.taskId,second.taskId);
  streamText += new TextDecoder().decode((await reader.read()).value);
  assert.match(streamText,/手机与电脑测试同一份进度/);
  const changed = await post(mobile,'/api/task',{...payload,goal:'不同指令'},cookie,id);
  assert.equal(changed.status,409);
  const localState = await (await get(origin,'/api/state',desktopCookie)).json();
  const mobileState = await (await get(mobile,'/api/state',cookie)).json();
  assert.equal(localState.tasks.length,1); assert.equal(mobileState.tasks[0].id,first.taskId);
  assert.equal('workspace' in mobileState.tasks[0],false);
  assert.equal('threads' in mobileState.tasks[0],false);
  assert.equal('pid' in mobileState.runtime,false);
  assert.equal('command' in mobileState.runtime.antigravity,false);
  const runId = randomUUID();
  const runs = await Promise.all([post(mobile,'/api/run',{taskId:first.taskId},cookie,runId),post(mobile,'/api/run',{taskId:first.taskId},cookie,runId)]);
  assert.deepEqual(runs.map(res=>res.status),[200,200]);
  assert.equal((await post(origin,'/api/run',{taskId:first.taskId},desktopCookie)).status,409);
  assert.equal((await post(mobile,'/api/stop',{},cookie)).status,400);
  assert.equal((await post(mobile,'/api/stop',{taskId:'wrong-task'},cookie)).status,409);
  assert.equal((await post(mobile,'/api/stop',{taskId:first.taskId},cookie)).status,200);
  const paused = await (await get(origin,'/api/state',desktopCookie)).json();
  assert.equal(paused.runtime.busy,false); assert.equal(paused.tasks[0].status,'interrupted');
  const noOriginRun = await fetch(mobile+'/api/run',{method:'POST', headers:{Cookie:cookie, 'X-Agent-Desk':'1', 'X-Request-Id':randomUUID(), 'Content-Type':'application/json'}, body:JSON.stringify({taskId:first.taskId})});
  assert.equal(noOriginRun.status,200);
  const completed = await eventually(async () => {
    const state = await (await get(mobile,'/api/state',cookie)).json();
    return state.tasks[0].status === 'completed' ? state : null;
  });
  assert.equal(completed.tasks[0].completed.length,4);
  assert.ok(completed.tasks[0].fileContents.length >= 4);
  assert.equal((await (await get(origin,'/api/state',desktopCookie)).json()).tasks[0].completed.length,4);
  await desktop('/api/devices/revoke',{deviceId:device.id});
  assert.equal((await post(mobile,'/api/device/pair',{token,name:'测试手机'},'',pairId)).status,410);
  assert.equal((await get(mobile,'/api/state',cookie)).status,401);
  assert.equal((await post(mobile,'/api/run',{taskId:first.taskId},cookie,runId)).status,401);
  await eventually(async () => {
    const chunk = await reader.read(); return chunk.done;
  });
  abort.abort();
  const nextInvitation = await desktop('/api/devices/pairing');
  const nextToken = new URLSearchParams(new URL(nextInvitation.url).hash.slice(1)).get('pair');
  const next = await post(mobile,'/api/device/pair',{token:nextToken},'');
  assert.equal(next.status,200);
  await desktop('/api/devices/disable');
  assert.equal((await devices()).enabled,false);
  assert.equal((await devices()).devices.length,0);
  await assert.rejects(fetch(mobile+'/api/state'));
  await desktop('/api/devices/enable');
  assert.equal((await get(mobile,'/api/device/status',cookie)).status,401);
  await desktop('/api/devices/disable');
  assert.equal(errors,'');
});
