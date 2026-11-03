import { useContext, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Box, CircularProgress, Typography } from "@mui/material";
import { AuthContext } from "../../context/AuthContext";
export default function MobileLanding() {
  const { user, loading } = useContext(AuthContext);
  const navigate = useNavigate();
  useEffect(() => { if (!loading) navigate(user ? "/mobile/preview" : "/mobile/login", { replace: true }); }, [user, loading, navigate]);
  return <Box sx={{ minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}><CircularProgress /><Typography color="text.secondary">Opening Umhlomunye Finance...</Typography></Box>;
}