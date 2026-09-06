import { useState } from "react";
import { addLoanApplication } from "../../services/applicationService";

import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  Grid,
  MenuItem,
  Divider,
  Alert,
} from "@mui/material";

export default function PublicApplication() {
  const [submitted, setSubmitted] = useState(false);
  const [applicationNumber, setApplicationNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    cellphone: "",
    email: "",
    physical_address: "",

    employer: "",
    employment_status: "",
    monthly_income: "",
    other_income: "",

    bank_name: "",
    account_number: "",

    amount_requested: "",
    loan_purpose: "",
    preferred_payment_date: "",
    collection_preference: "",
    notes: "",

    // ID number is intentionally unavailable for now.
    id_number: "",
  });

  function handleChange(event) {
    const { name, value } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    setError("");
    setLoading(true);

    try {
      // -------------------------------------------------------
      // VALIDATION
      // -------------------------------------------------------

      if (!form.first_name.trim()) {
        throw new Error("Please enter your first name.");
      }

      if (!form.last_name.trim()) {
        throw new Error("Please enter your last name.");
      }

      if (!form.cellphone.trim()) {
        throw new Error("Please enter your cellphone number.");
      }

      if (!form.bank_name.trim()) {
        throw new Error("Please enter your bank name.");
      }

      if (!form.account_number.trim()) {
        throw new Error("Please enter your bank account number.");
      }

      if (!form.amount_requested) {
        throw new Error(
          "Please enter the amount you want to borrow."
        );
      }

      const amount = Number(form.amount_requested);

      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error(
          "Loan amount must be greater than zero."
        );
      }

      // -------------------------------------------------------
      // SUBMIT APPLICATION
      // -------------------------------------------------------

      const data = await addLoanApplication({
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        cellphone: form.cellphone.trim(),

        email: form.email.trim() || null,

        physical_address:
          form.physical_address.trim() || null,

        employer:
          form.employer.trim() || null,

        employment_status:
          form.employment_status || null,

        monthly_income:
          form.monthly_income !== ""
            ? Number(form.monthly_income)
            : null,

        other_income:
          form.other_income !== ""
            ? Number(form.other_income)
            : null,

        bank_name: form.bank_name.trim(),

        account_number:
          form.account_number.trim(),

        amount_requested: amount,

        loan_purpose:
          form.loan_purpose.trim() || null,

        preferred_payment_date:
          form.preferred_payment_date || null,

        collection_preference:
          form.collection_preference || null,

        notes:
          form.notes.trim() || null,
      });

      // -------------------------------------------------------
      // GET APPLICATION NUMBER
      // -------------------------------------------------------

      const number =
        Array.isArray(data) && data.length > 0
          ? data[0]?.application_number
          : data?.application_number;

      setApplicationNumber(
        number || "SUBMITTED"
      );

      setSubmitted(true);
    } catch (err) {
      console.error(
        "APPLICATION SUBMISSION ERROR:",
        err
      );

      setError(
        err?.message ||
          "Unable to submit application. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  // ===========================================================
  // SUCCESS SCREEN
  // ===========================================================

  if (submitted) {
    return (
      <Box
        sx={{
          minHeight: "100vh",
          backgroundColor: "#f5f7fa",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          p: 2,
        }}
      >
        <Paper
          elevation={3}
          sx={{
            maxWidth: 600,
            width: "100%",
            p: 5,
            textAlign: "center",
          }}
        >
          <Typography
            variant="h4"
            gutterBottom
            fontWeight="bold"
          >
            Application Submitted
          </Typography>

          <Typography
            variant="h6"
            sx={{ mt: 2 }}
          >
            Application Number
          </Typography>

          <Typography
            variant="h4"
            color="primary"
            fontWeight="bold"
            sx={{ my: 2 }}
          >
            {applicationNumber}
          </Typography>

          <Typography color="text.secondary">
            Thank you for submitting your loan
            application. Your application will be
            reviewed by Umhlomunye Finance.
          </Typography>

          <Typography
            color="text.secondary"
            sx={{ mt: 2 }}
          >
            Please keep your application number
            for reference.
          </Typography>
        </Paper>
      </Box>
    );
  }

  // ===========================================================
  // APPLICATION FORM
  // ===========================================================

  return (
    <Box
      sx={{
        minHeight: "100vh",
        backgroundColor: "#f5f7fa",
        py: 4,
        px: 2,
      }}
    >
      <Box
        sx={{
          maxWidth: 900,
          mx: "auto",
        }}
      >
        <Paper
          elevation={3}
          sx={{
            p: {
              xs: 2,
              sm: 4,
            },
          }}
        >
          {/* =================================================
              HEADER
          ================================================= */}

          <Typography
            variant="h4"
            fontWeight="bold"
            gutterBottom
          >
            Umhlomunye Finance
          </Typography>

          <Typography
            color="text.secondary"
            sx={{ mb: 3 }}
          >
            Loan Application
          </Typography>

          {error && (
            <Alert
              severity="error"
              sx={{ mb: 3 }}
            >
              {error}
            </Alert>
          )}

          <form onSubmit={handleSubmit}>
            {/* =================================================
                PERSONAL INFORMATION
            ================================================= */}

            <Typography
              variant="h6"
              sx={{ mb: 2 }}
            >
              Personal Information
            </Typography>

            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  required
                  label="First Name"
                  name="first_name"
                  value={form.first_name}
                  onChange={handleChange}
                />
              </Grid>

              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  required
                  label="Last Name"
                  name="last_name"
                  value={form.last_name}
                  onChange={handleChange}
                />
              </Grid>

              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  required
                  label="Cellphone"
                  name="cellphone"
                  value={form.cellphone}
                  onChange={handleChange}
                  inputProps={{
                    inputMode: "tel",
                  }}
                />
              </Grid>

              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  type="email"
                  label="Email"
                  name="email"
                  value={form.email}
                  onChange={handleChange}
                />
              </Grid>

              <Grid item xs={12}>
                <TextField
                  fullWidth
                  multiline
                  rows={2}
                  label="Physical Address"
                  name="physical_address"
                  value={form.physical_address}
                  onChange={handleChange}
                />
              </Grid>

              {/* ID NUMBER CURRENTLY DISABLED */}

              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  disabled
                  label="ID Number"
                  value=""
                  helperText="Currently unavailable"
                />
              </Grid>
            </Grid>

            <Divider sx={{ my: 4 }} />

            {/* =================================================
                EMPLOYMENT & INCOME
            ================================================= */}

            <Typography
              variant="h6"
              sx={{ mb: 2 }}
            >
              Employment & Income
            </Typography>

            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Employer"
                  name="employer"
                  value={form.employer}
                  onChange={handleChange}
                />
              </Grid>

              <Grid item xs={12} sm={6}>
                <TextField
                  select
                  fullWidth
                  label="Employment Status"
                  name="employment_status"
                  value={form.employment_status}
                  onChange={handleChange}
                >
                  <MenuItem value="EMPLOYED">
                    Employed
                  </MenuItem>

                  <MenuItem value="SELF_EMPLOYED">
                    Self Employed
                  </MenuItem>

                  <MenuItem value="UNEMPLOYED">
                    Unemployed
                  </MenuItem>

                  <MenuItem value="OTHER">
                    Other
                  </MenuItem>
                </TextField>
              </Grid>

              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  type="number"
                  label="Monthly Income"
                  name="monthly_income"
                  value={form.monthly_income}
                  onChange={handleChange}
                  inputProps={{
                    min: 0,
                    step: "0.01",
                  }}
                  InputProps={{
                    startAdornment: "R ",
                  }}
                />
              </Grid>

              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  type="number"
                  label="Other Income"
                  name="other_income"
                  value={form.other_income}
                  onChange={handleChange}
                  inputProps={{
                    min: 0,
                    step: "0.01",
                  }}
                  InputProps={{
                    startAdornment: "R ",
                  }}
                />
              </Grid>
            </Grid>

            <Divider sx={{ my: 4 }} />

            {/* =================================================
                BANKING DETAILS
            ================================================= */}

            <Typography
              variant="h6"
              sx={{ mb: 1 }}
            >
              Banking Details
            </Typography>

            <Typography
              color="text.secondary"
              sx={{ mb: 2 }}
            >
              Please provide the bank account details
              that will be used for your loan application.
            </Typography>

            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  required
                  label="Bank Name"
                  name="bank_name"
                  value={form.bank_name}
                  onChange={handleChange}
                  placeholder="e.g. Capitec Bank"
                />
              </Grid>

              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  required
                  label="Account Number"
                  name="account_number"
                  value={form.account_number}
                  onChange={handleChange}
                  inputProps={{
                    inputMode: "numeric",
                  }}
                />
              </Grid>
            </Grid>

            <Divider sx={{ my: 4 }} />

            {/* =================================================
                LOAN INFORMATION
            ================================================= */}

            <Typography
              variant="h6"
              sx={{ mb: 2 }}
            >
              Loan Information
            </Typography>

            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  required
                  type="number"
                  label="Amount Requested"
                  name="amount_requested"
                  value={form.amount_requested}
                  onChange={handleChange}
                  inputProps={{
                    min: 1,
                    step: "0.01",
                  }}
                  InputProps={{
                    startAdornment: "R ",
                  }}
                />
              </Grid>

              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  type="date"
                  label="Preferred Payment Date"
                  name="preferred_payment_date"
                  value={form.preferred_payment_date}
                  onChange={handleChange}
                  InputLabelProps={{
                    shrink: true,
                  }}
                />
              </Grid>

              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Purpose of Loan"
                  name="loan_purpose"
                  value={form.loan_purpose}
                  onChange={handleChange}
                />
              </Grid>
            </Grid>

            <Divider sx={{ my: 4 }} />

            {/* =================================================
                COLLECTIONS
            ================================================= */}

            <Typography
              variant="h6"
              sx={{ mb: 2 }}
            >
              Collections
            </Typography>

            <TextField
              select
              fullWidth
              label="Preferred Collection Method"
              name="collection_preference"
              value={form.collection_preference}
              onChange={handleChange}
            >
              <MenuItem value="DEBIT_ORDER">
                Debit Order
              </MenuItem>

              <MenuItem value="BANK_TRANSFER">
                Bank Transfer
              </MenuItem>

              <MenuItem value="CASH">
                Cash
              </MenuItem>

              <MenuItem value="OTHER">
                Other
              </MenuItem>
            </TextField>

            <Divider sx={{ my: 4 }} />

            {/* =================================================
                ADDITIONAL INFORMATION
            ================================================= */}

            <Typography
              variant="h6"
              sx={{ mb: 2 }}
            >
              Additional Information
            </Typography>

            <TextField
              fullWidth
              multiline
              rows={4}
              label="Additional Notes"
              name="notes"
              value={form.notes}
              onChange={handleChange}
            />

            <Divider sx={{ my: 4 }} />

            {/* =================================================
                SUPPORTING DOCUMENTS
            ================================================= */}

            <Typography
              variant="h6"
              sx={{ mb: 1 }}
            >
              Supporting Documents
            </Typography>

            <Alert
              severity="info"
              sx={{ mb: 2 }}
            >
              Supporting document uploads are currently
              unavailable.
            </Alert>

            <Button
              variant="outlined"
              disabled
            >
              Upload Documents
            </Button>

            {/* =================================================
                SUBMIT
            ================================================= */}

            <Box
              sx={{
                mt: 4,
                display: "flex",
                justifyContent: "flex-end",
              }}
            >
              <Button
                type="submit"
                variant="contained"
                size="large"
                disabled={loading}
              >
                {loading
                  ? "Submitting..."
                  : "Submit Application"}
              </Button>
            </Box>
          </form>
        </Paper>
      </Box>
    </Box>
  );
}
