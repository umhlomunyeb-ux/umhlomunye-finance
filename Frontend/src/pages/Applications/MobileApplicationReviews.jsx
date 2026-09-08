import { useEffect, useState } from "react";
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
  Stack,
  Typography,
} from "@mui/material";

import { supabase } from "../../lib/supabase";

export default function MobileApplicationReviews() {
  const navigate = useNavigate();

  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadApplications() {
    try {
      setLoading(true);
      setError("");

      const { data, error } = await supabase
        .from("loan_applications")
        .select("*")
        .in("status", ["PENDING", "UNDER_REVIEW"])
        .order("created_at", {
          ascending: false,
        });

      if (error) {
        throw error;
      }

      setApplications(data || []);
    } catch (err) {
      console.error(
        "Unable to load applications:",
        err
      );

      setError(
        err?.message ||
          "Unable to load applications."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadApplications();
  }, []);

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

  function formatDate(value) {
    if (!value) return "-";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleDateString("en-ZA", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  function formatStatus(status) {
    if (!status) return "Unknown";

    return status
      .replaceAll("_", " ")
      .toLowerCase()
      .replace(/\b\w/g, (letter) =>
        letter.toUpperCase()
      );
  }

  function getStatusColor(status) {
    switch (status) {
      case "PENDING":
        return "warning";

      case "UNDER_REVIEW":
        return "info";

      default:
        return "default";
    }
  }

  return (
    <Box
      sx={{
        minHeight: "100vh",
        backgroundColor: "#f5f6f8",
        pb: 3,
      }}
    >
      {/* HEADER */}

      <Box
        sx={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          backgroundColor: "white",
          borderBottom: "1px solid",
          borderColor: "divider",
          px: 2,
          py: 1.5,
        }}
      >
        <Stack
          direction="row"
          alignItems="center"
          spacing={1}
        >
          <Box sx={{ flex: 1 }}>
            <Typography
              fontWeight="bold"
              sx={{ fontSize: "20px" }}
            >
              Application Review
            </Typography>

            <Typography
              variant="caption"
              color="text.secondary"
            >
              Pending loan applications
            </Typography>
          </Box>

          <Button
            size="small"
            variant="outlined"
            onClick={loadApplications}
            disabled={loading}
          >
            Refresh
          </Button>
        </Stack>
      </Box>

      <Box sx={{ p: 1.5 }}>
        {error && (
          <Alert
            severity="error"
            sx={{ mb: 1.5 }}
          >
            {error}
          </Alert>
        )}

        {loading ? (
          <Box
            sx={{
              minHeight: "50vh",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <CircularProgress />
          </Box>
        ) : applications.length === 0 ? (
          <Card>
            <CardContent>
              <Typography
                fontWeight="bold"
                sx={{ mb: 1 }}
              >
                No applications waiting for review
              </Typography>

              <Typography color="text.secondary">
                There are currently no pending loan
                applications.
              </Typography>
            </CardContent>
          </Card>
        ) : (
          <Stack spacing={1.5}>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ px: 0.5 }}
            >
              {applications.length} application
              {applications.length === 1 ? "" : "s"}{" "}
              awaiting review
            </Typography>

            {applications.map((application) => (
              <Card
                key={application.id}
                sx={{
                  border: "1px solid",
                  borderColor: "divider",
                }}
              >
                <CardContent>
                  <Stack spacing={1.5}>
                    <Stack
                      direction="row"
                      alignItems="flex-start"
                      spacing={1}
                    >
                      <Box sx={{ flex: 1 }}>
                        <Typography
                          fontWeight="bold"
                          sx={{
                            fontSize: "17px",
                          }}
                        >
                          {application.first_name ||
                            ""}{" "}
                          {application.last_name ||
                            ""}
                        </Typography>

                        <Typography
                          variant="caption"
                          color="text.secondary"
                        >
                          {application.application_number ||
                            "-"}
                        </Typography>
                      </Box>

                      <Chip
                        label={formatStatus(
                          application.status
                        )}
                        color={getStatusColor(
                          application.status
                        )}
                        size="small"
                        sx={{
                          fontWeight: "bold",
                        }}
                      />
                    </Stack>

                    <Divider />

                    <Stack
                      direction="row"
                      spacing={2}
                    >
                      <Box sx={{ flex: 1 }}>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                        >
                          LOAN REQUEST
                        </Typography>

                        <Typography
                          fontWeight="bold"
                          sx={{ fontSize: "19px" }}
                        >
                          R{" "}
                          {formatMoney(
                            application.amount_requested
                          )}
                        </Typography>
                      </Box>

                      <Box sx={{ flex: 1 }}>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                        >
                          SUBMITTED
                        </Typography>

                        <Typography
                          fontWeight={500}
                        >
                          {formatDate(
                            application.created_at
                          )}
                        </Typography>
                      </Box>
                    </Stack>

                    {application.loan_purpose && (
                      <Box>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                        >
                          PURPOSE
                        </Typography>

                        <Typography>
                          {application.loan_purpose}
                        </Typography>
                      </Box>
                    )}

                    {application.cellphone && (
                      <Box>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                        >
                          CELLPHONE
                        </Typography>

                        <Typography>
                          {application.cellphone}
                        </Typography>
                      </Box>
                    )}

                    <Button
                      fullWidth
                      variant="contained"
                      size="large"
                      onClick={() =>
                        navigate(
                          `/mobile/application-review/${application.id}`
                        )
                      }
                      sx={{
                        minHeight: 52,
                        fontWeight: "bold",
                      }}
                    >
                      Review Application
                    </Button>
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Stack>
        )}
      </Box>
    </Box>
  );
}