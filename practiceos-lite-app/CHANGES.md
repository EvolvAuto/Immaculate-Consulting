# PracticeOS Lite — Update Drop (Component Revisions)

Drop-in update for the files already live at `practiceos.immaculate-consulting.org`. All 9 files below go into the same paths they occupy now — overwrite in place via GitHub web editor.

## What's fixed

### 1. `src/auth/AuthProvider.jsx` — fixes the persistent loading hang
Previously, any edge case in the auth bootstrap (stale session, network blip, profile-fetch failure) left the provider stuck in `loading: true` forever. The new version guarantees `setLoading(false)` in all paths including errors, so the app always falls through to either the logged-in shell or the sign-in screen.

### 2. `src/views/QueueView.jsx` — drag-and-drop + backward progression
- Cards are draggable between columns (HTML5 drag API, no library)
- New "← Back" action on each card lets staff undo an accidental advance
- Still uses the Realtime subscription from the prior build

### 3. `src/views/ScheduleView.jsx` — rebuilt
- **Drag-and-drop** to move appointments between time slots and providers
- **Real clock times** in the UI (`9:30 AM`, `30 min`) — no more "slot" numbers visible to staff (still stored as `start_slot` + `duration_slots` in the DB)
- **Editable dates and times** on existing appointments — the form now includes a date picker, start-time dropdown, and duration dropdown
- **Provider filter** dropdown in the toolbar
- **Month view toggle** — click a day in month view to jump to that day's schedule
- **Custom appointment types** — uses the new `practice_appt_types` table (see migration below)

### 4. `src/views/PatientsView.jsx` — rebuilt
- **NC insurance editor** — new "+ Add Policy" button opens a form with a dropdown pre-populated from `NC_PAYERS` (Standard Medicaid MCOs, Tailored Plans, Medicare, Commercial). Selecting a payer auto-fills the category.
- **SDOH tab** — displays HRSN screener with flagged needs + PHQ-9/PHQ-2/GAD-7/AUDIT-C scores from `screener_responses`
- **Insurance filter** in the list toolbar (filter by NC Medicaid category, Medicare, Commercial, etc.)
- **PCP filter** and **Sort By** controls also in the toolbar
- Primary insurance now shows in the list row

### 5. `src/views/TasksView.jsx` — patient linking
The task create/edit modal now includes a patient search (same pattern as ScheduleView / Queue). Selecting a patient writes their ID to `tasks.patient_id`.

### 6. `src/views/ClinicalView.jsx` — search + filter
- Full-text search across chief complaint + assessment
- Filter by status (Draft / In Progress / Signed / Amended)
- Filter by provider
- Date-range picker (Today / Last 7 days / Last 30 days / All time)

### 7. `src/views/InboxView.jsx` — practitioner-initiated messaging
New "+ New Message" button in the toolbar opens a form to pick a patient and start a thread. Creates a new row in `message_threads` + first message row.

### 8. `src/views/SettingsView.jsx` — timezone dropdown + appointment types tab
- **Timezone** field is now a dropdown populated from `TIMEZONES` (US + major international) — prevents typos that would break scheduling math
- **New "Appointment Types" tab** — CRUD over `practice_appt_types` with a color picker. ScheduleView reads from this table.

### 9. `src/components/constants.js` — supporting changes
- `NC_PAYERS` — grouped list of NC Medicaid MCOs, Tailored Plans, Medicare, commercial payers
- `TIMEZONES` — dropdown options for Settings
- `HRSN_QUESTIONS` — reference list for SDOH screener display
- `hexToBg()` — helper to derive a translucent background from a hex color (used for custom appt type rendering)
- `time24ToSlot()` / `slotToTime24()` — helpers for the Settings hours grid

## Migration SQL — ALREADY APPLIED to project `wlkwmfxmrnjqvcsbwksk`

These ran successfully via MCP in the prior session. Listed here for the record:

```sql
-- 1. Grant table privileges to the authenticated role (fixed permission-denied errors)
GRANT USAGE ON SCHEMA public TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;

-- 2. Enable Realtime replication on the tables the views subscribe to
ALTER PUBLICATION supabase_realtime ADD TABLE public.queue_entries;
ALTER PUBLICATION supabase_realtime ADD TABLE public.message_threads;
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.appointments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;

-- 3. Custom appointment types table for per-practice type management
CREATE TABLE IF NOT EXISTS public.practice_appt_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#1D9E75',
  default_duration_minutes int NOT NULL DEFAULT 30,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (practice_id, name)
);
-- ...plus RLS policies and grants (see session history)
```

Nothing else to run. If you spin up a fresh Supabase project later, pull these from this file.

## Deploy checklist (same Chromebook flow as before)

1. Open `github.com/EvolvAuto/Immaculate-Consulting/tree/main/practiceos-lite-app/src` in web editor
2. Drop in the 9 files, overwriting existing ones
3. Commit to `main`
4. Vercel auto-deploys in ~60 seconds
5. Hard-refresh (Ctrl+Shift+R) and check:
   - Root URL loads past the sign-in page without hanging
   - Schedule: try dragging an appointment to a different time — it should persist after refresh
   - Queue: try the new "← Back" button and drag-and-drop between columns
   - Patients: click one → Insurance tab → "+ Add Policy" → payer dropdown should list NC Medicaid MCOs
   - Patients → SDOH tab should show "No screeners on file" (expected; you haven't seeded screeners yet)
   - Settings → Appointment Types tab → "+ Add Type" → save a custom type → appears in Schedule's type dropdown

## Known remaining work (not in this drop)

- Seed sample screener_responses rows to demo the SDOH tab
- Staff view: invite-new-user flow still requires a Supabase Edge Function (not wired)
- PortalView: still needs separate sub-route routing (staff vs patient shell)
