import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Paper,
  Button,
  Stack,
  Chip,
  CircularProgress,
  Typography,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
} from "@mui/material";

import {
  getLoans,
  updateLoan,
  voidLoan,
} from "../../services/loanService";
import RecordPayment from "../../pages/Repayments/RecordPayment";

export default function LoanTable({ refreshKey, search = "" }) {
  const navigate = useNavigate();

  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);

  // Payment dialog state
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [selectedLoan, setSelectedLoan] = useState(null);

  const [editingLoan, setEditingLoan] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState("");

  const [voidingLoan, setVoidingLoan] = useState(null);
  const [voiding, setVoiding] = useState(false);
  const [voidError, setVoidError] = useState("");

  useEffect(() => {
    loadLoans();
  }, [refreshKey]);

  async function loadLoans() {
    try {
      setLoading(true);

      const data = await getLoans();

      setLoans(data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function handlePaymentClick(loan) {
    setSelectedLoan(loan);
    setPaymentOpen(true);
  }

  function handlePaymentClose() {
    setPaymentOpen(false);
    setSelectedLoan(null);
  }

  async function handlePaymentSaved() {
    await loadLoans();
  }

  function handleEditClick(loan) {
    setEditingLoan(loan);
    setEditForm({
      principal_amount: loan.principal_amount ?? "",
      interest_rate: loan.interest_rate ?? "",
      interest_amount: loan.interest_amount ?? "",
      total_repayment: loan.total_repayment ?? "",
      monthly_repayment: loan.monthly_repayment ?? "",
      term_months: loan.term_months ?? "",
      first_payment_date: loan.first_payment_date
        ? String(loan.first_payment_date).slice(0, 10)
        : "",
      next_payment_date: loan.next_payment_date
        ? String(loan.next_payment_date).slice(0, 10)
        : "",
      notes: loan.notes ?? "",
    });
    setEditError("");
  }

  function handleEditClose() {
    if (savingEdit) return;
    setEditingLoan(null);
    setEditForm({});
    setEditError("");
  }

  async function handleEditSave() {
    if (!editingLoan || savingEdit) return;

    try {
      setSavingEdit(true);
      setEditError("");

      const numericFields = [
        "principal_amount",
        "interest_rate",
        "interest_amount",
        "total_repayment",
        "monthly_repayment",
        "term_months",
      ];

      const payload = { ...editForm };

      for (const field of numericFields) {
        if (payload[field] === "" || payload[field] === null) {
          payload[field] = null;
          continue;
        }

        const value = Number(payload[field]);

        if (!Number.isFinite(value)) {
          throw new Error(
            field.replaceAll("_", " ") +
              " must be a valid number."
          );
        }

        payload[field] = value;
      }

      payload.first_payment_date =
        payload.first_payment_date || null;

      payload.next_payment_date =
        payload.next_payment_date || null;

      await updateLoan(
        editingLoan.id,
        payload
      );

      await loadLoans();
      handleEditClose();
    } catch (err) {
      console.error(
        "EDIT LOAN ERROR:",
        err
      );

      setEditError(
        err?.message ||
          "Unable to update the loan."
      );
    } finally {
      setSavingEdit(false);
    }
  }

  function handleVoidClick(loan) {
    setVoidingLoan(loan);
    setVoidError("");
  }

  async function handleVoidConfirm() {
    if (!voidingLoan || voiding) return;

    try {
      setVoiding(true);
      setVoidError("");

      await voidLoan(
        voidingLoan.id
      );

      await loadLoans();
      setVoidingLoan(null);
    } catch (err) {
      console.error(
        "VOID LOAN ERROR:",
        err
      );

      setVoidError(
        err?.message ||
          "Unable to void the loan."
      );
    } finally {
      setVoiding(false);
    }
  }


  /*
   * Search by:
   * - Loan number
   * - Customer number
   * - Customer first name
   * - Customer last name
   * - Full customer name
   */
  const searchTerm = search.trim().toLowerCase();

  const filteredLoans = loans.filter((loan) => {
    if (!searchTerm) {
      return true;
    }

    const loanNumber = String(loan.loan_number || "").toLowerCase();

    const customerNumber = String(
      loan.customers?.customer_number || ""
    ).toLowerCase();

    const firstName = String(
      loan.customers?.first_name || ""
    ).toLowerCase();

    const lastName = String(
      loan.customers?.last_name || ""
    ).toLowerCase();

    const fullName = `${firstName} ${lastName}`.trim();

    return (
      loanNumber.includes(searchTerm) ||
      customerNumber.includes(searchTerm) ||
      firstName.includes(searchTerm) ||
      lastName.includes(searchTerm) ||
      fullName.includes(searchTerm)
    );
  });

  if (loading) {
    return <CircularProgress />;
  }

  return (
    <>
      <Paper sx={{ p: 2 }}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Loan No</TableCell>
              <TableCell>Customer</TableCell>
              <TableCell align="right">Principal</TableCell>
              <TableCell align="right">Interest %</TableCell>
              <TableCell align="right">Balance</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>First Payment</TableCell>
              <TableCell align="center">Actions</TableCell>
            </TableRow>
          </TableHead>

          <TableBody>
            {filteredLoans.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} align="center">
                  <Typography sx={{ py: 3 }}>
                    {searchTerm
                      ? "No loans found matching your search."
                      : "No loans found."}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              filteredLoans.map((loan) => (
                <TableRow key={loan.id}>
                  <TableCell>
                    {loan.loan_number}
                  </TableCell>

                  <TableCell>
                    {loan.customers?.customer_number}
                    <br />
                    {loan.customers?.first_name}{" "}
                    {loan.customers?.last_name}
                  </TableCell>

                  <TableCell align="right">
                    R{Number(loan.principal_amount).toFixed(2)}
                  </TableCell>

                  <TableCell align="right">
                    {loan.interest_rate}%
                  </TableCell>

                  <TableCell align="right">
                    R{Number(loan.current_balance).toFixed(2)}
                  </TableCell>

                  <TableCell>
                    <Chip
                      label={loan.loan_status}
                      color={
                        loan.loan_status === "Active"
                          ? "success"
                          : "default"
                      }
                      size="small"
                    />
                  </TableCell>

                  <TableCell>
                    {loan.first_payment_date}
                  </TableCell>

                  <TableCell>
                    <Stack
                      direction="row"
                      spacing={1}
                    >
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() =>
                          navigate(`/loans/${loan.id}`)
                        }
                      >
                        View
                      </Button>

                      <Button
                        size="small"
                        variant="contained"
                        onClick={() =>
                          handlePaymentClick(loan)
                        }
                      >
                        Payment
                      </Button>

                      <Button
                        size="small"
                        color="warning"
                        variant="outlined"
                        onClick={() =>
                          handleEditClick(loan)
                        }
                      >
                        Edit
                      </Button>

                      <Button
                        size="small"
                        color="error"
                        variant="outlined"
                        onClick={() =>
                          handleVoidClick(loan)
                        }
                      >
                        Void
                      </Button>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Paper>

      <RecordPayment
        open={paymentOpen}
        loan={selectedLoan}
        onClose={handlePaymentClose}
        onSaved={handlePaymentSaved}
      />

      <Dialog
        open={Boolean(editingLoan)}
        onClose={handleEditClose}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>
          Edit Loan {editingLoan?.loan_number || ""}
        </DialogTitle>

        <DialogContent dividers>
          {editError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {editError}
            </Alert>
          )}

          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mb: 2 }}
          >
            Current balance and total paid remain controlled by the loan ledger.
          </Typography>

          <Stack spacing={2}>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={2}
            >
              <TextField
                fullWidth
                label="Principal Amount"
                type="number"
                value={editForm.principal_amount ?? ""}
                onChange={(event) =>
                  setEditForm((current) => ({
                    ...current,
                    principal_amount:
                      event.target.value,
                  }))
                }
              />

              <TextField
                fullWidth
                label="Interest Rate %"
                type="number"
                value={editForm.interest_rate ?? ""}
                onChange={(event) =>
                  setEditForm((current) => ({
                    ...current,
                    interest_rate:
                      event.target.value,
                  }))
                }
              />
            </Stack>

            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={2}
            >
              <TextField
                fullWidth
                label="Interest Amount"
                type="number"
                value={editForm.interest_amount ?? ""}
                onChange={(event) =>
                  setEditForm((current) => ({
                    ...current,
                    interest_amount:
                      event.target.value,
                  }))
                }
              />

              <TextField
                fullWidth
                label="Total Repayment"
                type="number"
                value={editForm.total_repayment ?? ""}
                onChange={(event) =>
                  setEditForm((current) => ({
                    ...current,
                    total_repayment:
                      event.target.value,
                  }))
                }
              />
            </Stack>

            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={2}
            >
              <TextField
                fullWidth
                label="Monthly Repayment"
                type="number"
                value={editForm.monthly_repayment ?? ""}
                onChange={(event) =>
                  setEditForm((current) => ({
                    ...current,
                    monthly_repayment:
                      event.target.value,
                  }))
                }
              />

              <TextField
                fullWidth
                label="Term (Months)"
                type="number"
                value={editForm.term_months ?? ""}
                onChange={(event) =>
                  setEditForm((current) => ({
                    ...current,
                    term_months:
                      event.target.value,
                  }))
                }
              />
            </Stack>

            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={2}
            >
              <TextField
                fullWidth
                label="First Payment Date"
                type="date"
                value={editForm.first_payment_date ?? ""}
                onChange={(event) =>
                  setEditForm((current) => ({
                    ...current,
                    first_payment_date:
                      event.target.value,
                  }))
                }
                slotProps={{
                  inputLabel: {
                    shrink: true,
                  },
                }}
              />

              <TextField
                fullWidth
                label="Next Payment Date"
                type="date"
                value={editForm.next_payment_date ?? ""}
                onChange={(event) =>
                  setEditForm((current) => ({
                    ...current,
                    next_payment_date:
                      event.target.value,
                  }))
                }
                slotProps={{
                  inputLabel: {
                    shrink: true,
                  },
                }}
              />
            </Stack>

            <TextField
              fullWidth
              label="Notes"
              multiline
              minRows={3}
              value={editForm.notes ?? ""}
              onChange={(event) =>
                setEditForm((current) => ({
                  ...current,
                  notes: event.target.value,
                }))
              }
            />
          </Stack>
        </DialogContent>

        <DialogActions>
          <Button
            onClick={handleEditClose}
            disabled={savingEdit}
          >
            Cancel
          </Button>

          <Button
            variant="contained"
            onClick={handleEditSave}
            disabled={savingEdit}
          >
            {savingEdit
              ? "Saving..."
              : "Save Changes"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(voidingLoan)}
        onClose={() => {
          if (!voiding) {
            setVoidingLoan(null);
            setVoidError("");
          }
        }}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>
          Void Loan
        </DialogTitle>

        <DialogContent>
          {voidError && (
            <Alert
              severity="error"
              sx={{ mb: 2 }}
            >
              {voidError}
            </Alert>
          )}

          <Typography>
            Are you sure you want to void loan{" "}
            <strong>
              {voidingLoan?.loan_number || ""}
            </strong>
            ?
          </Typography>

          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: 1 }}
          >
            The loan will be marked as Void and retained as a deleted record.
          </Typography>
        </DialogContent>

        <DialogActions>
          <Button
            onClick={() => {
              if (!voiding) {
                setVoidingLoan(null);
                setVoidError("");
              }
            }}
            disabled={voiding}
          >
            Cancel
          </Button>

          <Button
            color="error"
            variant="contained"
            onClick={handleVoidConfirm}
            disabled={voiding}
          >
            {voiding
              ? "Voiding..."
              : "Void Loan"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}