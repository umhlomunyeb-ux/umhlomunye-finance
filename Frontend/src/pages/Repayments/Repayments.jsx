import { useCallback, useEffect, useMemo, useState } from "react";
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
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";

import SearchIcon from "@mui/icons-material/Search";
import RefreshIcon from "@mui/icons-material/Refresh";
import AddIcon from "@mui/icons-material/Add";
import VisibilityIcon from "@mui/icons-material/Visibility";
import PaymentsIcon from "@mui/icons-material/Payments";
import TodayIcon from "@mui/icons-material/Today";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";

import { useNavigate } from "react-router-dom";

import { supabase } from "../../lib/supabase";
import RecordPayment from "./RecordPayment";

export default function Repayments() {
  const navigate = useNavigate();

  const [repayments, setRepayments] = useState([]);
  const [loans, setLoans] = useState([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");

  // Record payment dialog
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [selectedLoan, setSelectedLoan] = useState(null);

  const [lastUpdated, setLastUpdated] = useState(null);

  /*
   * ============================================================
   * LOAD DATA
   * ============================================================
   */
  const loadData = useCallback(async (showRefresh = false) => {
    try {
      setError("");

      if (showRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      /*
       * Load loans
       */
      const { data: loanData, error: loanError } = await supabase
        .from("loans")
        .select(`
          id,
          loan_number,
          customer_id,
          principal_amount,
          interest_amount,
          total_repayment,
          current_balance,
          total_paid,
          loan_status,
          first_payment_date,
          next_payment_date,
          next_interest_date,
          last_payment_date,
          created_at
        `)
        .order("created_at", { ascending: false });

      if (loanError) {
        throw loanError;
      }

      /*
       * Load repayment transactions
       */
      const { data: transactionData, error: transactionError } =
        await supabase
          .from("loan_transactions")
          .select(`
            id,
            loan_id,
            transaction_date,
            transaction_type,
            description,
            debit,
            credit,
            balance,
            created_by
          `)
          .eq("transaction_type", "Payment")
          .order("transaction_date", { ascending: false });

      if (transactionError) {
        throw transactionError;
      }

      const loanMap = {};

      (loanData || []).forEach((loan) => {
        loanMap[loan.id] = loan;
      });

      /*
       * Combine payment transactions with loan information
       */
      const paymentRows = (transactionData || []).map((payment) => {
        const loan = loanMap[payment.loan_id];

        return {
          ...payment,
          loan,
          loan_number: loan?.loan_number || "Unknown",
          loan_status: loan?.loan_status || "Unknown",
        };
      });

      setLoans(loanData || []);
      setRepayments(paymentRows);
      setLastUpdated(new Date());
    } catch (err) {
      console.error("Repayment loading error:", err);

      setError(
        err?.message ||
          "Unable to load repayment information."
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  /*
   * Initial load
   */
  useEffect(() => {
    loadData();
  }, [loadData]);

  /*
   * ============================================================
   * REAL-TIME UPDATES
   * ============================================================
   */
  useEffect(() => {
    const channel = supabase
      .channel("repayments-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "loan_transactions",
        },
        () => {
          loadData(true);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "loans",
        },
        () => {
          loadData(true);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadData]);

  /*
   * Refresh when user comes back to the tab
   */
  useEffect(() => {
    const handleFocus = () => {
      loadData(true);
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        loadData(true);
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener(
      "visibilitychange",
      handleVisibility
    );

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener(
        "visibilitychange",
        handleVisibility
      );
    };
  }, [loadData]);

  /*
   * ============================================================
   * TODAY
   * ============================================================
   */
  const today = new Date();

  const todayString =
    today.getFullYear() +
    "-" +
    String(today.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(today.getDate()).padStart(2, "0");

  /*
   * ============================================================
   * FILTER
   * ============================================================
   */
  const filteredRepayments = useMemo(() => {
    const value = search.trim().toLowerCase();

    if (!value) {
      return repayments;
    }

    return repayments.filter((payment) => {
      return (
        payment.loan_number
          ?.toLowerCase()
          .includes(value) ||
        payment.description
          ?.toLowerCase()
          .includes(value)
      );
    });
  }, [repayments, search]);

  /*
   * ============================================================
   * SUMMARY
   * ============================================================
   */
  const totalRepayments = useMemo(() => {
    return repayments.reduce((total, payment) => {
      return total + Number(payment.credit || 0);
    }, 0);
  }, [repayments]);

  const todaysRepayments = useMemo(() => {
    return repayments.filter((payment) => {
      if (!payment.transaction_date) return false;

      const date = new Date(payment.transaction_date);

      const dateString =
        date.getFullYear() +
        "-" +
        String(date.getMonth() + 1).padStart(2, "0") +
        "-" +
        String(date.getDate()).padStart(2, "0");

      return dateString === todayString;
    });
  }, [repayments, todayString]);

  const todaysTotal = useMemo(() => {
    return todaysRepayments.reduce((total, payment) => {
      return total + Number(payment.credit || 0);
    }, 0);
  }, [todaysRepayments]);

  const activeLoans = useMemo(() => {
    return loans.filter(
      (loan) =>
        String(loan.loan_status || "").toLowerCase() ===
        "active"
    );
  }, [loans]);

  const outstandingBalance = useMemo(() => {
    return activeLoans.reduce((total, loan) => {
      return total + Number(loan.current_balance || 0);
    }, 0);
  }, [activeLoans]);

  /*
   * ============================================================
   * OPEN RECORD PAYMENT
   * ============================================================
   */
  function openRecordPayment(loan) {
    setSelectedLoan(loan);
    setPaymentDialogOpen(true);
  }

  /*
   * Close dialog
   */
  function closeRecordPayment() {
    setPaymentDialogOpen(false);
    setSelectedLoan(null);
  }

  /*
   * After payment has been successfully saved
   */
  async function handlePaymentSaved() {
    closeRecordPayment();

    await loadData(true);
  }

  /*
   * ============================================================
   * FORMATTERS
   * ============================================================
   */
  function formatCurrency(value) {
    return `R${Number(value || 0).toLocaleString("en-ZA", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  function formatDate(value) {
    if (!value) return "-";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "-";
    }

    return date.toLocaleDateString("en-ZA", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  function statusColor(status) {
    const value = String(status || "").toLowerCase();

    if (value === "active") return "success";
    if (value === "completed") return "primary";
    if (value === "overdue") return "error";
    if (value === "void") return "default";

    return "default";
  }

  /*
   * ============================================================
   * LOADING
   * ============================================================
   */
  if (loading) {
    return (
      <Box
        sx={{
          minHeight: "60vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Stack spacing={2} alignItems="center">
          <CircularProgress />
          <Typography color="text.secondary">
            Loading repayments...
          </Typography>
        </Stack>
      </Box>
    );
  }

  /*
   * ============================================================
   * PAGE
   * ============================================================
   */
  return (
    <Box sx={{ p: { xs: 1, md: 3 } }}>
      {/* HEADER */}
      <Stack
        direction={{ xs: "column", md: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "stretch", md: "center" }}
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Box>
          <Typography
            variant="h4"
            fontWeight={700}
            sx={{ mb: 0.5 }}
          >
            Repayments
          </Typography>

          <Typography color="text.secondary">
            Manage and monitor customer loan repayments.
          </Typography>

          {lastUpdated && (
            <Typography
              variant="caption"
              color="text.secondary"
            >
              Last updated:{" "}
              {lastUpdated.toLocaleTimeString("en-ZA")}
            </Typography>
          )}
        </Box>

        <Stack direction="row" spacing={1}>
          <Tooltip title="Refresh repayments">
            <span>
              <IconButton
                onClick={() => loadData(true)}
                disabled={refreshing}
              >
                <RefreshIcon />
              </IconButton>
            </span>
          </Tooltip>

          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => {
              /*
               * No loan selected yet.
               * The user will choose a loan from the list below.
               */
              if (activeLoans.length > 0) {
                openRecordPayment(activeLoans[0]);
              } else {
                setError(
                  "There are no active loans available for repayment."
                );
              }
            }}
          >
            Record Repayment
          </Button>
        </Stack>
      </Stack>

      {error && (
        <Alert
          severity="error"
          sx={{ mb: 3 }}
          onClose={() => setError("")}
        >
          {error}
        </Alert>
      )}

      {/* SUMMARY CARDS */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            sm: "repeat(2, 1fr)",
            lg: "repeat(4, 1fr)",
          },
          gap: 2,
          mb: 3,
        }}
      >
        <Card>
          <CardContent>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
            >
              <Box>
                <Typography
                  variant="body2"
                  color="text.secondary"
                >
                  Total Repayments
                </Typography>

                <Typography variant="h5" fontWeight={700}>
                  {formatCurrency(totalRepayments)}
                </Typography>
              </Box>

              <PaymentsIcon color="primary" />
            </Stack>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
            >
              <Box>
                <Typography
                  variant="body2"
                  color="text.secondary"
                >
                  Today's Collections
                </Typography>

                <Typography variant="h5" fontWeight={700}>
                  {formatCurrency(todaysTotal)}
                </Typography>

                <Typography
                  variant="caption"
                  color="text.secondary"
                >
                  {todaysRepayments.length} payment(s)
                </Typography>
              </Box>

              <TodayIcon color="primary" />
            </Stack>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
            >
              <Box>
                <Typography
                  variant="body2"
                  color="text.secondary"
                >
                  Active Loans
                </Typography>

                <Typography variant="h5" fontWeight={700}>
                  {activeLoans.length}
                </Typography>
              </Box>

              <AccountBalanceIcon color="primary" />
            </Stack>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
            >
              <Box>
                <Typography
                  variant="body2"
                  color="text.secondary"
                >
                  Outstanding Balance
                </Typography>

                <Typography variant="h5" fontWeight={700}>
                  {formatCurrency(outstandingBalance)}
                </Typography>
              </Box>

              <AccountBalanceIcon color="primary" />
            </Stack>
          </CardContent>
        </Card>
      </Box>

      {/* ACTIVE LOANS */}
      <Paper
        elevation={0}
        sx={{
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 2,
          mb: 3,
        }}
      >
        <Box sx={{ p: 2 }}>
          <Typography
            variant="h6"
            fontWeight={700}
          >
            Active Loans
          </Typography>

          <Typography
            variant="body2"
            color="text.secondary"
          >
            Select a loan to record a repayment.
          </Typography>
        </Box>

        <Divider />

        {activeLoans.length === 0 ? (
          <Box sx={{ p: 4, textAlign: "center" }}>
            <Typography color="text.secondary">
              No active loans available.
            </Typography>
          </Box>
        ) : (
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "1fr",
                md: "repeat(2, 1fr)",
                xl: "repeat(3, 1fr)",
              },
              gap: 2,
              p: 2,
            }}
          >
            {activeLoans.map((loan) => (
              <Card
                key={loan.id}
                variant="outlined"
              >
                <CardContent>
                  <Stack spacing={1.5}>
                    <Stack
                      direction="row"
                      justifyContent="space-between"
                      alignItems="center"
                    >
                      <Typography fontWeight={700}>
                        {loan.loan_number}
                      </Typography>

                      <Chip
                        label={loan.loan_status || "Active"}
                        color={statusColor(
                          loan.loan_status
                        )}
                        size="small"
                      />
                    </Stack>

                    <Box>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                      >
                        Current Balance
                      </Typography>

                      <Typography
                        variant="h6"
                        fontWeight={700}
                      >
                        {formatCurrency(
                          loan.current_balance
                        )}
                      </Typography>
                    </Box>

                    <Button
                      fullWidth
                      variant="contained"
                      startIcon={<PaymentsIcon />}
                      onClick={() =>
                        openRecordPayment(loan)
                      }
                    >
                      Record Payment
                    </Button>

                    <Button
                      fullWidth
                      variant="outlined"
                      startIcon={<VisibilityIcon />}
                      onClick={() =>
                        navigate(
                          `/loans/${loan.id}`
                        )
                      }
                    >
                      View Loan
                    </Button>
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Box>
        )}
      </Paper>

      {/* REPAYMENT REGISTER */}
      <Paper
        elevation={0}
        sx={{
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 2,
        }}
      >
        <Box sx={{ p: 2 }}>
          <Stack
            direction={{ xs: "column", md: "row" }}
            justifyContent="space-between"
            spacing={2}
          >
            <Box>
              <Typography
                variant="h6"
                fontWeight={700}
              >
                Repayment Register
              </Typography>

              <Typography
                variant="body2"
                color="text.secondary"
              >
                All recorded customer repayments.
              </Typography>
            </Box>

            <TextField
              size="small"
              placeholder="Search loan..."
              value={search}
              onChange={(e) =>
                setSearch(e.target.value)
              }
              sx={{
                width: {
                  xs: "100%",
                  md: 280,
                },
              }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon />
                  </InputAdornment>
                ),
              }}
            />
          </Stack>
        </Box>

        <Divider />

        {filteredRepayments.length === 0 ? (
          <Box
            sx={{
              p: 5,
              textAlign: "center",
            }}
          >
            <PaymentsIcon
              sx={{
                fontSize: 45,
                color: "text.disabled",
                mb: 1,
              }}
            />

            <Typography
              variant="h6"
              color="text.secondary"
            >
              No repayments found
            </Typography>

            <Typography
              variant="body2"
              color="text.secondary"
            >
              Recorded repayments will appear here.
            </Typography>
          </Box>
        ) : (
          <Box sx={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
              }}
            >
              <thead>
                <tr>
                  {[
                    "Date",
                    "Loan",
                    "Description",
                    "Amount",
                    "Balance After",
                    "Status",
                    "Action",
                  ].map((heading) => (
                    <th
                      key={heading}
                      style={{
                        textAlign: "left",
                        padding: "14px 16px",
                        borderBottom:
                          "1px solid #e0e0e0",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {filteredRepayments.map(
                  (payment) => (
                    <tr key={payment.id}>
                      <td
                        style={{
                          padding: "14px 16px",
                          borderBottom:
                            "1px solid #eee",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {formatDate(
                          payment.transaction_date
                        )}
                      </td>

                      <td
                        style={{
                          padding: "14px 16px",
                          borderBottom:
                            "1px solid #eee",
                          fontWeight: 600,
                        }}
                      >
                        {payment.loan_number}
                      </td>

                      <td
                        style={{
                          padding: "14px 16px",
                          borderBottom:
                            "1px solid #eee",
                        }}
                      >
                        {payment.description ||
                          "Loan repayment"}
                      </td>

                      <td
                        style={{
                          padding: "14px 16px",
                          borderBottom:
                            "1px solid #eee",
                          fontWeight: 700,
                        }}
                      >
                        {formatCurrency(
                          payment.credit
                        )}
                      </td>

                      <td
                        style={{
                          padding: "14px 16px",
                          borderBottom:
                            "1px solid #eee",
                        }}
                      >
                        {formatCurrency(
                          payment.balance
                        )}
                      </td>

                      <td
                        style={{
                          padding: "14px 16px",
                          borderBottom:
                            "1px solid #eee",
                        }}
                      >
                        <Chip
                          label={
                            payment.loan_status ||
                            "Unknown"
                          }
                          size="small"
                          color={statusColor(
                            payment.loan_status
                          )}
                        />
                      </td>

                      <td
                        style={{
                          padding: "14px 16px",
                          borderBottom:
                            "1px solid #eee",
                        }}
                      >
                        <Button
                          size="small"
                          startIcon={
                            <VisibilityIcon />
                          }
                          onClick={() =>
                            navigate(
                              `/loans/${payment.loan_id}`
                            )
                          }
                        >
                          View
                        </Button>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </Box>
        )}
      </Paper>

      {/* ========================================================
          RECORD PAYMENT DIALOG
      ======================================================== */}
      <RecordPayment
        open={paymentDialogOpen}
        loan={selectedLoan}
        onClose={closeRecordPayment}
        onSaved={handlePaymentSaved}
      />
    </Box>
  );
}