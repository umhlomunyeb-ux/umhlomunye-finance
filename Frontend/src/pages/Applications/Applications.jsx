import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import {
  Box,
  Paper,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Button,
  CircularProgress,
  Alert,
  TextField,
  MenuItem,
  Stack,
  IconButton,
  Tooltip,
} from "@mui/material";

import RefreshIcon from "@mui/icons-material/Refresh";

import {
  getLoanApplications,
} from "../../services/applicationService";

export default function Applications() {
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  // ===========================================================
  // LOAD APPLICATIONS
  // ===========================================================

  const loadApplications = useCallback(
    async (showRefresh = false) => {
      try {
        if (showRefresh) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }

        setError("");

        const data = await getLoanApplications();

        setApplications(data || []);
      } catch (err) {
        console.error(
          "APPLICATIONS LOAD ERROR:",
          err
        );

        setError(
          err?.message ||
            "Unable to load loan applications."
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );

  // ===========================================================
  // INITIAL LOAD
  // ===========================================================

  useEffect(() => {
    loadApplications();
  }, [loadApplications]);

  // ===========================================================
  // AUTOMATIC REFRESH
  //
  // Checks for new applications every 30 seconds.
  // ===========================================================

  useEffect(() => {
    const interval = setInterval(() => {
      loadApplications(true);
    }, 30000);

    return () => clearInterval(interval);
  }, [loadApplications]);

  // ===========================================================
  // STATUS COLOUR
  // ===========================================================

  function getStatusColor(status) {
    switch (status) {
      case "PENDING":
        return "warning";

      case "UNDER_REVIEW":
        return "info";

      case "MORE_INFORMATION_REQUIRED":
        return "secondary";

      case "APPROVED":
        return "success";

      case "REJECTED":
        return "error";

      case "CANCELLED":
        return "default";

      default:
        return "default";
    }
  }

  // ===========================================================
  // STATUS LABEL
  // ===========================================================

  function getStatusLabel(status) {
    switch (status) {
      case "PENDING":
        return "Pending";

      case "UNDER_REVIEW":
        return "Under Review";

      case "MORE_INFORMATION_REQUIRED":
        return "More Information Required";

      case "APPROVED":
        return "Approved";

      case "REJECTED":
        return "Rejected";

      case "CANCELLED":
        return "Cancelled";

      default:
        return status || "Unknown";
    }
  }

  // ===========================================================
  // FILTER APPLICATIONS
  // ===========================================================

  const filteredApplications = applications.filter(
    (application) => {
      const searchText =
        search.toLowerCase().trim();

      const applicationNumber =
        application.application_number
          ?.toString()
          .toLowerCase() || "";

      const firstName =
        application.first_name
          ?.toString()
          .toLowerCase() || "";

      const lastName =
        application.last_name
          ?.toString()
          .toLowerCase() || "";

      const cellphone =
        application.cellphone
          ?.toString()
          .toLowerCase() || "";

      const matchesSearch =
        !searchText ||
        applicationNumber.includes(searchText) ||
        firstName.includes(searchText) ||
        lastName.includes(searchText) ||
        cellphone.includes(searchText);

      const matchesStatus =
        statusFilter === "ALL" ||
        application.status === statusFilter;

      return (
        matchesSearch &&
        matchesStatus
      );
    }
  );

  // ===========================================================
  // LOADING SCREEN
  // ===========================================================

  if (loading) {
    return (
      <Box
        sx={{
          minHeight: "300px",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  // ===========================================================
  // PAGE
  // ===========================================================

  return (
    <Box sx={{ p: 3 }}>

      {/* =====================================================
          PAGE HEADER
      ====================================================== */}

      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: {
            xs: "flex-start",
            sm: "center",
          },
          flexDirection: {
            xs: "column",
            sm: "row",
          },
          gap: 2,
          mb: 3,
        }}
      >
        <Box>
          <Typography
            variant="h4"
            fontWeight="bold"
            gutterBottom
          >
            Loan Applications
          </Typography>

          <Typography color="text.secondary">
            Review applications submitted by clients.
          </Typography>
        </Box>

        <Stack
          direction="row"
          spacing={1}
        >
          <Tooltip title="Refresh applications">
            <span>
              <IconButton
                onClick={() =>
                  loadApplications(true)
                }
                disabled={refreshing}
                color="primary"
              >
                {refreshing ? (
                  <CircularProgress
                    size={22}
                  />
                ) : (
                  <RefreshIcon />
                )}
              </IconButton>
            </span>
          </Tooltip>

          <Button
            variant="contained"
            size="large"
            component={Link}
            to="/apply"
          >
            New Application
          </Button>
        </Stack>
      </Box>

      {/* =====================================================
          ERROR
      ====================================================== */}

      {error && (
        <Alert
          severity="error"
          sx={{ mb: 3 }}
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() =>
                loadApplications(true)
              }
            >
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      {/* =====================================================
          SEARCH AND FILTERS
      ====================================================== */}

      <Paper
        sx={{
          p: 2,
          mb: 3,
        }}
      >
        <Stack
          direction={{
            xs: "column",
            md: "row",
          }}
          spacing={2}
        >
          <TextField
            fullWidth
            label="Search applications"
            placeholder="Application number, name or cellphone"
            value={search}
            onChange={(e) =>
              setSearch(e.target.value)
            }
          />

          <TextField
            select
            label="Status"
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value)
            }
            sx={{
              minWidth: {
                md: 250,
              },
            }}
          >
            <MenuItem value="ALL">
              All Applications
            </MenuItem>

            <MenuItem value="PENDING">
              Pending
            </MenuItem>

            <MenuItem value="UNDER_REVIEW">
              Under Review
            </MenuItem>

            <MenuItem value="MORE_INFORMATION_REQUIRED">
              More Information Required
            </MenuItem>

            <MenuItem value="APPROVED">
              Approved
            </MenuItem>

            <MenuItem value="REJECTED">
              Rejected
            </MenuItem>

            <MenuItem value="CANCELLED">
              Cancelled
            </MenuItem>
          </TextField>
        </Stack>
      </Paper>

      {/* =====================================================
          APPLICATION COUNT
      ====================================================== */}

      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 2,
        }}
      >
        <Typography fontWeight="bold">
          Showing {filteredApplications.length} of{" "}
          {applications.length} applications
        </Typography>

        <Chip
          label={`${applications.filter(
            (application) =>
              application.status === "PENDING"
          ).length} Pending`}
          color="warning"
          variant="outlined"
        />
      </Box>

      {/* =====================================================
          APPLICATION TABLE
      ====================================================== */}

      <Paper>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>
                  Application No.
                </TableCell>

                <TableCell>
                  Applicant
                </TableCell>

                <TableCell>
                  Cellphone
                </TableCell>

                <TableCell>
                  Customer
                </TableCell>

                <TableCell>
                  Loan
                </TableCell>

                <TableCell align="right">
                  Amount Requested
                </TableCell>

                <TableCell>
                  Application Date
                </TableCell>

                <TableCell>
                  Status
                </TableCell>

                <TableCell align="center">
                  Action
                </TableCell>
              </TableRow>
            </TableHead>

            <TableBody>
              {filteredApplications.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    align="center"
                    sx={{ py: 5 }}
                  >
                    <Typography
                      color="text.secondary"
                    >
                      {applications.length === 0
                        ? "No loan applications found."
                        : "No applications match your search or filter."
                      }
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                filteredApplications.map(
                  (application) => (
                    <TableRow
                      key={application.id}
                      hover
                    >

                      {/* APPLICATION NUMBER */}

                      <TableCell>
                        <Typography
                          fontWeight="bold"
                        >
                          {application.application_number ||
                            "-"}
                        </Typography>
                      </TableCell>

                      {/* APPLICANT */}

                      <TableCell>
                        <Typography
                          fontWeight="500"
                        >
                          {application.first_name}{" "}
                          {application.last_name}
                        </Typography>
                      </TableCell>

                      {/* CELLPHONE */}

                      <TableCell>
                        {application.cellphone ||
                          "-"}
                      </TableCell>

                      {/* CUSTOMER */}

                      <TableCell>
                        {application.customer_id ? (
                          <Button
                            component={Link}
                            to={`/customers/${application.customer_id}`}
                            size="small"
                          >
                            View Customer
                          </Button>
                        ) : (
                          <Typography
                            color="text.secondary"
                          >
                            Not Created
                          </Typography>
                        )}
                      </TableCell>

                      {/* LOAN */}

                      <TableCell>
                        {application.loan_id ? (
                          <Button
                            component={Link}
                            to={`/loans/${application.loan_id}`}
                            size="small"
                          >
                            View Loan
                          </Button>
                        ) : (
                          <Typography
                            color="text.secondary"
                          >
                            Not Created
                          </Typography>
                        )}
                      </TableCell>

                      {/* AMOUNT */}

                      <TableCell align="right">
                        <Typography
                          fontWeight="bold"
                        >
                          R{" "}
                          {Number(
                            application.amount_requested ||
                              0
                          ).toLocaleString(
                            "en-ZA",
                            {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            }
                          )}
                        </Typography>
                      </TableCell>

                      {/* DATE */}

                      <TableCell>
                        {application.created_at
                          ? new Date(
                              application.created_at
                            ).toLocaleDateString(
                              "en-ZA"
                            )
                          : "-"}
                      </TableCell>

                      {/* STATUS */}

                      <TableCell>
                        <Chip
                          label={getStatusLabel(
                            application.status
                          )}
                          color={getStatusColor(
                            application.status
                          )}
                          size="small"
                        />
                      </TableCell>

                      {/* ACTION */}

                      <TableCell align="center">
                        <Button
                          variant="outlined"
                          size="small"
                          component={Link}
                          to={`/applications/${application.id}`}
                        >
                          Review
                        </Button>
                      </TableCell>

                    </TableRow>
                  )
                )
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Box>
  );
}
