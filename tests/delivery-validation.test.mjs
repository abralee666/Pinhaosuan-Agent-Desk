import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {deliverySnapshot,expectedDeliveryFiles,validateDelivery} from '../lib/delivery-validation.mjs';

function workspace(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'desk-delivery-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
test('empty SUCCESS cannot verify a text task, while actual text can',()=>{
  assert.equal(validateDelivery({response:' \n'}).verified,false);
  assert.equal(validateDelivery({response:'AG-207'}).verified,true);
});
test('file task fails even with a completion claim when files are missing, empty, directories or unchanged',t=>{
  const root=workspace(t),names=['README.md','DEPLOYMENT.md'];
  const check=before=>validateDelivery({workspace:root,expectedFiles:names,before,response:'All done'});
  assert.equal(check([]).verified,false);
  fs.writeFileSync(path.join(root,names[0]),'');fs.mkdirSync(path.join(root,names[1]));
  assert.deepEqual(check([]).files.map(f=>f.state),['empty','not_file']);
  fs.rmdirSync(path.join(root,names[1]));for(const n of names)fs.writeFileSync(path.join(root,n),'old');
  const before=deliverySnapshot(root,names);assert.deepEqual(check(before).files.map(f=>f.state),['unchanged','unchanged']);
  fs.writeFileSync(path.join(root,names[0]),'new');assert.equal(check(before).verified,false);
  fs.writeFileSync(path.join(root,names[1]),'new');assert.equal(check(before).verified,true);
});
test('silent but real new files pass with bytes and hashes as evidence',t=>{
  const root=workspace(t),expectedFiles=['README.md'],before=deliverySnapshot(root,expectedFiles);
  fs.writeFileSync(path.join(root,'README.md'),'# Documentation');
  const result=validateDelivery({workspace:root,expectedFiles,before,response:''});assert.equal(result.verified,true);assert.equal(result.files[0].state,'created');assert.equal(result.files[0].sha256.length,64);
});
test('delivery paths reject traversal, drives, absolute paths and linked parents',t=>{
  for(const name of ['../secret','C:/secret','/secret','docs/../../secret','docs\\..\\secret','docs//file'])assert.throws(()=>expectedDeliveryFiles([name]));
  const root=workspace(t),outside=workspace(t);fs.symlinkSync(outside,path.join(root,'linked'),process.platform==='win32'?'junction':'dir');
  assert.throws(()=>deliverySnapshot(root,['linked/file.md']),/符号链接/);
});
