// ═══════════════════════════════════════════════════════════════════════════════
// PracticeOS Lite — Shared UI Primitives
// Every view imports from here. Tokens come from lib/tokens.js
// ═══════════════════════════════════════════════════════════════════════════════

import { useState, useMemo } from "react";
import { C } from "../lib/tokens";
import { NC_PAYER_GROUPS, DEFAULT_APPT_TYPES } from "./constants";

// ─── Badge ────────────────────────────────────────────────────────────────────
export const Badge = ({ label, variant = "teal", size = "sm" }) => {
  const M = {
    teal:    { bg: C.tealBg,    color: C.teal,           border: C.tealBorder },
    amber:   { bg: C.amberBg,   color: C.amber,          border: C.amberBorder },
    red:     { bg: C.redBg,     color: C.red,            border: C.redBorder },
    blue:    { bg: C.blueBg,    color: C.blue,           border: C.blueBorder },
    purple:  { bg: C.purpleBg,  color: C.purple,         border: C.purpleBorder },
    green:   { bg: C.greenBg,   color: C.green,          border: C.greenBorder },
    neutral: { bg: C.bgSecondary, color: C.textSecondary, border: C.borderLight },
  };
  const s = M[variant] || M.teal;
  return (
    <span style={{
      fontSize: size === "xs" ? 9 : 10, fontWeight: 700,
      padding: size === "xs" ? "1px 6px" : "2px 9px",
      borderRadius: 20, background: s.bg, color: s.color,
      border: `0.5px solid ${s.border}`, whiteSpace: "nowrap",
      textTransform: "uppercase", letterSpacing: "0.04em",
    }}>{label}</span>
  );
};

// ─── Button ───────────────────────────────────────────────────────────────────
export const Btn = ({ children, onClick, variant = "primary", size = "md", disabled = false, style = {}, type = "button" }) => {
  const V = {
    primary: { background: C.teal, color: "#fff", border: "none" },
    outline: { background: "transparent", color: C.teal, border: `1.5px solid ${C.teal}` },
    ghost:   { background: C.bgSecondary, color: C.textSecondary, border: `0.5px solid ${C.borderLight}` },
    danger:  { background: C.redBg, color: C.red, border: `0.5px solid ${C.redBorder}` },
    amber:   { background: C.amberBg, color: C.amber, border: `0.5px solid ${C.amberBorder}` },
  };
  const S = {
    sm: { padding: "5px 12px", fontSize: 12 },
    md: { padding: "9px 18px", fontSize: 13 },
    lg: { padding: "12px 24px", fontSize: 14 },
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={{
      ...V[variant], ...S[size], borderRadius: 8, fontWeight: 600,
      cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.4 : 1,
      fontFamily: "inherit", transition: "opacity 0.15s", whiteSpace: "nowrap", ...style,
    }}>{children}</button>
  );
};

// ─── Card ─────────────────────────────────────────────────────────────────────
export const Card = ({ children, style = {}, onClick }) => (
  <div onClick={onClick} style={{
    background: C.bgPrimary, border: `0.5px solid ${C.borderLight}`,
    borderRadius: 12, padding: "16px 18px",
    cursor: onClick ? "pointer" : "default", ...style,
  }}>{children}</div>
);

// ─── Modal ────────────────────────────────────────────────────────────────────
export const Modal = ({ children, title, onClose, maxWidth = 520 }) => (
  <div
    onClick={(e) => e.target === e.currentTarget && onClose()}
    style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 300, padding: 16,
    }}
  >
    <div style={{
      background: C.bgPrimary, borderRadius: 16, width: "100%",
      maxWidth, boxShadow: "0 24px 64px rgba(0,0,0,0.18)",
      overflow: "hidden", maxHeight: "92vh", display: "flex", flexDirection: "column",
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "16px 20px", borderBottom: `0.5px solid ${C.borderLight}`, flexShrink: 0,
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary }}>{title}</div>
        <button onClick={onClose} style={{
          background: "none", border: "none", fontSize: 20,
          color: C.textTertiary, cursor: "pointer",
        }}>×</button>
      </div>
      <div style={{ overflowY: "auto", padding: 20, flex: 1 }}>{children}</div>
    </div>
  </div>
);

// ─── Field Label ──────────────────────────────────────────────────────────────
export const FL = ({ children }) => (
  <div style={{
    fontSize: 11, fontWeight: 600, color: C.textSecondary,
    textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 5,
  }}>{children}</div>
);

// ─── Input ────────────────────────────────────────────────────────────────────
export const Input = ({ label, value, onChange, type = "text", placeholder = "", style = {} }) => (
  <div style={{ marginBottom: 14, ...style }}>
    {label && <FL>{label}</FL>}
    <input
      type={type}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: "100%", padding: "9px 12px",
        border: `1px solid ${C.borderMid}`, borderRadius: 8,
        fontSize: 13, fontFamily: "inherit", outline: "none",
        color: C.textPrimary, background: C.bgPrimary, boxSizing: "border-box",
      }}
      onFocus={(e) => (e.target.style.borderColor = C.tealMid)}
      onBlur={(e) => (e.target.style.borderColor = C.borderMid)}
    />
  </div>
);

// ─── Textarea ─────────────────────────────────────────────────────────────────
export const Textarea = ({ label, value, onChange, rows = 3, placeholder = "" }) => (
  <div style={{ marginBottom: 14 }}>
    {label && <FL>{label}</FL>}
    <textarea
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      placeholder={placeholder}
      style={{
        width: "100%", padding: "9px 12px",
        border: `1px solid ${C.borderMid}`, borderRadius: 8,
        fontSize: 13, fontFamily: "inherit", outline: "none",
        color: C.textPrimary, resize: "vertical",
        background: C.bgPrimary, boxSizing: "border-box",
      }}
      onFocus={(e) => (e.target.style.borderColor = C.tealMid)}
      onBlur={(e) => (e.target.style.borderColor = C.borderMid)}
    />
  </div>
);

// ─── Select ───────────────────────────────────────────────────────────────────
export const Select = ({ label, value, onChange, options, style = {} }) => (
  <div style={{ marginBottom: 14, ...style }}>
    {label && <FL>{label}</FL>}
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%", padding: "9px 12px",
        border: `1px solid ${C.borderMid}`, borderRadius: 8,
        fontSize: 13, fontFamily: "inherit", outline: "none",
        color: C.textPrimary, background: C.bgPrimary, boxSizing: "border-box",
        WebkitAppearance: "none",
        backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b6a63' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")",
        backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center",
        paddingRight: 32,
      }}
    >
      {options.map((o) =>
        typeof o === "string"
          ? <option key={o} value={o}>{o}</option>
          : <option key={o.value} value={o.value}>{o.label}</option>
      )}
    </select>
  </div>
);

// ─── Toggle ───────────────────────────────────────────────────────────────────
export const Toggle = ({ value, onChange }) => (
  <button
    onClick={() => onChange(!value)}
    style={{
      width: 44, height: 24, borderRadius: 12, border: "none",
      cursor: "pointer", background: value ? C.tealMid : C.borderMid,
      transition: "background 0.2s", position: "relative", flexShrink: 0,
    }}
  >
    <div style={{
      width: 18, height: 18, borderRadius: 9, background: "#fff",
      position: "absolute", top: 3, left: value ? 23 : 3,
      transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
    }} />
  </button>
);

// ─── Avatar ───────────────────────────────────────────────────────────────────
export const Avatar = ({ initials, size = 32, color = "#0F6E56" }) => (
  <div style={{
    width: size, height: size, borderRadius: "50%",
    background: color, color: "#fff", display: "flex",
    alignItems: "center", justifyContent: "center",
    fontSize: size * 0.35, fontWeight: 700, flexShrink: 0,
  }}>{initials}</div>
);

// ─── Section Head ─────────────────────────────────────────────────────────────
export const SectionHead = ({ title, sub, action }) => (
  <div style={{
    display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14,
  }}>
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary }}>{title}</div>
      {sub && <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>{sub}</div>}
    </div>
    {action}
  </div>
);

// ─── Top Bar ──────────────────────────────────────────────────────────────────
export const TopBar = ({ title, sub, actions }) => (
  <div style={{
    background: C.bgPrimary, borderBottom: `0.5px solid ${C.borderLight}`,
    padding: "0 24px", height: 56, display: "flex",
    alignItems: "center", justifyContent: "space-between", flexShrink: 0,
  }}>
    <div>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary }}>{title}</div>
      {sub && <div style={{ fontSize: 11, color: C.textTertiary }}>{sub}</div>}
    </div>
    {actions && <div style={{ display: "flex", gap: 8, alignItems: "center" }}>{actions}</div>}
  </div>
);

// ─── Tab Bar ──────────────────────────────────────────────────────────────────
export const TabBar = ({ tabs, active, onChange }) => (
  <div style={{ display: "flex", background: C.bgSecondary, borderRadius: 8, padding: 3, gap: 2 }}>
    {tabs.map(([v, l]) => (
      <button
        key={v}
        onClick={() => onChange(v)}
        style={{
          padding: "6px 14px", borderRadius: 6, border: "none", cursor: "pointer",
          fontFamily: "inherit", fontSize: 12,
          fontWeight: active === v ? 700 : 400,
          background: active === v ? C.bgPrimary : "transparent",
          color: active === v ? C.textPrimary : C.textSecondary,
          boxShadow: active === v ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
        }}
      >{l}</button>
    ))}
  </div>
);

// ─── Insurance Select ─────────────────────────────────────────────────────────
export const InsuranceSelect = ({ value, onChange }) => (
  <select
    value={value ?? ""}
    onChange={(e) => onChange(e.target.value)}
    style={{
      width: "100%", padding: "9px 12px",
      border: `1px solid ${C.borderMid}`, borderRadius: 8,
      fontSize: 13, fontFamily: "inherit", outline: "none",
      color: C.textPrimary, background: C.bgPrimary, boxSizing: "border-box",
      WebkitAppearance: "none",
    }}
  >
    <option value="">Select insurance...</option>
    {NC_PAYER_GROUPS.map((g) => (
      <optgroup key={g.group} label={g.group}>
        {g.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </optgroup>
    ))}
  </select>
);

// ─── Stat Card ────────────────────────────────────────────────────────────────
export const StatCard = ({ label, value, sub, color = "#0F6E56", icon }) => (
  <Card>
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.textSecondary, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
        <div style={{ fontSize: 26, fontWeight: 800, color, letterSpacing: "-0.02em", marginTop: 6 }}>{value}</div>
        {sub && <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 4 }}>{sub}</div>}
      </div>
      {icon && <div style={{ fontSize: 20, opacity: 0.55, color }}>{icon}</div>}
    </div>
  </Card>
);

// ─── Appointment Type Dot ─────────────────────────────────────────────────────
export const ApptTypeDot = ({ type, size = "sm" }) => {
  const t = DEFAULT_APPT_TYPES.find((x) => x.name === type) || DEFAULT_APPT_TYPES[1];
  const d = size === "sm" ? 7 : 10;
  return <span style={{ display: "inline-block", width: d, height: d, borderRadius: "50%", background: t.dot, flexShrink: 0 }} />;
};

// ─── Code Search Modal (ICD-10 / CPT picker) ──────────────────────────────────
export const CodeSearchModal = ({ title, codes, onAdd, onClose }) => {
  const [q, setQ] = useState("");
  const filtered = useMemo(
    () => codes.filter((c) => c.code.toLowerCase().includes(q.toLowerCase()) || c.description.toLowerCase().includes(q.toLowerCase())),
    [codes, q]
  );
  return (
    <Modal title={title} onClose={onClose} maxWidth={600}>
      <Input label="Search" value={q} onChange={setQ} placeholder="Search by code or description..." />
      <div style={{ maxHeight: 360, overflowY: "auto", border: `0.5px solid ${C.borderLight}`, borderRadius: 8 }}>
        {filtered.map((c) => (
          <div
            key={c.code}
            onClick={() => { onAdd(c); onClose(); }}
            style={{
              padding: "10px 14px", borderBottom: `0.5px solid ${C.borderLight}`,
              cursor: "pointer", display: "flex", gap: 12,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = C.bgSecondary)}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <div style={{ fontSize: 12, fontWeight: 700, color: C.teal, minWidth: 64, fontFamily: "monospace" }}>{c.code}</div>
            <div style={{ fontSize: 12, color: C.textSecondary }}>{c.description}</div>
          </div>
        ))}
        {filtered.length === 0 && <div style={{ padding: 20, textAlign: "center", color: C.textTertiary, fontSize: 12 }}>No matches</div>}
      </div>
    </Modal>
  );
};

// ─── Empty State ──────────────────────────────────────────────────────────────
export const EmptyState = ({ icon = "○", title, sub, action }) => (
  <div style={{
    display: "flex", flexDirection: "column", alignItems: "center",
    justifyContent: "center", padding: 48, textAlign: "center", gap: 8,
  }}>
    <div style={{ fontSize: 36, color: C.textTertiary, opacity: 0.5 }}>{icon}</div>
    <div style={{ fontSize: 14, fontWeight: 700, color: C.textPrimary }}>{title}</div>
    {sub && <div style={{ fontSize: 12, color: C.textTertiary, maxWidth: 320 }}>{sub}</div>}
    {action && <div style={{ marginTop: 8 }}>{action}</div>}
  </div>
);

// ─── Loading / Error helpers ──────────────────────────────────────────────────
export const Loader = ({ label = "Loading..." }) => (
  <div style={{ padding: 32, textAlign: "center", color: C.textTertiary, fontSize: 12 }}>{label}</div>
);

export const ErrorBanner = ({ message }) => (
  <div style={{
    background: C.redBg, color: C.red, border: `0.5px solid ${C.redBorder}`,
    padding: "10px 14px", borderRadius: 8, fontSize: 12, margin: "12px 0",
  }}>⚠ {message}</div>
);
