import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DeviceAccess, OperationCoordinator, parseCookies} from '../lib/device-access.mjs';

function fixture(options = {}) {
  let time = 1_000;
  const access = new DeviceAccess({now: () => time, ...options});
  return {access, advance: ms => { time += ms; }};
}

test('pairing requires desktop enable and approval, never exposing tokens in device lists', () => {
  const {access} = fixture();
  assert.throws(() => access.createPairing(), error => error.statusCode === 403);
  access.enable();
  const invitation = access.createPairing();
  assert.match(invitation.token, /^[a-f0-9]{64}$/);
  const claim = access.claim(invitation.token, '  我的手机\n  ');
  assert.equal(claim.device.status, 'pending');
  assert.equal(claim.device.name, '我的手机');
  assert.equal(access.lookupSession(claim.sessionToken).status, 'pending');
  const approved = access.approve(claim.device.id);
  assert.equal(approved.status, 'approved');
  assert.equal(access.lookupSession(claim.sessionToken).status, 'approved');
  const serialized = JSON.stringify(access.list());
  assert.equal(serialized.includes(claim.sessionToken), false);
  assert.equal(serialized.includes(invitation.token), false);
  assert.equal(serialized.includes('sessionHash'), false);
  // Public snapshots cannot alter internal authorization state.
  approved.status = 'pending';
  assert.equal(access.lookupSession(claim.sessionToken).status, 'approved');
});

test('invitations are single-use, short-lived, and replaced by new invitations', () => {
  const {access, advance} = fixture();
  access.enable();
  const old = access.createPairing();
  const current = access.createPairing();
  assert.throws(() => access.claim(old.token), error => error.code === 'invalid_pairing');
  access.claim(current.token);
  assert.throws(() => access.claim(current.token), error => error.code === 'invalid_pairing');
  const expired = access.createPairing();
  advance(120_000);
  assert.throws(() => access.claim(expired.token), error => error.statusCode === 410);
});

test('revoke, expiry and disable immediately invalidate sessions', () => {
  const {access, advance} = fixture({sessionTtlMs: 100});
  access.enable();
  const first = access.claim(access.createPairing().token);
  access.approve(first.device.id);
  access.revoke(first.device.id);
  assert.equal(access.lookupSession(first.sessionToken), null);
  assert.throws(() => access.approve(first.device.id), error => error.code === 'device_revoked');
  const second = access.claim(access.createPairing().token);
  access.approve(second.device.id);
  advance(100);
  assert.equal(access.lookupSession(second.sessionToken), null);
  const third = access.claim(access.createPairing().token);
  const code = access.createPairing().token;
  access.disable();
  access.enable();
  assert.equal(access.lookupSession(third.sessionToken), null);
  assert.throws(() => access.claim(code), error => error.code === 'invalid_pairing');
  assert.deepEqual(access.list(), []);
});

test('pending-device limit cannot consume a usable invitation and malformed cookies are ignored', () => {
  const {access} = fixture({maxPending: 1});
  access.enable();
  const first = access.claim(access.createPairing().token);
  const next = access.createPairing().token;
  assert.throws(() => access.claim(next), error => error.statusCode === 429);
  access.approve(first.device.id);
  assert.equal(access.claim(next).device.status, 'pending');
  const cookies = parseCookies('a=1; agent_desk_device=hello%20world; malformed=%ZZ; a=2; __proto__=safe');
  assert.equal(cookies.a, '1');
  assert.equal(cookies.agent_desk_device, 'hello world');
  assert.equal(cookies.malformed, undefined);
  assert.equal(Object.getPrototypeOf(cookies), null);
});

test('concurrent retries coalesce, results replay, and conflicting commands are rejected', async () => {
  const coordinator = new OperationCoordinator();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const operation = {callerId: 'desktop', requestId: randomUUID(), route: '/api/tasks', payload: {goal: 'one', nested: {a: 1, b: 2}}};
  let calls = 0;
  const action = async () => { calls++; await gate; return {id: 'task-1'}; };
  const first = coordinator.execute(operation, action);
  const duplicate = coordinator.execute({...operation, payload: {nested: {b: 2, a: 1}, goal: 'one'}}, action);
  await assert.rejects(coordinator.execute({...operation, payload: {goal: 'two'}}, action), error => error.statusCode === 409);
  release();
  assert.deepEqual(await first, {id: 'task-1'});
  assert.deepEqual(await duplicate, {id: 'task-1'});
  assert.deepEqual(await coordinator.execute(operation, action), {id: 'task-1'});
  assert.equal(calls, 1);
  await assert.rejects(coordinator.execute({...operation, route: '/api/tasks/stop'}, action), error => error.statusCode === 409);
});

test('all device mutations serialize, including work before handlers mark a task active', async () => {
  const coordinator = new OperationCoordinator();
  let active = false;
  let launchCount = 0;
  const start = () => coordinator.execute({callerId: randomUUID(), requestId: randomUUID(), route: '/api/start'}, async () => {
    if (active) return 'busy';
    await Promise.resolve();
    active = true;
    launchCount++;
    return 'started';
  });
  assert.deepEqual(await Promise.all([start(), start()]), ['started', 'busy']);
  assert.equal(launchCount, 1);
});

test('failed handlers are replayed and do not prevent later commands from executing', async () => {
  const coordinator = new OperationCoordinator();
  const operation = {callerId: 'mobile', requestId: randomUUID(), route: '/api/stop'};
  let calls = 0;
  const fail = () => { calls++; throw new Error('cannot stop'); };
  await assert.rejects(coordinator.execute(operation, fail), /cannot stop/);
  await assert.rejects(coordinator.execute(operation, fail), /cannot stop/);
  assert.equal(calls, 1);
  assert.equal(await coordinator.execute({...operation, requestId: randomUUID()}, () => 'ok'), 'ok');
});

test('cache has a bounded size and expiry, but never evicts pending operations', async () => {
  let time = 0;
  const coordinator = new OperationCoordinator({now: () => time, ttlMs: 100, maxEntries: 1});
  const first = {callerId: 'mobile', requestId: randomUUID(), route: '/api/start'};
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const waiting = coordinator.execute(first, () => gate);
  const second = {...first, requestId: randomUUID()};
  await assert.rejects(coordinator.execute(second, () => 'second'), error => error.statusCode === 503);
  release('first');
  assert.equal(await waiting, 'first');
  assert.equal(await coordinator.execute(second, () => 'second'), 'second');
  time = 101;
  assert.equal(await coordinator.execute(second, () => 'fresh'), 'fresh');
  await assert.rejects(coordinator.execute({...first, requestId: 'bad'}, () => 'no'), error => error.code === 'invalid_request_id');
});

test('retry identity is scoped to the caller and oversized requests cannot occupy the queue', async () => {
  const coordinator = new OperationCoordinator({maxPayloadBytes: 32});
  const operation = {callerId: 'phone-one', requestId: randomUUID(), route: '/api/start'};
  let calls = 0;
  assert.equal(await coordinator.execute(operation, () => ++calls), 1);
  assert.equal(await coordinator.execute({...operation, callerId: 'phone-two'}, () => ++calls), 2);
  await assert.rejects(coordinator.execute({...operation, requestId: randomUUID(), payload: {goal: 'x'.repeat(100)}}, () => ++calls), error => error.statusCode === 413);
  assert.equal(calls, 2);
  assert.throws(() => new OperationCoordinator({maxEntries: 0.5}), TypeError);
  assert.throws(() => new DeviceAccess({maxDevices: 0.5}), TypeError);
});
