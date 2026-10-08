import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import {
  useLocation,
  useNavigate,
} from "react-router-dom";

import {
  Alert,
  Box,
  Button,
  Card,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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

import { getSystemSettings } from "../../services/settingsService";

const INSTALLATION_ID_STORAGE_KEY =
  "lms_companion_installation_id";

const DEVICE_ID_STORAGE_KEY =
  "lms_companion_device_id";

export default function Login() {
  const location = useLocation();
  const navigate = useNavigate();

  const fromMobile =
    Boolean(location.state?.fromMobile);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  // ------------------------------------------------------------
  // Company branding
  // ------------------------------------------------------------

  const [companyName, setCompanyName] =
    useState("");

  const [companyLogoUrl, setCompanyLogoUrl] =
    useState("");

  const [mobileBrandingLoading, setMobileBrandingLoading] =
    useState(false);

  const [mobileDeviceChecking, setMobileDeviceChecking] =
    useState(false);

  const [mobileDeviceValid, setMobileDeviceValid] =
    useState(!fromMobile);

  // ------------------------------------------------------------
  // Forgot password
  // ------------------------------------------------------------

  const [forgotPasswordOpen, setForgotPasswordOpen] =
    useState(false);

  const [resetEmail, setResetEmail] =
    useState("");

  const [resetLoading, setResetLoading] =
    useState(false);

  const [resetMessage, setResetMessage] =
    useState("");

  const [resetError, setResetError] =
    useState("");

  // ------------------------------------------------------------
  // Mobile pairing validation
  // ------------------------------------------------------------

  useEffect(() => {
    let mounted = true;

    async function validateMobileDevice() {
      if (!fromMobile) {
        setMobileDeviceValid(true);
        return;
      }

      setMobileDeviceChecking(true);
      setMobileDeviceValid(false);

      try {
        let installationId = "";
        let deviceId = "";

        try {
          installationId =
            localStorage.getItem(
              INSTALLATION_ID_STORAGE_KEY
            ) || "";

          deviceId =
            localStorage.getItem(
              DEVICE_ID_STORAGE_KEY
            ) || "";
        } catch (storageError) {
          console.error(
            "MOBILE DEVICE STORAGE ERROR:",
            storageError
          );
        }

        if (!installationId || !deviceId) {
          console.warn(
            "MOBILE DEVICE NOT PAIRED:",
            {
              installationIdPresent:
                Boolean(installationId),
              deviceIdPresent:
                Boolean(deviceId),
            }
          );

          if (mounted) {
            setMobileDeviceValid(false);
          }

          navigate("/mobile", {
            replace: true,
          });

          return;
        }

        const {
          data,
          error,
        } = await supabase.rpc(
          "get_mobile_device_status",
          {
            p_device_id: deviceId,
          }
        );

        if (error) {
          throw error;
        }

        const isLinked =
          data?.is_linked === true;

        const isRevoked =
          data?.is_revoked === true;

        if (!isLinked || isRevoked) {
          console.warn(
            "MOBILE DEVICE NOT AUTHORIZED:",
            {
              isLinked,
              isRevoked,
            }
          );

          try {
            localStorage.removeItem(
              INSTALLATION_ID_STORAGE_KEY
            );
          } catch (storageError) {
            console.error(
              "FAILED TO CLEAR INSTALLATION ID:",
              storageError
            );
          }

          if (mounted) {
            setMobileDeviceValid(false);
          }

          navigate("/mobile", {
            replace: true,
          });

          return;
        }

        if (mounted) {
          setMobileDeviceValid(true);
        }
      } catch (error) {
        console.error(
          "MOBILE DEVICE VALIDATION ERROR:",
          error
        );

        if (mounted) {
          setMobileDeviceValid(false);
        }

        navigate("/mobile", {
          replace: true,
        });
      } finally {
        if (mounted) {
          setMobileDeviceChecking(false);
        }
      }
    }

    validateMobileDevice();

    return () => {
      mounted = false;
    };
  }, [fromMobile, navigate]);

  // ------------------------------------------------------------
  // Load company settings
  // ------------------------------------------------------------

  useEffect(() => {
    let mounted = true;

    async function loadCompanySettings() {
      try {
        if (fromMobile) {
          setMobileBrandingLoading(true);

          let installationId = "";

          try {
            installationId =
              localStorage.getItem(
                INSTALLATION_ID_STORAGE_KEY
              ) || "";
          } catch (storageError) {
            console.error(
              "MOBILE INSTALLATION STORAGE ERROR:",
              storageError
            );
          }

          if (!installationId) {
            throw new Error(
              "This mobile device is not linked to an LMS installation."
            );
          }

          const {
            data,
            error,
          } = await supabase.rpc(
            "get_mobile_installation_settings",
            {
              p_installation_id:
                installationId,
            }
          );

          if (error) {
            throw error;
          }

          if (!data?.success) {
            throw new Error(
              data?.message ||
                "Unable to load the LMS installation."
            );
          }

          if (!mounted) return;

          setCompanyName(
            data.company_name || ""
          );

          setCompanyLogoUrl(
            data.company_logo_url || ""
          );

          return;
        }

        /*
         * Desktop login continues using the
         * existing settings service.
         */
        const settings =
          await getSystemSettings();

        if (!mounted) return;

        setCompanyName(
          settings?.company_name || ""
        );

        setCompanyLogoUrl(
          settings?.company_logo_url || ""
        );
      } catch (error) {
        console.error(
          "LOGIN COMPANY SETTINGS ERROR:",
          error
        );

        if (!mounted) return;

        setCompanyName("");
        setCompanyLogoUrl("");
      } finally {
        if (mounted) {
          setMobileBrandingLoading(false);
        }
      }
    }

    loadCompanySettings();

    return () => {
      mounted = false;
    };
  }, [fromMobile]);

  // ------------------------------------------------------------
  // Login
  // ------------------------------------------------------------

  async function login() {
    if (loading) return;

    if (!email.trim() || !password) {
      alert(
        "Please enter your email address and password."
      );
      return;
    }

    // ----------------------------------------------------------
    // MOBILE PAIRING SECURITY CHECK
    // ----------------------------------------------------------

    if (fromMobile) {
      if (
        mobileDeviceChecking ||
        !mobileDeviceValid
      ) {
        alert(
          "This device is not paired with an LMS installation."
        );

        navigate("/mobile", {
          replace: true,
        });

        return;
      }

      let deviceId = "";

      try {
        deviceId =
          localStorage.getItem(
            DEVICE_ID_STORAGE_KEY
          ) || "";
      } catch (storageError) {
        console.error(
          "MOBILE DEVICE STORAGE ERROR:",
          storageError
        );
      }

      if (!deviceId) {
        alert(
          "This device is not paired with an LMS installation."
        );

        navigate("/mobile", {
          replace: true,
        });

        return;
      }

      // Re-check the pairing immediately before
      // allowing authentication.
      const {
        data: deviceStatus,
        error: deviceStatusError,
      } = await supabase.rpc(
        "get_mobile_device_status",
        {
          p_device_id: deviceId,
        }
      );

      if (deviceStatusError) {
        console.error(
          "MOBILE DEVICE STATUS ERROR:",
          deviceStatusError
        );

        alert(
          "Unable to verify this mobile device. Please pair the device again."
        );

        navigate("/mobile", {
          replace: true,
        });

        return;
      }

      if (
        deviceStatus?.is_linked !== true ||
        deviceStatus?.is_revoked === true
      ) {
        try {
          localStorage.removeItem(
            INSTALLATION_ID_STORAGE_KEY
          );
        } catch (storageError) {
          console.error(
            "FAILED TO CLEAR INSTALLATION ID:",
            storageError
          );
        }

        alert(
          "This device is not paired or its access has been revoked."
        );

        navigate("/mobile", {
          replace: true,
        });

        return;
      }
    }

    setLoading(true);

    const {
      error,
    } =
      await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

    if (error) {
      alert(error.message);
      setLoading(false);
      return;
    }

    if (fromMobile) {
      navigate("/mobile/application-review", {
        replace: true,
      });
    } else {
      navigate("/dashboard");
    }
  }

  // ------------------------------------------------------------
  // Forgot password
  // ------------------------------------------------------------

  function openForgotPassword() {
    setResetEmail(email.trim());
    setResetMessage("");
    setResetError("");
    setForgotPasswordOpen(true);
  }

  function closeForgotPassword() {
    if (resetLoading) return;

    setForgotPasswordOpen(false);
    setResetMessage("");
    setResetError("");
  }

  async function sendPasswordReset() {
    if (resetLoading) return;

    const emailAddress =
      resetEmail.trim();

    if (!emailAddress) {
      setResetError(
        "Please enter your email address."
      );
      setResetMessage("");
      return;
    }

    setResetLoading(true);
    setResetMessage("");
    setResetError("");

    try {
      const redirectUrl =
        `${window.location.origin}/reset-password`;

      const {
        error,
      } =
        await supabase.auth.resetPasswordForEmail(
          emailAddress,
          {
            redirectTo: redirectUrl,
          }
        );

      if (error) {
        throw error;
      }

      setResetMessage(
        "If an account exists for this email address, a password reset link has been sent. Please check your email."
      );
    } catch (error) {
      console.error(
        "PASSWORD RESET ERROR:",
        error
      );

      setResetError(
        error?.message ||
          "Unable to send the password reset email. Please try again."
      );
    } finally {
      setResetLoading(false);
    }
  }

  // ------------------------------------------------------------
  // Mobile validation loading screen
  // ------------------------------------------------------------

  if (
    fromMobile &&
    mobileDeviceChecking
  ) {
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
          px: 2,
        }}
      >
        <Stack
          alignItems="center"
          spacing={2}
        >
          <CircularProgress
            sx={{ color: "white" }}
          />

          <Typography
            sx={{
              color: "white",
              fontSize: 14,
            }}
          >
            Verifying device...
          </Typography>
        </Stack>
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
      {/* Decorative background elements */}

      <Box
        sx={{
          position: "absolute",
          width: 420,
          height: 420,
          borderRadius: "50%",
          background:
            "rgba(255,255,255,0.05)",
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
          background:
            "rgba(255,255,255,0.04)",
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
          background:
            "rgba(255,255,255,0.98)",
          boxShadow:
            "0 25px 70px rgba(0,0,0,0.25)",
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
          {companyLogoUrl ? (
            <Box
              sx={{
                width: 110,
                height: 110,
                borderRadius: 3,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "#FFFFFF",
                mb: 2,
                overflow: "hidden",
                boxShadow:
                  "0 10px 25px rgba(11,61,145,0.18)",
                border:
                  "1px solid #E5E7EB",
              }}
            >
              <Box
                component="img"
                src={companyLogoUrl}
                alt={`${companyName} logo`}
                sx={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  p: 1,
                  display: "block",
                }}
                onError={(event) => {
                  event.currentTarget.style.display =
                    "none";
                }}
              />
            </Box>
          ) : (
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
                boxShadow:
                  "0 10px 25px rgba(11,61,145,0.25)",
              }}
            >
              <AccountBalanceWalletOutlinedIcon
                sx={{ fontSize: 38 }}
              />
            </Box>
          )}

          <Typography
            variant="h4"
            sx={{
              fontWeight: 800,
              color: "#102A43",
              textAlign: "center",
              letterSpacing: "-0.5px",
            }}
          >
            {mobileBrandingLoading
              ? "Loading..."
              : companyName}
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
          onChange={(e) =>
            setEmail(e.target.value)
          }
          autoComplete="email"
          sx={{
            mb: 2,
            "& .MuiOutlinedInput-root": {
              borderRadius: 2,
              backgroundColor: "#F8FAFC",
            },
          }}
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

        {/* Password */}

        <TextField
          fullWidth
          type={showPassword ? "text" : "password"}
          label="Password"
          placeholder="Enter your password"
          value={password}
          onChange={(e) =>
            setPassword(e.target.value)
          }
          autoComplete="current-password"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              login();
            }
          }}
          sx={{
            mb: 1,
            "& .MuiOutlinedInput-root": {
              borderRadius: 2,
              backgroundColor: "#F8FAFC",
            },
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
                  <button
                    type="button"
                    onClick={() =>
                      setShowPassword((visible) => !visible)
                    }
                    onMouseDown={(event) =>
                      event.preventDefault()
                    }
                    aria-label={
                      showPassword
                        ? "Hide password"
                        : "Show password"
                    }
                    aria-pressed={showPassword}
                    style={{
                      border: 0,
                      background: "transparent",
                      padding: 6,
                      margin: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      color: "#64748B",
                    }}
                  >
                    {showPassword ? (
                      <svg
                        width="22"
                        height="22"
                        viewBox="0 0 24 24"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                        aria-hidden="true"
                      >
                        <path
                          d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <circle
                          cx="12"
                          cy="12"
                          r="2.5"
                          stroke="currentColor"
                          strokeWidth="2"
                        />
                      </svg>
                    ) : (
                      <svg
                        width="22"
                        height="22"
                        viewBox="0 0 24 24"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                        aria-hidden="true"
                      >
                        <path
                          d="M3 3l18 18"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                        <path
                          d="M10.6 5.2A10.7 10.7 0 0 1 12 5c6.5 0 10 7 10 7a18.5 18.5 0 0 1-3.1 3.8M6.2 6.2C3.4 8.1 2 12 2 12s3.5 7 10 7c1.5 0 2.8-.3 4-.8"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M9.9 9.9a3 3 0 0 0 4.2 4.2"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      </svg>
                    )}
                  </button>
                </InputAdornment>
              ),
            },
          }}
        />

        {/* Forgot password */}

        <Box
          sx={{
            display: "flex",
            justifyContent: "flex-end",
            mb: 2.5,
          }}
        >
          <Button
            variant="text"
            onClick={openForgotPassword}
            sx={{
              minWidth: 0,
              p: 0,
              textTransform: "none",
              fontSize: 14,
              fontWeight: 600,
              color: "#0B3D91",
              "&:hover": {
                backgroundColor:
                  "transparent",
                textDecoration:
                  "underline",
              },
            }}
          >
            Forgot Password?
          </Button>
        </Box>

        {/* Login button */}

        <Button
          fullWidth
          variant="contained"
          size="large"
          onClick={login}
          disabled={
            loading ||
            mobileBrandingLoading ||
            mobileDeviceChecking ||
            (fromMobile &&
              !mobileDeviceValid)
          }
          sx={{
            height: 52,
            borderRadius: 2,
            fontSize: 15,
            fontWeight: 700,
            textTransform: "none",
            background:
              "linear-gradient(135deg, #0B3D91 0%, #1257A6 100%)",
            boxShadow:
              "0 8px 20px rgba(11,61,145,0.25)",
            "&:hover": {
              background:
                "linear-gradient(135deg, #082F70 0%, #0B3D91 100%)",
              boxShadow:
                "0 10px 25px rgba(11,61,145,0.32)",
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
            borderTop:
              "1px solid #E5E7EB",
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

      {/* Forgot Password Dialog */}

      <Dialog
        open={forgotPasswordOpen}
        onClose={closeForgotPassword}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle
          sx={{
            fontWeight: 800,
            color: "#172B4D",
          }}
        >
          Reset Your Password
        </DialogTitle>

        <DialogContent>
          <Typography
            sx={{
              color: "#64748B",
              fontSize: 14,
              mb: 2.5,
            }}
          >
            Enter the email address associated with
            your account. We will send you a secure
            link to create a new password.
          </Typography>

          {resetMessage && (
            <Alert
              severity="success"
              sx={{
                mb: 2,
                borderRadius: 2,
              }}
            >
              {resetMessage}
            </Alert>
          )}

          {resetError && (
            <Alert
              severity="error"
              sx={{
                mb: 2,
                borderRadius: 2,
              }}
            >
              {resetError}
            </Alert>
          )}

          <TextField
            fullWidth
            type="email"
            label="Email address"
            placeholder="Enter your email"
            value={resetEmail}
            onChange={(e) => {
              setResetEmail(
                e.target.value
              );
              setResetMessage("");
              setResetError("");
            }}
            autoComplete="email"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                sendPasswordReset();
              }
            }}
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
            sx={{
              "& .MuiOutlinedInput-root": {
                borderRadius: 2,
                backgroundColor:
                  "#F8FAFC",
              },
            }}
          />
        </DialogContent>

        <DialogActions
          sx={{
            px: 3,
            pb: 3,
            gap: 1,
          }}
        >
          <Button
            onClick={closeForgotPassword}
            disabled={resetLoading}
            sx={{
              textTransform: "none",
              fontWeight: 600,
              color: "#64748B",
            }}
          >
            Cancel
          </Button>

          <Button
            variant="contained"
            onClick={sendPasswordReset}
            disabled={resetLoading}
            sx={{
              minWidth: 150,
              height: 42,
              borderRadius: 2,
              textTransform: "none",
              fontWeight: 700,
              background:
                "linear-gradient(135deg, #0B3D91 0%, #1257A6 100%)",
              "&:hover": {
                background:
                  "linear-gradient(135deg, #082F70 0%, #0B3D91 100%)",
              },
            }}
          >
            {resetLoading ? (
              <CircularProgress
                size={22}
                sx={{
                  color: "white",
                }}
              />
            ) : (
              "Send Reset Link"
            )}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}