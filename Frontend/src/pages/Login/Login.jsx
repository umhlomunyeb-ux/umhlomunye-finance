import { useState } from "react";
import { supabase } from "../../lib/supabase";
import { useNavigate } from "react-router-dom";

import {
  Box,
  Button,
  Card,
  CircularProgress,
  InputAdornment,
  TextField,
  Typography,
} from "@mui/material";

import EmailOutlinedIcon from "@mui/icons-material/EmailOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import AccountBalanceWalletOutlinedIcon from "@mui/icons-material/AccountBalanceWalletOutlined";

export default function Login() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function login() {
    if (loading) return;

    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      alert(error.message);
      setLoading(false);
      return;
    }

    navigate("/dashboard");
  }

  return (
    <Box
      sx={{
        minHeight: "100vh",
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        overflow: "hidden",
        background:
          "linear-gradient(135deg, #071A35 0%, #0B3D91 50%, #1257A6 100%)",
        px: 2,
      }}
    >
      {/* Decorative background elements */}
      <Box
        sx={{
          position: "absolute",
          width: 420,
          height: 420,
          borderRadius: "50%",
          background: "rgba(255,255,255,0.05)",
          top: -180,
          right: -120,
        }}
      />

      <Box
        sx={{
          position: "absolute",
          width: 320,
          height: 320,
          borderRadius: "50%",
          background: "rgba(255,255,255,0.04)",
          bottom: -140,
          left: -100,
        }}
      />

      {/* Login card */}
      <Card
        elevation={0}
        sx={{
          width: "100%",
          maxWidth: 430,
          borderRadius: 4,
          p: {
            xs: 3,
            sm: 5,
          },
          position: "relative",
          zIndex: 2,
          background: "rgba(255,255,255,0.98)",
          boxShadow: "0 25px 70px rgba(0,0,0,0.25)",
        }}
      >
        {/* Logo / Brand */}
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            mb: 4,
          }}
        >
          <Box
            sx={{
              width: 72,
              height: 72,
              borderRadius: 3,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background:
                "linear-gradient(135deg, #0B3D91 0%, #1257A6 100%)",
              color: "white",
              mb: 2,
              boxShadow: "0 10px 25px rgba(11,61,145,0.25)",
            }}
          >
            <AccountBalanceWalletOutlinedIcon sx={{ fontSize: 38 }} />
          </Box>

          <Typography
            variant="h4"
            sx={{
              fontWeight: 800,
              color: "#102A43",
              textAlign: "center",
              letterSpacing: "-0.5px",
            }}
          >
            Umhlomunye Finance
          </Typography>

          <Typography
            sx={{
              mt: 0.8,
              color: "#6B7280",
              fontSize: 14,
              textAlign: "center",
            }}
          >
            Loan Management System
          </Typography>
        </Box>

        {/* Welcome */}
        <Box sx={{ mb: 3 }}>
          <Typography
            variant="h6"
            sx={{
              fontWeight: 700,
              color: "#172B4D",
            }}
          >
            Welcome back
          </Typography>

          <Typography
            sx={{
              color: "#6B7280",
              fontSize: 14,
              mt: 0.5,
            }}
          >
            Sign in to access your finance dashboard.
          </Typography>
        </Box>

        {/* Email */}
        <TextField
          fullWidth
          type="email"
          label="Email address"
          placeholder="Enter your email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          sx={{
            mb: 2,
            "& .MuiOutlinedInput-root": {
              borderRadius: 2,
              backgroundColor: "#F8FAFC",
            },
          }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <EmailOutlinedIcon sx={{ color: "#64748B" }} />
              </InputAdornment>
            ),
          }}
        />

        {/* Password */}
        <TextField
          fullWidth
          type="password"
          label="Password"
          placeholder="Enter your password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              login();
            }
          }}
          sx={{
            mb: 3,
            "& .MuiOutlinedInput-root": {
              borderRadius: 2,
              backgroundColor: "#F8FAFC",
            },
          }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <LockOutlinedIcon sx={{ color: "#64748B" }} />
              </InputAdornment>
            ),
          }}
        />

        {/* Login button */}
        <Button
          fullWidth
          variant="contained"
          size="large"
          onClick={login}
          disabled={loading}
          sx={{
            height: 52,
            borderRadius: 2,
            fontSize: 15,
            fontWeight: 700,
            textTransform: "none",
            background:
              "linear-gradient(135deg, #0B3D91 0%, #1257A6 100%)",
            boxShadow: "0 8px 20px rgba(11,61,145,0.25)",
            "&:hover": {
              background:
                "linear-gradient(135deg, #082F70 0%, #0B3D91 100%)",
              boxShadow: "0 10px 25px rgba(11,61,145,0.32)",
            },
          }}
        >
          {loading ? (
            <CircularProgress
              size={24}
              sx={{
                color: "white",
              }}
            />
          ) : (
            "Sign In"
          )}
        </Button>

        {/* Footer */}
        <Box
          sx={{
            mt: 4,
            pt: 3,
            borderTop: "1px solid #E5E7EB",
            textAlign: "center",
          }}
        >
          <Typography
            sx={{
              fontSize: 12,
              color: "#94A3B8",
            }}
          >
            Umhlomunye Finance
          </Typography>

          <Typography
            sx={{
              fontSize: 11,
              color: "#CBD5E1",
              mt: 0.5,
            }}
          >
            Secure Loan Management
          </Typography>
        </Box>
      </Card>
    </Box>
  );
}
