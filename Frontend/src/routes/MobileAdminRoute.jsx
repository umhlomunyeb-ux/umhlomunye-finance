import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Alert, Box, CircularProgress } from "@mui/material";
import { isCurrentUserAdmin } from "../services/userService";

export default function MobileAdminRoute({ children }) {
  const [state, setState] = useState({ loading: true, allowed: false, error: "" });

  useEffect(() => {
    let active = true;
    isCurrentUserAdmin().then((allowed) => {
      if (active) setState({ loading: false, allowed: Boolean(allowed), error: "" });
    }).catch((error) => {
      if (active) setState({ loading: false, allowed: false, error: error?.message || "Unable to verify administrator access." });
    });
    return () => { active = false; };
  }, []);

  if (state.loading) return <Box sx={{ minHeight: "100dvh", display: "grid", placeItems: "center" }}><CircularProgress /></Box>;
  if (state.error) return <Box sx={{ p: 2 }}><Alert severity="error">{state.error}</Alert></Box>;
  if (!state.allowed) return <Navigate to="/mobile/login" replace />;
  return children;
}
