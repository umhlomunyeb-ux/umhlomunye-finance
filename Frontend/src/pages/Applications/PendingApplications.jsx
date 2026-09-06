import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Paper,
  Stack,
  Typography,
} from "@mui/material";

import RefreshIcon from "@mui/icons-material/Refresh";
import NotificationsActiveIcon from "@mui/icons-material/NotificationsActive";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";

import { supabase } from "../../lib/supabase";

export default function PendingApplications() {
  const navigate = useNavigate();

  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const loadPendingApplications = useCallback(
    async (showRefreshing = false) => {
      try {
        if (showRefreshing) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }

        setError("");

        const { data, error: queryError } = await supabase
          .from("loan_applications")
          .select("*")
          .eq("status", "PENDING")
          .order("created_at", {
            ascending: false,
          });

        if (queryError) {
          throw queryError;
        }

        setApplications(data || []);
      } catch (err) {
        console.error(
          "Unable to load pending applications:",
          err
        );

        setError(
          err?.message ||
            "Unable to load pending applications."
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );

  // --------------------------------------------------
  // INITIAL LOAD
  // --------------------------------------------------

  useEffect(() => {
    loadPendingApplications();
  }, [loadPendingApplications]);

  // --------------------------------------------------
  // AUTOMATIC REFRESH
  // --------------------------------------------------

  useEffect(() => {
    const interval = setInterval(() => {
      loadPendingApplications(true);
    }, 30000);

    return () => clearInterval(interval);
  }, [loadPendingApplications]);

  // --------------------------------------------------
  // REFRESH WHEN RETURNING TO PAGE
  // --------------------------------------------------

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        loadPendingApplications(true);
      }
    }

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
  }, [loadPendingApplications]);

  // --------------------------------------------------
  // FORMATTING
  // --------------------------------------------------

  function formatMoney(value) {
    if (
      value === null ||
      value === undefined ||
      value === ""
    ) {
      return "0.00";
    }

    const number = Number(value);

    if (Number.isNaN(number)) {
      return value;
    }

    return number.toLocaleString("en-ZA", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function formatDateTime(value) {
    if (!value) return "-";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleString("en-ZA", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function getApplicantName(application) {
    return `${application.first_name || ""} ${
      application.last_name || ""
    }`.trim() || "Unknown Applicant";
  }

  // --------------------------------------------------
  // REVIEW APPLICATION
  // --------------------------------------------------

  function reviewApplication(applicationId) {
    navigate(
      `/applications/${applicationId}/review`
    );
  }

  // --------------------------------------------------
  // LOADING
  // --------------------------------------------------

  if (loading) {
    return (
      <Box
        sx={{
          width: "100%",
          minHeight: "60vh",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          px: 2,
          boxSizing: "border-box",
        }}
      >
        <Stack
          spacing={2}
          alignItems="center"
        >
          <CircularProgress />

          <Typography
            color="text.secondary"
            textAlign="center"
          >
            Loading pending applications...
          </Typography>
        </Stack>
      </Box>
    );
  }

  // --------------------------------------------------
  // MAIN UI
  // --------------------------------------------------

  return (
    <Box
      sx={{
        width: "100%",
        maxWidth: {
          xs: "100%",
          sm: 1100,
        },

        mx: "auto",

        px: {
          xs: 0.75,
          sm: 2,
          md: 3,
        },

        py: {
          xs: 0.75,
          sm: 2,
          md: 3,
        },

        boxSizing: "border-box",

        overflowX: "hidden",
      }}
    >
      {/* ==========================================
          HEADER
      ========================================== */}

      <Paper
        elevation={2}
        sx={{
          width: "100%",

          boxSizing: "border-box",

          p: {
            xs: 1.25,
            sm: 2.5,
          },

          mb: {
            xs: 1,
            sm: 2,
          },

          borderRadius: {
            xs: 1.5,
            sm: 2,
          },
        }}
      >
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          spacing={1}
          sx={{
            width: "100%",
          }}
        >
          {/* TITLE */}

          <Stack
            direction="row"
            alignItems="center"
            spacing={{
              xs: 0.75,
              sm: 1,
            }}
            sx={{
              minWidth: 0,
              flex: 1,
            }}
          >
            <NotificationsActiveIcon
              sx={{
                fontSize: {
                  xs: 24,
                  sm: 30,
                },

                flexShrink: 0,
              }}
            />

            <Box
              sx={{
                minWidth: 0,
              }}
            >
              <Typography
                sx={{
                  fontSize: {
                    xs: "1rem",
                    sm: "1.5rem",
                  },

                  fontWeight: 700,

                  lineHeight: 1.2,

                  whiteSpace: {
                    xs: "nowrap",
                    sm: "normal",
                  },

                  overflow: "hidden",

                  textOverflow: "ellipsis",
                }}
              >
                Pending Applications
              </Typography>

              <Typography
                color="text.secondary"
                sx={{
                  display: {
                    xs: "none",
                    sm: "block",
                  },

                  fontSize: "0.85rem",

                  mt: 0.5,
                }}
              >
                Applications waiting for administrator review.
              </Typography>
            </Box>
          </Stack>

          {/* COUNT */}

          <Chip
            label={`${applications.length} Pending`}
            color={
              applications.length > 0
                ? "warning"
                : "default"
            }
            sx={{
              flexShrink: 0,

              height: {
                xs: 30,
                sm: 36,
              },

              "& .MuiChip-label": {
                px: {
                  xs: 1,
                  sm: 1.5,
                },

                fontSize: {
                  xs: "0.7rem",
                  sm: "0.85rem",
                },

                fontWeight: 700,
              },
            }}
          />

          {/* REFRESH */}

          <IconButton
            onClick={() =>
              loadPendingApplications(true)
            }
            disabled={refreshing}
            aria-label="Refresh applications"
            sx={{
              flexShrink: 0,

              width: {
                xs: 38,
                sm: 44,
              },

              height: {
                xs: 38,
                sm: 44,
              },
            }}
          >
            {refreshing ? (
              <CircularProgress size={20} />
            ) : (
              <RefreshIcon
                sx={{
                  fontSize: {
                    xs: 21,
                    sm: 24,
                  },
                }}
              />
            )}
          </IconButton>
        </Stack>

        {/* MOBILE DESCRIPTION */}

        <Typography
          color="text.secondary"
          sx={{
            display: {
              xs: "block",
              sm: "none",
            },

            mt: 0.75,

            fontSize: "0.7rem",

            lineHeight: 1.3,
          }}
        >
          Loan applications waiting for review.
        </Typography>
      </Paper>

      {/* ==========================================
          ERROR
      ========================================== */}

      {error && (
        <Alert
          severity="error"
          sx={{
            mb: 1.5,
            borderRadius: 1.5,
          }}
          onClose={() => setError("")}
        >
          {error}
        </Alert>
      )}

      {/* ==========================================
          EMPTY
      ========================================== */}

      {applications.length === 0 && (
        <Paper
          elevation={1}
          sx={{
            width: "100%",

            boxSizing: "border-box",

            p: {
              xs: 3,
              sm: 6,
            },

            textAlign: "center",

            borderRadius: {
              xs: 1.5,
              sm: 2,
            },
          }}
        >
          <NotificationsActiveIcon
            sx={{
              fontSize: {
                xs: 42,
                sm: 50,
              },

              mb: 1,

              opacity: 0.5,
            }}
          />

          <Typography
            sx={{
              fontSize: {
                xs: "1rem",
                sm: "1.25rem",
              },

              fontWeight: 700,
            }}
          >
            No Pending Applications
          </Typography>

          <Typography
            color="text.secondary"
            sx={{
              mt: 1,

              fontSize: {
                xs: "0.75rem",
                sm: "0.875rem",
              },
            }}
          >
            There are currently no loan applications
            waiting for review.
          </Typography>
        </Paper>
      )}

      {/* ==========================================
          APPLICATION LIST
      ========================================== */}

      <Stack
        spacing={{
          xs: 1,
          sm: 2,
        }}
        sx={{
          width: "100%",
        }}
      >
        {applications.map((application) => (
          <Card
            key={application.id}
            elevation={2}
            sx={{
              width: "100%",

              boxSizing: "border-box",

              borderRadius: {
                xs: 1.5,
                sm: 2,
              },

              overflow: "hidden",
            }}
          >
            <CardContent
              sx={{
                p: {
                  xs: 1.5,
                  sm: 3,
                },

                "&:last-child": {
                  pb: {
                    xs: 1.5,
                    sm: 3,
                  },
                },
              }}
            >
              {/* ==================================
                  APPLICANT
              ================================== */}

              <Stack
                direction="row"
                alignItems="flex-start"
                justifyContent="space-between"
                spacing={1}
              >
                <Box
                  sx={{
                    minWidth: 0,
                    flex: 1,
                  }}
                >
                  <Typography
                    sx={{
                      fontSize: {
                        xs: "0.95rem",
                        sm: "1.25rem",
                      },

                      fontWeight: 700,

                      lineHeight: 1.25,

                      overflow: "hidden",

                      textOverflow: "ellipsis",

                      whiteSpace: "nowrap",
                    }}
                  >
                    {getApplicantName(
                      application
                    )}
                  </Typography>

                  <Typography
                    color="text.secondary"
                    sx={{
                      mt: 0.25,

                      fontSize: {
                        xs: "0.65rem",
                        sm: "0.8rem",
                      },

                      overflow: "hidden",

                      textOverflow: "ellipsis",

                      whiteSpace: "nowrap",
                    }}
                  >
                    Application{" "}
                    {application.application_number ||
                      "-"}
                  </Typography>
                </Box>

                <Chip
                  label="PENDING"
                  color="warning"
                  size="small"
                  sx={{
                    flexShrink: 0,

                    height: {
                      xs: 25,
                      sm: 30,
                    },

                    "& .MuiChip-label": {
                      px: {
                        xs: 0.75,
                        sm: 1,
                      },

                      fontSize: {
                        xs: "0.6rem",
                        sm: "0.7rem",
                      },

                      fontWeight: 700,
                    },
                  }}
                />
              </Stack>

              <Divider
                sx={{
                  my: {
                    xs: 1.25,
                    sm: 2,
                  },
                }}
              />

              {/* ==================================
                  AMOUNT
              ================================== */}

              <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                spacing={1}
              >
                <Typography
                  color="text.secondary"
                  sx={{
                    fontSize: {
                      xs: "0.7rem",
                      sm: "0.875rem",
                    },
                  }}
                >
                  Amount Requested
                </Typography>

                <Typography
                  sx={{
                    fontSize: {
                      xs: "1.15rem",
                      sm: "1.5rem",
                    },

                    fontWeight: 800,

                    whiteSpace: "nowrap",
                  }}
                >
                  R{" "}
                  {formatMoney(
                    application.amount_requested
                  )}
                </Typography>
              </Stack>

              <Divider
                sx={{
                  my: {
                    xs: 1.25,
                    sm: 2,
                  },
                }}
              />

              {/* ==================================
                  DETAILS
              ================================== */}

              <Stack
                spacing={{
                  xs: 0.75,
                  sm: 1.5,
                }}
              >
                {/* CELLPHONE */}

                <Stack
                  direction="row"
                  justifyContent="space-between"
                  alignItems="flex-start"
                  spacing={2}
                >
                  <Typography
                    color="text.secondary"
                    sx={{
                      fontSize: {
                        xs: "0.7rem",
                        sm: "0.875rem",
                      },

                      flexShrink: 0,
                    }}
                  >
                    Cellphone
                  </Typography>

                  <Typography
                    sx={{
                      fontSize: {
                        xs: "0.75rem",
                        sm: "0.9rem",
                      },

                      fontWeight: 600,

                      textAlign: "right",

                      overflowWrap: "anywhere",
                    }}
                  >
                    {application.cellphone || "-"}
                  </Typography>
                </Stack>

                {/* SUBMITTED */}

                <Stack
                  direction="row"
                  justifyContent="space-between"
                  alignItems="flex-start"
                  spacing={2}
                >
                  <Typography
                    color="text.secondary"
                    sx={{
                      fontSize: {
                        xs: "0.7rem",
                        sm: "0.875rem",
                      },

                      flexShrink: 0,
                    }}
                  >
                    Submitted
                  </Typography>

                  <Typography
                    sx={{
                      fontSize: {
                        xs: "0.7rem",
                        sm: "0.875rem",
                      },

                      fontWeight: 500,

                      textAlign: "right",
                    }}
                  >
                    {formatDateTime(
                      application.created_at
                    )}
                  </Typography>
                </Stack>

                {/* PURPOSE */}

                {application.loan_purpose && (
                  <Stack
                    direction="row"
                    justifyContent="space-between"
                    alignItems="flex-start"
                    spacing={2}
                  >
                    <Typography
                      color="text.secondary"
                      sx={{
                        fontSize: {
                          xs: "0.7rem",
                          sm: "0.875rem",
                        },

                        flexShrink: 0,
                      }}
                    >
                      Purpose
                    </Typography>

                    <Typography
                      sx={{
                        fontSize: {
                          xs: "0.7rem",
                          sm: "0.875rem",
                        },

                        fontWeight: 500,

                        textAlign: "right",

                        maxWidth: {
                          xs: "65%",
                          sm: "70%",
                        },

                        overflowWrap: "anywhere",
                      }}
                    >
                      {application.loan_purpose}
                    </Typography>
                  </Stack>
                )}
              </Stack>

              {/* ==================================
                  REVIEW BUTTON
              ================================== */}

              <Button
                fullWidth
                variant="contained"
                size="large"
                endIcon={<ArrowForwardIcon />}
                onClick={() =>
                  reviewApplication(
                    application.id
                  )
                }
                sx={{
                  mt: {
                    xs: 1.75,
                    sm: 3,
                  },

                  minHeight: {
                    xs: 48,
                    sm: 52,
                  },

                  borderRadius: {
                    xs: 1.5,
                    sm: 2,
                  },

                  fontSize: {
                    xs: "0.85rem",
                    sm: "1rem",
                  },

                  fontWeight: 700,

                  textTransform: "none",

                  px: 1,

                  "& .MuiButton-endIcon": {
                    ml: 0.5,
                  },
                }}
              >
                Review Application
              </Button>
            </CardContent>
          </Card>
        ))}
      </Stack>
    </Box>
  );
}