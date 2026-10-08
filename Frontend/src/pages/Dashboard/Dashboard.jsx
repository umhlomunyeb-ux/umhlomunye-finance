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
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";

import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import PaymentsIcon from "@mui/icons-material/Payments";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import ScheduleIcon from "@mui/icons-material/Schedule";

import { supabase } from "../../lib/supabase";
import { getCurrentUserProfile } from "../../services/userService";
import { getSystemSettings } from "../../services/settingsService";

function money(value) {
  return `R${Number(value || 0).toLocaleString("en-ZA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(value) {
  if (!value) return "-";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString("en-ZA", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function formatDateTime(value) {
  if (!value) return "-";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

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

function StatCard({ title, value, subtitle, icon }) {
  return (
    <Card
      elevation={2}
      sx={{
        height: "100%",
        width: "100%",
        borderRadius: 3,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <CardContent
        sx={{
          flex: 1,
          display: "flex",
          alignItems: "center",
        }}
      >
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="flex-start"
          spacing={2}
          sx={{ width: "100%" }}
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

          {icon && (
            <Box
              sx={{
                width: 46,
                height: 46,
                minWidth: 46,
                borderRadius: 2,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                bgcolor: "action.hover",
              }}
            >
              {icon}
            </Box>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();

  const [loans, setLoans] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [applications, setApplications] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [userName, setUserName] = useState("User");
  const [companyName, setCompanyName] =
    useState("Company");

  useEffect(() => {
    let mounted = true;

    async function loadHeaderInformation() {
      try {
        const [profile, settings] =
          await Promise.all([
            getCurrentUserProfile(),
            getSystemSettings(),
          ]);

        if (!mounted) return;

        const fullName =
          profile?.full_name?.trim();

        setUserName(
          fullName || profile?.username || "User"
        );

        setCompanyName(
          settings?.company_name ||
            "Company"
        );
      } catch (err) {
        console.error(
          "DASHBOARD HEADER ERROR:",
          err
        );

        if (!mounted) return;

        setUserName("User");
        setCompanyName("Company");
      }
    }

    loadHeaderInformation();

    return () => {
      mounted = false;
    };
  }, []);

  const loadDashboard = useCallback(
    async () => {
      try {
        setError("");

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

        setTransactions(
          transactionsResult.data || []
        );

        setApplications(
          applicationsResult.data || []
        );
      } catch (err) {
        console.error(
          "DASHBOARD ERROR:",
          err
        );

        setError(
          err.message ||
            "Unable to load dashboard data."
        );
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    const refreshInterval =
      setInterval(() => {
        loadDashboard();
      }, 30000);

    return () => {
      clearInterval(refreshInterval);
    };
  }, [loadDashboard]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (
        document.visibilityState ===
        "visible"
      ) {
        loadDashboard();
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
          loadDashboard();
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
          loadDashboard();
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
          loadDashboard();
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
          String(
            loan.loan_status
          ).toLowerCase() === "active" &&
          !loan.is_deleted
      ),
    [loans]
  );

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

  const activeBalance = useMemo(
    () =>
      activeLoans.reduce(
        (sum, loan) =>
          sum +
          Number(
            loan.current_balance || 0
          ),
        0
      ),
    [activeLoans]
  );

  const totalPaid = useMemo(
    () =>
      loans.reduce(
        (sum, loan) =>
          sum +
          Number(
            loan.total_paid || 0
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

  const interestCollected = useMemo(
    () =>
      transactions
        .filter(
          (transaction) =>
            String(
              transaction.transaction_type ||
                ""
            ).toLowerCase() ===
            "payment"
        )
        .reduce(
          (sum, transaction) =>
            sum +
            Number(
              transaction.interest_amount ??
                transaction.interest_collected ??
                0
            ),
          0
        ),
    [transactions]
  );

  const arrearsLoans = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return activeLoans
      .filter((loan) => {
        if (!loan.next_payment_date) {
          return false;
        }

        const dueDate = new Date(
          loan.next_payment_date + "T00:00:00"
        );

        return (
          dueDate < today &&
          Number(loan.current_balance || 0) > 0
        );
      })
      .sort(
        (a, b) =>
          new Date(
            a.next_payment_date + "T00:00:00"
          ) -
          new Date(
            b.next_payment_date + "T00:00:00"
          )
      )
      .slice(0, 10);
  }, [activeLoans]);

  const upcomingInterest = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(end.getDate() + 7);

    return activeLoans
      .filter((loan) => {
        if (!loan.next_payment_date) {
          return false;
        }

        const dueDate = new Date(
          loan.next_payment_date + "T00:00:00"
        );

        return dueDate >= start && dueDate <= end;
      })
      .sort(
        (a, b) =>
          new Date(
            a.next_payment_date + "T00:00:00"
          ) -
          new Date(
            b.next_payment_date + "T00:00:00"
          )
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
    <Box sx={{ width: "100%" }}>
      {/* HEADER */}
      <Stack
        direction={{
          xs: "column",
          md: "row",
        }}
        justifyContent="space-between"
        alignItems={{
          xs: "flex-start",
          md: "center",
        }}
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Box>
          <Typography
            variant="h4"
            fontWeight={800}
            sx={{ mb: 0.5 }}
          >
            Welcome, {userName}
          </Typography>
        </Box>
      </Stack>

      {/* ERROR */}
      {error && (
        <Alert
          severity="error"
          sx={{
            mb: 3,
            borderRadius: 2,
          }}
        >
          {error}
        </Alert>
      )}

      {/* =======================================================
          DASHBOARD STATISTICS

          DESKTOP:
          4 columns x 2 rows

          Columns 1-3:
          Six equal statistic cards

          Column 4:
          Pending Applications spans both rows
          ======================================================= */}

      <Box
        sx={{
          width: "100%",
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            sm: "repeat(2, minmax(0, 1fr))",
            md: "repeat(4, minmax(0, 1fr))",
          },
          gridTemplateRows: {
            xs: "auto",
            sm: "auto",
            md: "repeat(2, minmax(190px, 1fr))",
          },
          gap: 2.5,
          mb: 3,
          alignItems: "stretch",
        }}
      >
        {/* ROW 1 - CARD 1 */}
        <Box
          sx={{
            display: "flex",
            minWidth: 0,
          }}
        >
          <StatCard
            title="Total Loans"
            value={loans.length}
            subtitle="All recorded loans"
            icon={<AccountBalanceWalletIcon />}
          />
        </Box>

        {/* ROW 1 - CARD 2 */}
        <Box
          sx={{
            display: "flex",
            minWidth: 0,
          }}
        >
          <StatCard
            title="Portfolio Balance"
            value={money(activeBalance)}
            subtitle="Outstanding active balance"
            icon={<TrendingUpIcon />}
          />
        </Box>

        {/* ROW 1 - CARD 3 */}
        <Box
          sx={{
            display: "flex",
            minWidth: 0,
          }}
        >
          <StatCard
            title="Total Paid"
            value={money(totalPaid)}
            subtitle="All recorded repayments"
            icon={<PaymentsIcon />}
          />
        </Box>

        {/* PENDING APPLICATIONS
            CARD 4 - SPANS BOTH ROWS */}
        <Box
          sx={{
            display: "flex",
            minWidth: 0,

            gridColumn: {
              xs: "auto",
              sm: "auto",
              md: "4",
            },

            gridRow: {
              xs: "auto",
              sm: "auto",
              md: "1 / span 2",
            },
          }}
        >
          <Card
            elevation={2}
            sx={{
              borderRadius: 3,
              width: "100%",
              height: "100%",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <CardContent
              sx={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
              }}
            >
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
                    Pending Applications
                  </Typography>

                  <Typography
                    variant="body2"
                    color="text.secondary"
                  >
                    Applications awaiting review
                  </Typography>
                </Box>

                <Chip
                  label={applications.length}
                  color="warning"
                />
              </Stack>

              <Divider sx={{ mb: 2 }} />

              {applications.length === 0 ? (
                <Box
                  sx={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    textAlign: "center",
                    py: 3,
                  }}
                >
                  <Typography color="text.secondary">
                    No pending applications.
                  </Typography>
                </Box>
              ) : (
                <Stack
                  spacing={1.5}
                  sx={{
                    flex: 1,
                    overflowY: "auto",
                    minHeight: 0,
                  }}
                >
                  {applications
                    .slice(0, 6)
                    .map((application) => (
                      <Paper
                        key={application.id}
                        variant="outlined"
                        sx={{
                          p: 1.5,
                          cursor: "pointer",
                          transition:
                            "all 0.2s ease",
                          "&:hover": {
                            bgcolor:
                              "action.hover",
                          },
                        }}
                        onClick={() =>
                          navigate(
                            `/applications/${application.id}`
                          )
                        }
                      >
                        <Typography fontWeight={700}>
                          {application.application_number ||
                            application.id?.slice(
                              0,
                              8
                            )}
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
        </Box>

        {/* ROW 2 - CARD 1 */}
        <Box
          sx={{
            display: "flex",
            minWidth: 0,
          }}
        >
          <StatCard
            title="Total Principal Disbursed"
            value={money(totalDisbursed)}
            subtitle="Total principal issued"
          />
        </Box>

        {/* ROW 2 - CARD 2 */}
        <Box
          sx={{
            display: "flex",
            minWidth: 0,
          }}
        >
          <StatCard
            title="Contracted Interest"
            value={money(totalInterest)}
            subtitle="Total interest on recorded loans"
          />
        </Box>

        {/* ROW 2 - CARD 3 */}
        <Box
          sx={{
            display: "flex",
            minWidth: 0,
          }}
        >
          <StatCard
            title="Interest Collected"
            value={money(interestCollected)}
            subtitle="Interest received through repayments"
          />
        </Box>
      </Box>

      {/* UPCOMING INTEREST */}
      <Card
        elevation={2}
        sx={{
          borderRadius: 3,
          mb: 3,
        }}
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
                Upcoming Interest Processing
              </Typography>

              <Typography
                variant="body2"
                color="text.secondary"
              >
                Payments due within the next
                7 days
              </Typography>
            </Box>

            <ScheduleIcon color="action" />
          </Stack>

          <Divider sx={{ mb: 2 }} />

          {upcomingInterest.length === 0 ? (
            <Typography
              color="text.secondary"
              sx={{ py: 3 }}
            >
              No upcoming interest processing.
            </Typography>
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
                      <strong>Payment Due</strong>
                    </TableCell>

                    <TableCell align="right">
                      <strong>Balance</strong>
                    </TableCell>
                  </TableRow>
                </TableHead>

                <TableBody>
                  {upcomingInterest.map(
                    (loan) => (
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
                          <Typography fontWeight={600}>
                            {loan.loan_number ||
                              "-"}
                          </Typography>
                        </TableCell>

                        <TableCell>
                          {getCustomerName(loan)}
                        </TableCell>

                        <TableCell>
                          {formatDateTime(
                            loan.next_payment_date
                          )}
                        </TableCell>

                        <TableCell align="right">
                          {money(
                            loan.current_balance
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      {/* LOAN ACCOUNTS IN ARREARS */}
      <Card
        elevation={2}
        sx={{ borderRadius: 3 }}
      >
        <CardContent>
          <Box sx={{ mb: 2 }}>
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
              Loan accounts in arrears where the full amount was not paid by the payment date
            </Typography>
          </Box>

          <Divider sx={{ mb: 2 }} />

          {arrearsLoans.length === 0 ? (
            <Typography
              color="text.secondary"
              sx={{ py: 3 }}
            >
              No loan accounts are currently in arrears.
            </Typography>
          ) : (
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>
                      <strong>Payment Date</strong>
                    </TableCell>

                    <TableCell>
                      <strong>Loan</strong>
                    </TableCell>

                    <TableCell>
                      <strong>Customer</strong>
                    </TableCell>

                    <TableCell align="right">
                      <strong>Outstanding</strong>
                    </TableCell>
                  </TableRow>
                </TableHead>

                <TableBody>
                  {arrearsLoans.map((loan) => (
                    <TableRow
                      key={loan.id}
                      hover
                      sx={{ cursor: "pointer" }}
                      onClick={() =>
                        navigate(`/loans/${loan.id}`)
                      }
                    >
                      <TableCell>
                        {formatDate(loan.next_payment_date)}
                      </TableCell>

                      <TableCell>
                        <Typography fontWeight={600}>
                          {loan.loan_number || "-"}
                        </Typography>
                      </TableCell>

                      <TableCell>
                        {getCustomerName(loan)}
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

      {/* ENGINE INFORMATION */}
      <Alert
        severity="info"
        sx={{
          mt: 3,
          borderRadius: 2,
        }}
      >
        Loan balances and interest are calculated
        by the Supabase loan engine. The dashboard
        only displays the database values.
      </Alert>
    </Box>
  );
}
