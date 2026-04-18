# PracticeOS Lite — Views Drop-In Bundle

Complete replacement for all 15 stub views + 3 shared foundation files.

## What's in here

```
src/
├── components/
│   ├── constants.js          ← appt types, payers, ICD/CPT, role meta, time helpers, status→badge maps
│   └── ui.jsx                ← Badge, Btn, Card, Modal, Input, Textarea, Select, Toggle, Avatar,
│                               SectionHead, TopBar, TabBar, InsuranceSelect, StatCard, ApptTypeDot,
│                               CodeSearchModal, EmptyState, Loader, ErrorBanner
├── lib/
│   └── db.js                 ← logAudit, listRows, insertRow, updateRow, deleteRow,
│                               subscribeTable (Realtime), breakTheGlass, fetchPatientFull
└── views/
    ├── DashboardView.jsx     (1)  KPI strip + today's schedule + live queue + open tasks + IC insights
    ├── ScheduleView.jsx      (2)  Day grid, provider columns, appt CRUD, patient inline search
    ├── PatientsView.jsx      (3)  Paginated list, search, detail modal (info/appts/encounters/meds/insurance)
    ├── QueueView.jsx         (4)  Realtime kanban (Waiting → Roomed → In Progress → Ready)
    ├── TasksView.jsx         (5)  Priority-sorted task list + quick-create
    ├── ClinicalView.jsx      (6)  Encounter editor: SOAP + ICD-10 + CPT + E/M, Draft → Signed workflow
    ├── InboxView.jsx         (7)  Message threads with Realtime subscription
    ├── EligibilityView.jsx   (8)  NEW — flagged eligibility_checks exception worklist
    ├── WaitlistView.jsx      (9)  NEW — priority-scored waitlist, contact tracker
    ├── InsightsView.jsx      (10) NEW — ic_insights_daily + benchmark percentiles
    ├── ComplianceView.jsx    (11) NEW — audit_log, Break-the-Glass reviews, BAA tracker, revisions
    ├── StaffView.jsx         (12) Users + providers management
    ├── ReportsView.jsx       (13) Operations / Productivity / Financial aggregates, date-range driven
    ├── SettingsView.jsx      (14) Practice info, rooms, hours, holidays
    └── PortalView.jsx        (15) Patient-facing: home / appts / labs / messages / profile
```

## How to install (GitHub web editor)

1. In your repo `github.com/EvolvAuto/Immaculate-Consulting`, browse to `practiceos-lite-app/src/`
2. For each file in this bundle: open the corresponding existing stub on GitHub, click the pencil,
   select-all + delete, paste the new contents, commit.
3. You'll need to create `src/components/` (two new files) if it doesn't exist — use the "Create new file"
   button and type `components/constants.js` as the path (GitHub creates the folder automatically).
4. Same for `src/lib/db.js` if it's not already there.

## What's assumed to exist (from Phase 2A foundation)

These files are NOT in this bundle — they were delivered in Phase 2A and should already be in your repo:

- `src/lib/supabaseClient.js` — exports `supabase` singleton and session helpers
- `src/lib/tokens.js` — exports `C` design tokens (used everywhere)
- `src/auth/AuthProvider.jsx` — exports `useAuth()` returning `{ session, profile, role, practiceId }`
- `src/auth/ProtectedRoute.jsx`
- `src/auth/LoginScreen.jsx`
- `src/App.jsx`, `src/main.jsx`, `src/styles.css`, `index.html`, `package.json`, `vite.config.js`, `vercel.json`

If `useAuth()` doesn't already surface `profile.patient_id`, add that passthrough for PortalView.

## Supabase wiring conventions used throughout

- **RLS-first**: no explicit `practice_id` filtering in SELECTs; RLS handles it via `my_practice_id()`
- **Enum values** are Title Case exactly as in the DB (`"Checked In"`, `"No Show"`, `"Follow-up"`, `"NC Medicaid - Standard"`, etc.)
- **Audit logging**: every write-that-matters calls `logAudit({ action, entityType, entityId, patientId?, details? })` which RPC-calls `log_audit()`
- **Realtime**: `QueueView` and `InboxView` subscribe via `subscribeTable(table, { practiceId, onChange })` using `supabase.channel()` (v2 API)
- **Appointments**: insert with `start_slot` only; BEFORE trigger computes `start_at`/`end_at` from practice timezone
- **Patient clinical-lite** (allergies / medications / problem_list) read/written as JSONB arrays on the `patients` row
- **Encounters**: Draft → In Progress → Signed; edits after Signed require amendment reason and land in `revision_history`

## Pre-flight before first real data test

Run this in Supabase SQL Editor to seed enough data for the views to render something:

```sql
-- 3 providers
INSERT INTO providers (practice_id, first_name, last_name, credential, specialty, color, default_duration) VALUES
  ('bf50934d-0bc2-454e-8177-6c9f749eefe4', 'Aisha',  'Patel',    'MD', 'Family Medicine',     '#1D9E75', 30),
  ('bf50934d-0bc2-454e-8177-6c9f749eefe4', 'James',  'Okafor',   'MD', 'Family Medicine',     '#3B82F6', 30),
  ('bf50934d-0bc2-454e-8177-6c9f749eefe4', 'Sandra', 'Williams', 'NP', 'Family Medicine',     '#8B5CF6', 30);

-- 6 rooms
INSERT INTO rooms (practice_id, name, room_type) VALUES
  ('bf50934d-0bc2-454e-8177-6c9f749eefe4', 'Exam 1', 'Exam'),
  ('bf50934d-0bc2-454e-8177-6c9f749eefe4', 'Exam 2', 'Exam'),
  ('bf50934d-0bc2-454e-8177-6c9f749eefe4', 'Exam 3', 'Exam'),
  ('bf50934d-0bc2-454e-8177-6c9f749eefe4', 'Exam 4', 'Exam'),
  ('bf50934d-0bc2-454e-8177-6c9f749eefe4', 'Procedure', 'Procedure'),
  ('bf50934d-0bc2-454e-8177-6c9f749eefe4', 'Telehealth', 'Telehealth');

-- Ask Claude in a follow-up to seed patients + appointments + tasks + queue + encounters
```

## Known compromises (deliberate, for token efficiency)

- **StaffView** creates users via `insertRow('users', ...)` but NOT via Supabase Auth admin API.
  For production invites you'll want an Edge Function (`invite-user`) that calls `auth.admin.inviteUserByEmail()`
  and then inserts the profile row. The UI is ready — just swap the insert call.
- **ClinicalView** writes amendment reasons to `amendment_reason` but doesn't yet insert a
  `revision_history` row inline — the DB has a trigger recommendation for that. When ready, add the
  trigger or call `insertRow('revision_history', ...)` alongside the update.
- **InsightsView** reads `ic_insights_daily` and `benchmark_snapshots` but the rows are produced by
  IC's nightly Make.com scenario — empty until you wire that job.
- **WaitlistView** tracks contact attempts and priority score but doesn't yet fire outbound SMS —
  that's a Make.com scenario (cascading SMS on slot open) slated for a future session.

## Suggested immediate next steps after upload

1. Commit the files via GitHub web editor (Vercel redeploys automatically)
2. Seed data via the SQL above + ask Claude to write the rest of the seed
3. Log in as Owner at `practiceos.immaculate-consulting.org`
4. Walk through each tab — Dashboard first (fails loud if RLS/JWT are off), then Settings → Patients → Schedule
5. Open Supabase → `audit_log` after a few clicks — every PHI touch should be recorded

— Built off PracticeOSLite_Full.jsx monolith, wired to live schema in project wlkwmfxmrnjqvcsbwksk
