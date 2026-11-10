-- RPL Application and Assessment Management System
-- Normalised relational schema, Third Normal Form.
-- Every non-key attribute depends on the whole primary key and on nothing else.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- USERS — single identity entity for all three roles.
-- Role is a constrained attribute rather than separate tables, which avoids
-- the duplication that role-per-table would introduce.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    email           TEXT    NOT NULL UNIQUE,
    password_hash   TEXT    NOT NULL,
    first_name      TEXT    NOT NULL,
    surname         TEXT    NOT NULL,
    role            TEXT    NOT NULL DEFAULT 'APPLICANT'
                            CHECK (role IN ('APPLICANT','ASSESSOR','MODERATOR','ADMINISTRATOR')),
    -- Accounts are deactivated rather than deleted once they have taken part
    -- in any record, so the audit trail never points at a missing person.
    active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Single-administrator rule, enforced by the database itself: at most one
-- active ADMINISTRATOR row can exist. The API offers no route that grants the
-- role; only the seed:admin script on the server does.
CREATE UNIQUE INDEX IF NOT EXISTS uq_single_active_admin
    ON users(role) WHERE role = 'ADMINISTRATOR' AND active = 1;

-- ---------------------------------------------------------------------------
-- QUALIFICATIONS — held in its own entity rather than repeated as text on each
-- application, removing the transitive dependency that would otherwise arise.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS qualifications (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    saqa_id     TEXT    UNIQUE,
    title       TEXT    NOT NULL,
    nqf_level   INTEGER NOT NULL CHECK (nqf_level BETWEEN 1 AND 10),
    active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);

-- ---------------------------------------------------------------------------
-- APPLICATIONS — the central entity. status is constrained to the six
-- lifecycle states; transitions between them are guarded in the service layer.
-- assigned_assessor_id is nullable because an application is unallocated
-- until administrator triage.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS applications (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    applicant_id            INTEGER NOT NULL REFERENCES users(id),
    qualification_id        INTEGER NOT NULL REFERENCES qualifications(id),
    assigned_assessor_id    INTEGER NULL REFERENCES users(id),
    status                  TEXT    NOT NULL DEFAULT 'DRAFT'
                                    CHECK (status IN ('DRAFT','SUBMITTED','UNDER_REVIEW',
                                                      'ASSESSMENT_COMPLETE','APPROVED','REJECTED')),
    motivation              TEXT    NOT NULL DEFAULT '',
    outcome_rationale       TEXT    NULL,
    created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_applications_applicant ON applications(applicant_id);
CREATE INDEX IF NOT EXISTS idx_applications_assessor  ON applications(assigned_assessor_id);
CREATE INDEX IF NOT EXISTS idx_applications_status    ON applications(status);

-- ---------------------------------------------------------------------------
-- EVIDENCE — identifying relationship to applications. An evidence item
-- cannot exist independently of the application it supports.
-- stored_filename is a generated UUID; the client-supplied name is retained
-- for display only and never used for storage.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS evidence (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id      INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    original_filename   TEXT    NOT NULL,
    stored_filename     TEXT    NOT NULL UNIQUE,
    mime_type           TEXT    NOT NULL
                                CHECK (mime_type IN (
                                    'application/pdf',
                                    'image/jpeg',
                                    'image/png',
                                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                                )),
    size_bytes          INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
    evidence_type       TEXT    NOT NULL DEFAULT 'OTHER',
    description         TEXT    NULL,
    uploaded_by         INTEGER NOT NULL REFERENCES users(id),
    uploaded_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_evidence_application ON evidence(application_id);

-- ---------------------------------------------------------------------------
-- ASSESSMENTS — append-only. A correction is made by a superseding record
-- rather than by overwrite, preserving the evidential trail.
-- criterion_ratings is structured JSON so that a change to the institutional
-- criteria set is configuration rather than schema migration.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assessments (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id      INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    assessor_id         INTEGER NOT NULL REFERENCES users(id),
    criterion_ratings   TEXT    NOT NULL,
    comments            TEXT    NOT NULL,
    recommendation      TEXT    NOT NULL
                                CHECK (recommendation IN ('RECOMMEND_APPROVE','RECOMMEND_REJECT')),
    superseded          INTEGER NOT NULL DEFAULT 0 CHECK (superseded IN (0,1)),
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_assessments_application ON assessments(application_id);

-- ---------------------------------------------------------------------------
-- APPLICATION_STATUS_HISTORY — weak entity dependent on applications.
-- This is the structure that satisfies the auditability objective. Written in
-- the same transaction as the status update, so the invariant that no state
-- change exists without its audit row cannot be violated.
-- No application operation deletes or alters a row in this table.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS application_status_history (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id  INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    previous_status TEXT    NULL,
    new_status      TEXT    NOT NULL,
    actor_id        INTEGER NOT NULL REFERENCES users(id),
    note            TEXT    NULL,
    changed_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_history_application ON application_status_history(application_id);

-- ---------------------------------------------------------------------------
-- STAFF_QUALIFICATIONS — which qualifications an assessor or moderator is
-- competent to judge. An assessor may only be allocated, and a moderator may
-- only see, applications for qualifications listed here.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS staff_qualifications (
    user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    qualification_id  INTEGER NOT NULL REFERENCES qualifications(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, qualification_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_qual_qualification ON staff_qualifications(qualification_id);

-- ---------------------------------------------------------------------------
-- MODERATIONS — append-only quality-assurance record. A moderator reviews an
-- assessed application and either confirms the assessment or records concerns.
-- Moderation does not change the application status; the administrator reads
-- it before or after ratifying the outcome.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS moderations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id  INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    moderator_id    INTEGER NOT NULL REFERENCES users(id),
    verdict         TEXT    NOT NULL CHECK (verdict IN ('CONFIRMED','CONCERNS')),
    comments        TEXT    NOT NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_moderations_application ON moderations(application_id);

-- ---------------------------------------------------------------------------
-- USER_AUDIT_LOG — every account change made by the administrator (create,
-- role change, scope change, deactivation, password reset, deletion).
-- target_user_id is deliberately not a foreign key and the target's email is
-- copied in, so the row survives deletion of the account it describes.
-- Insert and read only; nothing in the codebase updates or deletes it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_audit_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id        INTEGER NULL,
    actor_email     TEXT    NULL,
    target_user_id  INTEGER NULL,
    target_email    TEXT    NULL,
    action          TEXT    NOT NULL,
    detail          TEXT    NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_audit_created ON user_audit_log(created_at);
