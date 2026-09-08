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
  Grid,
  Paper,
  Stack,
  Typography,
} from "@mui/material";

import {
  AccountBalance,
  ArrowForward,
  Assignment,
  AttachMoney,
  CheckCircle,
  CreditCard,
  Payment,
  Refresh,
  Schedule,
  TrendingUp,
} from "@mui/icons-material";

import { supabase } from "../../lib/supabase";
import { runDailyLoanProcessing } from "../../services/LoanService";

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
              "Daily loan processing error:",
              processingError
            );
          }

          setProcessing(false);
        }

        /*
         * =========================
         * LOAD LOANS
         * =========================
         */

        const loansResult = await supabase
          .from("loans")
          .select(
            `
              *,
              customers (
                id,
                customer_number,
                first_name,
                last_name,
                id_number,
                phone
              )
            `
          )
          .order("created_at", {
            ascending: false,
          });

        if (loansResult.error) {
          console.error(
            "Loans error:",
            loansResult.error
          );

          throw loansResult.error;
        }

        /*
         * =========================
         * LOAD TRANSACTIONS
         * =========================
         */

        const transactionsResult = await supabase
          .from("loan_transactions")
          .select("*")
          .order("transaction_date", {
            ascending: false,
          });

        if (transactionsResult.error) {
          console.error(
            "Transactions error:",
            transactionsResult.error
          );

          throw transactionsResult.error;
        }

        /*
         * =========================
         * LOAD PENDING APPLICATIONS
         * =========================
         *
         * IMPORTANT:
         *
         * loan_applications.status is:
         *
         * PENDING
         *
         * We are deliberately using the
         * exact database value here.
         */

        const applicationsResult = await supabase
          .from("loan_applications")
          .select("*")
          .eq("status", "PENDING")
          .order("created_at", {
            ascending: false,
          });

        /*
         * Diagnostic output.
         *
         * This will tell us exactly what
         * the browser receives from Supabase.
         */

        console.log(
          "PENDING APPLICATION QUERY RESULT:",
          applicationsResult
        );

        if (applicationsResult.error) {
          console.error(
            "Applications error:",
            applicationsResult.error
          );

          throw applicationsResult.error;
        }

        console.log(
          "PENDING APPLICATIONS RETURNED:",
          applicationsResult.data || []
        );

        /*
         * =========================
         * UPDATE STATE
         * =========================
         */

        setLoans(loansResult.data || []);

        setTransactions(
          transactionsResult.data || []
        );

        setApplications(
          applicationsResult.data || []
        );
      } catch (err) {
        console.error(
          "Dashboard loading error:",
          err
        );

        setError(
          err?.message ||
            "Failed to load dashboard data."
        );
      } finally {
        setLoading(false);
        setProcessing(false);
      }
    },
    []
  );

  /*
   * =========================
   * INITIAL LOAD + REALTIME
   * =========================
   */

  useEffect(() => {
    loadDashboard();

    const channel = supabase
      .channel("dashboard-realtime")
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

  /*
   * =========================
   * CALCULATIONS
   * =========================
   */

  const activeLoans = loans.filter(
    (loan) =>
      String(loan.loan_status || "").toLowerCase() ===
      "active"
  );

  const totalPortfolioBalance =
    activeLoans.reduce(
      (total, loan) =>
        total + Number(loan.current_balance || 0),
      0
    );

  const totalPaid = loans.reduce(
    (total, loan) =>
      total + Number(loan.total_paid || 0),
    0
  );

  const totalLoans = loans.length;

  /*
   * This is the number displayed on the
   * Pending Applications dashboard card.
   */
  const pendingApplications =
    applications.length;

  const upcomingInterest = activeLoans
    .filter((loan) => loan.next_interest_date)
    .sort(
      (a, b) =>
        new Date(a.next_interest_date) -
        new Date(b.next_interest_date)
    );

  const recentRepayments = transactions
    .filter((transaction) => {
      const type = String(
        transaction.transaction_type || ""
      ).toLowerCase();

      return (
        type.includes("payment") ||
        type.includes("repayment")
      );
    })
    .slice(0, 5);

  /*
   * =========================
   * FORMATTERS
   * =========================
   */

  const formatCurrency = (value) =>
    new Intl.NumberFormat("en-ZA", {
      style: "currency",
      currency: "ZAR",
      minimumFractionDigits: 2,
    }).format(Number(value || 0));

  const formatDate = (date) => {
    if (!date) return "-";

    return new Date(date).toLocaleDateString(
      "en-ZA",
      {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }
    );
  };

  const getCustomerName = (loan) => {
    if (!loan?.customers) {
      return "Unknown Customer";
    }

    return (
      `${loan.customers.first_name || ""} ${
        loan.customers.last_name || ""
      }`.trim() || "Unknown Customer"
    );
  };

  const getApplicationName = (application) => {
    return (
      `${application.first_name || ""} ${
        application.last_name || ""
      }`.trim() || "Unknown Applicant"
    );
  };

  const getApplicationStatus = (application) =>
    String(application.status || "")
      .replace(/_/g, " ")
      .toUpperCase();

  /*
   * =========================
   * LOADING
   * =========================
   */

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
        <Stack
          spacing={2}
          alignItems="center"
        >
          <CircularProgress />

          <Typography color="text.secondary">
            Loading dashboard...
          </Typography>
        </Stack>
      </Box>
    );
  }

  /*
   * =========================
   * DASHBOARD
   * =========================
   */

  return (
    <Box
      sx={{
        p: {
          xs: 2,
          md: 3,
        },
      }}
    >
      {/* =========================
          HEADER
      ========================== */}

      <Stack
        direction={{
          xs: "column",
          sm: "row",
        }}
        justifyContent="space-between"
        alignItems={{
          xs: "flex-start",
          sm: "center",
        }}
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Box>
          <Typography
            variant="h4"
            fontWeight={700}
          >
            Dashboard
          </Typography>

          <Typography
            color="text.secondary"
            sx={{ mt: 0.5 }}
          >
            Umhlomunye Finance overview
          </Typography>
        </Box>

        <Button
          variant="outlined"
          startIcon={<Refresh />}
          onClick={() => loadDashboard()}
          disabled={processing}
        >
          {processing
            ? "Processing..."
            : "Refresh"}
        </Button>
      </Stack>

      {error && (
        <Alert
          severity="error"
          sx={{ mb: 3 }}
        >
          {error}
        </Alert>
      )}

      {/* =========================
          MAIN STATISTICS
      ========================== */}

      <Grid
        container
        spacing={2}
        sx={{ mb: 3 }}
      >
        {/* TOTAL LOANS */}

        <Grid
          size={{
            xs: 12,
            sm: 6,
            md: 3,
          }}
        >
          <Card>
            <CardContent>
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="flex-start"
              >
                <Box>
                  <Typography
                    color="text.secondary"
                    variant="body2"
                  >
                    Total Loans
                  </Typography>

                  <Typography
                    variant="h4"
                    fontWeight={700}
                    sx={{ mt: 1 }}
                  >
                    {totalLoans}
                  </Typography>
                </Box>

                <CreditCard />
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* PORTFOLIO BALANCE */}

        <Grid
          size={{
            xs: 12,
            sm: 6,
            md: 3,
          }}
        >
          <Card>
            <CardContent>
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="flex-start"
              >
                <Box>
                  <Typography
                    color="text.secondary"
                    variant="body2"
                  >
                    Portfolio Balance
                  </Typography>

                  <Typography
                    variant="h5"
                    fontWeight={700}
                    sx={{ mt: 1 }}
                  >
                    {formatCurrency(
                      totalPortfolioBalance
                    )}
                  </Typography>
                </Box>

                <AccountBalance />
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* TOTAL PAID */}

        <Grid
          size={{
            xs: 12,
            sm: 6,
            md: 3,
          }}
        >
          <Card>
            <CardContent>
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="flex-start"
              >
                <Box>
                  <Typography
                    color="text.secondary"
                    variant="body2"
                  >
                    Total Paid
                  </Typography>

                  <Typography
                    variant="h5"
                    fontWeight={700}
                    sx={{ mt: 1 }}
                  >
                    {formatCurrency(totalPaid)}
                  </Typography>
                </Box>

                <Payment />
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* PENDING APPLICATIONS */}

        <Grid
          size={{
            xs: 12,
            sm: 6,
            md: 3,
          }}
        >
          <Card
            sx={{
              cursor:
                pendingApplications > 0
                  ? "pointer"
                  : "default",
            }}
            onClick={() => {
              if (pendingApplications > 0) {
                navigate("/applications");
              }
            }}
          >
            <CardContent>
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="flex-start"
              >
                <Box>
                  <Typography
                    color="text.secondary"
                    variant="body2"
                  >
                    Pending Applications
                  </Typography>

                  <Typography
                    variant="h4"
                    fontWeight={700}
                    sx={{ mt: 1 }}
                  >
                    {pendingApplications}
                  </Typography>
                </Box>

                <Assignment />
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* =========================
          SECONDARY STATISTICS
      ========================== */}

      <Grid
        container
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Grid
          size={{
            xs: 12,
            md: 4,
          }}
        >
          <Paper sx={{ p: 2 }}>
            <Stack
              direction="row"
              spacing={2}
              alignItems="center"
            >
              <CheckCircle />

              <Box>
                <Typography
                  variant="body2"
                  color="text.secondary"
                >
                  Active Loans
                </Typography>

                <Typography
                  variant="h6"
                  fontWeight={700}
                >
                  {activeLoans.length}
                </Typography>
              </Box>
            </Stack>
          </Paper>
        </Grid>

        <Grid
          size={{
            xs: 12,
            md: 4,
          }}
        >
          <Paper sx={{ p: 2 }}>
            <Stack
              direction="row"
              spacing={2}
              alignItems="center"
            >
              <TrendingUp />

              <Box>
                <Typography
                  variant="body2"
                  color="text.secondary"
                >
                  Average Loan Balance
                </Typography>

                <Typography
                  variant="h6"
                  fontWeight={700}
                >
                  {formatCurrency(
                    activeLoans.length
                      ? totalPortfolioBalance /
                          activeLoans.length
                      : 0
                  )}
                </Typography>
              </Box>
            </Stack>
          </Paper>
        </Grid>

        <Grid
          size={{
            xs: 12,
            md: 4,
          }}
        >
          <Paper sx={{ p: 2 }}>
            <Stack
              direction="row"
              spacing={2}
              alignItems="center"
            >
              <AttachMoney />

              <Box>
                <Typography
                  variant="body2"
                  color="text.secondary"
                >
                  Total Portfolio
                </Typography>

                <Typography
                  variant="h6"
                  fontWeight={700}
                >
                  {formatCurrency(
                    totalPortfolioBalance
                  )}
                </Typography>
              </Box>
            </Stack>
          </Paper>
        </Grid>
      </Grid>

      {/* =========================
          APPLICATIONS
      ========================== */}

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack
            direction={{
              xs: "column",
              sm: "row",
            }}
            justifyContent="space-between"
            alignItems={{
              xs: "flex-start",
              sm: "center",
            }}
            spacing={2}
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
                Applications awaiting review
              </Typography>
            </Box>

            <Button
              variant="contained"
              endIcon={<ArrowForward />}
              onClick={() =>
                navigate("/applications")
              }
            >
              Review Applications
            </Button>
          </Stack>

          <Divider sx={{ mb: 2 }} />

          {applications.length === 0 ? (
            <Box
              sx={{
                py: 4,
                textAlign: "center",
              }}
            >
              <Assignment
                sx={{
                  fontSize: 42,
                  color: "text.secondary",
                  mb: 1,
                }}
              />

              <Typography color="text.secondary">
                No pending applications.
              </Typography>
            </Box>
          ) : (
            <Stack spacing={1}>
              {applications
                .slice(0, 5)
                .map((application) => (
                  <Paper
                    key={application.id}
                    variant="outlined"
                    sx={{
                      p: 2,
                      cursor: "pointer",
                    }}
                    onClick={() =>
                      navigate(
                        `/applications/${application.id}`
                      )
                    }
                  >
                    <Stack
                      direction={{
                        xs: "column",
                        sm: "row",
                      }}
                      justifyContent="space-between"
                      spacing={2}
                    >
                      <Box>
                        <Typography fontWeight={600}>
                          {getApplicationName(
                            application
                          )}
                        </Typography>

                        <Typography
                          variant="body2"
                          color="text.secondary"
                        >
                          {application.application_number ||
                            "Application"}
                        </Typography>

                        <Typography
                          variant="caption"
                          color="text.secondary"
                        >
                          Submitted{" "}
                          {formatDate(
                            application.created_at
                          )}
                        </Typography>
                      </Box>

                      <Stack
                        direction="row"
                        spacing={1}
                        alignItems="center"
                      >
                        <Chip
                          size="small"
                          label={getApplicationStatus(
                            application
                          )}
                        />

                        <Typography fontWeight={600}>
                          {formatCurrency(
                            application.amount_requested
                          )}
                        </Typography>
                      </Stack>
                    </Stack>
                  </Paper>
                ))}
            </Stack>
          )}
        </CardContent>
      </Card>

      {/* =========================
          ACTIVE LOANS + UPCOMING
          INTEREST
      ========================== */}

      <Grid
        container
        spacing={2}
        sx={{ mb: 3 }}
      >
        {/* ACTIVE LOANS */}

        <Grid
          size={{
            xs: 12,
            md: 7,
          }}
        >
          <Card>
            <CardContent>
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                sx={{ mb: 2 }}
              >
                <Typography
                  variant="h6"
                  fontWeight={700}
                >
                  Active Loans
                </Typography>

                <Button
                  size="small"
                  endIcon={<ArrowForward />}
                  onClick={() =>
                    navigate("/loans")
                  }
                >
                  View All
                </Button>
              </Stack>

              <Divider sx={{ mb: 2 }} />

              {activeLoans.length === 0 ? (
                <Typography
                  color="text.secondary"
                  sx={{ py: 3 }}
                >
                  No active loans.
                </Typography>
              ) : (
                <Stack spacing={1}>
                  {activeLoans
                    .slice(0, 5)
                    .map((loan) => (
                      <Paper
                        key={loan.id}
                        variant="outlined"
                        sx={{
                          p: 2,
                          cursor: "pointer",
                        }}
                        onClick={() =>
                          navigate(
                            `/loans/${loan.id}`
                          )
                        }
                      >
                        <Stack
                          direction={{
                            xs: "column",
                            sm: "row",
                          }}
                          justifyContent="space-between"
                          spacing={1}
                        >
                          <Box>
                            <Typography fontWeight={600}>
                              {getCustomerName(loan)}
                            </Typography>

                            <Typography
                              variant="body2"
                              color="text.secondary"
                            >
                              {loan.loan_number ||
                                "Loan"}
                            </Typography>
                          </Box>

                          <Typography fontWeight={600}>
                            {formatCurrency(
                              loan.current_balance
                            )}
                          </Typography>
                        </Stack>
                      </Paper>
                    ))}
                </Stack>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* UPCOMING INTEREST */}

        <Grid
          size={{
            xs: 12,
            md: 5,
          }}
        >
          <Card>
            <CardContent>
              <Stack
                direction="row"
                spacing={1}
                alignItems="center"
                sx={{ mb: 2 }}
              >
                <Schedule />

                <Typography
                  variant="h6"
                  fontWeight={700}
                >
                  Upcoming Interest
                </Typography>
              </Stack>

              <Divider sx={{ mb: 2 }} />

              {upcomingInterest.length === 0 ? (
                <Typography
                  color="text.secondary"
                  sx={{ py: 3 }}
                >
                  No upcoming interest dates.
                </Typography>
              ) : (
                <Stack spacing={1.5}>
                  {upcomingInterest
                    .slice(0, 5)
                    .map((loan) => (
                      <Box key={loan.id}>
                        <Stack
                          direction="row"
                          justifyContent="space-between"
                          spacing={1}
                        >
                          <Box>
                            <Typography
                              variant="body2"
                              fontWeight={600}
                            >
                              {getCustomerName(loan)}
                            </Typography>

                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              {formatDate(
                                loan.next_interest_date
                              )}
                            </Typography>
                          </Box>

                          <Typography
                            variant="body2"
                            fontWeight={600}
                          >
                            {formatCurrency(
                              loan.current_balance
                            )}
                          </Typography>
                        </Stack>
                      </Box>
                    ))}
                </Stack>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* =========================
          RECENT REPAYMENTS
      ========================== */}

      <Card sx={{ mb: 3 }}>
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
                Recent Repayments
              </Typography>

              <Typography
                variant="body2"
                color="text.secondary"
              >
                Latest payment transactions
              </Typography>
            </Box>

            <Button
              size="small"
              endIcon={<ArrowForward />}
              onClick={() =>
                navigate("/repayments")
              }
            >
              View Repayments
            </Button>
          </Stack>

          <Divider sx={{ mb: 2 }} />

          {recentRepayments.length === 0 ? (
            <Typography
              color="text.secondary"
              sx={{ py: 3 }}
            >
              No recent repayments.
            </Typography>
          ) : (
            <Stack spacing={1}>
              {recentRepayments.map(
                (transaction) => (
                  <Paper
                    key={transaction.id}
                    variant="outlined"
                    sx={{ p: 2 }}
                  >
                    <Stack
                      direction={{
                        xs: "column",
                        sm: "row",
                      }}
                      justifyContent="space-between"
                      spacing={1}
                    >
                      <Box>
                        <Typography fontWeight={600}>
                          {transaction.description ||
                            "Repayment"}
                        </Typography>

                        <Typography
                          variant="body2"
                          color="text.secondary"
                        >
                          {formatDate(
                            transaction.transaction_date
                          )}
                        </Typography>
                      </Box>

                      <Typography fontWeight={700}>
                        {formatCurrency(
                          transaction.credit
                        )}
                      </Typography>
                    </Stack>
                  </Paper>
                )
              )}
            </Stack>
          )}
        </CardContent>
      </Card>

      {/* =========================
          FOOTER
      ========================== */}

      <Box
        sx={{
          textAlign: "center",
          py: 2,
        }}
      >
        <Typography
          variant="body2"
          color="text.secondary"
        >
          Umhlomunye Finance
        </Typography>

        <Typography
          variant="caption"
          color="text.secondary"
        >
          Our dreams, Our hope
        </Typography>
      </Box>
    </Box>
  );
}