/**
 * Response-time measurement for the Evaluation section.
 * Measures server-side latency for representative operations against a
 * running API. Reports median and 95th percentile over N samples.
 *
 *   node scripts/benchmark.mjs
 */
const API = process.env.API || 'http://localhost:4000';
const N = Number(process.env.SAMPLES) || 50;

async function login(email, password) {
  const r = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return (await r.json()).token;
}

function stats(times) {
  const s = [...times].sort((a, b) => a - b);
  const p = (q) => s[Math.min(s.length - 1, Math.floor(s.length * q))];
  return {
    median: p(0.5).toFixed(1),
    p95: p(0.95).toFixed(1),
    min: s[0].toFixed(1),
    max: s[s.length - 1].toFixed(1),
  };
}

async function time(label, fn, n = N) {
  const times = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    await fn(i);
    times.push(performance.now() - t0);
  }
  const st = stats(times);
  console.log(
    `${label.padEnd(42)} median ${st.median.padStart(7)} ms   p95 ${st.p95.padStart(7)} ms   (n=${n})`
  );
  return st;
}

const applicant = await login('applicant@rpl.local', 'Applicant#2026');
const admin = await login('admin@rpl.local', 'Admin#2026');
const assessor = await login('assessor@rpl.local', 'Assessor#2026');
const H = (t) => ({ Authorization: `Bearer ${t}` });

console.log(`\nRPL API response times — ${N} samples per operation\n`);

await time('Authentication (bcrypt verify + JWT issue)', async () => {
  await login('applicant@rpl.local', 'Applicant#2026');
}, 20);

await time('Read: list own applications', async () => {
  await fetch(`${API}/api/applications/mine`, { headers: H(applicant) });
});

await time('Read: qualifications reference list', async () => {
  await fetch(`${API}/api/qualifications`, { headers: H(applicant) });
});

await time('Read: administrator triage queue', async () => {
  await fetch(`${API}/api/applications/queue`, { headers: H(admin) });
});

await time('Read: full register (all applications)', async () => {
  await fetch(`${API}/api/applications`, { headers: H(admin) });
});

await time('Write: create draft application', async () => {
  await fetch(`${API}/api/applications`, {
    method: 'POST',
    headers: { ...H(applicant), 'Content-Type': 'application/json' },
    body: JSON.stringify({ qualificationId: 1, motivation: 'Benchmark sample.' }),
  });
});

await time('Refusal: unauthorised cross-role request', async () => {
  await fetch(`${API}/api/applications/queue`, { headers: H(applicant) });
});

await time('Refusal: no token (terminates in middleware)', async () => {
  await fetch(`${API}/api/applications/mine`);
});

// Guarded transition with atomic audit write — the operation the design
// treats as most critical.
const created = await (await fetch(`${API}/api/applications`, {
  method: 'POST',
  headers: { ...H(applicant), 'Content-Type': 'application/json' },
  body: JSON.stringify({ qualificationId: 1, motivation: 'Transition benchmark.' }),
})).json();

const pdf = new Blob(['%PDF-1.4\ntrailer<</Root 1 0 R>>'], { type: 'application/pdf' });
const fd = new FormData();
fd.append('file', pdf, 'bench.pdf');
await fetch(`${API}/api/applications/${created.application.id}/evidence`, {
  method: 'POST', headers: H(applicant), body: fd,
});

await time('Guarded transition + atomic audit write', async () => {
  const c = await (await fetch(`${API}/api/applications`, {
    method: 'POST',
    headers: { ...H(applicant), 'Content-Type': 'application/json' },
    body: JSON.stringify({ qualificationId: 1, motivation: 'Transition benchmark.' }),
  })).json();
  const f = new FormData();
  f.append('file', new Blob(['%PDF-1.4\ntrailer<</Root 1 0 R>>'], { type: 'application/pdf' }), 'b.pdf');
  await fetch(`${API}/api/applications/${c.application.id}/evidence`, {
    method: 'POST', headers: H(applicant), body: f,
  });
  const t0 = performance.now();
  await fetch(`${API}/api/applications/${c.application.id}/submit`, {
    method: 'POST', headers: H(applicant),
  });
  return performance.now() - t0;
}, 20);

await time('Evidence upload (validate, rename, store)', async () => {
  const c = await (await fetch(`${API}/api/applications`, {
    method: 'POST',
    headers: { ...H(applicant), 'Content-Type': 'application/json' },
    body: JSON.stringify({ qualificationId: 1, motivation: 'Upload benchmark.' }),
  })).json();
  const f = new FormData();
  f.append('file', new Blob([Buffer.alloc(512 * 1024, 'a')], { type: 'application/pdf' }), 'big.pdf');
  await fetch(`${API}/api/applications/${c.application.id}/evidence`, {
    method: 'POST', headers: H(applicant), body: f,
  });
}, 15);

await time('Read: audit trail for one application', async () => {
  await fetch(`${API}/api/applications/${created.application.id}/audit`, { headers: H(admin) });
});

const stat = await (await fetch(`${API}/api/statistics`, { headers: H(admin) })).json();
console.log(`\nDataset at time of measurement: ${stat.total} applications on the register.`);
console.log(`By status: ${JSON.stringify(stat.byStatus)}\n`);
