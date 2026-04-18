# PracticeOS Lite — Frontend

Vite + React + Supabase. Multi-tenant practice operating system.

## Stack

- **Build:** Vite 5 (`npm run dev`, `npm run build`)
- **UI:** React 18, inline styles, Inter/DM Sans fonts (no Tailwind)
- **Backend:** Supabase (Postgres + Auth + RLS) — no custom server
- **Auth:** Supabase Auth, JWT with `app_metadata.role` and `app_metadata.practice_id`
- **Hosting:** Vercel

## Structure

```
app/
├── index.html              Vite entry
├── package.json
├── vite.config.js
├── vercel.json             SPA rewrites + security headers
├── .env.example            Env var template (safe to commit)
├── .gitignore
└── src/
    ├── main.jsx            Mounts <AuthProvider><App /></AuthProvider>
    ├── App.jsx             Nav shell + view router
    ├── styles.css          Font imports + resets
    ├── lib/
    │   ├── supabaseClient.js   Singleton client + logAudit helper
    │   └── tokens.js           Design tokens (C.*), NAV_BY_ROLE, NAV_META
    ├── auth/
    │   ├── AuthProvider.jsx    useAuth() context
    │   ├── ProtectedRoute.jsx  Gates by auth + role
    │   └── LoginScreen.jsx
    └── views/              15 view stubs, ported one-by-one from
                            PracticeOSLite_Full.jsx in subsequent sessions
```

## Environment variables

Required for any environment (local or Vercel):

| Name | Value | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://wlkwmfxmrnjqvcsbwksk.supabase.co` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | `sb_publishable_MBXJ2rc-RXwNwufopYWg2A_4lC4Sz7Q` | Publishable (anon) key — safe in client |

**Never put the Supabase `service_role` key in a `VITE_` env var.** Anything prefixed `VITE_` is embedded into the client bundle and visible to any browser.

## Deployment

Connected to Vercel → auto-deploys on push to `main`.

## Role / multi-tenancy model

Every row in every domain table carries a `practice_id`. RLS policies on every table check that `practice_id` matches the value in the user's JWT `app_metadata.practice_id`. A user can only see or modify rows in their own practice.

Roles (stored in JWT `app_metadata.role`):
- `Owner` — full practice access including compliance
- `Manager` — full practice access except compliance admin
- `Provider` — clinical + own-schedule access
- `Medical Assistant` — schedule, queue, intake
- `Front Desk` — schedule, queue, patients, tasks, inbox
- `Billing` — eligibility, claims, copays
- `Patient` — patient portal only, scoped to own `patient_id`

## Audit log

Every PHI read/write should call `logAudit({ action, entityType, entityId, patientId, details })` from `lib/supabaseClient.js`. This server-side-resolves role + user_id + practice_id from the JWT and appends an immutable row to `public.audit_log` (HIPAA requirement).
