import {test} from 'node:test';
import assert from 'node:assert/strict';
import {proxyEnvironment} from '../lib/agent-env.mjs';
test('CLI inherits enabled Windows HTTP proxy without changing global environment',()=>{
  const source={CUSTOM:'keep'};const next=proxyEnvironment(source,'127.0.0.1:7892');
  assert.equal(next.HTTPS_PROXY,'http://127.0.0.1:7892/');assert.equal(next.HTTP_PROXY,next.HTTPS_PROXY);assert.equal(source.HTTPS_PROXY,undefined);assert.ok(next.NO_PROXY.includes('127.0.0.1'));
});
test('explicit proxy configuration and bypass rules are preserved',()=>{
  const source={HTTPS_PROXY:'http://user-choice:8888',NO_PROXY:'internal'};assert.deepEqual(proxyEnvironment(source,'127.0.0.1:7892'),source);
});
test('HTTPS mapping wins over HTTP and SOCKS-only or credential-bearing entries are ignored',()=>{
  assert.equal(proxyEnvironment({},'http=127.0.0.1:1;https=127.0.0.1:2').HTTPS_PROXY,'http://127.0.0.1:2/');
  assert.equal(proxyEnvironment({},'socks=127.0.0.1:1').HTTPS_PROXY,undefined);
  assert.equal(proxyEnvironment({},'http://user:secret@host:1').HTTPS_PROXY,undefined);
});
