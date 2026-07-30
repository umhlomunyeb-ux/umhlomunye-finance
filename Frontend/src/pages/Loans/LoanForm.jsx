import { useEffect, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Grid,
  TextField,
  MenuItem,
} from "@mui/material";

import { getCustomers } from "../../services/customerService";
import { addLoan } from "../../services/loanService";
import { calculateLoan } from "../../utils/loanCalculator";

export default function LoanForm({ open, onClose, onSaved }) {
  const [customers, setCustomers] = useState([]);

  const [loan, setLoan] = useState({
    customer_id: "",
    principal_amount: "",
    interest_rate: 0,
    interest_amount: 0,
    total_repayment: 0,
    current_balance: 0,
    first_payment_date: "",
    next_payment_date: "",
    next_interest_date: "",
    purpose: "",
    notes: "",
  });

  useEffect(() => {
    if (open) {
      loadCustomers();
    }
  }, [open]);

  async function loadCustomers() {
    const data = await getCustomers();
    setCustomers(data);
  }

  function handleChange(e) {
    const { name, value } = e.target;

    if (name === "principal_amount") {
      const calc = calculateLoan(value);

      setLoan((prev) => ({
        ...prev,
        principal_amount: value,
        interest_rate: calc.interestRate,
        interest_amount: calc.interestAmount,
        total_repayment: calc.totalRepayment,
        current_balance: calc.currentBalance,
      }));

      return;
    }

    if (name === "first_payment_date") {
      const paymentDate = new Date(value);

      const nextInterest = new Date(paymentDate);
      nextInterest.setDate(nextInterest.getDate() + 8);

      setLoan((prev) => ({
        ...prev,
        first_payment_date: value,
        next_payment_date: value,
        next_interest_date: nextInterest.toISOString().split("T")[0],
      }));

      return;
    }

    setLoan((prev) => ({
      ...prev,
      [name]: value,
    }));
  }

  async function handleSave() {
    try {
      await addLoan(loan);

      if (onSaved) onSaved();

      onClose();
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <Dialog open={open} maxWidth="md" fullWidth>

      <DialogTitle>New Loan</DialogTitle>

      <DialogContent>

        <Grid container spacing={2} sx={{ mt: 1 }}>

          <Grid item xs={12}>
            <TextField
              select
              fullWidth
              label="Customer"
              name="customer_id"
              value={loan.customer_id}
              onChange={handleChange}
            >
              {customers.map((customer) => (
                <MenuItem
                  key={customer.id}
                  value={customer.id}
                >
                  {customer.customer_number} - {customer.first_name} {customer.last_name}
                </MenuItem>
              ))}
            </TextField>
          </Grid>

          <Grid item xs={6}>
            <TextField
              fullWidth
              type="number"
              label="Loan Amount"
              name="principal_amount"
              value={loan.principal_amount}
              onChange={handleChange}
            />
          </Grid>

          <Grid item xs={6}>
            <TextField
              fullWidth
              label="Interest Rate"
              value={`${loan.interest_rate}%`}
              InputProps={{ readOnly: true }}
            />
          </Grid>

          <Grid item xs={6}>
            <TextField
              fullWidth
              label="Interest Amount"
              value={loan.interest_amount}
              InputProps={{ readOnly: true }}
            />
          </Grid>

          <Grid item xs={6}>
            <TextField
              fullWidth
              label="Total Repayment"
              value={loan.total_repayment}
              InputProps={{ readOnly: true }}
            />
          </Grid>

          <Grid item xs={6}>
            <TextField
              fullWidth
              type="date"
              label="First Payment Date"
              name="first_payment_date"
              value={loan.first_payment_date}
              onChange={handleChange}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>

          <Grid item xs={6}>
            <TextField
              fullWidth
              label="Next Interest Date"
              value={loan.next_interest_date}
              InputProps={{ readOnly: true }}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>

          <Grid item xs={12}>
            <TextField
              fullWidth
              label="Purpose"
              name="purpose"
              value={loan.purpose}
              onChange={handleChange}
            />
          </Grid>

          <Grid item xs={12}>
            <TextField
              fullWidth
              multiline
              rows={3}
              label="Notes"
              name="notes"
              value={loan.notes}
              onChange={handleChange}
            />
          </Grid>

        </Grid>

      </DialogContent>

      <DialogActions>

        <Button onClick={onClose}>
          Cancel
        </Button>

        <Button
          variant="contained"
          onClick={handleSave}
        >
          Save Loan
        </Button>

      </DialogActions>

    </Dialog>
  );
}