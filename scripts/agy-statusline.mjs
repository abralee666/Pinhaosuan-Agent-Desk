import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {statuslineIdentity} from '../lib/antigravity-statusline.mjs';
const target=process.argv[2]||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../data/user/agy-identity.json');
let input='';for await(const data of process.stdin){input+=data;if(input.length>256*1024)process.exit(0);}
try{const identity=statuslineIdentity(JSON.parse(input));if(identity){fs.mkdirSync(path.dirname(target),{recursive:true});const temporary=target+'.'+process.pid+'.tmp';fs.writeFileSync(temporary,JSON.stringify(identity),{mode:0o600});fs.renameSync(temporary,target);process.stdout.write('Agent Desk: account synced');}}catch{}
