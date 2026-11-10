# RPL Application and Assessment Management System

A web application for administering Recognition of Prior Learning: candidates
submit applications with portfolios of evidence, assessors record structured
judgements, and the registrar ratifies outcomes — with every status change
written to an immutable audit trail.

Built to the architecture set out in the Design Phase submission: a layered
three-tier design, a guarded state machine, and server-side role enforcement.

---

## Running it

Two terminals, from the repository root.

Requires **Node.js 22.5 or newer** (`node --version`). There are no native
dependencies — nothing compiles, so no Python or C++ toolchain is needed.

```bash
# Terminal 1 — API on http://localhost:4000
cd backend
npm install
npm start          # creates and seeds the database on first run

# Terminal 2 — client on http://localhost:5173
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>.

### The administrator (one only)

There is exactly one administrator, and it is set on the server, never from
the app. Add these to `backend/.env`:

```
ADMIN_EMAIL=you@cput.ac.za
ADMIN_PASSWORD=ChooseAStrong#Password1
ADMIN_FIRST_NAME=Zola
ADMIN_SURNAME=Matebese
```

then run:

```bash
cd backend
npm run seed:admin
```

This creates (or updates) that account as the administrator and deactivates
any other administrator, such as the old `admin@rpl.local` demo account. The
database also enforces the rule: a unique index allows only one active
ADMINISTRATOR. Lost the password? Change `ADMIN_PASSWORD` and run
`npm run seed:admin` again.

### What the administrator can do (People screen)

| Action | Notes |
| --- | --- |
| Read | Every account, its role, status and qualification scope |
| Create | Assessor or moderator accounts with a temporary password |
| Update | Role (Applicant / Assessor / Moderator), name, qualification scope, password reset |
| Deactivate / reactivate | Blocks sign-in immediately; keeps the record intact |
| Delete | Only for an account never used on an application; otherwise deactivate |

The administrator role itself can never be granted, changed or deleted from
the app. Every account change is written to **Account activity**
(`user_audit_log`), which is insert-only.

**Qualification scope.** An assessor can only be allocated applications for
qualifications ticked against their name, and a moderator only sees assessed
applications for theirs.

**Moderators** review assessed applications in their scope, download the
evidence, and record *Assessment confirmed* or *Concerns*. The verdict is shown
to the registrar and the assessor (not the applicant) and noted in the file's
history. It does not change the application's status.

### Qualifications

The qualification list is CPUT's undergraduate RPL list (Step 8 of
<https://www.cput.ac.za/study-at-cput/undergraduate/rpl>), kept in
`backend/src/db/cputQualifications.js`: 32 qualifications across four
faculties, each with its RPL type. Only the 20 marked *access only* or
*access and/or exemptions* are offered to applicants; those marked not
available, or left blank on the CPUT page, are stored but inactive.

An applicant chooses the RPL route (access, exemption, or both). An *access
only* qualification accepts access only, and the server enforces this.

NQF levels are filled only where the title names the qualification type
(Diploma 6, Advanced Diploma 7). CPUT does not publish SAQA IDs or the other
levels on that page, so they are left empty. To change the list, edit the
file and restart the server (or run `npm run seed`); rows are updated by title.

### Demonstration accounts

Seeded automatically outside production (`SEED_DEMO_USERS=false` turns them
off). Synthetic data only. There is no demo administrator.

| Role          | Email                  | Password          |
| ------------- | ---------------------- | ----------------- |
| Applicant     | `applicant@rpl.local`  | `Applicant#2026`  |
| Assessor      | `assessor@rpl.local`   | `Assessor#2026`   |
| Assessor      | `assessor2@rpl.local`  | `Assessor#2026`   |
| Moderator     | `moderator@rpl.local`  | `Moderator#2026`  |

To see the whole lifecycle: submit as the applicant; allocate as the
administrator; assess as the assessor; moderate as the moderator; ratify as the
administrator.

---

## Architecture

```
React SPA  ──HTTPS/JSON + Bearer token──▶  Express API
                                              │
                           parse → authenticate → authorise → validate
                                              │
                                      Route handlers
                                              │
                                     Service layer  ← owns all business rules
                                              │
                                    Repository layer  ← the only code issuing SQL
                                              │
                            node:sqlite  +  evidence file store
                                            (outside the web root)
```

The single permitted direction of dependency is downward. No service calls
another service's repository; no route handler issues SQL.

### Layout

```
backend/
  src/
    config/          environment and limits
    db/              schema.sql, connection, seed
    repositories/    all SQL, parameterised only
    services/        business rules, including the state machine
    middleware/      auth chain, upload handling, error mapping
    routes/          HTTP surface
  tests/             97 tests (authorisation, state machine, evidence, auth)
  scripts/           smoke.sh / smoke.ps1, check-route-coverage.mjs,
                     benchmark.mjs, loadtest.mjs
frontend/
  src/
    api/             fetch client; token held in memory only
    components/      layout, audit ledger, assessment form, UI primitives
    pages/           sign-in, applicant, assessor, administrator workspaces
```

---

## The state machine

The organising abstraction. An application is never edited freely — it moves
through defined states, and each transition is guarded by a role condition and
a precondition.

```
                    ┌──────────────── Administrator: return ─────────────┐
                    ▼                                                    │
  [*] ──▶ DRAFT ──Applicant: submit──▶ SUBMITTED ──Admin: allocate──▶ UNDER_REVIEW
            ▲      [≥1 evidence item                [assessor         │  [all criteria
            │       AND motivation]                  allocated]       │   rated]
            │                                                         ▼
            └────────── Administrator: return ──────── ASSESSMENT_COMPLETE
                                                                      │
                                                 Administrator: ratify [rationale]
                                                            ┌─────────┴─────────┐
                                                            ▼                   ▼
                                                        APPROVED            REJECTED
```

Two properties matter:

1. **The transition table is data, not branching code**
   (`src/services/stateMachine.js`). A change to institutional RPL policy is a
   change to that table rather than to control flow.

2. **Status change and audit record commit together.** Both happen inside one
   SQLite transaction, so the invariant *no state change exists without its
   audit row* cannot be violated even under partial failure.

The absence of an arc is as meaningful as its presence: there is no
`SUBMITTED → APPROVED` transition, which encodes the rule that no application
is approved without a recorded assessment.

---

## Security posture

- **Authorisation runs ahead of business logic.** Role checks are middleware
  positioned before every protected handler, so an unauthorised request
  terminates before any database access.
- **The role is read from the database, not the token claim.** A role change
  takes effect on the next request rather than at token expiry.
- **Passwords** are bcrypt hashes at work factor 12. Login failure responses
  are uniform for unknown-email and wrong-password, and a dummy comparison
  runs when the account is absent so timing does not leak existence either.
- **Role is never accepted from the registration payload.** New accounts are
  always applicants; elevation is an administrator action.
- **Evidence files** are renamed to a UUID, stored outside the web root, and
  streamed only through an authorised endpoint. The MIME allow-list is
  enforced in the service, not only in the upload filter, and a rejected file
  leaves nothing on disk.
- **All SQL is parameterised** and confined to the repository layer.
- **Rate limiting** on the authentication endpoints.

### Known gaps before production

Documented rather than concealed:

- **No token revocation.** A JWT stays valid until expiry. Reading the role
  from the database narrows the impact, but a stolen token works until it
  expires. Short-lived access tokens with refresh are the fix.
- **No anti-virus scanning** on uploaded evidence. The type allow-list is not
  a substitute. This must be added before real candidate data is accepted.
- **SQLite serialises writes.** Fine for this workload, which is strongly
  read-dominated, but it is the first scaling ceiling. All SQL is confined to
  the repository layer and no SQLite-specific syntax is used, so moving to
  PostgreSQL is a contained change.
- **`node:sqlite` is marked experimental.** It ships with Node and needs no
  compiler, which is why it was chosen over `better-sqlite3`, but its API may
  change between Node majors. Only `src/db/index.js` constructs the driver, so
  swapping it is contained.
- **No email notification** on status transition, so parties are not yet told
  when action is required of them.
- **HTTPS is assumed to terminate at a reverse proxy.** The app does not
  terminate TLS itself.

---

## Tests

```bash
cd backend
npm test              # route-coverage check, then 97 tests
npm run test:routes   # coverage check alone
bash scripts/smoke.sh      # end-to-end lifecycle (macOS/Linux/Git Bash)
.\scripts\smoke.ps1        # the same run on Windows PowerShell
node scripts/benchmark.mjs # response times, server running
node scripts/loadtest.mjs  # scaling and concurrency, server running
```

`scripts/check-route-coverage.mjs` parses the route definitions and asserts
that every protected endpoint appears in the authorisation test table. Adding
an endpoint without a corresponding test fails the check — this is what makes
"full authorisation coverage" a verified claim rather than an assertion.

The suite covers:

- every protected route refused without a token (401)
- every protected route refused for each role outside its allow-list (403)
- forged and malformed tokens
- record-level refusals: unallocated assessor, non-owner, cross-applicant access
- state machine guards: submission without evidence, approval without
  assessment, allocation to a non-assessor, incomplete criteria, terminal states
- the audit invariant: every transition recorded, refused transitions leaving
  no trace, correct actor attribution
- evidence: type rejection, disguised executables, no orphaned files
- authentication: no account enumeration, no self-elevation, no password hash
  in any response

---

## Configuration

Backend reads from `backend/.env` (all optional in development):

| Variable         | Default                      | Notes                                    |
| ---------------- | ---------------------------- | ---------------------------------------- |
| `PORT`           | `4000`                       |                                          |
| `JWT_SECRET`     | insecure development default | **Required in production** — refuses to start without it |
| `JWT_EXPIRES_IN` | `2h`                         |                                          |
| `BCRYPT_ROUNDS`  | `12`                         |                                          |
| `DB_PATH`        | `backend/data/rpl.db`        |                                          |
| `UPLOAD_DIR`     | `backend/uploads`            | Must stay outside any served directory   |
| `CORS_ORIGIN`    | `http://localhost:5173`      |                                          |
| `SEED_ON_START`  | `true`                       | Set `false` to skip seeding              |

---

## API

All routes require `Authorization: Bearer <token>` except registration and login.

| Method | Endpoint | Role |
| ------ | -------- | ---- |
| POST   | `/api/auth/register` | public |
| POST   | `/api/auth/login` | public |
| GET    | `/api/auth/me` | any |
| GET    | `/api/qualifications` | any |
| GET    | `/api/assessment-criteria` | any |
| POST   | `/api/applications` | applicant |
| GET    | `/api/applications/mine` | applicant |
| PATCH  | `/api/applications/:id` | applicant (owner, draft only) |
| POST   | `/api/applications/:id/submit` | applicant (owner) |
| POST   | `/api/applications/:id/evidence` | applicant (owner, draft only) |
| DELETE | `/api/evidence/:id` | applicant (owner, draft only) |
| GET    | `/api/evidence/:id/download` | owner, allocated assessor, admin |
| GET    | `/api/applications/allocated` | assessor |
| POST   | `/api/applications/:id/assessment` | assessor (allocated) |
| GET    | `/api/applications/queue` | administrator |
| GET    | `/api/applications` | administrator |
| POST   | `/api/applications/:id/allocate` | administrator |
| POST   | `/api/applications/:id/return` | administrator |
| POST   | `/api/applications/:id/outcome` | administrator |
| GET    | `/api/statistics` | administrator |
| GET    | `/api/admin/assessors` | administrator |
| GET    | `/api/admin/users` | administrator |
| PATCH  | `/api/admin/users/:id/role` | administrator |
| GET    | `/api/applications/:id` | owner, allocated assessor, admin |
| GET    | `/api/applications/:id/audit` | owner, admin |

Error codes are part of the contract: **403** authorisation failure, **409**
illegal transition from the current state, **422** a guard condition failed,
**415** disallowed file type, **413** file too large.
