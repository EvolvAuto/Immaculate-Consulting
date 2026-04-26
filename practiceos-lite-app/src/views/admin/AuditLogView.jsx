// ═══════════════════════════════════════════════════════════════════════════════
// src/views/admin/AuditLogView.jsx
// Global audit log feed. Super admin's RLS bypass means we see every practice.
// Filters: action type, time window, search.
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { C } from "../../lib/tokens";
import { Btn, Card, Loader, ErrorBanner } from "../../components/ui";

const ACTION_COLORS = {
  Create:           { color: C.teal,             bg: C.tealBg },
  Read:             { color: C.textSecondary,    bg: C.bgTertiary },
  Update:           { color: C.blue || "#1E5BA8",bg: C.blueBg || "#DBEAFE" },
  Delete:           { color: C.red,              bg: "#fef2f2" },
  Disclose:         { color: C.violet || "#6D28D9", bg: C.violetBg || "#EDE9FE" },
  Login:            { color: C.teal,             bg: C.tealBg },
  Logout:           { color: C.textSecondary,    bg: C.bgTertiary },
  "Failed Login":   { color: C.red,              bg: "#fef2f2" },
  "Break The Glass":{ color: C.amber,            bg: C.amberBg },
  Export:           { color: C.amber,            bg: C.amberBg },
  Print:            { color: C.amber,            bg: C.amberBg },
};

const ACTION_FILTERS = [
  "All",
  "Disclose",
  "Create",
  "Update",
  "Delete",
  "Read",
  "Break The Glass",
  "Failed Login",
];

function fmtAbsolute(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function AuditLogView() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);
  const [practices, setPractices] = useState({});
  const [filterAction, setFilterAction] = useState("All");
  const [search, setSearch] = useState("");
  const [hours, setHours] = useState(24);

  const load = async () => {
    try {
      setLoading(true);
      const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
      const [rRes, pRes] = await Promise.all([
        supabase.from("audit_log")
          .select("*")
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(500),
        supabase.from("practices").select("id, name"),
      ]);
      if (rRes.error) throw rRes.error;
      if (pRes.error) throw pRes.error;
      setRows(rRes.data || []);
      const pMap = {};
      (pRes.data || []).forEach(p => { pMap[p.id] = p.name; });
      setPractices(pMap);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [hours]);

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (filterAction !== "All" && r.action !== filterAction) return false;
      if (search.trim()) {
        const s = search.toLowerCase();
        const haystack = [
          r.entity_type,
          r.user_email,
          r.action,
          JSON.stringify(r.details || {}),
        ].filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(s)) return false;
      }
      return true;
    });
  }, [rows, filterAction, search]);

  if (loading) return <div style={{ padding: 40 }}><Loader /></div>;

  return (
    <div style={{ padding: 20 }}>
      {error && <ErrorBanner message={error} />}

      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary }}>Global audit log</div>
            <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 1 }}>
              All practices · last {hours}h · {filtered.length} of {rows.length} shown
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <Btn size="sm" variant="outline" onClick={load}>Refresh</Btn>
            <Btn size="sm" variant="outline" onClick={() => alert("Export to CSV: Phase 2")}>Export</Btn>
          </div>
        </div>

        {/* Filters row */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by entity, user, action..."
            style={{
              flex: "1 1 220px",
              minWidth: 220,
              background: C.bgSecondary,
              border: "0.5px solid " + C.borderLight,
              borderRadius: 7,
              padding: "7px 10px",
              fontSize: 12,
              fontFamily: "inherit",
              outline: "none",
              color: C.textPrimary,
            }}
          />
          <select
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value)}
            style={{
              padding: "7px 10px",
              border: "0.5px solid " + C.borderLight,
              borderRadius: 7,
              fontSize: 12,
              fontFamily: "inherit",
              background: C.bgPrimary,
            }}
          >
            {ACTION_FILTERS.map(a => <option key={a}>{a}</option>)}
          </select>
          <select
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            style={{
              padding: "7px 10px",
              border: "0.5px solid " + C.borderLight,
              borderRadius: 7,
              fontSize: 12,
              fontFamily: "inherit",
              background: C.bgPrimary,
            }}
          >
            <option value={1}>Last hour</option>
            <option value={24}>Last 24 hours</option>
            <option value={168}>Last 7 days</option>
            <option value={720}>Last 30 days</option>
          </select>
        </div>

        {filtered.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", fontSize: 12, color: C.textTertiary }}>
            No audit entries match.
          </div>
        ) : (
          <div style={{ border: "0.5px solid " + C.borderLight, borderRadius: 8, overflow: "hidden" }}>
            <div style={{
              display: "grid", gridTemplateColumns: "120px 100px 2.2fr 1fr 1fr",
              gap: 10, padding: "10px 14px",
              background: C.bgSecondary,
              fontSize: 10, fontWeight: 700,
              color: C.textTertiary,
              textTransform: "uppercase", letterSpacing: "0.06em",
              borderBottom: "0.5px solid " + C.borderLight,
            }}>
              <div>Time</div>
              <div>Action</div>
              <div>Detail</div>
              <div>Practice</div>
              <div>User</div>
            </div>
            <div style={{ maxHeight: "calc(100vh - 360px)", overflowY: "auto" }}>
              {filtered.map(r => {
                const palette = ACTION_COLORS[r.action] || ACTION_COLORS.Read;
                const eventName = r.details?.event ? r.details.event.replace(/_/g, " ") : null;
                const detailText = eventName
                  ? eventName + (r.entity_type ? " · " + r.entity_type : "")
                  : (r.entity_type || "—");
                return (
                  <div key={r.id} style={{
                    display: "grid", gridTemplateColumns: "120px 100px 2.2fr 1fr 1fr",
                    gap: 10, padding: "10px 14px",
                    fontSize: 11, alignItems: "center",
                    borderBottom: "0.5px solid " + C.borderLight,
                  }}>
                    <div style={{ color: C.textPrimary, fontFamily: "Consolas, monospace" }}>{fmtAbsolute(r.created_at)}</div>
                    <div>
                      <span style={{
                        fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
                        padding: "2px 6px", borderRadius: 3,
                        color: palette.color, background: palette.bg,
                      }}>{r.action}</span>
                    </div>
                    <div style={{ color: C.textPrimary }}>
                      {detailText}
                      {r.details?.vendor && <span style={{ color: C.textTertiary }}> → {r.details.vendor}{r.details.model ? " (" + r.details.model + ")" : ""}</span>}
                    </div>
                    <div style={{ color: C.textSecondary }}>{practices[r.practice_id] || (r.practice_id ? r.practice_id.slice(0, 8) : "—")}</div>
                    <div style={{ color: C.textTertiary }}>{r.user_email || (r.user_id ? r.user_id.slice(0, 8) : "system")}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
