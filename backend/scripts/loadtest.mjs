/**
 * Read-performance and concurrency measurement for the Evaluation section.
 *
 * Measures read latency on an empty register, seeds 500 applications,
 * re-measures, then issues 25 simultaneous reads and 25 simultaneous writes.
 *
 * Authenticates ONCE per role and reuses the token: repeated logins trip the
 * rate limiter, after which every request is refused with 401 and the
 * measurement silently times refusals instead of reads (see DEF-003).
 * Each sampled request asserts a success status so that a failed request
 * aborts the run rather than being reported as a fast one.
 *
 *   node scripts/loadtest.mjs        (with the API server running)
 */
const API='http://localhost:4000';
const H=t=>({Authorization:`Bearer ${t}`});
const J=t=>({...H(t),'Content-Type':'application/json'});

// Log in ONCE per role and reuse — repeated logins trip the rate limiter.
const lg=async(e,p)=>{const r=await fetch(`${API}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:e,password:p})});
  if(r.status!==200) throw new Error('login '+r.status); return (await r.json()).token;};
const applicant=await lg('applicant@rpl.local','Applicant#2026');
const admin=await lg('admin@rpl.local','Admin#2026');

const count=async()=>{const r=await fetch(`${API}/api/statistics`,{headers:H(admin)});
  if(r.status!==200) throw new Error('statistics '+r.status); return (await r.json()).total;};

const med=async(label,fn,n=40)=>{const t=[];for(let i=0;i<n;i++){const a=performance.now();const ok=await fn();t.push(performance.now()-a);
    if(ok===false) throw new Error('request failed during: '+label);}
  t.sort((x,y)=>x-y);
  console.log(`${label.padEnd(40)} median ${t[Math.floor(n*0.5)].toFixed(1).padStart(6)} ms   p95 ${t[Math.floor(n*0.95)].toFixed(1).padStart(6)} ms`);};

const read=(url,tok)=>async()=>{const r=await fetch(API+url,{headers:H(tok)});return r.status===200;};

console.log('Baseline register size:',await count());
await med('Read: full register',read('/api/applications',admin));
await med('Read: triage queue',read('/api/applications/queue',admin));
await med('Read: own applications',read('/api/applications/mine',applicant));

process.stdout.write('\nSeeding 500 applications... ');
for(let i=0;i<500;i++){
  const r=await fetch(`${API}/api/applications`,{method:'POST',headers:J(applicant),body:JSON.stringify({qualificationId:(i%5)+1,motivation:'Load record '+i})});
  if(r.status!==201){console.log('\nseed failed at',i,'status',r.status);break;}
}
console.log('register now holds',await count(),'applications\n');

await med('Read: full register',read('/api/applications',admin));
await med('Read: triage queue',read('/api/applications/queue',admin));
await med('Read: own applications',read('/api/applications/mine',applicant));

const t0=performance.now();
const reads=await Promise.all(Array.from({length:25},()=>fetch(`${API}/api/applications/mine`,{headers:H(applicant)})));
console.log(`\n25 concurrent reads : ${(performance.now()-t0).toFixed(0)} ms total, all ${reads.every(r=>r.status===200)?'200 OK':'NOT OK'}`);

const t1=performance.now();
const writes=await Promise.all(Array.from({length:25},(_,i)=>fetch(`${API}/api/applications`,{method:'POST',headers:J(applicant),body:JSON.stringify({qualificationId:1,motivation:'concurrent '+i})})));
console.log(`25 concurrent writes: ${(performance.now()-t1).toFixed(0)} ms total, all ${writes.every(r=>r.status===201)?'201 Created':'NOT OK'} (SQLite serialises writes)`);
console.log('\nFinal register size:',await count());
