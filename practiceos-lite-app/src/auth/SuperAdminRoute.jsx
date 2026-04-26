// ═══════════════════════════════════════════════════════════════════════════════
// src/auth/SuperAdminRoute.jsx
// Layer 2 of three-layer super admin defense:
//   Layer 1 (cosmetic): rail item conditionally rendered in Layout.jsx
//   Layer 2 (route): this wrapper, redirects non-super-admins
//   Layer 3 (database): RLS policies on every admin table check is_super_admin()
//
// If anything fails between layers 1 and 2, this catches the user before any
// admin component mounts and bounces them to /dashboard. Even if THIS fails,
// the database returns no rows.
// ═══════════════════════════════════════════════════════════════════════════════

import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { C } from "../lib/tokens";

export default function SuperAdminRoute({ children }) {
  const { loading, isAuthenticated, isSuperAdmin } = useAuth();

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
        Loading...
      </div>
    );
  }

  if (!isAuthenticated) return <Navigate to="/dashboard" replace />;
  if (!isSuperAdmin)    return <Navigate to="/dashboard" replace />;

  return children;
}
