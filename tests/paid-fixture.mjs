import fs from 'node:fs';
import path from 'node:path';
import {generateKeyPairSync,sign,randomUUID} from 'node:crypto';
import {Store} from '../lib/store.mjs';
export function paidFixture(directory,plan='unlimited',empty=false){
  const keys=generateKeyPairSync('ed25519'),installationId=randomUUID();
  const publicKey=keys.publicKey.export({type:'spki',format:'pem'}),publicKeyFile=path.join(directory,'public.pem');fs.writeFileSync(publicKeyFile,publicKey);
  const payload=Buffer.from(JSON.stringify({version:1,installationId,plan,expiresAt:Date.now()+86400000})).toString('base64url');const license=payload+'.'+sign(null,Buffer.from(payload),keys.privateKey).toString('base64url');
  const store=new Store(directory,{empty});store.state.membership={installationId,license,slots:[]};store.save();return {publicKey,publicKeyFile,license,installationId,keys};
}
