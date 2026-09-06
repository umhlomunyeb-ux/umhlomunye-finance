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
  Alert,
  Typography,
  CircularProgress,
  Box,
} from "@mui/material";

import { getCustomers } from "../../services/customerService";
import { addLoan } from "../../services/loanService";

import { calculateLoan } from "../../utils/loanCalculator";
import {
  getSystemSettings,
  getInterestRateForAmount,
} from "../../services/settingsService";

export default function LoanForm({ open, onClose, onSaved }) {
  const [customers, setCustomers] = useState([]);

  const [settings, setSettings] = useState(null);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState("");

  const [loan, setLoan] = useState({
    customer_id: "",
    principal_amount: "",
    interest_rate: 0,
    interest_amount: 0,
    total_repayment: 0,
    current_balance: 0,
    loan_status: "Active",
    first_payment_date: "",
    next_payment_date: "",
    next_interest_date: "",
  });

  useEffect(() => {
    if (open) {
      initializeForm();
    }
  }, [open]);

  async function initializeForm() {
    try {
      setLoading(true);
      setError("");

      const [customerData, systemSettings] = await Promise.all([
        getCustomers(),
        getSystemSettings(),
      ]);

      setCustomers(customerData || []);
      setSettings(systemSettings);

      resetLoanForm();
    } catch (err) {
      console.error("LoanForm initialization error:", err);

      setError(
        err.message ||
          "Unable to load customers and loan settings."
      );
    } finally {
      setLoading(false);
    }
  }

  function resetLoanForm() {
    setLoan({
      customer_id: "",
      principal_amount: "",
      interest_rate: 0,
      interest_amount: 0,
      total_repayment: 0,
      current_balance: 0,
      loan_status: "Active",
      first_payment_date: "",
      next_payment_date: "",
      next_interest_date: "",
    });
  }

  function handleChange(e) {
    const { name, value } = e.target;

    if (name === "principal_amount") {
      const amount = Number(value);

      if (!settings || !value || amount <= 0) {
        setLoan((prev) => ({
          ...prev,
          principal_amount: value,
          interest_rate: 0,
          interest_amount: 0,
          total_repayment: 0,
          current_balance: 0,
        }));

        return;
      }

      const minimum = Number(
        settings.minimum_loan_amount
      );

      const maximum = Number(
        settings.maximum_loan_amount
      );

      if (amount > maximum) {
        setError(
          `The maximum loan amount is R${maximum.toLocaleString(
            "en-ZA",
            {
              minimumFractionDigits: 2,
            }
          )}.`
        );
      } else if (amount < minimum) {
        setError(
          `The minimum loan amount is R${minimum.toLocaleString(
            "en-ZA",
            {
              minimumFractionDigits: 2,
            }
          )}.`
        );
      } else {
        setError("");
      }

      const calc = calculateLoan(
        value,
        settings
      );

      setLoan((prev) => ({
        ...prev,
        principal_amount: value,
        interest_rate: calc.interestRate,
        interest_amount: calc.interestAmount,
        total_repayment: calc.totalRepayment,
        current_balance: calc.balance,
      }));

      return;
    }

    if (name === "first_payment_date") {
      if (!value) {
        setLoan((prev) => ({
          ...prev,
          first_payment_date: "",
          next_payment_date: "",
          next_interest_date: "",
        }));

        return;
      }

      const paymentDate = new Date(
        `${value}T00:00:00`
      );

      const cycleDays = Number(
        settings?.interest_cycle_days ?? 8
      );

      const nextInterest = new Date(paymentDate);

      nextInterest.setDate(
        nextInterest.getDate() + cycleDays
      );

      const nextInterestDate =
        nextInterest
          .toISOString()
          .split("T")[0];

      setLoan((prev) => ({
        ...prev,
        first_payment_date: value,

        /*
         * The first payment date becomes the
         * payment-date anchor for the loan.
         */
        next_payment_date: value,

        next_interest_date: nextInterestDate,
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
      setError("");

      if (!loan.customer_id) {
        throw new Error("Please select a customer.");
      }

      const amount = Number(
        loan.principal_amount
      );

      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error(
          "Enter a valid loan amount."
        );
      }

      if (!settings) {
        throw new Error(
          "Loan settings could not be loaded."
        );
      }

      const minimum = Number(
        settings.minimum_loan_amount
      );

      const maximum = Number(
        settings.maximum_loan_amount
      );

      if (amount < minimum) {
        throw new Error(
          `The minimum loan amount is R${minimum.toLocaleString(
            "en-ZA",
            {
              minimumFractionDigits: 2,
            }
          )}.`
        );
      }

      if (amount > maximum) {
        throw new Error(
          `The maximum loan amount is R${maximum.toLocaleString(
            "en-ZA",
            {
              minimumFractionDigits: 2,
            }
          )}.`
        );
      }

      if (!loan.first_payment_date) {
        throw new Error(
          "Please select the first payment date."
        );
      }

      /*
       * Recalculate immediately before saving.
       *
       * This ensures the loan uses the latest
       * rules loaded from Settings.
       */
      const calc = calculateLoan(
        amount,
        settings
      );

      const applicableRate =
        getInterestRateForAmount(
          amount,
          settings
        );

      const loanToSave = {
        ...loan,

        principal_amount: amount,

        interest_rate: applicableRate,

        interest_amount:
          calc.interestAmount,

        total_repayment:
          calc.totalRepayment,

        current_balance:
          calc.balance,

        loan_status: "Active",
      };

      setSaving(true);

      console.log(
        "NEW LOAN USING SYSTEM RULES:",
        {
          amount,
          interestRate: applicableRate,
          interestAmount:
            calc.interestAmount,
          totalRepayment:
            calc.totalRepayment,
          settings,
        }
      );

      await addLoan(loanToSave);

      if (onSaved) {
        await onSaved();
      }

      resetLoanForm();

      onClose();
    } catch (err) {
      console.error(
        "Loan save error:",
        err
      );

      setError(
        err.message ||
          "Unable to save the loan."
      );
    } finally {
      setSaving(false);
    }
  }

  function handleClose() {
    if (saving) return;

    resetLoanForm();
    setError("");

    onClose();
  }

  function formatCurrency(value) {
    return Number(value || 0).toLocaleString(
      "en-ZA",
      {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }
    );
  }

  const selectedRate =
    settings && loan.principal_amount
      ? getInterestRateForAmount(
          Number(loan.principal_amount),
          settings
        )
      : 0;

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle>
        New Loan
      </DialogTitle>

      <DialogContent>
        {loading ? (
          <Box
            sx={{
              minHeight: 250,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <CircularProgress />
          </Box>
        ) : (
          <>
            {error && (
              <Alert
                severity="error"
                sx={{ mt: 1, mb: 2 }}
              >
                {error}
              </Alert>
            )}

            {settings && (
              <Alert
                severity="info"
                sx={{ mt: 1, mb: 2 }}
              >
                <strong>Current loan pricing:</strong>{" "}
                Loans up to R
                {Number(
                  settings.tier_1_max_amount
                ).toLocaleString("en-ZA")}{" "}
                use{" "}
                {settings.tier_1_interest_rate}%.
                Loans above that amount use{" "}
                {settings.tier_2_interest_rate}%.
              </Alert>
            )}

            <Grid
              container
              spacing={2}
              sx={{ mt: 1 }}
            >
              {/* CUSTOMER */}
              <Grid item xs={12}>
                <TextField
                  select
                  fullWidth
                  label="Customer"
                  name="customer_id"
                  value={loan.customer_id}
                  onChange={handleChange}
                >
                  {customers.map(
                    (customer) => (
                      <MenuItem
                        key={customer.id}
                        value={customer.id}
                      >
                        {customer.customer_number}{" "}
                        -{" "}
                        {customer.first_name}{" "}
                        {customer.last_name}
                      </MenuItem>
                    )
                  )}
                </TextField>
              </Grid>

              {/* LOAN AMOUNT */}
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  type="number"
                  label="Loan Amount"
                  name="principal_amount"
                  value={
                    loan.principal_amount
                  }
                  onChange={handleChange}
                  inputProps={{
                    min:
                      settings?.minimum_loan_amount ??
                      100,
                    max:
                      settings?.maximum_loan_amount ??
                      15000,
                    step: "0.01",
                  }}
                />
              </Grid>

              {/* INTEREST RATE */}
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Interest Rate"
                  value={`${selectedRate}%`}
                  InputProps={{
                    readOnly: true,
                  }}
                />
              </Grid>

              {/* INTEREST AMOUNT */}
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Interest Amount"
                  value={formatCurrency(
                    loan.interest_amount
                  )}
                  InputProps={{
                    readOnly: true,
                  }}
                />
              </Grid>

              {/* TOTAL REPAYMENT */}
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Total Repayment"
                  value={formatCurrency(
                    loan.total_repayment
                  )}
                  InputProps={{
                    readOnly: true,
                  }}
                />
              </Grid>

              {/* FIRST PAYMENT DATE */}
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  type="date"
                  label="First Payment Date"
                  name="first_payment_date"
                  value={
                    loan.first_payment_date
                  }
                  onChange={handleChange}
                  InputLabelProps={{
                    shrink: true,
                  }}
                />
              </Grid>

              {/* NEXT INTEREST DATE */}
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Next Interest Date"
                  value={
                    loan.next_interest_date
                  }
                  InputProps={{
                    readOnly: true,
                  }}
                  InputLabelProps={{
                    shrink: true,
                  }}
                />
              </Grid>

              {/* CURRENT BALANCE */}
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Current Balance"
                  value={formatCurrency(
                    loan.current_balance
                  )}
                  InputProps={{
                    readOnly: true,
                  }}
                />
              </Grid>

              {/* RULE PREVIEW */}
              {loan.principal_amount &&
                Number(
                  loan.principal_amount
                ) > 0 &&
                settings && (
                  <Grid item xs={12}>
                    <Alert severity="success">
                      <Typography
                        variant="body2"
                      >
                        <strong>
                          Applied Rule:
                        </strong>{" "}
                        R
                        {formatCurrency(
                          loan.principal_amount
                        )}{" "}
                        →{" "}
                        <strong>
                          {selectedRate}%
                        </strong>{" "}
                        interest
                      </Typography>

                      <Typography
                        variant="body2"
                        sx={{ mt: 0.5 }}
                      >
                        Total repayment:{" "}
                        <strong>
                          R
                          {formatCurrency(
                            loan.total_repayment
                          )}
                        </strong>
                      </Typography>
                    </Alert>
                  </Grid>
                )}
            </Grid>
          </>
        )}
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
          disabled={
            saving ||
            loading ||
            !settings
          }
        >
          {saving
            ? "Saving..."
            : "Save Loan"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
