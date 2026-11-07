import {createHash, randomBytes, randomUUID} from 'node:crypto';

export const SESSION_COOKIE = 'agent_desk_device';
const TOKEN_PATTERN = /^[a-f0-9]{64}$/i;
const REQUEST_ID_PATTERN = /^(?:[a-f0-9]{32,64}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;
const hash = value => createHash('sha256').update(value).digest('hex');

export class DeviceAccessError extends Error {
  constructor(message, statusCode = 400, code = 'invalid_request') {
    super(message);
    this.name = 'DeviceAccessError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function parseCookies(header = '') {
  const cookies = Object.create(null);
  for (const part of String(header).split(';')) {
    const equals = part.indexOf('=');
    if (equals < 1) continue;
    const key = part.slice(0, equals).trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(key) || Object.hasOwn(cookies, key)) continue;
    try { cookies[key] = decodeURIComponent(part.slice(equals + 1).trim()); } catch {}
  }
  return cookies;
}

function publicDevice(device) {
  return {
    id: device.id,
    name: device.name,
    status: device.status,
    createdAt: device.createdAt,
    expiresAt: device.expiresAt,
    approvedAt: device.approvedAt,
  };
}

/** Ephemeral LAN access. No official login credentials or pairing secrets are persisted. */
export class DeviceAccess {
  #enabled = false;
  #pairings = new Map();
  #sessions = new Map();
  #devices = new Map();

  constructor({now = Date.now, pairingTtlMs = 2 * 60_000, sessionTtlMs = 8 * 60 * 60_000, maxDevices = 25, maxPending = 10} = {}) {
    if (typeof now !== 'function' || ![pairingTtlMs, sessionTtlMs, maxDevices, maxPending].every(value => Number.isFinite(value) && value > 0)
      || !Number.isInteger(maxDevices) || !Number.isInteger(maxPending)) {
      throw new TypeError('Invalid device access configuration');
    }
    this.now = now;
    this.pairingTtlMs = pairingTtlMs;
    this.sessionTtlMs = sessionTtlMs;
    this.maxDevices = maxDevices;
    this.maxPending = maxPending;
  }

  get enabled() { return this.#enabled; }

  enable() {
    this.#enabled = true;
    return {enabled: true};
  }

  disable() {
    this.#enabled = false;
    this.#pairings.clear();
    this.#sessions.clear();
    this.#devices.clear();
    return {enabled: false};
  }

  #requireEnabled() {
    if (!this.#enabled) throw new DeviceAccessError('手机连接尚未开启', 403, 'device_access_disabled');
  }

  #prune() {
    const now = this.now();
    for (const [key, pairing] of this.#pairings) {
      if (pairing.expiresAt <= now) this.#pairings.delete(key);
    }
    for (const [id, device] of this.#devices) {
      if (device.expiresAt <= now) {
        this.#sessions.delete(device.sessionHash);
        this.#devices.delete(id);
      }
    }
  }

  createPairing() {
    this.#requireEnabled();
    this.#prune();
    // Only the newest desktop-generated invitation remains valid.
    this.#pairings.clear();
    const token = randomBytes(32).toString('hex');
    const expiresAt = this.now() + this.pairingTtlMs;
    this.#pairings.set(hash(token), {expiresAt});
    return {token, expiresAt};
  }

  claim(token, name = '手机') {
    this.#requireEnabled();
    if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) throw new DeviceAccessError('配对链接无效或已使用', 403, 'invalid_pairing');
    const tokenHash = hash(token);
    const pairing = this.#pairings.get(tokenHash);
    if (!pairing) throw new DeviceAccessError('配对链接无效或已使用', 403, 'invalid_pairing');
    if (pairing.expiresAt <= this.now()) {
      this.#pairings.delete(tokenHash);
      throw new DeviceAccessError('配对链接已过期，请重新生成', 410, 'pairing_expired');
    }
    this.#prune();
    const active = [...this.#devices.values()].filter(device => device.status !== 'revoked');
    if (active.length >= this.maxDevices || active.filter(device => device.status === 'pending').length >= this.maxPending) {
      throw new DeviceAccessError('连接设备数量已达到上限', 429, 'device_limit');
    }
    if (typeof name !== 'string') throw new DeviceAccessError('请输入设备名称');
    const safeName = name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 64) || '手机';
    const sessionToken = randomBytes(32).toString('hex');
    const device = {
      id: randomUUID(), name: safeName, status: 'pending',
      createdAt: this.now(), expiresAt: this.now() + this.sessionTtlMs,
      approvedAt: null, sessionHash: hash(sessionToken),
    };
    // A valid invitation is consumed atomically before any async response handling.
    this.#pairings.delete(tokenHash);
    this.#devices.set(device.id, device);
    this.#sessions.set(device.sessionHash, device.id);
    // Keep a bounded revoked-device history for the desktop display.
    if (this.#devices.size > this.maxDevices * 2) {
      for (const [id, old] of this.#devices) {
        if (old.status === 'revoked') this.#devices.delete(id);
        if (this.#devices.size <= this.maxDevices * 2) break;
      }
    }
    return {sessionToken, device: publicDevice(device)};
  }

  approve(id) {
    this.#requireEnabled();
    this.#prune();
    const device = this.#devices.get(id);
    if (!device) throw new DeviceAccessError('设备不存在或连接已过期', 404, 'device_not_found');
    if (device.status === 'revoked') throw new DeviceAccessError('该设备已取消授权，请重新配对', 409, 'device_revoked');
    if (device.status === 'pending') {
      device.status = 'approved';
      device.approvedAt = this.now();
    }
    return publicDevice(device);
  }

  revoke(id) {
    this.#requireEnabled();
    this.#prune();
    const device = this.#devices.get(id);
    if (!device) throw new DeviceAccessError('设备不存在或连接已过期', 404, 'device_not_found');
    device.status = 'revoked';
    this.#sessions.delete(device.sessionHash);
    return publicDevice(device);
  }

  lookupSession(token) {
    if (!this.#enabled || typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return null;
    this.#prune();
    const id = this.#sessions.get(hash(token));
    const device = this.#devices.get(id);
    return device && device.status !== 'revoked' ? publicDevice(device) : null;
  }

  list() {
    this.#prune();
    return [...this.#devices.values()].map(publicDevice);
  }
}

function canonicalPayload(value, seen = new Set(), depth = 0) {
  if (depth > 32) throw new DeviceAccessError('操作参数层级过多');
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== 'object' || seen.has(value)) throw new DeviceAccessError('操作参数必须是有效 JSON');
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new DeviceAccessError('操作参数必须是有效 JSON');
  }
  seen.add(value);
  const result = Array.isArray(value)
    ? '[' + value.map(item => canonicalPayload(item, seen, depth + 1)).join(',') + ']'
    : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalPayload(value[key], seen, depth + 1)).join(',') + '}';
  seen.delete(value);
  return result;
}

/** Serializes mutations across devices and coalesces retry requests before invoking handlers. */
export class OperationCoordinator {
  #entries = new Map();
  #tail = Promise.resolve();

  constructor({now = Date.now, ttlMs = 10 * 60_000, maxEntries = 256, maxPayloadBytes = 1024 * 1024} = {}) {
    if (typeof now !== 'function' || ![ttlMs, maxEntries, maxPayloadBytes].every(value => Number.isFinite(value) && value > 0)
      || !Number.isInteger(maxEntries)) {
      throw new TypeError('Invalid operation coordinator configuration');
    }
    this.now = now;
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.maxPayloadBytes = maxPayloadBytes;
  }

  async execute({callerId, requestId, route, payload = null}, action) {
    if (typeof callerId !== 'string' || !callerId || callerId.length > 128 || /[\u0000-\u001f\u007f]/.test(callerId)) {
      throw new DeviceAccessError('操作来源无效');
    }
    if (typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId)) {
      throw new DeviceAccessError('操作编号无效，请刷新页面后重试', 400, 'invalid_request_id');
    }
    if (typeof route !== 'string' || !route || route.length > 256 || /[\u0000-\u001f\u007f]/.test(route) || typeof action !== 'function') {
      throw new DeviceAccessError('操作路径无效');
    }
    const serialized = canonicalPayload(payload);
    if (Buffer.byteLength(serialized) > this.maxPayloadBytes) throw new DeviceAccessError('操作参数过大', 413, 'payload_too_large');
    const key = hash(callerId + '\0' + requestId.toLowerCase());
    const fingerprint = hash(route + '\0' + serialized);
    const now = this.now();
    for (const [entryKey, entry] of this.#entries) {
      if (entry.settled && entry.expiresAt <= now) this.#entries.delete(entryKey);
    }
    const prior = this.#entries.get(key);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new DeviceAccessError('同一操作编号对应了不同指令，请重试', 409, 'request_conflict');
      return prior.promise;
    }
    if (this.#entries.size >= this.maxEntries) {
      // Never evict a pending operation: its retries must still coalesce.
      for (const [entryKey, entry] of this.#entries) {
        if (entry.settled) { this.#entries.delete(entryKey); break; }
      }
      if (this.#entries.size >= this.maxEntries) throw new DeviceAccessError('操作队列繁忙，请稍后重试', 503, 'operation_queue_full');
    }
    const entry = {fingerprint, settled: false, expiresAt: Infinity, promise: null};
    // Reserve synchronously, before action execution or the first await.
    this.#entries.set(key, entry);
    entry.promise = this.#tail.then(() => action()).finally(() => {
      entry.settled = true;
      entry.expiresAt = this.now() + this.ttlMs;
    });
    this.#tail = entry.promise.then(() => undefined, () => undefined);
    return entry.promise;
  }
}
