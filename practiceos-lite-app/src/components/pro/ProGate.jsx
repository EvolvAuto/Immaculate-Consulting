// ═══════════════════════════════════════════════════════════════════════════════
// ProGate — wraps Pro-only UI. Reads practices.subscription_tier directly so it
// is self-contained and works without changes to AuthProvider.
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../auth/AuthProvider";
import { C } from "../../lib/tokens";
import { Btn, Card, Loader, ErrorBanner } from "../ui";

export default function ProGate({ children, feature }) {
  const { practiceId } = useAuth();
  const [tier, setTier] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!practiceId) return;
    supabase
      .from("practices")
      .select("subscription_tier")
      .eq("id", practiceId)
      .single()
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) setError(err.message);
        else setTier(data ? data.subscription_tier : "Lite");
      });
    return () => { cancelled = true; };
  }, [practiceId]);

  if (error) return <ErrorBanner message={error} />;
  if (tier === null) return <Loader />;

  const isPro = tier === "Pro" || tier === "Command";
  if (isPro) return children;

  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
      <Card style={{ maxWidth: 480, textAlign: "center" }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>✨</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: C.textPrimary, marginBottom: 8 }}>
          {feature ? feature + " is a Pro feature" : "This is a Pro feature"}
        </div>
        <div style={{ fontSize: 13, color: C.textSecondary, lineHeight: 1.5, marginBottom: 20 }}>
          Lite gave your staff a system. Pro gives them a teammate - an AI assistant
          that can search your practice data in plain English and draft patient outreach.
        </div>
        <Btn onClick={() => window.open("mailto:leonard@immaculate-consulting.org?subject=PracticeOS Pro upgrade", "_blank")}>
          Contact us to upgrade
        </Btn>
        <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 14 }}>
          Current tier: {tier}
        </div>
      </Card>
    </div>
  );
}
