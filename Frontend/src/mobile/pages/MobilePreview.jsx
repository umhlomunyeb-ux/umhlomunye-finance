import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material";

import DashboardIcon from "@mui/icons-material/Dashboard";
import AssignmentIcon from "@mui/icons-material/Assignment";
import ArrowForwardIosIcon from "@mui/icons-material/ArrowForwardIos";

import { supabase } from "../../lib/supabase";

const INSTALLATION_ID_STORAGE_KEY =
  "lms_companion_installation_id";

function money(value) {
  return `R ${Number(value || 0).toLocaleString("en-ZA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function getStoredInstallationId() {
  try {
    return (
      localStorage.getItem(
        INSTALLATION_ID_STORAGE_KEY
      ) || ""
    );
  } catch {
    return "";
  }
}

export default function MobilePreview() {
  const navigate = useNavigate();

  const [loans, setLoans] = useState([]);
  const [applications, setApplications] = useState([]);

  const [companyName, setCompanyName] =
    useState("LMS");

  const [mobileAppName, setMobileAppName] =
    useState("LMS");

  const [companyLogoUrl, setCompanyLogoUrl] =
    useState("");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadMobileDashboard = useCallback(
    async () => {
      try {
        setError("");

        const installationId =
          getStoredInstallationId();

        if (!installationId) {
          throw new Error(
            "This device is not paired with an LMS installation."
          );
        }

        const [
          settingsResult,
          loansResult,
          applicationsResult,
        ] = await Promise.all([
          supabase.rpc(
            "get_mobile_installation_settings",
            {
              p_installation_id:
                installationId,
            }
          ),

          supabase
            .from("loans")
            .select("*")
            .eq("is_deleted", false)
            .order("created_at", {
              ascending: false,
            }),

          supabase
            .from("loan_applications")
            .select("*")
            .eq("status", "PENDING")
            .order("created_at", {
              ascending: false,
            }),
        ]);

        if (settingsResult.error) {
          throw settingsResult.error;
        }

        if (loansResult.error) {
          throw loansResult.error;
        }

        if (applicationsResult.error) {
          throw applicationsResult.error;
        }

        const settings =
          settingsResult.data;

        if (
          !settings ||
          settings.success === false
        ) {
          throw new Error(
            settings?.message ||
              "Unable to load LMS installation settings."
          );
        }

        setCompanyName(
          settings.company_name ||
            "LMS"
        );

        setMobileAppName(
          settings.mobile_app_name ||
            settings.short_name ||
            "LMS"
        );

        setCompanyLogoUrl(
          settings.company_logo_url || ""
        );

        setLoans(
          loansResult.data || []
        );

        setApplications(
          applicationsResult.data || []
        );
      } catch (err) {
        console.error(
          "MOBILE DASHBOARD ERROR:",
          err
        );

        setError(
          err?.message ||
            "Unable to load dashboard data."
        );
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    loadMobileDashboard();
  }, [loadMobileDashboard]);

  useEffect(() => {
    const refreshInterval =
      setInterval(() => {
        loadMobileDashboard();
      }, 30000);

    return () => {
      clearInterval(refreshInterval);
    };
  }, [loadMobileDashboard]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (
        document.visibilityState ===
        "visible"
      ) {
        loadMobileDashboard();
      }
    };

    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange
    );

    return () => {
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange
      );
    };
  }, [loadMobileDashboard]);

  useEffect(() => {
    const channel = supabase
      .channel(
        "mobile-dashboard-realtime"
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "loans",
        },
        () => {
          loadMobileDashboard();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "loan_applications",
        },
        () => {
          loadMobileDashboard();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadMobileDashboard]);

  const totalDisbursed = useMemo(
    () =>
      loans.reduce(
        (sum, loan) =>
          sum +
          Number(
            loan.principal_amount || 0
          ),
        0
      ),
    [loans]
  );

  const totalInterest = useMemo(
    () =>
      loans.reduce(
        (sum, loan) =>
          sum +
          Number(
            loan.interest_amount || 0
          ),
        0
      ),
    [loans]
  );

  const amountExpected = useMemo(
    () =>
      totalDisbursed +
      totalInterest,
    [totalDisbursed, totalInterest]
  );

  const handleHome = () => {
    navigate("/mobile/preview");
  };

  const handleReviewApplications =
    () => {
      navigate(
        "/mobile/application-review"
      );
    };

  if (loading) {
    return (
      <Box
        sx={{
          minHeight: "100dvh",
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f5f7fa",
        }}
      >
        <Stack
          alignItems="center"
          spacing={2}
        >
          <CircularProgress />

          <Typography color="text.secondary">
            Loading dashboard...
          </Typography>
        </Stack>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        minHeight: "100dvh",
        width: "100%",
        background: "#f5f7fa",
        boxSizing: "border-box",
        pb: 10,
      }}
    >
      {/* Header */}
      <Box
        sx={{
          background: "#102a43",
          color: "#fff",
          px: 2,
          pt: 3,
          pb: 3,
          borderBottomLeftRadius: 24,
          borderBottomRightRadius: 24,
        }}
      >
        <Stack
          direction="row"
          spacing={1.5}
          alignItems="center"
        >
          <Box
            sx={{
              width: 48,
              height: 48,
              borderRadius: 2,
              background: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
              flexShrink: 0,
            }}
          >
            {companyLogoUrl ? (
              <Box
                component="img"
                src={companyLogoUrl}
                alt={companyName}
                sx={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  p: 0.5,
                }}
              />
            ) : (
              <Typography
                sx={{
                  color: "#102a43",
                  fontWeight: 800,
                  fontSize: 14,
                }}
              >
                LMS
              </Typography>
            )}
          </Box>

          <Box sx={{ minWidth: 0 }}>
            <Typography
              sx={{
                fontWeight: 800,
                fontSize: 19,
                lineHeight: 1.2,
              }}
            >
              {mobileAppName}
            </Typography>

            <Typography
              sx={{
                fontSize: 13,
                opacity: 0.8,
                mt: 0.5,
              }}
            >
              {companyName}
            </Typography>
          </Box>
        </Stack>
      </Box>

      {/* Content */}
      <Box
        sx={{
          width: "100%",
          maxWidth: 600,
          mx: "auto",
          px: 2,
          pt: 2.5,
          boxSizing: "border-box",
        }}
      >
        <Typography
          sx={{
            fontSize: 23,
            fontWeight: 800,
            color: "#102a43",
            mb: 2,
          }}
        >
          Dashboard
        </Typography>

        {error && (
          <Alert
            severity="error"
            sx={{
              mb: 2,
              borderRadius: 2,
            }}
          >
            {error}
          </Alert>
        )}

        {/* Financial Cards */}
        <Stack spacing={1.5}>
          <Card
            elevation={0}
            sx={{
              borderRadius: 3,
              border: "1px solid #e1e8ed",
            }}
          >
            <CardContent sx={{ p: 2.2 }}>
              <Typography
                sx={{
                  color: "#627d98",
                  fontSize: 14,
                  mb: 0.8,
                }}
              >
                Amount Borrowed
              </Typography>

              <Typography
                sx={{
                  fontSize: 26,
                  fontWeight: 800,
                  color: "#102a43",
                }}
              >
                {money(totalDisbursed)}
              </Typography>

              <Typography
                sx={{
                  color: "#627d98",
                  fontSize: 12,
                  mt: 0.5,
                }}
              >
                Total principal disbursed
              </Typography>
            </CardContent>
          </Card>

          <Card
            elevation={0}
            sx={{
              borderRadius: 3,
              border: "1px solid #e1e8ed",
            }}
          >
            <CardContent sx={{ p: 2.2 }}>
              <Typography
                sx={{
                  color: "#627d98",
                  fontSize: 14,
                  mb: 0.8,
                }}
              >
                Amount Expected
              </Typography>

              <Typography
                sx={{
                  fontSize: 26,
                  fontWeight: 800,
                  color: "#102a43",
                }}
              >
                {money(amountExpected)}
              </Typography>

              <Typography
                sx={{
                  color: "#627d98",
                  fontSize: 12,
                  mt: 0.5,
                }}
              >
                Principal plus contracted interest
              </Typography>
            </CardContent>
          </Card>

          <Card
            elevation={0}
            sx={{
              borderRadius: 3,
              border: "1px solid #e1e8ed",
            }}
          >
            <CardContent sx={{ p: 2.2 }}>
              <Typography
                sx={{
                  color: "#627d98",
                  fontSize: 14,
                  mb: 0.8,
                }}
              >
                Interest Expected
              </Typography>

              <Typography
                sx={{
                  fontSize: 26,
                  fontWeight: 800,
                  color: "#102a43",
                }}
              >
                {money(totalInterest)}
              </Typography>

              <Typography
                sx={{
                  color: "#627d98",
                  fontSize: 12,
                  mt: 0.5,
                }}
              >
                Contracted interest
              </Typography>
            </CardContent>
          </Card>
        </Stack>

        {/* Applications */}
        <Card
          elevation={0}
          sx={{
            mt: 2.5,
            borderRadius: 3,
            border: "1px solid #e1e8ed",
          }}
        >
          <CardContent sx={{ p: 2.2 }}>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="flex-start"
              spacing={2}
            >
              <Box>
                <Typography
                  sx={{
                    fontWeight: 800,
                    fontSize: 17,
                    color: "#102a43",
                  }}
                >
                  Pending Applications
                </Typography>

                <Typography
                  sx={{
                    color: "#627d98",
                    fontSize: 13,
                    mt: 0.5,
                  }}
                >
                  Applications waiting for review
                </Typography>
              </Box>

              <Chip
                label={applications.length}
                sx={{
                  fontWeight: 800,
                  borderRadius: 2,
                }}
              />
            </Stack>

            <Box
              onClick={
                handleReviewApplications
              }
              sx={{
                mt: 2,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                p: 1.5,
                borderRadius: 2,
                background: "#f7f9fc",
                cursor: "pointer",
                transition:
                  "background 0.2s ease",
                "&:hover": {
                  background: "#edf2f7",
                },
              }}
            >
              <Typography
                sx={{
                  fontWeight: 700,
                  fontSize: 14,
                }}
              >
                Review Applications
              </Typography>

              <ArrowForwardIosIcon
                sx={{
                  fontSize: 16,
                  color: "#627d98",
                }}
              />
            </Box>
          </CardContent>
        </Card>
      </Box>

      {/* Mobile Bottom Navigation */}
      <Box
        sx={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          height: 70,
          background: "#fff",
          borderTop: "1px solid #e1e8ed",
          display: "flex",
          justifyContent: "space-around",
          alignItems: "center",
          zIndex: 1000,
        }}
      >
        {/* Home */}
        <Box
          onClick={handleHome}
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            color: "#102a43",
            cursor: "pointer",
            minWidth: 80,
          }}
        >
          <DashboardIcon />

          <Typography
            sx={{
              fontSize: 11,
              mt: 0.3,
            }}
          >
            Home
          </Typography>
        </Box>

        {/* Applications */}
        <Box
          onClick={
            handleReviewApplications
          }
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            color: "#627d98",
            cursor: "pointer",
            minWidth: 80,
          }}
        >
          <AssignmentIcon />

          <Typography
            sx={{
              fontSize: 11,
              mt: 0.3,
            }}
          >
            Applications
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
