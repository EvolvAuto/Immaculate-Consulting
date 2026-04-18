// ═══════════════════════════════════════════════════════════════════════════════
// src/main.jsx
// Vite entry. Mounts <AuthProvider><App /></AuthProvider> into #root.
// ═══════════════════════════════════════════════════════════════════════════════

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider } from "./auth/AuthProvider";
import App from "./App";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>
);
