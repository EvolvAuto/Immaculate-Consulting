// ═══════════════════════════════════════════════════════════════════════════════
// src/views/portal/PortalBilling.jsx
// Read-only billing view. copay_collections is a collections log (not a balance
// ledger) so v1 shows recent payments + links to call for balance inquiries.
// Live schema: amount, method, collected_at, collected_via, last4, refunded,
// receipt_sent.
// ═══════════════════════════════════════════════════════════════════════════════

import { useState, useEffect } from "react";
import { supabase, logAudit } from "../../lib/supabaseClient";
import { C, Panel, Badge, Empty, InfoBox, fmtDate, fmtMoney } from "./_ui.jsx";

export default function PortalBilling({ patientId, practice }) {
  const [rows, setRows]     = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data, error } = await supabase.from("copay_collections")
          .select("id, appointment_id, amount, method, collected_at, collected_via, last4, refunded, refund_amount, receipt_sent, notes")
          .eq("patient_id", patientId)
          .order("collected_at", { ascending:false, nullsFirst:false })
          .limit(50);
        if (!active) return;
        if (error) console.warn("[billing] load failed:", error.message);
        setRows(data || []);
        logAudit({ action:"Read", entityType:"copay_collections", entityId:patientId }).catch(()=>{});
      } catch (e) {
        console.warn("[billing] exception:", e?.message || e);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [patientId]);

  if (loading) return <Empty title="Loading billing info..." />;

  const totalPaid = rows
    .filter(r => !r.refunded)
    .reduce((s, r) => s + Number(r.amount || 0), 0);
  const last90 = rows.filter(r => {
    if (!r.collected_at || r.refunded) return false;
    return new Date(r.collected_at).getTime() > Date.now() - 90*24*60*60*1000;
  }).reduce((s, r) => s + Number(r.amount || 0), 0);

  return (
    <div>
      <div style={{
        display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))",
        gap:10, marginBottom:14,
      }}>
        <Stat label="Last 90 Days" value={fmtMoney(last90)} color={C.teal} sub="Payments collected" />
        <Stat label="All Time Paid" value={fmtMoney(totalPaid)} color={C.textPrimary} sub="Portal-visible only" />
      </div>

      <InfoBox variant="amber">
        <strong>For your current balance or billing questions,</strong> please call{" "}
        {practice && practice.phone ? practice.phone : "your practice"} or send a secure message
        to the Billing team. Online payments are coming in a future release.
      </InfoBox>

      <div style={{
        fontSize:10, textTransform:"uppercase", letterSpacing:"0.06em",
        color:C.textTertiary, margin:"16px 0 8px", fontWeight:600,
      }}>Payment History</div>

      {rows.length === 0 && <Empty title="No payments on record yet" />}

      {rows.map(r => (
        <Panel key={r.id} style={{
          display:"flex", justifyContent:"space-between", alignItems:"center",
          flexWrap:"wrap", gap:8,
          opacity: r.refunded ? 0.6 : 1,
        }}>
          <div>
            <div style={{ fontSize:11, color:C.textTertiary }}>
              {r.collected_at ? fmtDate(r.collected_at) : "Date unknown"}
            </div>
            <div style={{ fontSize:13, fontWeight:600, color:C.textPrimary, marginTop:2 }}>
              {r.notes || "Visit payment"}
            </div>
            <div style={{ fontSize:11, color:C.textSecondary, marginTop:2 }}>
              {r.method || "Payment"}
              {r.last4 ? " ****" + r.last4 : ""}
              {r.collected_via ? " - via " + r.collected_via : ""}
            </div>
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{
              fontSize:15, fontWeight:700,
              color: r.refunded ? C.textTertiary : C.green,
              textDecoration: r.refunded ? "line-through" : "none",
            }}>{fmtMoney(r.amount)}</div>
            <Badge
              label={r.refunded ? "Refunded" : (r.receipt_sent ? "Paid - Receipt Sent" : "Paid")}
              variant={r.refunded ? "red" : "teal"}
            />
          </div>
        </Panel>
      ))}
    </div>
  );
}

function Stat({ label, value, color, sub }) {
  return (
    <div style={{
      background:C.bgPrimary, border:"0.5px solid " + C.borderLight, borderRadius:10,
      padding:"12px 14px",
    }}>
      <div style={{
        fontSize:9.5, fontWeight:600, textTransform:"uppercase",
        letterSpacing:"0.06em", color:C.textTertiary, marginBottom:5,
      }}>{label}</div>
      <div style={{ fontSize:20, fontWeight:700, color, letterSpacing:"-0.01em" }}>{value}</div>
      <div style={{ fontSize:10.5, color:C.textSecondary, marginTop:2 }}>{sub}</div>
    </div>
  );
}
