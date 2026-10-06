import { Box } from "@mui/material";
import { useNavigate } from "react-router-dom";

import Dashboard from "../../pages/Dashboard/Dashboard";

export default function MobileDashboard() {
  const navigate = useNavigate();

  return (
    <Box
      sx={{
        minHeight: "100dvh",
        bgcolor: "#f4f6f9",
        pb: 8,
      }}
    >
      <Dashboard />

      <Box
        component="nav"
        sx={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 1200,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 1,
          p: 1,
          bgcolor: "background.paper",
          borderTop: "1px solid",
          borderColor: "divider",
          boxShadow: 4,
        }}
      >
        <Box
          component="button"
          type="button"
          onClick={() => navigate("/mobile/dashboard")}
          sx={{
            minHeight: 48,
            border: 0,
            borderRadius: 2,
            bgcolor: "primary.main",
            color: "primary.contrastText",
            font: "inherit",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Dashboard
        </Box>

        <Box
          component="button"
          type="button"
          onClick={() => navigate("/mobile/application-review")}
          sx={{
            minHeight: 48,
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 2,
            bgcolor: "background.paper",
            color: "text.primary",
            font: "inherit",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Loan Review
        </Box>
      </Box>
    </Box>
  );
}
