import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Resolved relative to this script so the check runs on any machine.
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const B=path.join(ROOT,'src','routes')+path.sep;
const MOUNT={'authRoutes.js':'/api/auth','adminRoutes.js':'/api/admin','applicationRoutes.js':'/api'};
const found=[];
for (const [file,mount] of Object.entries(MOUNT)) {
  const src=fs.readFileSync(B+file,'utf8');
  for (const m of src.matchAll(/router\.(get|post|patch|delete|put)\(\s*'([^']+)'/g)) {
    found.push(`${m[1].toUpperCase()} ${mount}${m[2]==='/'?'':m[2]}`);
  }
}
const PUBLIC=['POST /api/auth/register','POST /api/auth/login'];
const prot=found.filter(r=>!PUBLIC.includes(r));
const t=fs.readFileSync(path.join(ROOT,'tests','authorisation.test.js'),'utf8');

// collect the paths declared in the test table
const tableRoutes=[...t.matchAll(/method:\s*'(\w+)',\s*path:\s*'([^']+)'/g)]
  .map(m=>`${m[1].toUpperCase()} ${m[2]}`);

const norm=s=>s.replace(/\/(\d+|:\w+)(?=\/|$)/g,'/:p');
const covered=new Set(tableRoutes.map(norm));

console.log(`Routes defined: ${found.length} (public ${PUBLIC.length}, protected ${prot.length})`);
console.log(`Routes in authorisation table: ${tableRoutes.length}\n`);
const missing=prot.filter(r=>!covered.has(norm(r)));
if(missing.length){console.log('NOT COVERED:');missing.forEach(r=>console.log('  '+r));}
else console.log('Every protected route appears in the authorisation table.');
if(missing.length) process.exit(1);
