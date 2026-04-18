-- ═══════════════════════════════════════════════════════════════════════════════
-- PracticeOS Lite - Patient Portal v1 migration
--
-- STATUS: This migration was APPLIED to project wlkwmfxmrnjqvcsbwksk
--         on 2026-04-18 via Supabase MCP (name: portal_v1_schema).
--         A follow-up patch locked set_updated_at's search_path.
--         This file is kept for reference and as the canonical source.
--
-- Live schema notes (what this adapted to):
--   patients uses phone_mobile / phone_home / portal_user_id / gender
--   lab_results uses released_to_portal / result_unit / is_abnormal / is_critical
--   insurance_policies uses rank (1=primary) - no eligibility_status column
--   messages uses direction / channel / is_read / sender_user_id / sender_label
--   Existing helpers my_patient_id() and is_staff() and my_practice_id() kept as-is
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1. ENUMS ──────────────────────────────────────────────────────────────
DO $$ BEGIN CREATE TYPE portal_invitation_status AS ENUM ('Pending','Sent','Activated','Expired','Revoked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE refill_request_status AS ENUM ('Pending','In Review','Approved','Denied','Sent to Pharmacy');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE insurance_update_status AS ENUM ('Pending Review','Approved','Rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE form_submission_status AS ENUM ('Draft','Submitted','Accepted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE portal_notification_status AS ENUM ('Pending','Sent','Failed','Cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ─── 2. HELPER FUNCTIONS ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_patient()
RETURNS boolean LANGUAGE sql STABLE
SET search_path TO 'public'
AS $fn$ SELECT get_my_role() = 'Patient'::user_role; $fn$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END $fn$;


-- ─── 3. EXTEND patients ────────────────────────────────────────────────────
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS last_portal_access_at timestamptz;


-- ─── 4. NEW TABLES ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.portal_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  patient_id  uuid NOT NULL REFERENCES public.patients(id)  ON DELETE CASCADE,
  email text NOT NULL,
  token text NOT NULL UNIQUE,
  status portal_invitation_status NOT NULL DEFAULT 'Pending',
  invited_by uuid REFERENCES public.users(id),
  expires_at timestamptz NOT NULL,
  sent_at timestamptz, activated_at timestamptz, revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_portal_inv_patient ON public.portal_invitations(patient_id);
CREATE INDEX IF NOT EXISTS idx_portal_inv_token   ON public.portal_invitations(token);
CREATE INDEX IF NOT EXISTS idx_portal_inv_status  ON public.portal_invitations(status);

CREATE TABLE IF NOT EXISTS public.refill_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  patient_id  uuid NOT NULL REFERENCES public.patients(id)  ON DELETE CASCADE,
  medication_name text NOT NULL,
  dosage text, sig text, pharmacy_name text, pharmacy_phone text, notes text,
  status refill_request_status NOT NULL DEFAULT 'Pending',
  assigned_to uuid REFERENCES public.users(id),
  resolved_at timestamptz, resolution_note text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refill_req_patient  ON public.refill_requests(patient_id);
CREATE INDEX IF NOT EXISTS idx_refill_req_practice ON public.refill_requests(practice_id);
CREATE INDEX IF NOT EXISTS idx_refill_req_status   ON public.refill_requests(status);

CREATE TABLE IF NOT EXISTS public.insurance_update_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  patient_id  uuid NOT NULL REFERENCES public.patients(id)  ON DELETE CASCADE,
  payer_name text, member_id text, group_number text, plan_name text,
  subscriber_name text, subscriber_dob date, relationship text,
  front_image_url text, back_image_url text, notes text,
  status insurance_update_status NOT NULL DEFAULT 'Pending Review',
  reviewed_by uuid REFERENCES public.users(id),
  reviewed_at timestamptz, review_note text,
  applied_policy_id uuid REFERENCES public.insurance_policies(id),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ins_upd_patient  ON public.insurance_update_requests(patient_id);
CREATE INDEX IF NOT EXISTS idx_ins_upd_practice ON public.insurance_update_requests(practice_id);
CREATE INDEX IF NOT EXISTS idx_ins_upd_status   ON public.insurance_update_requests(status);

CREATE TABLE IF NOT EXISTS public.portal_form_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  patient_id  uuid NOT NULL REFERENCES public.patients(id)  ON DELETE CASCADE,
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  form_type text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  status form_submission_status NOT NULL DEFAULT 'Draft',
  submitted_at timestamptz, accepted_at timestamptz,
  accepted_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_form_subs_patient ON public.portal_form_submissions(patient_id);
CREATE INDEX IF NOT EXISTS idx_form_subs_appt    ON public.portal_form_submissions(appointment_id);
CREATE INDEX IF NOT EXISTS idx_form_subs_status  ON public.portal_form_submissions(status);

CREATE TABLE IF NOT EXISTS public.portal_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  patient_id  uuid REFERENCES public.patients(id) ON DELETE SET NULL,
  event text NOT NULL, channel text NOT NULL, recipient text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status portal_notification_status NOT NULL DEFAULT 'Pending',
  attempts integer NOT NULL DEFAULT 0, last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_portal_notif_status   ON public.portal_notifications(status);
CREATE INDEX IF NOT EXISTS idx_portal_notif_practice ON public.portal_notifications(practice_id);
CREATE INDEX IF NOT EXISTS idx_portal_notif_event    ON public.portal_notifications(event);


-- ─── 5. TRIGGERS ───────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_portal_inv_updated  ON public.portal_invitations;
CREATE TRIGGER trg_portal_inv_updated  BEFORE UPDATE ON public.portal_invitations         FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_refill_req_updated  ON public.refill_requests;
CREATE TRIGGER trg_refill_req_updated  BEFORE UPDATE ON public.refill_requests            FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_ins_upd_updated     ON public.insurance_update_requests;
CREATE TRIGGER trg_ins_upd_updated     BEFORE UPDATE ON public.insurance_update_requests  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_form_subs_updated   ON public.portal_form_submissions;
CREATE TRIGGER trg_form_subs_updated   BEFORE UPDATE ON public.portal_form_submissions    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_portal_notif_updated ON public.portal_notifications;
CREATE TRIGGER trg_portal_notif_updated BEFORE UPDATE ON public.portal_notifications       FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ─── 6. RLS on new tables ──────────────────────────────────────────────────
ALTER TABLE public.portal_invitations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refill_requests           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_update_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_form_submissions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_notifications      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS portal_invitations_staff_all ON public.portal_invitations;
CREATE POLICY portal_invitations_staff_all ON public.portal_invitations FOR ALL TO authenticated
  USING (practice_id = my_practice_id() AND is_staff())
  WITH CHECK (practice_id = my_practice_id() AND is_staff());

DROP POLICY IF EXISTS refill_requests_staff_all ON public.refill_requests;
CREATE POLICY refill_requests_staff_all ON public.refill_requests FOR ALL TO authenticated
  USING (practice_id = my_practice_id() AND is_staff())
  WITH CHECK (practice_id = my_practice_id() AND is_staff());
DROP POLICY IF EXISTS refill_requests_patient_read ON public.refill_requests;
CREATE POLICY refill_requests_patient_read ON public.refill_requests FOR SELECT TO authenticated
  USING (patient_id = my_patient_id());
DROP POLICY IF EXISTS refill_requests_patient_insert ON public.refill_requests;
CREATE POLICY refill_requests_patient_insert ON public.refill_requests FOR INSERT TO authenticated
  WITH CHECK (patient_id = my_patient_id() AND is_patient());

DROP POLICY IF EXISTS insurance_update_staff_all ON public.insurance_update_requests;
CREATE POLICY insurance_update_staff_all ON public.insurance_update_requests FOR ALL TO authenticated
  USING (practice_id = my_practice_id() AND is_staff())
  WITH CHECK (practice_id = my_practice_id() AND is_staff());
DROP POLICY IF EXISTS insurance_update_patient_read ON public.insurance_update_requests;
CREATE POLICY insurance_update_patient_read ON public.insurance_update_requests FOR SELECT TO authenticated
  USING (patient_id = my_patient_id());
DROP POLICY IF EXISTS insurance_update_patient_insert ON public.insurance_update_requests;
CREATE POLICY insurance_update_patient_insert ON public.insurance_update_requests FOR INSERT TO authenticated
  WITH CHECK (patient_id = my_patient_id() AND is_patient());

DROP POLICY IF EXISTS form_subs_staff_all ON public.portal_form_submissions;
CREATE POLICY form_subs_staff_all ON public.portal_form_submissions FOR ALL TO authenticated
  USING (practice_id = my_practice_id() AND is_staff())
  WITH CHECK (practice_id = my_practice_id() AND is_staff());
DROP POLICY IF EXISTS form_subs_patient_read ON public.portal_form_submissions;
CREATE POLICY form_subs_patient_read ON public.portal_form_submissions FOR SELECT TO authenticated
  USING (patient_id = my_patient_id());
DROP POLICY IF EXISTS form_subs_patient_insert ON public.portal_form_submissions;
CREATE POLICY form_subs_patient_insert ON public.portal_form_submissions FOR INSERT TO authenticated
  WITH CHECK (patient_id = my_patient_id() AND is_patient());
DROP POLICY IF EXISTS form_subs_patient_update ON public.portal_form_submissions;
CREATE POLICY form_subs_patient_update ON public.portal_form_submissions FOR UPDATE TO authenticated
  USING (patient_id = my_patient_id() AND is_patient() AND status = 'Draft')
  WITH CHECK (patient_id = my_patient_id() AND is_patient());

DROP POLICY IF EXISTS portal_notif_staff_all ON public.portal_notifications;
CREATE POLICY portal_notif_staff_all ON public.portal_notifications FOR ALL TO authenticated
  USING (practice_id = my_practice_id() AND is_staff())
  WITH CHECK (practice_id = my_practice_id() AND is_staff());


-- ─── 7. EXTEND self-read RLS on existing tables ────────────────────────────
DROP POLICY IF EXISTS patients_self_read ON public.patients;
CREATE POLICY patients_self_read ON public.patients FOR SELECT TO authenticated
  USING (id = my_patient_id());

DROP POLICY IF EXISTS patients_self_update_last_access ON public.patients;
CREATE POLICY patients_self_update_last_access ON public.patients FOR UPDATE TO authenticated
  USING (id = my_patient_id() AND is_patient())
  WITH CHECK (id = my_patient_id() AND is_patient());

DROP POLICY IF EXISTS appointments_self_read ON public.appointments;
CREATE POLICY appointments_self_read ON public.appointments FOR SELECT TO authenticated
  USING (patient_id = my_patient_id());

DROP POLICY IF EXISTS encounters_self_read ON public.encounters;
CREATE POLICY encounters_self_read ON public.encounters FOR SELECT TO authenticated
  USING (patient_id = my_patient_id() AND status = 'Signed');

DROP POLICY IF EXISTS lab_results_self_read ON public.lab_results;
CREATE POLICY lab_results_self_read ON public.lab_results FOR SELECT TO authenticated
  USING (patient_id = my_patient_id() AND released_to_portal = true);

DROP POLICY IF EXISTS message_threads_self_read ON public.message_threads;
CREATE POLICY message_threads_self_read ON public.message_threads FOR SELECT TO authenticated
  USING (patient_id = my_patient_id());
DROP POLICY IF EXISTS message_threads_self_insert ON public.message_threads;
CREATE POLICY message_threads_self_insert ON public.message_threads FOR INSERT TO authenticated
  WITH CHECK (patient_id = my_patient_id() AND is_patient() AND practice_id = my_practice_id());

DROP POLICY IF EXISTS messages_self_read ON public.messages;
CREATE POLICY messages_self_read ON public.messages FOR SELECT TO authenticated
  USING (patient_id = my_patient_id());
DROP POLICY IF EXISTS messages_self_insert ON public.messages;
CREATE POLICY messages_self_insert ON public.messages FOR INSERT TO authenticated
  WITH CHECK (
    is_patient() AND patient_id = my_patient_id() AND practice_id = my_practice_id()
    AND direction = 'Inbound' AND channel = 'Portal'
  );
DROP POLICY IF EXISTS messages_self_mark_read ON public.messages;
CREATE POLICY messages_self_mark_read ON public.messages FOR UPDATE TO authenticated
  USING (patient_id = my_patient_id() AND is_patient())
  WITH CHECK (patient_id = my_patient_id() AND is_patient());

DROP POLICY IF EXISTS copay_self_read ON public.copay_collections;
CREATE POLICY copay_self_read ON public.copay_collections FOR SELECT TO authenticated
  USING (patient_id = my_patient_id());

DROP POLICY IF EXISTS insurance_policies_self_read ON public.insurance_policies;
CREATE POLICY insurance_policies_self_read ON public.insurance_policies FOR SELECT TO authenticated
  USING (patient_id = my_patient_id());

DROP POLICY IF EXISTS consents_self_read ON public.consents;
CREATE POLICY consents_self_read ON public.consents FOR SELECT TO authenticated
  USING (patient_id = my_patient_id());

DROP POLICY IF EXISTS providers_patient_read ON public.providers;
CREATE POLICY providers_patient_read ON public.providers FOR SELECT TO authenticated
  USING (is_patient() AND practice_id = (SELECT practice_id FROM public.patients WHERE id = my_patient_id()));

DROP POLICY IF EXISTS practices_patient_read ON public.practices;
CREATE POLICY practices_patient_read ON public.practices FOR SELECT TO authenticated
  USING (is_patient() AND id = (SELECT practice_id FROM public.patients WHERE id = my_patient_id()));

DROP POLICY IF EXISTS tasks_patient_insert ON public.tasks;
CREATE POLICY tasks_patient_insert ON public.tasks FOR INSERT TO authenticated
  WITH CHECK (is_patient() AND practice_id = my_practice_id() AND patient_id = my_patient_id() AND source = 'Portal');

DROP POLICY IF EXISTS waitlist_patient_insert ON public.waitlist_entries;
CREATE POLICY waitlist_patient_insert ON public.waitlist_entries FOR INSERT TO authenticated
  WITH CHECK (is_patient() AND practice_id = my_practice_id() AND patient_id = my_patient_id());

DROP POLICY IF EXISTS clinical_measurements_self_read ON public.clinical_measurements;
CREATE POLICY clinical_measurements_self_read ON public.clinical_measurements FOR SELECT TO authenticated
  USING (patient_id = my_patient_id());


-- ─── 8. GRANTS ─────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portal_invitations         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.refill_requests            TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.insurance_update_requests  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portal_form_submissions    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portal_notifications       TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_patient()     TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO authenticated;


-- ─── 9. REALTIME REPLICATION ───────────────────────────────────────────────
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.refill_requests;             EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.insurance_update_requests;   EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.portal_form_submissions;     EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.portal_notifications;        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
