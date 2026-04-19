// ═══════════════════════════════════════════════════════════════════════════════
// src/views/portal/_ui.jsx
// Minimal UI primitives for portal views. Keeps inline styles consistent.
// ═══════════════════════════════════════════════════════════════════════════════

export const C = {
  teal:"#0F6E56", tealMid:"#1D9E75", tealLight:"#5DCAA5", tealBg:"#E1F5EE",
  tealBorder:"#9FE1CB", tealDark:"#085041",
  amber:"#854F0B", amberBg:"#FAEEDA", amberBorder:"#FAC775", amberMid:"#D08A2E",
  red:"#A32D2D", redBg:"#FCEBEB", redBorder:"#F5B8B8", redMid:"#DC2626",
  blue:"#1D4ED8", blueBg:"#EFF6FF", blueBorder:"#BFDBFE",
  purple:"#6D28D9", purpleBg:"#EDE9FE", purpleBorder:"#C4B5FD",
  green:"#065F46", greenBg:"#D1FAE5", greenBorder:"#6EE7B7",
  bgPrimary:"#ffffff", bgSecondary:"#f7f7f5", bgTertiary:"#f0efeb",
  textPrimary:"#1a1a18", textSecondary:"#6b6a63", textTertiary:"#9c9b94",
  borderLight:"rgba(0,0,0,0.08)", borderMid:"rgba(0,0,0,0.18)",
};

export function Panel({ children, style, accent }) {
  const accentBorder = accent ? "3px solid " + accent : undefined;
  return (
    <div style={{
      background:C.bgPrimary, border:"0.5px solid " + C.borderLight, borderRadius:12,
      padding:"14px 16px", marginBottom:10, borderLeft: accentBorder,
      ...(style || {}),
    }}>{children}</div>
  );
}

export function Badge({ label, variant = "teal" }) {
  const map = {
    teal:   { bg:C.tealBg,   color:C.teal,   bd:C.tealBorder },
    amber:  { bg:C.amberBg,  color:C.amber,  bd:C.amberBorder },
    red:    { bg:C.redBg,    color:C.red,    bd:C.redBorder },
    blue:   { bg:C.blueBg,   color:C.blue,   bd:C.blueBorder },
    purple: { bg:C.purpleBg, color:C.purple, bd:C.purpleBorder },
    green:  { bg:C.greenBg,  color:C.green,  bd:C.greenBorder },
    neutral:{ bg:C.bgSecondary, color:C.textSecondary, bd:C.borderMid },
  };
  const s = map[variant] || map.neutral;
  return <span style={{
    fontSize:10, fontWeight:600, padding:"2px 8px", borderRadius:20,
    border:"0.5px solid " + s.bd, background:s.bg, color:s.color,
    whiteSpace:"nowrap", display:"inline-flex", alignItems:"center",
  }}>{label}</span>;
}

export function Btn({ children, onClick, variant = "primary", disabled, style, type = "button" }) {
  const map = {
    primary:   { bg:C.teal, color:"#fff", bd:C.teal, hoverBg:C.tealDark },
    secondary: { bg:C.bgSecondary, color:C.textSecondary, bd:C.borderMid, hoverBg:C.bgTertiary },
    ghost:     { bg:"transparent", color:C.teal, bd:C.tealBorder, hoverBg:C.tealBg },
    danger:    { bg:C.redMid, color:"#fff", bd:C.redMid, hoverBg:C.red },
    dangerGhost:{ bg:C.redBg, color:C.red, bd:C.redBorder, hoverBg:"#FCDADA" },
  };
  const s = map[variant] || map.primary;
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={{
      padding:"7px 14px", borderRadius:6, border:"0.5px solid " + s.bd,
      background:s.bg, color:s.color, fontSize:11, fontWeight:600,
      cursor:disabled ? "not-allowed" : "pointer", fontFamily:"inherit",
      opacity:disabled ? 0.55 : 1, transition:"opacity 0.12s",
      ...(style || {}),
    }}>{children}</button>
  );
}

export function SectionHead({ title, subtitle, right }) {
  return (
    <div style={{
      display:"flex", alignItems:"flex-start", justifyContent:"space-between",
      marginBottom:12, gap:10, flexWrap:"wrap",
    }}>
      <div>
        <div style={{ fontSize:13, fontWeight:600, color:C.textPrimary }}>{title}</div>
        {subtitle && <div style={{ fontSize:11, color:C.textTertiary, marginTop:2 }}>{subtitle}</div>}
      </div>
      {right}
    </div>
  );
}

export function Field({ label, children }) {
  return (
    <div style={{ marginBottom:12 }}>
      <div style={{
        fontSize:11, fontWeight:600, color:C.textSecondary, marginBottom:5,
        textTransform:"uppercase", letterSpacing:"0.04em",
      }}>{label}</div>
      {children}
    </div>
  );
}

export function Input({ value, onChange, type = "text", placeholder, disabled, maxLength, inputMode }) {
  return (
    <input
      type={type} value={value ?? ""} placeholder={placeholder}
      disabled={disabled} maxLength={maxLength} inputMode={inputMode}
      onChange={(e) => onChange && onChange(e.target.value)}
      style={{
        width:"100%", padding:"9px 12px", border:"0.5px solid " + C.borderMid,
        borderRadius:7, fontSize:13, fontFamily:"inherit", color:C.textPrimary,
        background:C.bgPrimary, outline:"none", boxSizing:"border-box",
      }}
    />
  );
}

export function TextArea({ value, onChange, rows = 4, placeholder, disabled }) {
  return (
    <textarea value={value ?? ""} placeholder={placeholder} disabled={disabled} rows={rows}
      onChange={(e) => onChange && onChange(e.target.value)}
      style={{
        width:"100%", padding:"9px 12px", border:"0.5px solid " + C.borderMid,
        borderRadius:7, fontSize:13, fontFamily:"inherit", color:C.textPrimary,
        background:C.bgPrimary, outline:"none", boxSizing:"border-box", resize:"vertical",
      }}
    />
  );
}

export function Select({ value, onChange, options, disabled }) {
  return (
    <select value={value ?? ""} onChange={(e) => onChange && onChange(e.target.value)} disabled={disabled} style={{
      width:"100%", padding:"9px 12px", border:"0.5px solid " + C.borderMid,
      borderRadius:7, fontSize:13, fontFamily:"inherit", color:C.textPrimary,
      background:C.bgPrimary, outline:"none", cursor:"pointer", boxSizing:"border-box",
    }}>
      {options.map((o) => {
        const val = typeof o === "object" ? o.value : o;
        const lbl = typeof o === "object" ? o.label : o;
        return <option key={val} value={val}>{lbl}</option>;
      })}
    </select>
  );
}

export function Empty({ title, subtitle }) {
  return (
    <div style={{
      padding:"30px 20px", textAlign:"center", color:C.textTertiary,
      background:C.bgSecondary, borderRadius:8, border:"0.5px dashed " + C.borderMid,
    }}>
      <div style={{ fontSize:13, fontWeight:500, color:C.textSecondary, marginBottom:4 }}>{title}</div>
      {subtitle && <div style={{ fontSize:11 }}>{subtitle}</div>}
    </div>
  );
}

export function Toast({ show, msg, variant = "teal" }) {
  if (!show) return null;
  const colors = {
    teal:  { bg:C.tealBg,  color:C.teal,  bd:C.tealBorder },
    amber: { bg:C.amberBg, color:C.amber, bd:C.amberBorder },
    red:   { bg:C.redBg,   color:C.red,   bd:C.redBorder },
  };
  const s = colors[variant] || colors.teal;
  return (
    <div style={{
      background:s.bg, border:"0.5px solid " + s.bd, borderRadius:7,
      padding:"9px 14px", marginBottom:10, fontSize:12, color:s.color, fontWeight:600,
    }}>{msg}</div>
  );
}

export function InfoBox({ children, variant = "teal" }) {
  const colors = {
    teal:  { bg:C.tealBg,  color:C.tealDark,  bd:C.tealBorder },
    amber: { bg:C.amberBg, color:C.amber,     bd:C.amberBorder },
    blue:  { bg:C.blueBg,  color:C.blue,      bd:C.blueBorder },
    red:   { bg:C.redBg,   color:C.red,       bd:C.redBorder },
  };
  const s = colors[variant] || colors.teal;
  return (
    <div style={{
      background:s.bg, border:"0.5px solid " + s.bd, borderRadius:7,
      padding:"9px 13px", fontSize:11.5, color:s.color, lineHeight:1.55, marginBottom:10,
    }}>{children}</div>
  );
}

export const fmtDate = (d) => {
  if (!d) return "";
  try {
    return new Date(d).toLocaleDateString("en-US", { year:"numeric", month:"short", day:"numeric" });
  } catch { return String(d); }
};

export const fmtDateTime = (d) => {
  if (!d) return "";
  try {
    return new Date(d).toLocaleString("en-US", {
      month:"short", day:"numeric", year:"numeric", hour:"numeric", minute:"2-digit",
    });
  } catch { return String(d); }
};

export const fmtMoney = (n) => {
  const num = Number(n || 0);
  return "$" + num.toFixed(2);
};

export const slotToTime = (slot) => {
  const h = Math.floor(slot / 4);
  const m = (slot % 4) * 15;
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h === 0 ? 12 : (h > 12 ? h - 12 : h);
  return h12 + ":" + String(m).padStart(2, "0") + " " + ampm;
};
