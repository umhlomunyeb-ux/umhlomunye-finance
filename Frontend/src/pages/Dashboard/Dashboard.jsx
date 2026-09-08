import { useCallback, useEffect, useMemo, useState } from "react";
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
  Grid,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";

import RefreshIcon from "@mui/icons-material/Refresh";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import PeopleIcon from "@mui/icons-material/People";
import PaymentsIcon from "@mui/icons-material/Payments";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import ScheduleIcon from "@mui/icons-material/Schedule";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";

import { supabase } from "../../lib/supabase";
import { runDailyLoanProcessing } from "../../services/loanService";

function money(value) {
  return `R${Number(value || 0).toLocaleString("en-ZA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
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
    day: "2-digit",
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
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getCustomerName(loan) {
  if (!loan?.customers) return "Unknown customer";

  return (
    `${loan.customers.first_name || ""} ${
      loan.customers.last_name || ""
    }`.trim() || "Unknown customer"
  );
}

function StatCard({
  title,
  value,
  subtitle,
  icon,
}) {
  return (
    <Card
      elevation={2}
      sx={{
        height: "100%",
        borderRadius: 3,
      }}
    >
      <CardContent>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="flex-start"
          spacing={2}
        >
          <Box>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ mb: 1 }}
            >
              {title}
            </Typography>

            <Typography
              variant="h5"
              fontWeight={700}
              sx={{ mb: 0.5 }}
            >
              {value}
            </Typography>

            {subtitle && (
              <Typography
                variant="caption"
                color="text.secondary"
              >
                {subtitle}
              </Typography>
            )}
          </Box>

          <Box
            sx={{
              width: 46,
              height: 46,
              borderRadius: 2,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              bgcolor: "action.hover",
            }}
          >
            {icon}
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

function statusColor(status) {
  switch (String(status || "").toLowerCase()) {
    case "active":
      return "success";

    case "completed":
      return "primary";

    case "overdue":
      return "error";

    case "void":
    case "cancelled":
      return "default";

    default:
      return "warning";
  }
}

export default function Dashboard() {
  const navigate = useNavigate();

  const [loans, setLoans] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [applications, setApplications] = useState([]);

  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");

  const loadDashboard = useCallback(
    async (runProcessing = true) => {
      try {
        setError("");

        if (runProcessing) {
          setProcessing(true);

          try {
            await runDailyLoanProcessing();
          } catch (processingError) {
            console.error(
              "Daily processing failed:",
              processingError
            );

            // Do not prevent the dashboard from loading
            // if processing fails.
          } finally {
            setProcessing(false);
          }
        }

        const [
          loansResult,
          transactionsResult,
          applicationsResult,
        ] = await Promise.all([
          supabase
            .from("loans")
            .select(`
              *,
              customers (
                customer_number,
                first_name,
                last_name
              )
            `)
            .eq("is_deleted", false)
            .order("created_at", {
              ascending: false,
            }),

          supabase
            .from("loan_transactions")
            .select("*")
            .order("transaction_date", {
              ascending: false,
            })
            .limit(50),

          supabase
            .from("loan_applications")
            .select("*")
            .eq("status", "PENDING")
            .order("created_at", {
              ascending: false,
            }),
        ]);

        console.log(
          "PENDING APPLICATION QUERY RESULT:",
          applicationsResult
        );

        if (loansResult.error) {
          throw loansResult.error;
        }

        if (transactionsResult.error) {
          throw transactionsResult.error;
        }

        if (applicationsResult.error) {
          throw applicationsResult.error;
        }

        setLoans(loansResult.data || []);
        setTransactions(transactionsResult.data || []);
        setApplications(applicationsResult.data || []);
      } catch (err) {
        console.error("DASHBOARD ERROR:", err);

        setError(
          err.message || "Unable to load dashboard data."
        );
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    loadDashboard(true);
  }, [loadDashboard]);

  useEffect(() => {
    const channel = supabase
      .channel("dashboard-loan-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "loans",
        },
        () => {
          loadDashboard(false);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "loan_transactions",
        },
        () => {
          loadDashboard(false);
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
          loadDashboard(false);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadDashboard]);

  const activeLoans = useMemo(
    () =>
      loans.filter(
        (loan) =>
          String(loan.loan_status).toLowerCase() ===
            "active" &&
          !loan.is_deleted
      ),
    [loans]
  );

  const completedLoans = useMemo(
    () =>
      loans.filter(
        (loan) =>
          String(loan.loan_status).toLowerCase() ===
          "completed"
      ),
    [loans]
  );

  const totalDisbursed = useMemo(
    () =>
      loans.reduce(
        (sum, loan) =>
          sum + Number(loan.principal_amount || 0),
        0
      ),
    [loans]
  );

  const activeBalance = useMemo(
    () =>
      activeLoans.reduce(
        (sum, loan) =>
          sum + Number(loan.current_balance || 0),
        0
      ),
    [activeLoans]
  );

  const totalPaid = useMemo(
    () =>
      loans.reduce(
        (sum, loan) =>
          sum + Number(loan.total_paid || 0),
        0
      ),
    [loans]
  );

  const totalInterest = useMemo(
    () =>
      loans.reduce(
        (sum, loan) =>
          sum + Number(loan.interest_amount || 0),
        0
      ),
    [loans]
  );

  const repaymentTransactions = useMemo(
    () =>
      transactions
        .filter(
          (transaction) =>
            String(
              transaction.transaction_type || ""
            ).toLowerCase() === "payment"
        )
        .slice(0, 10),
    [transactions]
  );

  const upcomingInterest = useMemo(() => {
    const now = new Date();

    return activeLoans
      .filter((loan) => {
        if (!loan.next_interest_date) return false;

        const interestDate = new Date(
          loan.next_interest_date
        );

        return interestDate >= now;
      })
      .sort(
        (a, b) =>
          new Date(a.next_interest_date) -
          new Date(b.next_interest_date)
      )
      .slice(0, 10);
  }, [activeLoans]);

  if (loading) {
    return (
      <Box
        sx={{
          minHeight: "70vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Stack alignItems="center" spacing={2}>
          <CircularProgress />
          <Typography color="text.secondary">
            Loading dashboard...
          </Typography>
        </Stack>
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      {/* HEADER */}
      <Stack
        direction={{ xs: "column", md: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "flex-start", md: "center" }}
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Box>
          <Typography
            variant="h4"
            fontWeight={800}
            sx={{ mb: 0.5 }}
          >
            Dashboard
          </Typography>

          <Typography color="text.secondary">
            Umhlomunye Finance loan portfolio overview
          </Typography>

          {processing && (
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{ mt: 1 }}
            >
              <CircularProgress size={14} />

              <Typography
                variant="caption"
                color="text.secondary"
              >
                Processing due loan interest...
              </Typography>
            </Stack>
          )}
        </Box>

        <Stack direction="row" spacing={1}>
          <Tooltip title="Refresh dashboard">
            <IconButton
              onClick={() => loadDashboard(true)}
              disabled={processing}
            >
              <RefreshIcon />
            </IconButton>
          </Tooltip>

          <Button
            variant="contained"
            onClick={() => navigate("/loans")}
          >
            View Loans
          </Button>
        </Stack>
      </Stack>

      {error && (
        <Alert
          severity="warning"
          sx={{ mb: 3 }}
          onClose={() => setError("")}
        >
          {error}
        </Alert>
      )}

      {/* STAT CARDS */}
      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Total Loans"
            value={loans.length}
            subtitle={`${activeLoans.length} active`}
            icon={<AccountBalanceWalletIcon />}
          />
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Portfolio Balance"
            value={money(activeBalance)}
            subtitle="Outstanding active balance"
            icon={<TrendingUpIcon />}
          />
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Total Paid"
            value={money(totalPaid)}
            subtitle="All recorded repayments"
            icon={<PaymentsIcon />}
          />
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Pending Applications"
            value={applications.length}
            subtitle="Awaiting review"
            icon={<PeopleIcon />}
          />
        </Grid>
      </Grid>

      {/* SECONDARY STATISTICS */}
      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid item xs={12} md={4}>
          <Card elevation={1} sx={{ borderRadius: 3 }}>
            <CardContent>
              <Typography
                variant="body2"
                color="text.secondary"
              >
                Total Principal Disbursed
              </Typography>

              <Typography
                variant="h5"
                fontWeight={700}
                sx={{ mt: 1 }}
              >
                {money(totalDisbursed)}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={4}>
          <Card elevation={1} sx={{ borderRadius: 3 }}>
            <CardContent>
              <Typography
                variant="body2"
                color="text.secondary"
              >
                Contracted Interest
              </Typography>

              <Typography
                variant="h5"
                fontWeight={700}
                sx={{ mt: 1 }}
              >
                {money(totalInterest)}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={4}>
          <Card elevation={1} sx={{ borderRadius: 3 }}>
            <CardContent>
              <Typography
                variant="body2"
                color="text.secondary"
              >
                Completed Loans
              </Typography>

              <Typography
                variant="h5"
                fontWeight={700}
                sx={{ mt: 1 }}
              >
                {completedLoans.length}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* LOANS + APPLICATIONS */}
      <Grid container spacing={3}>
        <Grid item xs={12} lg={8}>
          <Card
            elevation={2}
            sx={{ borderRadius: 3 }}
          >
            <CardContent sx={{ p: 0 }}>
              <Box
                sx={{
                  p: 2.5,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <Box>
                  <Typography variant="h6" fontWeight={700}>
                    Active Loans
                  </Typography>

                  <Typography
                    variant="body2"
                    color="text.secondary"
                  >
                    Current outstanding portfolio
                  </Typography>
                </Box>

                <Button
                  endIcon={<ArrowForwardIcon />}
                  onClick={() => navigate("/loans")}
                >
                  All Loans
                </Button>
              </Box>

              <Divider />

              {activeLoans.length === 0 ? (
                <Box sx={{ p: 4, textAlign: "center" }}>
                  <Typography color="text.secondary">
                    No active loans found.
                  </Typography>
                </Box>
              ) : (
                <TableContainer>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell>
                          <strong>Loan</strong>
                        </TableCell>

                        <TableCell>
                          <strong>Customer</strong>
                        </TableCell>

                        <TableCell align="right">
                          <strong>Balance</strong>
                        </TableCell>

                        <TableCell>
                          <strong>Next Interest</strong>
                        </TableCell>

                        <TableCell>
                          <strong>Status</strong>
                        </TableCell>
                      </TableRow>
                    </TableHead>

                    <TableBody>
                      {activeLoans
                        .slice(0, 10)
                        .map((loan) => (
                          <TableRow
                            key={loan.id}
                            hover
                            sx={{
                              cursor: "pointer",
                            }}
                            onClick={() =>
                              navigate(
                                `/loans/${loan.id}`
                              )
                            }
                          >
                            <TableCell>
                              <Typography
                                fontWeight={700}
                              >
                                {loan.loan_number}
                              </Typography>
                            </TableCell>

                            <TableCell>
                              {getCustomerName(loan)}
                            </TableCell>

                            <TableCell align="right">
                              <Typography
                                fontWeight={700}
                              >
                                {money(
                                  loan.current_balance
                                )}
                              </Typography>
                            </TableCell>

                            <TableCell>
                              {formatDate(
                                loan.next_interest_date
                              )}
                            </TableCell>

                            <TableCell>
                              <Chip
                                size="small"
                                label={
                                  loan.loan_status ||
                                  "Unknown"
                                }
                                color={statusColor(
                                  loan.loan_status
                                )}
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* PENDING APPLICATIONS */}
        <Grid item xs={12} lg={4}>
          <Card
            elevation={2}
            sx={{ borderRadius: 3, height: "100%" }}
          >
            <CardContent>
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                sx={{ mb: 2 }}
              >
                <Box>
                  <Typography
                    variant="h6"
                    fontWeight={700}
                  >
                    Applications
                  </Typography>

                  <Typography
                    variant="body2"
                    color="text.secondary"
                  >
                    Pending review
                  </Typography>
                </Box>

                <Chip
                  label={applications.length}
                  color="warning"
                />
              </Stack>

              {applications.length === 0 ? (
                <Typography
                  color="text.secondary"
                  sx={{ py: 3 }}
                >
                  No pending applications.
                </Typography>
              ) : (
                <Stack spacing={1.5}>
                  {applications
                    .slice(0, 6)
                    .map((application) => (
                      <Paper
                        key={application.id}
                        variant="outlined"
                        sx={{
                          p: 1.5,
                          cursor: "pointer",
                        }}
                        onClick={() =>
                          navigate(
                            `/applications/${application.id}`
                          )
                        }
                      >
                        <Typography fontWeight={700}>
                          {application.application_number ||
                            application.id?.slice(0, 8)}
                        </Typography>

                        <Typography
                          variant="body2"
                          color="text.secondary"
                        >
                          {application.first_name ||
                            application.full_name ||
                            "Applicant"}
                        </Typography>

                        <Typography
                          variant="caption"
                          color="text.secondary"
                        >
                          {formatDate(
                            application.created_at
                          )}
                        </Typography>
                      </Paper>
                    ))}
                </Stack>
              )}

              <Button
                fullWidth
                sx={{ mt: 2 }}
                variant="outlined"
                onClick={() =>
                  navigate("/applications")
                }
              >
                Review Applications
              </Button>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* NEXT INTEREST */}
      <Card
        elevation={2}
        sx={{
          borderRadius: 3,
          mt: 3,
        }}
      >
        <CardContent sx={{ p: 0 }}>
          <Box sx={{ p: 2.5 }}>
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
            >
              <ScheduleIcon />

              <Box>
                <Typography
                  variant="h6"
                  fontWeight={700}
                >
                  Upcoming Interest Processing
                </Typography>

                <Typography
                  variant="body2"
                  color="text.secondary"
                >
                  Loans scheduled for the next interest
                  calculation
                </Typography>
              </Box>
            </Stack>
          </Box>

          <Divider />

          {upcomingInterest.length === 0 ? (
            <Box sx={{ p: 4, textAlign: "center" }}>
              <Typography color="text.secondary">
                No upcoming interest dates.
              </Typography>
            </Box>
          ) : (
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>
                      <strong>Loan</strong>
                    </TableCell>

                    <TableCell>
                      <strong>Customer</strong>
                    </TableCell>

                    <TableCell>
                      <strong>Interest Date</strong>
                    </TableCell>

                    <TableCell align="right">
                      <strong>Balance</strong>
                    </TableCell>
                  </TableRow>
                </TableHead>

                <TableBody>
                  {upcomingInterest.map((loan) => (
                    <TableRow
                      key={loan.id}
                      hover
                      sx={{ cursor: "pointer" }}
                      onClick={() =>
                        navigate(`/loans/${loan.id}`)
                      }
                    >
                      <TableCell>
                        {loan.loan_number}
                      </TableCell>

                      <TableCell>
                        {getCustomerName(loan)}
                      </TableCell>

                      <TableCell>
                        {formatDate(
                          loan.next_interest_date
                        )}
                      </TableCell>

                      <TableCell align="right">
                        {money(loan.current_balance)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      {/* RECENT PAYMENTS */}
      <Card
        elevation={2}
        sx={{
          borderRadius: 3,
          mt: 3,
        }}
      >
        <CardContent sx={{ p: 0 }}>
          <Box sx={{ p: 2.5 }}>
            <Typography
              variant="h6"
              fontWeight={700}
            >
              Recent Repayments
            </Typography>

            <Typography
              variant="body2"
              color="text.secondary"
            >
              Latest payment transactions
            </Typography>
          </Box>

          <Divider />

          {repaymentTransactions.length === 0 ? (
            <Box sx={{ p: 4, textAlign: "center" }}>
              <Typography color="text.secondary">
                No repayments recorded yet.
              </Typography>
            </Box>
          ) : (
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>
                      <strong>Date</strong>
                    </TableCell>

                    <TableCell>
                      <strong>Loan</strong>
                    </TableCell>

                    <TableCell>
                      <strong>Description</strong>
                    </TableCell>

                    <TableCell align="right">
                      <strong>Amount</strong>
                    </TableCell>

                    <TableCell align="right">
                      <strong>Balance</strong>
                    </TableCell>
                  </TableRow>
                </TableHead>

                <TableBody>
                  {repaymentTransactions.map(
                    (transaction) => {
                      const loan = loans.find(
                        (item) =>
                          item.id ===
                          transaction.loan_id
                      );

                      return (
                        <TableRow
                          key={transaction.id}
                          hover
                          sx={{
                            cursor: loan
                              ? "pointer"
                              : "default",
                          }}
                          onClick={() => {
                            if (loan) {
                              navigate(
                                `/loans/${loan.id}`
                              );
                            }
                          }}
                        >
                          <TableCell>
                            {formatDateTime(
                              transaction.transaction_date
                            )}
                          </TableCell>

                          <TableCell>
                            {loan?.loan_number || "-"}
                          </TableCell>

                          <TableCell>
                            {transaction.description ||
                              "Loan repayment"}
                          </TableCell>

                          <TableCell align="right">
                            <Typography
                              fontWeight={700}
                              color="success.main"
                            >
                              {money(
                                transaction.credit
                              )}
                            </Typography>
                          </TableCell>

                          <TableCell align="right">
                            {money(
                              transaction.balance
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    }
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      {/* FOOTER INFO */}
      <Paper
        variant="outlined"
        sx={{
          mt: 3,
          p: 2,
          borderRadius: 2,
        }}
      >
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
        >
          <WarningAmberIcon fontSize="small" />

          <Typography
            variant="caption"
            color="text.secondary"
          >
            Loan balances and interest are calculated by
            the Supabase loan engine. The dashboard only
            displays the database values.
          </Typography>
        </Stack>
      </Paper>
    </Box>
  );
}