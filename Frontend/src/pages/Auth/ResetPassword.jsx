import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  Alert,
  Box,
  Button,
  Card,
  CircularProgress,
  InputAdornment,
  TextField,
  Typography,
} from "@mui/material";

import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import AccountBalanceWalletOutlinedIcon from "@mui/icons-material/AccountBalanceWalletOutlined";

import { supabase } from "../../lib/supabase";

export default function ResetPassword() {
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [companyName, setCompanyName] = useState("Company");

  useEffect(() => {
    let mounted = true;

    async function checkSession() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!mounted) return;

        if (!session) {
          setError(
            "This password reset link is invalid or has expired. Please request a new password reset link."
          );
        }
      } catch (err) {
        console.error("RESET SESSION ERROR:", err);

        if (mounted) {
          setError(
            "Unable to verify the password reset session. Please request a new reset link."
          );
        }
      } finally {
        if (mounted) {
          setCheckingSession(false);
        }
      }
    }

    async function loadCompanySettings() {
      try {
        const {
          data,
          error,
        } = await supabase
          .from("system_settings")
          .select("company_name")
          .limit(1)
          .maybeSingle();

        if (error) {
          console.error(
            "Unable to load company settings:",
            error
          );
          return;
        }

        if (mounted) {
          setCompanyName(
            data?.company_name || "Company"
          );
        }
      } catch (err) {
        console.error(
          "Company settings error:",
          err
        );
      }
    }

    checkSession();
    loadCompanySettings();

    return () => {
      mounted = false;
    };
  }, []);

  async function updatePassword() {
    if (loading) return;

    setError("");
    setSuccess("");

    if (!password) {
      setError("Please enter a new password.");
      return;
    }

    if (password.length < 8) {
      setError("Your new password must be at least 8 characters long.");
      return;
    }

    if (!confirmPassword) {
      setError("Please confirm your new password.");
      return;
    }

    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }

    setLoading(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        throw new Error(
          "Your password reset session has expired. Please request a new reset link."
        );
      }

      const { error: updateError } =
        await supabase.auth.updateUser({
          password,
        });

      if (updateError) {
        throw updateError;
      }

      setSuccess(
        "Your password has been changed successfully. You can now sign in with your new password."
      );

      setPassword("");
      setConfirmPassword("");

      setTimeout(() => {
        navigate("/");
      }, 2000);
    } catch (err) {
      console.error("UPDATE PASSWORD ERROR:", err);

      setError(
        err?.message ||
          "Unable to update your password. Please request a new reset link."
      );
    } finally {
      setLoading(false);
    }
  }

  if (checkingSession) {
    return (
      <Box
        sx={{
          minHeight: "100vh",
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background:
            "linear-gradient(135deg, #071A35 0%, #0B3D91 50%, #1257A6 100%)",
        }}
      >
        <CircularProgress sx={{ color: "white" }} />
      </Box>
    );
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
      {/* Decorative background */}
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
        {/* Logo */}
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
            {companyName}
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

        <Typography
          variant="h6"
          sx={{
            fontWeight: 700,
            color: "#172B4D",
            mb: 0.5,
          }}
        >
          Create New Password
        </Typography>

        <Typography
          sx={{
            color: "#6B7280",
            fontSize: 14,
            mb: 3,
          }}
        >
          Enter a new password for your {companyName} account.
        </Typography>

        {error && (
          <Alert
            severity="error"
            sx={{
              mb: 2.5,
              borderRadius: 2,
            }}
          >
            {error}
          </Alert>
        )}

        {success && (
          <Alert
            severity="success"
            sx={{
              mb: 2.5,
              borderRadius: 2,
            }}
          >
            {success}
          </Alert>
        )}

        <TextField
          fullWidth
          type="password"
          label="New Password"
          placeholder="Enter new password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError("");
            setSuccess("");
          }}
          autoComplete="new-password"
          disabled={loading || Boolean(success)}
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
                <LockOutlinedIcon sx={{ color: "#64748B" }} />
              </InputAdornment>
            ),
          }}
        />

        <TextField
          fullWidth
          type="password"
          label="Confirm New Password"
          placeholder="Confirm new password"
          value={confirmPassword}
          onChange={(e) => {
            setConfirmPassword(e.target.value);
            setError("");
            setSuccess("");
          }}
          autoComplete="new-password"
          disabled={loading || Boolean(success)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              updatePassword();
            }
          }}
          sx={{
            mb: 1,
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

        <Typography
          sx={{
            color: "#94A3B8",
            fontSize: 12,
            mb: 3,
          }}
        >
          Password must be at least 8 characters long.
        </Typography>

        <Button
          fullWidth
          variant="contained"
          size="large"
          onClick={updatePassword}
          disabled={loading || Boolean(success)}
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
            },
          }}
        >
          {loading ? (
            <CircularProgress
              size={24}
              sx={{ color: "white" }}
            />
          ) : (
            "Update Password"
          )}
        </Button>

        <Button
          fullWidth
          variant="text"
          onClick={() => navigate("/")}
          disabled={loading}
          sx={{
            mt: 1.5,
            textTransform: "none",
            fontWeight: 600,
            color: "#0B3D91",
          }}
        >
          Back to Sign In
        </Button>

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
            {companyName}
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
