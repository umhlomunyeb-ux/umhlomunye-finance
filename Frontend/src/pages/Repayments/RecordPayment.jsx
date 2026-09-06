import { useEffect, useState } from "react";

import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Alert,
  Typography,
} from "@mui/material";

import { addRepayment } from "../../services/loanService";

export default function RecordPayment({
  open,
  loan,
  onClose,
  onSaved,
}) {
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  /*
   * Set the payment date whenever the dialog opens.
   * This is the actual date of the repayment,
   * NOT the scheduled loan payment date.
   */
  useEffect(() => {
    if (open) {
      setPaymentDate("");
      setError("");
    }
  }, [open]);

  function resetForm() {
    setAmount("");
    setPaymentDate("");
    setNotes("");
    setError("");
  }

  function handleClose() {
    if (saving) return;

    resetForm();
    onClose();
  }

  async function handleSave() {
    try {
      setError("");

      if (!loan?.id) {
        throw new Error("Loan information is missing.");
      }

      if (!amount || Number(amount) <= 0) {
        throw new Error(
          "Enter a payment amount greater than zero."
        );
      }

      if (!paymentDate) {
        throw new Error("Select the payment date.");
      }

      setSaving(true);

      /*
       * IMPORTANT:
       * Pass the exact date selected by the user.
       */
      console.log("PAYMENT TEST:", {
        amount: Number(amount),
        paymentDate,
        loanId: loan.id,
      });

      await addRepayment({
        loanId: loan.id,
        amount: Number(amount),
        paymentDate,
        notes,
      });

      resetForm();

      if (onSaved) {
        await onSaved();
      }

      onClose();
    } catch (err) {
      console.error(err);

      setError(
        err.message ||
          "Unable to record the repayment."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>
        Capture Loan Repayment
      </DialogTitle>

      <DialogContent>

        {error && (
          <Alert
            severity="error"
            sx={{ mb: 2 }}
          >
            {error}
          </Alert>
        )}

        <Typography sx={{ mb: 2 }}>
          <strong>Loan:</strong>{" "}
          {loan?.loan_number || "-"}
        </Typography>

        <Typography sx={{ mb: 2 }}>
          <strong>Current Balance:</strong>{" "}
          R
          {Number(
            loan?.current_balance || 0
          ).toLocaleString("en-ZA", {
            minimumFractionDigits: 2,
          })}
        </Typography>

        <TextField
          fullWidth
          type="number"
          label="Payment Amount"
          value={amount}
          onChange={(e) =>
            setAmount(e.target.value)
          }
          sx={{ mb: 2 }}
          inputProps={{
            min: 0,
            step: "0.01",
          }}
        />

        <TextField
          fullWidth
          type="date"
          label="Payment Date"
          value={paymentDate}
          onChange={(e) =>
            setPaymentDate(e.target.value)
          }
          InputLabelProps={{
            shrink: true,
          }}
          sx={{ mb: 2 }}
        />

        <TextField
          fullWidth
          multiline
          rows={3}
          label="Notes"
          value={notes}
          onChange={(e) =>
            setNotes(e.target.value)
          }
        />

      </DialogContent>

      <DialogActions>

        <Button
          onClick={handleClose}
          disabled={saving}
        >
          Cancel
        </Button>

        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving}
        >
          {saving
            ? "Saving..."
            : "Record Payment"}
        </Button>

      </DialogActions>
    </Dialog>
  );
}
