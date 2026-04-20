// ═══════════════════════════════════════════════════════════════════════════════
// CapBoostModal - purchase a one-month AI message cap boost.
// Role gate: Owner, Manager, Billing only. Matches the server-side gate in
// pro-cap-boost-purchase edge function.
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { C } from "../../lib/tokens";
import { Btn, Modal } from "../ui";
import { proApi, BOOST_PACKAGES, PURCHASE_ROLES, fetchBoostsThisMonth } from "../../lib/proApi";

export default function CapBoostModal({ onClose, onPurchased, currentUsed, currentCap }) {
  const { role } = useAuth();
  const canPurchase = PURCHASE_ROLES.includes(role);

  const [selected, setSelected] = useState(BOOST_PACKAGES[0]);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState(null);
  const [success, setSuccess] = useState(null);
  const [existing, setExisting] = useState([]);

  useEffect(() => {
    fetchBoostsThisMonth().then(setExisting).catch(() => setExisting([]));
  }, []);

  const handlePurchase = async () => {
    if (!selected) return;
    try {
      setSubmitting(true); setErr(null);
      const res = await proApi.capBoostPurchase({
        messages_added: selected.messages_added,
        amount_usd: selected.amount_usd,
        note: "In-app purchase",
      });
      setSuccess(res);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!canPurchase) {
    return (
      <Modal title="Upgrade your monthly cap" onClose={onClose}>
        <div style={{ fontSize: 13, color: C.textSecondary, lineHeight: 1.5, marginBottom: 14 }}>
          Only Owner, Manager, and Billing roles can purchase cap boosts. Please contact the person at your practice who manages billing to upgrade for this month.
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Btn onClick={onClose}>Close</Btn>
        </div>
      </Modal>
    );
  }

  if (success) {
    return (
      <Modal title="Cap boost purchased" onClose={onClose}>
        <div style={{
          padding: 14,
          background: "#ECFDF5",
          border: "0.5px solid #A7F3D0",
          borderRadius: 8,
          marginBottom: 14,
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#065F46", marginBottom: 6 }}>
            +{Number(success.messagesAdded).toLocaleString()} messages added for this month
          </div>
          <div style={{ fontSize: 12, color: "#065F46" }}>
            New cap: <strong>{Number(success.newCap).toLocaleString()}</strong> messages
            <br />
            Remaining: {Number(success.usage?.remaining || 0).toLocaleString()}
          </div>
        </div>
        <div style={{ fontSize: 11, color: C.textTertiary, marginBottom: 14, lineHeight: 1.4 }}>
          This boost applies only to the current calendar month. Next month resets to your base plan cap.
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Btn onClick={() => { onClose(); if (typeof onPurchased === "function") onPurchased(); }}>
            Done
          </Btn>
        </div>
      </Modal>
    );
  }

  const overCap = currentCap > 0 && currentUsed > currentCap;
  const overBy = overCap ? (currentUsed - currentCap) : 0;

  return (
    <Modal title="Add more AI messages this month" onClose={onClose}>
      <div style={{ fontSize: 13, color: C.textSecondary, lineHeight: 1.5, marginBottom: 14 }}>
        Your base plan includes <strong>{Number(currentCap || 0).toLocaleString()}</strong> AI messages per month.
        You've used <strong>{Number(currentUsed || 0).toLocaleString()}</strong>
        {overCap ? ", which is " + overBy.toLocaleString() + " over your cap." : "."}
        {" "}Add a one-month boost to keep things running smoothly. Resets next month to your base plan.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
        {BOOST_PACKAGES.map((pkg) => {
          const isSelected = selected && selected.messages_added === pkg.messages_added;
          return (
            <div
              key={pkg.messages_added}
              onClick={() => setSelected(pkg)}
              style={{
                padding: 12,
                border: "1.5px solid " + (isSelected ? (C.teal || "#1D9E75") : C.borderLight),
                background: isSelected ? (C.tealBg || "#E6F4EF") : "#fff",
                borderRadius: 8,
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary }}>{pkg.label}</div>
                <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>
                  Expires at end of this month
                </div>
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: isSelected ? (C.teal || "#1D9E75") : C.textPrimary }}>
                {pkg.value_desc}
              </div>
            </div>
          );
        })}
      </div>

      {existing.length > 0 && (
        <div style={{
          padding: 10,
          background: "#FAFBFC",
          border: "0.5px solid " + C.borderLight,
          borderRadius: 6,
          marginBottom: 14,
          fontSize: 12,
          color: C.textSecondary,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4, color: C.textPrimary }}>
            Boosts already active this month
          </div>
          {existing.map((b) => (
            <div key={b.id} style={{ marginTop: 2 }}>
              +{Number(b.messages_added).toLocaleString()} messages - ${Number(b.amount_usd || 0).toFixed(2)}
              {" "}({new Date(b.purchased_at).toLocaleDateString()})
            </div>
          ))}
        </div>
      )}

      <div style={{
        padding: 10,
        background: "#FEF3C7",
        border: "0.5px solid #FCD34D",
        borderRadius: 6,
        marginBottom: 14,
        fontSize: 11,
        color: "#78350F",
        lineHeight: 1.4,
      }}>
        Payment is currently in test mode. Your boost will be applied immediately but no card will be charged. Live billing will be enabled once Stripe is finalized.
      </div>

      {err && (
        <div style={{ fontSize: 12, color: "#DC2626", marginBottom: 10 }}>{err}</div>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn variant="secondary" onClick={onClose} disabled={submitting}>Cancel</Btn>
        <Btn onClick={handlePurchase} disabled={submitting || !selected}>
          {submitting ? "Processing..." : (selected ? "Purchase " + selected.value_desc : "Select a package")}
        </Btn>
      </div>
    </Modal>
  );
}
