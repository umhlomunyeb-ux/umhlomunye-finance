import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  Paper,
  TextField,
  Typography,
} from "@mui/material";

import { addLoan } from "../../services/loanService";
import { calculateLoan } from "../../utils/loanCalculator";
import {
  getSystemSettings,
  validateInterestCycleSettings,
} from "../../services/settingsService";

export default function LoanForm({
  open,
  customer,
  onClose,
  onSaved,
  skipDocumentCheck = false,
}) {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [loan, setLoan] = useState({
    customer_id: "",
    principal_amount: "",
    interest_rate: 0,
    interest_amount: 0,
    total_repayment: 0,
    monthly_repayment: 0,
    term_months: 0,
    current_balance: 0,
    loan_status: "Active",
    first_payment_date: "",
    next_payment_date: "",
    next_interest_date: "",
  });

  // ===========================================================
  // INITIALISE FORM
  // ===========================================================

  useEffect(() => {
    if (!open) {
      return;
    }

    initializeForm();
  }, [open]);

  // ===========================================================
  // SET VERIFIED CUSTOMER
  // ===========================================================

  useEffect(() => {
    if (!open || !customer) {
      return;
    }

    setLoan((previous) => ({
      ...previous,
      customer_id: customer.id,
    }));
  }, [open, customer]);

  // ===========================================================
  // INITIALISE SETTINGS
  // ===========================================================

  async function initializeForm() {
    try {
      setLoading(true);
      setError("");
      setSuccess("");

      const systemSettings = await getSystemSettings();

      validateInterestCycleSettings(systemSettings);

      setSettings(systemSettings);

      resetLoanForm(systemSettings);
    } catch (err) {
      console.error(
        "LOAN FORM INITIALISATION ERROR:",
        err
      );

      setError(
        err?.message ||
          "Unable to load loan settings."
      );
    } finally {
      setLoading(false);
    }
  }

  // ===========================================================
  // RESET FORM
  // ===========================================================

  function resetLoanForm(systemSettings = settings) {
    setLoan({
      customer_id: customer?.id || "",
      principal_amount: "",
      interest_rate: 0,
      interest_amount: 0,
      total_repayment: 0,
      monthly_repayment: 0,
      term_months: 0,
      current_balance: 0,
      loan_status: "Active",
      first_payment_date: "",
      next_payment_date: "",
      next_interest_date: "",
    });

    setError("");
    setSuccess("");
  }

  // ===========================================================
  // HANDLE AMOUNT
  // ===========================================================

  function handleAmountChange(event) {
    const value = event.target.value;

    setError("");
    setSuccess("");

    if (value === "") {
      setLoan((previous) => ({
        ...previous,
        principal_amount: "",
        interest_rate: 0,
        interest_amount: 0,
        total_repayment: 0,
        monthly_repayment: 0,
        term_months: 0,
        current_balance: 0,
      }));

      return;
    }

    const amount = Number(value);

    if (!Number.isFinite(amount)) {
      return;
    }

    if (!settings) {
      return;
    }

    const minimumAmount = Number(
      settings.minimum_loan_amount
    );

    const maximumAmount = Number(
      settings.maximum_loan_amount
    );

    if (
      amount < minimumAmount ||
      amount > maximumAmount
    ) {
      setLoan((previous) => ({
        ...previous,
        principal_amount: value,
        interest_rate: 0,
        interest_amount: 0,
        total_repayment: 0,
        monthly_repayment: 0,
        term_months: 0,
        current_balance: 0,
      }));

      setError(
        `Loan amount must be between ${settings.currency || "R"}${minimumAmount.toLocaleString(
          "en-ZA",
          {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }
        )} and ${settings.currency || "R"}${maximumAmount.toLocaleString(
          "en-ZA",
          {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }
        )}.`
      );

      return;
    }

    try {
      const calculation = calculateLoan(
        amount,
        settings
      );

      setLoan((previous) => ({
        ...previous,
        principal_amount: value,
        interest_rate: calculation.interestRate,
        interest_amount: calculation.interestAmount,
        total_repayment: calculation.totalRepayment,
        monthly_repayment: calculation.monthlyRepayment,
        term_months: calculation.termMonths,
        current_balance: calculation.balance,
      }));
    } catch (err) {
      console.error(
        "LOAN CALCULATION ERROR:",
        err
      );

      setError(
        err?.message ||
          "Unable to calculate the loan."
      );
    }
  }

  // ===========================================================
  // HANDLE FIRST PAYMENT DATE
  // ===========================================================

  function handleFirstPaymentDateChange(event) {
    const value = event.target.value;

    setError("");
    setSuccess("");

    setLoan((previous) => ({
      ...previous,
      first_payment_date: value,
      next_payment_date: value,
      next_interest_date: "",
    }));

    if (!value || !settings) {
      return;
    }

    try {
      validateInterestCycleSettings(settings);

      if (!settings.interest_cycle_enabled) {
        return;
      }

      const cycleDays = Number(
        settings.interest_cycle_days
      );

      const firstPaymentDate = new Date(
        `${value}T00:00:00`
      );

      if (Number.isNaN(firstPaymentDate.getTime())) {
        return;
      }

      firstPaymentDate.setDate(
        firstPaymentDate.getDate() + cycleDays
      );

      const year =
        firstPaymentDate.getFullYear();

      const month = String(
        firstPaymentDate.getMonth() + 1
      ).padStart(2, "0");

      const day = String(
        firstPaymentDate.getDate()
      ).padStart(2, "0");

      const nextInterestDate =
        `${year}-${month}-${day}`;

      setLoan((previous) => ({
        ...previous,
        first_payment_date: value,
        next_payment_date: value,
        next_interest_date: nextInterestDate,
      }));
    } catch (err) {
      console.error(
        "INTEREST DATE CALCULATION ERROR:",
        err
      );

      setError(
        err?.message ||
          "Unable to calculate the next interest date."
      );
    }
  }

  // ===========================================================
  // SAVE LOAN
  // ===========================================================

  async function handleSave() {
    try {
      setSaving(true);
      setError("");
      setSuccess("");

      if (!customer?.id) {
        throw new Error(
          "A verified customer is required before creating a loan."
        );
      }

      if (!settings) {
        throw new Error(
          "Loan settings could not be loaded."
        );
      }

      validateInterestCycleSettings(settings);

      const principalAmount = Number(
        loan.principal_amount
      );

      if (!Number.isFinite(principalAmount)) {
        throw new Error(
          "Please enter a valid loan amount."
        );
      }

      const minimumAmount = Number(
        settings.minimum_loan_amount
      );

      const maximumAmount = Number(
        settings.maximum_loan_amount
      );

      if (
        principalAmount < minimumAmount ||
        principalAmount > maximumAmount
      ) {
        throw new Error(
          `Loan amount must be between ${settings.currency || "R"}${minimumAmount.toLocaleString(
            "en-ZA",
            {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }
          )} and ${settings.currency || "R"}${maximumAmount.toLocaleString(
            "en-ZA",
            {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }
          )}.`
        );
      }

      if (!loan.first_payment_date) {
        throw new Error(
          "Please select the first payment date."
        );
      }

      const calculation = calculateLoan(
        principalAmount,
        settings
      );

      const loanData = {
        customer_id: customer.id,
        principal_amount:
          calculation.principalAmount,
        interest_rate:
          calculation.interestRate,
        interest_amount:
          calculation.interestAmount,
        total_repayment:
          calculation.totalRepayment,
        monthly_repayment:
          calculation.monthlyRepayment,
        term_months:
          calculation.termMonths,
        current_balance:
          calculation.balance,
        loan_status: "Active",
        first_payment_date:
          loan.first_payment_date,
        next_payment_date:
          loan.next_payment_date ||
          loan.first_payment_date,
        next_interest_date:
          loan.next_interest_date || null,

        // Records whether the normal customer
        // document validation was intentionally skipped.
        document_check_skipped:
          Boolean(skipDocumentCheck),
      };

      await addLoan(loanData);

      setSuccess(
        "Loan created successfully."
      );

      if (onSaved) {
        onSaved();
      }
    } catch (err) {
      console.error(
        "SAVE LOAN ERROR:",
        err
      );

      setError(
        err?.message ||
          "Unable to save the loan."
      );
    } finally {
      setSaving(false);
    }
  }

  // ===========================================================
  // CLOSE
  // ===========================================================

  function handleClose() {
    if (saving) {
      return;
    }

    setError("");
    setSuccess("");

    if (onClose) {
      onClose();
    }
  }

  // ===========================================================
  // CUSTOMER DISPLAY
  // ===========================================================

  function getCustomerName() {
    if (!customer) {
      return "-";
    }

    return [
      customer.first_name,
      customer.last_name,
    ]
      .filter(Boolean)
      .join(" ") || "-";
  }

  // ===========================================================
  // LOADING
  // ===========================================================

  if (!open) {
    return null;
  }

  if (loading) {
    return (
      <Paper
        sx={{
          position: "fixed",
          inset: 0,
          zIndex: 1400,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          p: 3,
        }}
      >
        <CircularProgress />
      </Paper>
    );
  }

  // ===========================================================
  // FORM
  // ===========================================================

  return (
    <Paper
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: 1300,
        overflow: "auto",
        p: {
          xs: 2,
          md: 4,
        },
        backgroundColor: "background.default",
      }}
    >
      <Box
        sx={{
          maxWidth: 1000,
          mx: "auto",
        }}
      >
        {/* =====================================================
            HEADER
        ====================================================== */}

        <Box sx={{ mb: 3 }}>
          <Typography
            variant="h4"
            fontWeight="bold"
            gutterBottom
          >
            New Loan
          </Typography>

          <Typography color="text.secondary">
            Create a new loan for the verified customer.
          </Typography>
        </Box>

        {/* =====================================================
            ERROR
        ====================================================== */}

        {error && (
          <Alert
            severity="error"
            sx={{ mb: 3 }}
          >
            {error}
          </Alert>
        )}

        {/* =====================================================
            SUCCESS
        ====================================================== */}

        {success && (
          <Alert
            severity="success"
            sx={{ mb: 3 }}
          >
            {success}
          </Alert>
        )}

        {/* =====================================================
            VERIFIED CUSTOMER
        ====================================================== */}

        <Paper
          variant="outlined"
          sx={{
            p: 3,
            mb: 3,
            borderColor: "success.main",
          }}
        >
          <Typography
            variant="h6"
            fontWeight="bold"
            gutterBottom
          >
            Verified Customer
          </Typography>

          {!customer ? (
            <Alert severity="error">
              No verified customer is available.
              Please close this form and verify the
              customer's ID number first.
            </Alert>
          ) : (
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: {
                  xs: "1fr",
                  sm: "repeat(2, 1fr)",
                  md: "repeat(3, 1fr)",
                },
                gap: 2,
              }}
            >
              <Box>
                <Typography
                  variant="caption"
                  color="text.secondary"
                >
                  Customer Number
                </Typography>

                <Typography fontWeight="bold">
                  {customer.customer_number || "-"}
                </Typography>
              </Box>

              <Box>
                <Typography
                  variant="caption"
                  color="text.secondary"
                >
                  Customer Name
                </Typography>

                <Typography fontWeight="bold">
                  {getCustomerName()}
                </Typography>
              </Box>

              <Box>
                <Typography
                  variant="caption"
                  color="text.secondary"
                >
                  ID Number
                </Typography>

                <Typography fontWeight="bold">
                  {customer.id_number || "-"}
                </Typography>
              </Box>

              <Box>
                <Typography
                  variant="caption"
                  color="text.secondary"
                >
                  Cellphone
                </Typography>

                <Typography fontWeight="bold">
                  {customer.cellphone || "-"}
                </Typography>
              </Box>

              <Box>
                <Typography
                  variant="caption"
                  color="text.secondary"
                >
                  Email
                </Typography>

                <Typography fontWeight="bold">
                  {customer.email || "-"}
                </Typography>
              </Box>
            </Box>
          )}
        </Paper>

        <Divider sx={{ mb: 3 }} />

        {/* =====================================================
            LOAN AMOUNT
        ====================================================== */}

        <Paper
          variant="outlined"
          sx={{
            p: 3,
            mb: 3,
          }}
        >
          <Typography
            variant="h6"
            fontWeight="bold"
            gutterBottom
          >
            Loan Details
          </Typography>

          <TextField
            fullWidth
            type="number"
            label="Loan Amount"
            value={loan.principal_amount}
            onChange={handleAmountChange}
            inputProps={{
              min: settings?.minimum_loan_amount,
              max: settings?.maximum_loan_amount,
              step: "0.01",
            }}
            helperText={
              settings
                ? `Allowed range: ${settings.currency || "R"}${Number(
                    settings.minimum_loan_amount
                  ).toLocaleString("en-ZA", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })} - ${settings.currency || "R"}${Number(
                    settings.maximum_loan_amount
                  ).toLocaleString("en-ZA", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}`
                : ""
            }
          />

          {loan.principal_amount &&
            Number(loan.principal_amount) >=
              Number(settings?.minimum_loan_amount || 0) &&
            Number(loan.principal_amount) <=
              Number(settings?.maximum_loan_amount || 0) && (
              <Box
                sx={{
                  mt: 3,
                  display: "grid",
                  gridTemplateColumns: {
                    xs: "1fr",
                    sm: "repeat(2, 1fr)",
                    md: "repeat(4, 1fr)",
                  },
                  gap: 2,
                }}
              >
                <Box>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                  >
                    Interest Rate
                  </Typography>

                  <Typography
                    variant="h6"
                    fontWeight="bold"
                  >
                    {loan.interest_rate}%
                  </Typography>
                </Box>

                <Box>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                  >
                    Interest Amount
                  </Typography>

                  <Typography
                    variant="h6"
                    fontWeight="bold"
                  >
                    {settings?.currency || "R"}{" "}
                    {Number(
                      loan.interest_amount || 0
                    ).toLocaleString("en-ZA", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </Typography>
                </Box>

                <Box>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                  >
                    Total Repayment
                  </Typography>

                  <Typography
                    variant="h6"
                    fontWeight="bold"
                  >
                    {settings?.currency || "R"}{" "}
                    {Number(
                      loan.total_repayment || 0
                    ).toLocaleString("en-ZA", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </Typography>
                </Box>

                <Box>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                  >
                    Full Balance Due
                  </Typography>

                  <Typography
                    variant="h6"
                    fontWeight="bold"
                  >
                    {settings?.currency || "R"}{" "}
                    {Number(
                      loan.monthly_repayment || 0
                    ).toLocaleString("en-ZA", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </Typography>
                </Box>
              </Box>
            )}
        </Paper>

        {/* =====================================================
            TERM
        ====================================================== */}

        <Paper
          variant="outlined"
          sx={{
            p: 3,
            mb: 3,
          }}
        >
          <Typography
            variant="h6"
            fontWeight="bold"
            gutterBottom
          >
            Repayment Term
          </Typography>

          <Typography color="text.secondary" sx={{ mb: 2 }}>
            The full outstanding balance is due on the selected payment date.
            If it is not fully paid, interest is added after the configured
            interest-cycle days and the payment date moves to the same day in
            the following month.
          </Typography>

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "1fr",
                sm: "repeat(2, 1fr)",
              },
              gap: 2,
            }}
          >
            <TextField
              label="Term"
              value={
                loan.term_months
                  ? `${loan.term_months} month${
                      loan.term_months === 1
                        ? ""
                        : "s"
                    }`
                  : ""
              }
              InputProps={{
                readOnly: true,
              }}
            />

            <TextField
              label="Full Balance Due"
              value={
                loan.monthly_repayment
                  ? `${settings?.currency || "R"} ${Number(
                      loan.monthly_repayment
                    ).toLocaleString("en-ZA", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}`
                  : ""
              }
              InputProps={{
                readOnly: true,
              }}
            />
          </Box>
        </Paper>

        {/* =====================================================
            PAYMENT DATES
        ====================================================== */}

        <Paper
          variant="outlined"
          sx={{
            p: 3,
            mb: 3,
          }}
        >
          <Typography
            variant="h6"
            fontWeight="bold"
            gutterBottom
          >
            Payment Dates
          </Typography>

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "1fr",
                md: "repeat(3, 1fr)",
              },
              gap: 2,
            }}
          >
            <TextField
              type="date"
              label="First Payment Date"
              value={loan.first_payment_date}
              onChange={
                handleFirstPaymentDateChange
              }
              InputLabelProps={{
                shrink: true,
              }}
              fullWidth
            />

            <TextField
              type="date"
              label="Next Payment Date"
              value={loan.next_payment_date}
              InputLabelProps={{
                shrink: true,
              }}
              InputProps={{
                readOnly: true,
              }}
              fullWidth
            />

            <TextField
              type="date"
              label="Next Interest Date"
              value={loan.next_interest_date}
              InputLabelProps={{
                shrink: true,
              }}
              InputProps={{
                readOnly: true,
              }}
              fullWidth
              helperText={
                settings?.interest_cycle_enabled
                  ? `Based on ${settings.interest_cycle_days}-day interest cycle`
                  : "Interest cycle disabled in Settings"
              }
            />
          </Box>
        </Paper>

        {/* =====================================================
            CURRENT BALANCE
        ====================================================== */}

        <Paper
          variant="outlined"
          sx={{
            p: 3,
            mb: 3,
          }}
        >
          <Typography
            variant="h6"
            fontWeight="bold"
            gutterBottom
          >
            Opening Balance
          </Typography>

          <TextField
            fullWidth
            label="Current Balance"
            value={
              loan.current_balance
                ? `${settings?.currency || "R"} ${Number(
                    loan.current_balance
                  ).toLocaleString("en-ZA", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}`
                : ""
            }
            InputProps={{
              readOnly: true,
            }}
          />
        </Paper>

        {/* =====================================================
            RULE PREVIEW
        ====================================================== */}

        {settings && (
          <Alert
            severity="info"
            sx={{ mb: 3 }}
          >
            <Typography
              variant="body2"
              fontWeight="bold"
            >
              Loan rules from Settings
            </Typography>

            <Typography variant="body2">
              Interest pricing and repayment terms
              are calculated using the current
              Settings configuration.
            </Typography>

            <Typography variant="body2">
              Interest cycle:{" "}
              {settings.interest_cycle_enabled
                ? `${settings.interest_cycle_days} days at ${settings.interest_cycle_time} (${settings.timezone})`
                : "Disabled"}
            </Typography>
          </Alert>
        )}

        {/* =====================================================
            DOCUMENT CHECK STATUS
        ====================================================== */}

        {skipDocumentCheck && (
          <Alert
            severity="warning"
            sx={{ mb: 3 }}
          >
            Customer document checking was skipped for
            this loan.
          </Alert>
        )}

        {/* =====================================================
            ACTIONS
        ====================================================== */}

        <Box
          sx={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 2,
            pb: 4,
          }}
        >
          <Button
            variant="outlined"
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
              !customer ||
              !loan.principal_amount ||
              !loan.first_payment_date
            }
          >
            {saving ? (
              <CircularProgress
                size={24}
                color="inherit"
              />
            ) : (
              "Save Loan"
            )}
          </Button>
        </Box>
      </Box>
    </Paper>
  );
}