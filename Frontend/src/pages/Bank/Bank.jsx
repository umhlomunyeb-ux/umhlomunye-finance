import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";

import {
  addBankMoney,
  createCompanyBorrowing,
  createInitialBankBalance,
  getBankSummary,
  getCompanyBorrowings,
  repayCompanyDebt,
  subscribeToBankTransactions,
  removeBankSubscription,
} from "../../services/bankService";

import { isCurrentUserAdmin } from "../../services/userService";

function formatCurrency(value) {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
  }).format(Number(value || 0));
}

function today() {
  return new Date().toISOString().split("T")[0];
}

function formatDate(value) {
  if (!value) return "-";

  return new Date(`${value}T00:00:00`).toLocaleDateString("en-ZA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getTransactionTypeLabel(type) {
  const labels = {
    INITIAL_BALANCE: "Initial Balance",
    DEPOSIT: "Money Added",
    BORROWING: "Company Borrowing",
    DEBT_REPAYMENT: "Debt Repayment",
    OTHER_INCOME: "Other Income",
    OTHER_EXPENSE: "Other Expense",
    VOID: "Voided",
  };

  return labels[type] || type || "-";
}

export default function Bank() {
  const [summary, setSummary] = useState(null);
  const [borrowings, setBorrowings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [isAdmin, setIsAdmin] = useState(false);
  const [tab, setTab] = useState(0);

  const [initialDialog, setInitialDialog] = useState(false);
  const [moneyDialog, setMoneyDialog] = useState(false);
  const [borrowingDialog, setBorrowingDialog] = useState(false);
  const [repaymentDialog, setRepaymentDialog] = useState(false);

  const [selectedBorrowing, setSelectedBorrowing] = useState(null);

  const [initialForm, setInitialForm] = useState({
    accountName: "Company Bank Account",
    bankName: "",
    amount: "",
    transactionDate: today(),
    description: "Initial company bank balance",
  });

  const [moneyForm, setMoneyForm] = useState({
    amount: "",
    transactionDate: today(),
    description: "",
    reference: "",
  });

  const [borrowingForm, setBorrowingForm] = useState({
    lenderName: "",
    amount: "",
    borrowingDate: today(),
    description: "",
    reference: "",
  });

  const [repaymentForm, setRepaymentForm] = useState({
    amount: "",
    repaymentDate: today(),
    description: "",
    reference: "",
  });

  async function loadBankData() {
    try {
      setError("");

      const [bankSummary, companyBorrowings, admin] = await Promise.all([
        getBankSummary(),
        getCompanyBorrowings(),
        isCurrentUserAdmin(),
      ]);

      setSummary(bankSummary);
      setBorrowings(companyBorrowings);
      setIsAdmin(Boolean(admin));
    } catch (err) {
      console.error("Bank module error:", err);
      setError(err.message || "Unable to load bank information.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBankData();

    const channel = subscribeToBankTransactions(() => {
      loadBankData();
    });

    return () => {
      removeBankSubscription(channel);
    };
  }, []);

  function closeDialogs() {
    setInitialDialog(false);
    setMoneyDialog(false);
    setBorrowingDialog(false);
    setRepaymentDialog(false);
    setSelectedBorrowing(null);
  }

  function showSuccess(message) {
    setSuccess(message);
    setError("");

    setTimeout(() => {
      setSuccess("");
    }, 4000);
  }

  async function handleInitialBalance(event) {
    event.preventDefault();

    if (Number(initialForm.amount) <= 0) {
      setError("The initial bank balance must be greater than zero.");
      return;
    }

    try {
      setSaving(true);
      setError("");

      await createInitialBankBalance({
        accountName: initialForm.accountName,
        bankName: initialForm.bankName,
        amount: initialForm.amount,
        transactionDate: initialForm.transactionDate,
        description: initialForm.description,
      });

      closeDialogs();

      setInitialForm({
        accountName: "Company Bank Account",
        bankName: "",
        amount: "",
        transactionDate: today(),
        description: "Initial company bank balance",
      });

      showSuccess("Initial company bank balance recorded successfully.");
      await loadBankData();
    } catch (err) {
      console.error(err);
      setError(err.message || "Unable to record initial balance.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddMoney(event) {
    event.preventDefault();

    if (Number(moneyForm.amount) <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }

    if (!moneyForm.description.trim()) {
      setError("Please enter a description.");
      return;
    }

    try {
      setSaving(true);
      setError("");

      await addBankMoney({
        amount: moneyForm.amount,
        transactionDate: moneyForm.transactionDate,
        description: moneyForm.description,
        reference: moneyForm.reference,
      });

      closeDialogs();

      setMoneyForm({
        amount: "",
        transactionDate: today(),
        description: "",
        reference: "",
      });

      showSuccess("Money added to the company bank account.");
      await loadBankData();
    } catch (err) {
      console.error(err);
      setError(err.message || "Unable to add money.");
    } finally {
      setSaving(false);
    }
  }

  async function handleBorrowing(event) {
    event.preventDefault();

    if (!borrowingForm.lenderName.trim()) {
      setError("Please enter the lender name.");
      return;
    }

    if (Number(borrowingForm.amount) <= 0) {
      setError("Enter a borrowing amount greater than zero.");
      return;
    }

    try {
      setSaving(true);
      setError("");

      await createCompanyBorrowing({
        lenderName: borrowingForm.lenderName,
        amount: borrowingForm.amount,
        borrowingDate: borrowingForm.borrowingDate,
        description: borrowingForm.description,
        reference: borrowingForm.reference,
      });

      closeDialogs();

      setBorrowingForm({
        lenderName: "",
        amount: "",
        borrowingDate: today(),
        description: "",
        reference: "",
      });

      showSuccess("Company borrowing recorded successfully.");
      await loadBankData();
    } catch (err) {
      console.error(err);
      setError(err.message || "Unable to record borrowing.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDebtRepayment(event) {
    event.preventDefault();

    if (!selectedBorrowing) {
      setError("Please select a borrowing.");
      return;
    }

    if (Number(repaymentForm.amount) <= 0) {
      setError("Enter a repayment amount greater than zero.");
      return;
    }

    if (
      Number(repaymentForm.amount) >
      Number(selectedBorrowing.outstanding_amount)
    ) {
      setError("Repayment cannot be greater than the outstanding debt.");
      return;
    }

    try {
      setSaving(true);
      setError("");

      await repayCompanyDebt({
        borrowingId: selectedBorrowing.id,
        amount: repaymentForm.amount,
        repaymentDate: repaymentForm.repaymentDate,
        description: repaymentForm.description,
        reference: repaymentForm.reference,
      });

      closeDialogs();

      setRepaymentForm({
        amount: "",
        repaymentDate: today(),
        description: "",
        reference: "",
      });

      showSuccess("Company debt repayment recorded successfully.");
      await loadBankData();
    } catch (err) {
      console.error(err);
      setError(err.message || "Unable to record debt repayment.");
    } finally {
      setSaving(false);
    }
  }

  const outstandingBorrowings = useMemo(() => {
    return borrowings.filter(
      (borrowing) =>
        borrowing.status !== "Paid" && borrowing.status !== "Voided"
    );
  }, [borrowings]);

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
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Stack
        direction={{ xs: "column", md: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "flex-start", md: "center" }}
        spacing={2}
        mb={3}
      >
        <Box>
          <Typography variant="h4" fontWeight={700}>
            Bank
          </Typography>

          <Typography color="text.secondary">
            Track company funds, borrowings and debt repayments.
          </Typography>
        </Box>

        {isAdmin && (
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <Button
              variant="outlined"
              onClick={() => setInitialDialog(true)}
            >
              Set Initial Balance
            </Button>

            <Button
              variant="contained"
              onClick={() => setMoneyDialog(true)}
            >
              Add Money
            </Button>

            <Button
              variant="contained"
              color="secondary"
              onClick={() => setBorrowingDialog(true)}
            >
              Record Borrowing
            </Button>
          </Stack>
        )}
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {success}
        </Alert>
      )}

      <Grid container spacing={2} mb={3}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card>
            <CardContent>
              <Typography color="text.secondary" gutterBottom>
                Current Bank Balance
              </Typography>

              <Typography variant="h5" fontWeight={700}>
                {formatCurrency(summary?.currentBalance)}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card>
            <CardContent>
              <Typography color="text.secondary" gutterBottom>
                Total Money In
              </Typography>

              <Typography variant="h5" fontWeight={700} color="success.main">
                {formatCurrency(summary?.totalMoneyIn)}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card>
            <CardContent>
              <Typography color="text.secondary" gutterBottom>
                Total Money Out
              </Typography>

              <Typography variant="h5" fontWeight={700} color="error.main">
                {formatCurrency(summary?.totalMoneyOut)}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card>
            <CardContent>
              <Typography color="text.secondary" gutterBottom>
                Outstanding Company Debt
              </Typography>

              <Typography variant="h5" fontWeight={700}>
                {formatCurrency(summary?.outstandingDebt)}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Paper sx={{ mb: 3 }}>
        <Tabs
          value={tab}
          onChange={(_, newValue) => setTab(newValue)}
          variant="scrollable"
          scrollButtons="auto"
        >
          <Tab label="Transactions" />
          <Tab label="Company Borrowings" />
        </Tabs>
      </Paper>

      {tab === 0 && (
        <Card>
          <CardContent>
            <Typography variant="h6" fontWeight={700} mb={2}>
              Bank Transactions
            </Typography>

            {!summary?.transactions?.length ? (
              <Alert severity="info">
                No bank transactions have been recorded yet.
              </Alert>
            ) : (
              <Box sx={{ overflowX: "auto" }}>
                <Box
                  component="table"
                  sx={{
                    width: "100%",
                    borderCollapse: "collapse",
                    minWidth: 850,
                  }}
                >
                  <thead>
                    <tr>
                      {[
                        "Date",
                        "Type",
                        "Description",
                        "Reference",
                        "Money In",
                        "Money Out",
                        "Balance After",
                      ].map((heading) => (
                        <th
                          key={heading}
                          style={{
                            textAlign: "left",
                            padding: "12px",
                            borderBottom: "1px solid #ddd",
                          }}
                        >
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>

                  <tbody>
                    {summary.transactions.map((transaction) => (
                      <tr key={transaction.id}>
                        <td style={{ padding: "12px" }}>
                          {formatDate(transaction.transaction_date)}
                        </td>

                        <td style={{ padding: "12px" }}>
                          <Chip
                            size="small"
                            label={getTransactionTypeLabel(
                              transaction.transaction_type
                            )}
                            color={
                              transaction.direction === "IN"
                                ? "success"
                                : "error"
                            }
                            variant="outlined"
                          />
                        </td>

                        <td style={{ padding: "12px" }}>
                          {transaction.description || "-"}
                        </td>

                        <td style={{ padding: "12px" }}>
                          {transaction.reference || "-"}
                        </td>

                        <td
                          style={{
                            padding: "12px",
                            color:
                              transaction.direction === "IN"
                                ? "green"
                                : undefined,
                          }}
                        >
                          {transaction.direction === "IN"
                            ? formatCurrency(transaction.amount)
                            : "-"}
                        </td>

                        <td
                          style={{
                            padding: "12px",
                            color:
                              transaction.direction === "OUT"
                                ? "red"
                                : undefined,
                          }}
                        >
                          {transaction.direction === "OUT"
                            ? formatCurrency(transaction.amount)
                            : "-"}
                        </td>

                        <td style={{ padding: "12px", fontWeight: 600 }}>
                          {formatCurrency(transaction.balance_after)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Box>
              </Box>
            )}
          </CardContent>
        </Card>
      )}

      {tab === 1 && (
        <Card>
          <CardContent>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              mb={2}
            >
              <Typography variant="h6" fontWeight={700}>
                Company Borrowings
              </Typography>

              <Chip
                label={`${outstandingBorrowings.length} outstanding`}
                color="warning"
                variant="outlined"
              />
            </Stack>

            {!borrowings.length ? (
              <Alert severity="info">
                No company borrowings have been recorded.
              </Alert>
            ) : (
              <Box sx={{ overflowX: "auto" }}>
                <Box
                  component="table"
                  sx={{
                    width: "100%",
                    borderCollapse: "collapse",
                    minWidth: 850,
                  }}
                >
                  <thead>
                    <tr>
                      {[
                        "Date",
                        "Lender",
                        "Original Amount",
                        "Amount Repaid",
                        "Outstanding",
                        "Status",
                        "Action",
                      ].map((heading) => (
                        <th
                          key={heading}
                          style={{
                            textAlign: "left",
                            padding: "12px",
                            borderBottom: "1px solid #ddd",
                          }}
                        >
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>

                  <tbody>
                    {borrowings.map((borrowing) => (
                      <tr key={borrowing.id}>
                        <td style={{ padding: "12px" }}>
                          {formatDate(borrowing.borrowing_date)}
                        </td>

                        <td style={{ padding: "12px" }}>
                          {borrowing.lender_name}
                        </td>

                        <td style={{ padding: "12px" }}>
                          {formatCurrency(borrowing.original_amount)}
                        </td>

                        <td style={{ padding: "12px" }}>
                          {formatCurrency(borrowing.amount_repaid)}
                        </td>

                        <td style={{ padding: "12px", fontWeight: 600 }}>
                          {formatCurrency(borrowing.outstanding_amount)}
                        </td>

                        <td style={{ padding: "12px" }}>
                          <Chip
                            size="small"
                            label={borrowing.status}
                            color={
                              borrowing.status === "Paid"
                                ? "success"
                                : borrowing.status === "Partially Paid"
                                  ? "warning"
                                  : "error"
                            }
                          />
                        </td>

                        <td style={{ padding: "12px" }}>
                          {isAdmin &&
                            borrowing.status !== "Paid" &&
                            borrowing.status !== "Voided" && (
                              <Button
                                size="small"
                                variant="outlined"
                                onClick={() => {
                                  setSelectedBorrowing(borrowing);
                                  setRepaymentDialog(true);
                                }}
                              >
                                Repay Debt
                              </Button>
                            )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Box>
              </Box>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog
        open={initialDialog}
        onClose={closeDialogs}
        fullWidth
        maxWidth="sm"
      >
        <Box component="form" onSubmit={handleInitialBalance}>
          <DialogTitle>Set Initial Company Bank Balance</DialogTitle>

          <DialogContent>
            <Alert severity="info" sx={{ mb: 2 }}>
              This can only be recorded once. Enter the amount the company
              currently has in its bank account.
            </Alert>

            <Stack spacing={2} mt={1}>
              <TextField
                label="Account Name"
                value={initialForm.accountName}
                onChange={(event) =>
                  setInitialForm({
                    ...initialForm,
                    accountName: event.target.value,
                  })
                }
                fullWidth
                required
              />

              <TextField
                label="Bank Name"
                value={initialForm.bankName}
                onChange={(event) =>
                  setInitialForm({
                    ...initialForm,
                    bankName: event.target.value,
                  })
                }
                fullWidth
              />

              <TextField
                label="Initial Amount"
                type="number"
                value={initialForm.amount}
                onChange={(event) =>
                  setInitialForm({
                    ...initialForm,
                    amount: event.target.value,
                  })
                }
                inputProps={{ min: 0.01, step: "0.01" }}
                fullWidth
                required
              />

              <TextField
                label="Transaction Date"
                type="date"
                value={initialForm.transactionDate}
                onChange={(event) =>
                  setInitialForm({
                    ...initialForm,
                    transactionDate: event.target.value,
                  })
                }
                InputLabelProps={{ shrink: true }}
                fullWidth
                required
              />

              <TextField
                label="Description"
                value={initialForm.description}
                onChange={(event) =>
                  setInitialForm({
                    ...initialForm,
                    description: event.target.value,
                  })
                }
                fullWidth
                required
              />
            </Stack>
          </DialogContent>

          <DialogActions>
            <Button onClick={closeDialogs}>Cancel</Button>

            <Button type="submit" variant="contained" disabled={saving}>
              {saving ? "Saving..." : "Save Initial Balance"}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      <Dialog
        open={moneyDialog}
        onClose={closeDialogs}
        fullWidth
        maxWidth="sm"
      >
        <Box component="form" onSubmit={handleAddMoney}>
          <DialogTitle>Add Money to Company Bank Account</DialogTitle>

          <DialogContent>
            <Stack spacing={2} mt={1}>
              <TextField
                label="Amount"
                type="number"
                value={moneyForm.amount}
                onChange={(event) =>
                  setMoneyForm({
                    ...moneyForm,
                    amount: event.target.value,
                  })
                }
                inputProps={{ min: 0.01, step: "0.01" }}
                fullWidth
                required
              />

              <TextField
                label="Transaction Date"
                type="date"
                value={moneyForm.transactionDate}
                onChange={(event) =>
                  setMoneyForm({
                    ...moneyForm,
                    transactionDate: event.target.value,
                  })
                }
                InputLabelProps={{ shrink: true }}
                fullWidth
                required
              />

              <TextField
                label="Description"
                value={moneyForm.description}
                onChange={(event) =>
                  setMoneyForm({
                    ...moneyForm,
                    description: event.target.value,
                  })
                }
                placeholder="Example: Owner contribution"
                fullWidth
                required
              />

              <TextField
                label="Reference"
                value={moneyForm.reference}
                onChange={(event) =>
                  setMoneyForm({
                    ...moneyForm,
                    reference: event.target.value,
                  })
                }
                fullWidth
              />
            </Stack>
          </DialogContent>

          <DialogActions>
            <Button onClick={closeDialogs}>Cancel</Button>

            <Button type="submit" variant="contained" disabled={saving}>
              {saving ? "Saving..." : "Add Money"}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      <Dialog
        open={borrowingDialog}
        onClose={closeDialogs}
        fullWidth
        maxWidth="sm"
      >
        <Box component="form" onSubmit={handleBorrowing}>
          <DialogTitle>Record Company Borrowing</DialogTitle>

          <DialogContent>
            <Stack spacing={2} mt={1}>
              <TextField
                label="Lender Name"
                value={borrowingForm.lenderName}
                onChange={(event) =>
                  setBorrowingForm({
                    ...borrowingForm,
                    lenderName: event.target.value,
                  })
                }
                placeholder="Example: Director Loan"
                fullWidth
                required
              />

              <TextField
                label="Borrowing Amount"
                type="number"
                value={borrowingForm.amount}
                onChange={(event) =>
                  setBorrowingForm({
                    ...borrowingForm,
                    amount: event.target.value,
                  })
                }
                inputProps={{ min: 0.01, step: "0.01" }}
                fullWidth
                required
              />

              <TextField
                label="Borrowing Date"
                type="date"
                value={borrowingForm.borrowingDate}
                onChange={(event) =>
                  setBorrowingForm({
                    ...borrowingForm,
                    borrowingDate: event.target.value,
                  })
                }
                InputLabelProps={{ shrink: true }}
                fullWidth
                required
              />

              <TextField
                label="Description"
                value={borrowingForm.description}
                onChange={(event) =>
                  setBorrowingForm({
                    ...borrowingForm,
                    description: event.target.value,
                  })
                }
                fullWidth
              />

              <TextField
                label="Reference"
                value={borrowingForm.reference}
                onChange={(event) =>
                  setBorrowingForm({
                    ...borrowingForm,
                    reference: event.target.value,
                  })
                }
                fullWidth
              />
            </Stack>
          </DialogContent>

          <DialogActions>
            <Button onClick={closeDialogs}>Cancel</Button>

            <Button
              type="submit"
              variant="contained"
              color="secondary"
              disabled={saving}
            >
              {saving ? "Saving..." : "Record Borrowing"}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      <Dialog
        open={repaymentDialog}
        onClose={closeDialogs}
        fullWidth
        maxWidth="sm"
      >
        <Box component="form" onSubmit={handleDebtRepayment}>
          <DialogTitle>Repay Company Debt</DialogTitle>

          <DialogContent>
            {selectedBorrowing && (
              <Alert severity="info" sx={{ mb: 2 }}>
                <strong>{selectedBorrowing.lender_name}</strong>
                <br />
                Outstanding debt:{" "}
                {formatCurrency(selectedBorrowing.outstanding_amount)}
              </Alert>
            )}

            <Stack spacing={2} mt={1}>
              <TextField
                label="Repayment Amount"
                type="number"
                value={repaymentForm.amount}
                onChange={(event) =>
                  setRepaymentForm({
                    ...repaymentForm,
                    amount: event.target.value,
                  })
                }
                inputProps={{ min: 0.01, step: "0.01" }}
                fullWidth
                required
              />

              <TextField
                label="Repayment Date"
                type="date"
                value={repaymentForm.repaymentDate}
                onChange={(event) =>
                  setRepaymentForm({
                    ...repaymentForm,
                    repaymentDate: event.target.value,
                  })
                }
                InputLabelProps={{ shrink: true }}
                fullWidth
                required
              />

              <TextField
                label="Description"
                value={repaymentForm.description}
                onChange={(event) =>
                  setRepaymentForm({
                    ...repaymentForm,
                    description: event.target.value,
                  })
                }
                placeholder="Example: Director loan repayment"
                fullWidth
                required
              />

              <TextField
                label="Reference"
                value={repaymentForm.reference}
                onChange={(event) =>
                  setRepaymentForm({
                    ...repaymentForm,
                    reference: event.target.value,
                  })
                }
                fullWidth
              />
            </Stack>
          </DialogContent>

          <DialogActions>
            <Button onClick={closeDialogs}>Cancel</Button>

            <Button type="submit" variant="contained" disabled={saving}>
              {saving ? "Saving..." : "Record Repayment"}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>
    </Box>
  );
}