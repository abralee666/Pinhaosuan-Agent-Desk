import {test} from 'node:test';
import assert from 'node:assert/strict';
import {lanAddresses} from '../lib/companion-server.mjs';

test('phone invitations prefer Wi-Fi over virtual adapters and exclude public or loopback addresses', () => {
  const ip = (address, internal = false) => ({address, family:'IPv4', internal});
  assert.deepEqual(lanAddresses({
    'VMware VMnet8':[ip('192.168.201.1')], 'cfw-tap':[ip('10.0.0.1')],
    Ethernet:[ip('192.168.0.12')], 'WLAN 2':[ip('10.128.33.125')],
    Loopback:[ip('127.0.0.1',true)], Internet:[ip('2.0.0.1')],
    LinkLocal:[ip('169.254.1.1')], IPv6:[{address:'::1',family:'IPv6',internal:true}],
  }), ['10.128.33.125','192.168.0.12','192.168.201.1','10.0.0.1']);
});
