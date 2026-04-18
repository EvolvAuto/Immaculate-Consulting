// ═══════════════════════════════════════════════════════════════════════════════
// src/auth/ProtectedRoute.jsx
// Gatekeeper: only renders children when the user is authenticated AND
// (optionally) has one of the allowed roles. Shows loading state while
// the session hydrates; redirects to <LoginScreen/> if unauthenticated.
// ═══════════════════════════════════════════════════════════════════════════════

import { useAuth } from "./AuthProvider";
import LoginScreen from "./LoginScreen";
import { C } from "../lib/tokens";

export default function ProtectedRoute({ allowedRoles, children }) {
  const { loading, isAuthenticated, role } = useAuth();

  if (loading) {
    return (
      <div style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: C.bgSecondary,
        color: C.textSecondary,
        fontSize: 14,
      }}>
        Loading your practice...
      </div>
    );
  }

  if (!isAuthenticated) return <LoginScreen />;

  if (Array.isArray(allowedRoles) && allowedRoles.length > 0 && !allowedRoles.includes(role)) {
    return (
      <div style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: C.bgSecondary,
        color: C.textPrimary,
        padding: 24,
        textAlign: "center",
      }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Access restricted</div>
        <div style={{ fontSize: 13, color: C.textSecondary, maxWidth: 400 }}>
          Your role ({role || "unknown"}) does not have permission to view this area.
          Contact your practice manager if you believe this is an error.
        </div>
      </div>
    );
  }

  return children;
}
