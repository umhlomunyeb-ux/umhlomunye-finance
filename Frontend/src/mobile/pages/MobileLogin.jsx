import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  InputAdornment,
  IconButton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import EmailOutlinedIcon from "@mui/icons-material/EmailOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import VisibilityOffOutlinedIcon from "@mui/icons-material/VisibilityOffOutlined";
import AccountBalanceWalletOutlinedIcon from "@mui/icons-material/AccountBalanceWalletOutlined";
import { supabase } from "../../lib/supabase";

const INSTALLATION_ID_STORAGE_KEY = "lms_companion_installation_id";
const DEVICE_ID_STORAGE_KEY = "lms_companion_device_id";

export default function MobileLogin() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyLogoUrl, setCompanyLogoUrl] = useState("");

  useEffect(() => {
    let mounted = true;

    async function initialize() {
      try {
        let deviceId = "";
        let installationId = "";

        try {
          deviceId =
            localStorage.getItem(DEVICE_ID_STORAGE_KEY) || "";
          installationId =
            localStorage.getItem(INSTALLATION_ID_STORAGE_KEY) || "";
        } catch {}

        if (!deviceId || !installationId) {
          throw new Error(
            "This mobile device is not paired with an LMS installation."
          );
        }

        const { data, error: deviceError } =
          await supabase.rpc("get_mobile_device_status", {
            p_device_id: deviceId,
          });

        if (deviceError) throw deviceError;

        const deviceStatus = Array.isArray(data)
          ? data[0]
          : data;

        if (
          deviceStatus?.is_linked !== true ||
          deviceStatus?.is_revoked === true ||
          deviceStatus?.installation_id !== installationId
        ) {
          throw new Error(
            "This mobile device is not authorized. Please pair it again."
          );
        }

        const { data: sessionData, error: sessionError } =
          await supabase.auth.getSession();

        if (sessionError) throw sessionError;

        if (sessionData?.session?.user) {
          navigate("/mobile/application-review", {
            replace: true,
          });
          return;
        }

        const {
          data: brandingData,
          error: brandingError,
        } = await supabase.rpc(
          "get_mobile_installation_settings",
          {
            p_installation_id: installationId,
          }
        );

        if (brandingError) throw brandingError;

        if (!brandingData?.success) {
          throw new Error(
            brandingData?.message ||
              "Unable to load the linked LMS installation."
          );
        }

        if (!mounted) return;

        setCompanyName(
          brandingData.company_name || ""
        );

        setCompanyLogoUrl(
          brandingData.company_logo_url || ""
        );
      } catch (err) {
        console.error(
          "MOBILE LOGIN INITIALIZATION ERROR:",
          err
        );

        if (!mounted) return;

        setError(
          err?.message ||
            "Unable to open the mobile LMS login."
        );
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    initialize();

    return () => {
      mounted = false;
    };
  }, [navigate]);

  async function login() {
    if (signingIn) return;

    if (!email.trim() || !password) {
      setError(
        "Please enter your email address and password."
      );
      return;
    }

    setSigningIn(true);
    setError("");

    try {
      let deviceId = "";
      let installationId = "";

      try {
        deviceId =
          localStorage.getItem(
            DEVICE_ID_STORAGE_KEY
          ) || "";

        installationId =
          localStorage.getItem(
            INSTALLATION_ID_STORAGE_KEY
          ) || "";
      } catch {}

      if (!deviceId || !installationId) {
        throw new Error(
          "This mobile device is not paired with an LMS installation."
        );
      }

      const {
        data,
        error: deviceError,
      } =
        await supabase.rpc(
          "get_mobile_device_status",
          {
            p_device_id: deviceId,
          }
        );

      if (deviceError) throw deviceError;

      const deviceStatus = Array.isArray(data)
        ? data[0]
        : data;

      if (
        deviceStatus?.is_linked !== true ||
        deviceStatus?.is_revoked === true ||
        deviceStatus?.installation_id !==
          installationId
      ) {
        throw new Error(
          "This mobile device is not authorized. Please pair it again."
        );
      }

      const {
        error: authError,
      } =
        await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

      if (authError) throw authError;

      navigate(
        "/mobile/application-review",
        {
          replace: true,
        }
      );
    } catch (err) {
      console.error(
        "MOBILE LOGIN ERROR:",
        err
      );

      setError(
        err?.message ||
          "Unable to sign in."
      );
    } finally {
      setSigningIn(false);
    }
  }

  if (loading) {
    return (
      <Box
        sx={{
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background:
            "linear-gradient(135deg, #071A35 0%, #0B3D91 50%, #1257A6 100%)",
          px: 2,
        }}
      >
        <CircularProgress
          sx={{ color: "white" }}
        />
      </Box>
    );
  }

  return (
    <Box
      sx={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background:
          "linear-gradient(135deg, #071A35 0%, #0B3D91 50%, #1257A6 100%)",
        px: 2,
        py: 3,
      }}
    >
      <Card
        elevation={0}
        sx={{
          width: "100%",
          maxWidth: 420,
          borderRadius: 4,
          backgroundColor:
            "rgba(255,255,255,0.98)",
          boxShadow:
            "0 25px 70px rgba(0,0,0,0.25)",
        }}
      >
        <CardContent
          sx={{
            p: {
              xs: 3,
              sm: 4,
            },
          }}
        >
          <Stack spacing={3}>
            <Stack
              spacing={1}
              alignItems="center"
            >
              {companyLogoUrl ? (
                <Box
                  component="img"
                  src={companyLogoUrl}
                  alt={
                    companyName
                      ? `${companyName} logo`
                      : "Company logo"
                  }
                  sx={{
                    width: 88,
                    height: 88,
                    objectFit: "contain",
                    borderRadius: 2,
                  }}
                />
              ) : (
                <Box
                  sx={{
                    width: 72,
                    height: 72,
                    borderRadius: 3,
                    display: "flex",
                    alignItems: "center",
                    justifyContent:
                      "center",
                    background:
                      "linear-gradient(135deg, #0B3D91 0%, #1257A6 100%)",
                    color: "white",
                  }}
                >
                  <AccountBalanceWalletOutlinedIcon
                    sx={{ fontSize: 38 }}
                  />
                </Box>
              )}

              <Typography
                variant="h5"
                sx={{
                  fontWeight: 800,
                  color: "#102A43",
                  textAlign: "center",
                }}
              >
                {companyName ||
                  "Loan Management System"}
              </Typography>

              <Typography
                sx={{
                  color: "#6B7280",
                  fontSize: 14,
                  textAlign: "center",
                }}
              >
                Mobile Application Review
              </Typography>
            </Stack>

            {error && (
              <Alert severity="error">
                {error}
              </Alert>
            )}

            <TextField
              fullWidth
              type="email"
              label="Email address"
              value={email}
              onChange={(event) =>
                setEmail(event.target.value)
              }
              autoComplete="email"
              disabled={signingIn}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <EmailOutlinedIcon
                        sx={{
                          color: "#64748B",
                        }}
                      />
                    </InputAdornment>
                  ),
                },
              }}
            />

            <TextField
              fullWidth
              type={
                showPassword
                  ? "text"
                  : "password"
              }
              label="Password"
              value={password}
              onChange={(event) =>
                setPassword(event.target.value)
              }
              autoComplete="current-password"
              disabled={signingIn}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  login();
                }
              }}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <LockOutlinedIcon
                        sx={{
                          color: "#64748B",
                        }}
                      />
                    </InputAdornment>
                  ),
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        edge="end"
                        onClick={() =>
                          setShowPassword(
                            (current) =>
                              !current
                          )
                        }
                        onMouseDown={(event) =>
                          event.preventDefault()
                        }
                        aria-label={
                          showPassword
                            ? "Hide password"
                            : "Show password"
                        }
                      >
                        {showPassword ? (
                          <VisibilityOffOutlinedIcon
                            sx={{
                              color:
                                "#64748B",
                            }}
                          />
                        ) : (
                          <VisibilityOutlinedIcon
                            sx={{
                              color:
                                "#64748B",
                            }}
                          />
                        )}
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
            />

            <Button
              fullWidth
              variant="contained"
              size="large"
              onClick={login}
              disabled={signingIn}
              sx={{
                minHeight: 52,
                borderRadius: 2,
                textTransform: "none",
                fontWeight: 700,
              }}
            >
              {signingIn ? (
                <CircularProgress
                  size={22}
                  color="inherit"
                />
              ) : (
                "Login"
              )}
            </Button>

            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                textAlign: "center",
              }}
            >
              This browser is paired to the
              LMS mobile review interface.
            </Typography>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
