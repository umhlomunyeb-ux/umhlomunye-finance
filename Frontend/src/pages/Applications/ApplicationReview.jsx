import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";

import {
  Box,
  Paper,
  Typography,
  Grid,
  Divider,
  Button,
  Chip,
  CircularProgress,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Stack,
} from "@mui/material";

import { supabase } from "../../lib/supabase";
import { findCustomerByIdNumber } from "../../services/customerService";

export default function ApplicationReview() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [application, setApplication] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  const [successMessage, setSuccessMessage] =
    useState("");

  const [rejectDialogOpen, setRejectDialogOpen] =
    useState(false);

  const [rejectionReason, setRejectionReason] =
    useState("");

  const [customer, setCustomer] = useState(null);
  const [customerLoading, setCustomerLoading] =
    useState(false);
  const [customerError, setCustomerError] =
    useState("");

  const [currentUserId, setCurrentUserId] =
    useState(null);

  // --------------------------------------------------
  // FIND EXISTING CUSTOMER
  // --------------------------------------------------

  async function findApplicationCustomer(
    applicationData
  ) {
    try {
      setCustomerLoading(true);
      setCustomerError("");
      setCustomer(null);

      if (!applicationData.id_number) {
        setCustomerError(
          "No ID number was provided on this application."
        );

        return null;
      }

      const existingCustomer =
        await findCustomerByIdNumber(
          applicationData.id_number
        );

      if (!existingCustomer) {
        setCustomerError(
          "No existing customer was found with this ID number."
        );

        return null;
      }

      setCustomer(existingCustomer);

      return existingCustomer;
    } catch (err) {
      console.error(
        "Unable to identify customer:",
        err
      );

      setCustomerError(
        err?.message ||
          "Unable to identify the customer."
      );

      return null;
    } finally {
      setCustomerLoading(false);
    }
  }

  // --------------------------------------------------
  // LOAD CURRENT USER
  // --------------------------------------------------

  async function loadCurrentUser() {
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) {
        throw userError;
      }

      setCurrentUserId(user?.id || null);
    } catch (err) {
      console.error(
        "Unable to load current user:",
        err
      );

      setCurrentUserId(null);
    }
  }

  // --------------------------------------------------
  // LOAD APPLICATION
  // --------------------------------------------------

  async function loadApplication() {
    try {
      setLoading(true);
      setError("");

      const { data, error } = await supabase
        .from("loan_applications")
        .select("*")
        .eq("id", id)
        .single();

      // IMPORTANT:
      // This is an application-loading error.
      // Do not run approval logic here.
      if (error) {
        throw error;
      }

      setApplication(data);

      if (data.id_number) {
        await findApplicationCustomer(data);
      } else {
        setCustomer(null);
        setCustomerError("");
      }
    } catch (err) {
      console.error(
        "Unable to load application:",
        err
      );

      setError(
        err?.message ||
          "Unable to load application."
      );
    } finally {
      setLoading(false);
    }
  }

  // --------------------------------------------------
  // INITIAL LOAD
  // --------------------------------------------------

  useEffect(() => {
    loadApplication();
    loadCurrentUser();
  }, [id]);

  // --------------------------------------------------
  // FORMATTING
  // --------------------------------------------------

  function formatMoney(value) {
    if (
      value === null ||
      value === undefined ||
      value === ""
    ) {
      return "0.00";
    }

    const number = Number(value);

    if (Number.isNaN(number)) {
      return value;
    }

    return number.toLocaleString("en-ZA", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function formatDate(value) {
    if (!value) return "-";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleDateString("en-ZA", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  function formatDateTime(value) {
    if (!value) return "-";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleString("en-ZA", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatStatus(status) {
    if (!status) return "Unknown";

    return status
      .replaceAll("_", " ")
      .toLowerCase()
      .replace(/\b\w/g, (letter) =>
        letter.toUpperCase()
      );
  }

  function getStatusColor(status) {
    switch (status) {
      case "PENDING":
        return "warning";

      case "UNDER_REVIEW":
        return "info";

      case "MORE_INFORMATION_REQUIRED":
        return "warning";

      case "APPROVED":
        return "success";

      case "REJECTED":
        return "error";

      case "CANCELLED":
        return "default";

      default:
        return "default";
    }
  }

  // --------------------------------------------------
  // MAKER-CHECKER
  // --------------------------------------------------

  const isApplicationCreator =
    Boolean(
      application?.created_by &&
        currentUserId &&
        application.created_by === currentUserId
    );

  // --------------------------------------------------
  // APPROVE APPLICATION
  // --------------------------------------------------

  async function handleApprove() {
    try {
      setApproving(true);
      setError("");
      setSuccessMessage("");

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) {
        throw userError;
      }

      if (!user) {
        throw new Error(
          "No logged-in administrator was found."
        );
      }

      // Maker-checker protection
      if (
        application.created_by &&
        application.created_by === user.id
      ) {
        throw new Error(
          "You cannot approve an application that you created. Another authorised user must approve this application."
        );
      }

      if (application.status !== "PENDING") {
        throw new Error(
          `This application cannot be approved because its current status is ${formatStatus(
            application.status
          )}.`
        );
      }

      const { data, error } =
        await supabase.rpc(
          "approve_loan_application",
          {
            p_application_id: application.id,
            p_approved_by: user.id,
          }
        );

      if (error) {
        console.error(
          "APPROVAL ERROR MESSAGE:",
          error.message
        );

        console.error(
          "APPROVAL ERROR DETAILS:",
          error.details
        );

        console.error(
          "APPROVAL ERROR HINT:",
          error.hint
        );

        console.error(
          "APPROVAL ERROR CODE:",
          error.code
        );

        throw error;
      }

      console.log(
        "Approval result:",
        data
      );

      const loanNumber =
        data?.loan_number ||
        data?.loanNumber ||
        data?.loan?.loan_number;

      if (loanNumber) {
        setSuccessMessage(
          `Application approved successfully. Loan ${loanNumber} has been created.`
        );
      } else {
        setSuccessMessage(
          "Application approved successfully."
        );
      }

      await loadApplication();
    } catch (err) {
      console.error(
        "Unable to approve application:",
        err
      );

      setError(
        err?.message ||
          "Unable to approve application."
      );
    } finally {
      setApproving(false);
    }
  }

  // --------------------------------------------------
  // OPEN REJECTION DIALOG
  // --------------------------------------------------

  function openRejectDialog() {
    setError("");
    setRejectionReason("");
    setRejectDialogOpen(true);
  }

  // --------------------------------------------------
  // REJECT APPLICATION
  // --------------------------------------------------

  async function handleReject() {
    try {
      if (!rejectionReason.trim()) {
        setError(
          "Please enter a rejection reason."
        );

        return;
      }

      setRejecting(true);
      setError("");
      setSuccessMessage("");

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) {
        throw userError;
      }

      if (!user) {
        throw new Error(
          "No logged-in administrator was found."
        );
      }

      if (application.status !== "PENDING") {
        throw new Error(
          `This application cannot be rejected because its current status is ${formatStatus(
            application.status
          )}.`
        );
      }

      const { data, error } =
        await supabase.rpc(
          "reject_loan_application",
          {
            p_application_id: application.id,
            p_rejected_by: user.id,
            p_rejection_reason:
              rejectionReason.trim(),
          }
        );

      if (error) {
        console.error(
          "REJECTION ERROR MESSAGE:",
          error.message
        );

        console.error(
          "REJECTION ERROR DETAILS:",
          error.details
        );

        console.error(
          "REJECTION ERROR HINT:",
          error.hint
        );

        console.error(
          "REJECTION ERROR CODE:",
          error.code
        );

        throw error;
      }

      console.log(
        "Rejection result:",
        data
      );

      setRejectDialogOpen(false);
      setRejectionReason("");

      setSuccessMessage(
        "Application rejected successfully."
      );

      await loadApplication();
    } catch (err) {
      console.error(
        "Unable to reject application:",
        err
      );

      setError(
        err?.message ||
          "Unable to reject application."
      );
    } finally {
      setRejecting(false);
    }
  }

  // --------------------------------------------------
  // LOADING
  // --------------------------------------------------

  if (loading) {
    return (
      <Box
        sx={{
          minHeight: "50vh",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  // --------------------------------------------------
  // ERROR
  // --------------------------------------------------

  if (error && !application) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">
          {error}
        </Alert>

        <Button
          sx={{ mt: 2 }}
          variant="outlined"
          onClick={() =>
            navigate("/applications")
          }
        >
          Back to Applications
        </Button>
      </Box>
    );
  }

  // --------------------------------------------------
  // NOT FOUND
  // --------------------------------------------------

  if (!application) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography>
          Application not found.
        </Typography>

        <Button
          sx={{ mt: 2 }}
          variant="outlined"
          onClick={() =>
            navigate("/applications")
          }
        >
          Back to Applications
        </Button>
      </Box>
    );
  }

  // --------------------------------------------------
  // MAIN UI
  // --------------------------------------------------

  return (
    <Box
      sx={{
        p: { xs: 2, md: 3 },
        maxWidth: 1400,
        mx: "auto",
      }}
    >
      {/* BACK BUTTON */}

      <Button
        variant="text"
        onClick={() =>
          navigate("/applications")
        }
        sx={{ mb: 2 }}
      >
        ← Back to Applications
      </Button>

      {/* ERROR */}

      {error && (
        <Alert
          severity="error"
          sx={{ mb: 3 }}
          onClose={() => setError("")}
        >
          {error}
        </Alert>
      )}

      {/* SUCCESS */}

      {successMessage && (
        <Alert
          severity="success"
          sx={{ mb: 3 }}
          onClose={() => setSuccessMessage("")}
        >
          {successMessage}
        </Alert>
      )}

      {/* HEADER */}

      <Paper
        sx={{
          p: { xs: 2, md: 3 },
          mb: 3,
        }}
      >
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
        >
          <Box>
            <Typography
              variant="h4"
              fontWeight="bold"
            >
              Review Loan Application
            </Typography>

            <Typography
              color="text.secondary"
              sx={{ mt: 1 }}
            >
              Application Number:{" "}
              <strong>
                {application.application_number ||
                  "-"}
              </strong>
            </Typography>

            <Typography
              color="text.secondary"
              sx={{ mt: 0.5 }}
            >
              Submitted:{" "}
              {formatDateTime(
                application.created_at
              )}
            </Typography>
          </Box>

          <Chip
            label={formatStatus(
              application.status
            )}
            color={getStatusColor(
              application.status
            )}
            sx={{
              fontWeight: "bold",
              px: 1,
            }}
          />
        </Stack>
      </Paper>

      {/* PERSONAL INFORMATION */}

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography
          variant="h6"
          fontWeight="bold"
        >
          Personal Information
        </Typography>

        <Divider sx={{ my: 2 }} />

        <Grid container spacing={3}>
          <Grid item xs={12} md={4}>
            <Typography color="text.secondary">
              First Name
            </Typography>

            <Typography fontWeight={500}>
              {application.first_name || "-"}
            </Typography>
          </Grid>

          <Grid item xs={12} md={4}>
            <Typography color="text.secondary">
              Last Name
            </Typography>

            <Typography fontWeight={500}>
              {application.last_name || "-"}
            </Typography>
          </Grid>

          <Grid item xs={12} md={4}>
            <Typography color="text.secondary">
              Cellphone
            </Typography>

            <Typography fontWeight={500}>
              {application.cellphone || "-"}
            </Typography>
          </Grid>

          <Grid item xs={12} md={4}>
            <Typography color="text.secondary">
              Email
            </Typography>

            <Typography fontWeight={500}>
              {application.email || "-"}
            </Typography>
          </Grid>

          <Grid item xs={12} md={8}>
            <Typography color="text.secondary">
              Physical Address
            </Typography>

            <Typography fontWeight={500}>
              {application.physical_address ||
                "-"}
            </Typography>
          </Grid>
        </Grid>
      </Paper>

      {/* ID NUMBER */}

      <Paper
        sx={{
          p: 3,
          mb: 3,
          opacity: 0.55,
          backgroundColor: "#f5f5f5",
        }}
      >
        <Typography
          variant="h6"
          fontWeight="bold"
        >
          ID Number
        </Typography>

        <Divider sx={{ my: 2 }} />

        <Typography color="text.secondary">
          ID number collection is currently
          unavailable.
        </Typography>

        <Typography sx={{ mt: 1 }}>
          Not captured
        </Typography>
      </Paper>

      {/* EXISTING CUSTOMER SEARCH */}

      {customerLoading && (
        <Alert
          severity="info"
          sx={{ mb: 3 }}
        >
          Identifying existing customer...
        </Alert>
      )}

      {customerError && (
        <Alert
          severity="warning"
          sx={{ mb: 3 }}
        >
          {customerError}
        </Alert>
      )}

      {customer && (
        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography
            variant="h6"
            fontWeight="bold"
          >
            Existing Customer Identified
          </Typography>

          <Divider sx={{ my: 2 }} />

          <Grid container spacing={3}>
            <Grid item xs={12} md={4}>
              <Typography color="text.secondary">
                Customer Number
              </Typography>

              <Typography fontWeight="bold">
                {customer.customer_number ||
                  "-"}
              </Typography>
            </Grid>

            <Grid item xs={12} md={4}>
              <Typography color="text.secondary">
                Name
              </Typography>

              <Typography>
                {customer.first_name || ""}{" "}
                {customer.last_name || ""}
              </Typography>
            </Grid>

            <Grid item xs={12} md={4}>
              <Typography color="text.secondary">
                Cellphone
              </Typography>

              <Typography>
                {customer.cellphone || "-"}
              </Typography>
            </Grid>

            <Grid item xs={12} md={4}>
              <Typography color="text.secondary">
                Date of Birth
              </Typography>

              <Typography>
                {customer.date_of_birth || "-"}
              </Typography>
            </Grid>

            <Grid item xs={12} md={4}>
              <Typography color="text.secondary">
                Gender
              </Typography>

              <Typography>
                {customer.gender || "-"}
              </Typography>
            </Grid>

            <Grid item xs={12}>
              <Button
                variant="outlined"
                onClick={() =>
                  navigate(
                    `/customers/${customer.id}`
                  )
                }
              >
                View Customer Profile
              </Button>
            </Grid>
          </Grid>
        </Paper>
      )}

      {/* EMPLOYMENT AND INCOME */}

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography
          variant="h6"
          fontWeight="bold"
        >
          Employment & Income
        </Typography>

        <Divider sx={{ my: 2 }} />

        <Grid container spacing={3}>
          <Grid item xs={12} md={4}>
            <Typography color="text.secondary">
              Employer
            </Typography>

            <Typography fontWeight={500}>
              {application.employer || "-"}
            </Typography>
          </Grid>

          <Grid item xs={12} md={4}>
            <Typography color="text.secondary">
              Employment Status
            </Typography>

            <Typography fontWeight={500}>
              {application.employment_status ||
                "-"}
            </Typography>
          </Grid>

          <Grid item xs={12} md={4}>
            <Typography color="text.secondary">
              Monthly Income
            </Typography>

            <Typography fontWeight={500}>
              R{" "}
              {formatMoney(
                application.monthly_income
              )}
            </Typography>
          </Grid>

          <Grid item xs={12} md={4}>
            <Typography color="text.secondary">
              Other Income
            </Typography>

            <Typography fontWeight={500}>
              R{" "}
              {formatMoney(
                application.other_income
              )}
            </Typography>
          </Grid>
        </Grid>
      </Paper>

      {/* LOAN INFORMATION */}

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography
          variant="h6"
          fontWeight="bold"
        >
          Loan Information
        </Typography>

        <Divider sx={{ my: 2 }} />

        <Grid container spacing={3}>
          <Grid item xs={12} md={4}>
            <Typography color="text.secondary">
              Amount Requested
            </Typography>

            <Typography
              variant="h5"
              fontWeight="bold"
            >
              R{" "}
              {formatMoney(
                application.amount_requested
              )}
            </Typography>
          </Grid>

          <Grid item xs={12} md={4}>
            <Typography color="text.secondary">
              Preferred Payment Date
            </Typography>

            <Typography fontWeight={500}>
              {formatDate(
                application.preferred_payment_date
              )}
            </Typography>
          </Grid>

          <Grid item xs={12} md={4}>
            <Typography color="text.secondary">
              Loan Purpose
            </Typography>

            <Typography fontWeight={500}>
              {application.loan_purpose || "-"}
            </Typography>
          </Grid>
        </Grid>
      </Paper>

      {/* BANKING */}

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography
          variant="h6"
          fontWeight="bold"
        >
          Banking Information
        </Typography>

        <Divider sx={{ my: 2 }} />

        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <Typography color="text.secondary">
              Bank Name
            </Typography>

            <Typography fontWeight={500}>
              {application.bank_name || "-"}
            </Typography>
          </Grid>

          <Grid item xs={12} md={6}>
            <Typography color="text.secondary">
              Account Number
            </Typography>

            <Typography fontWeight={500}>
              {application.account_number || "-"}
            </Typography>
          </Grid>
        </Grid>
      </Paper>

      {/* COLLECTION */}

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography
          variant="h6"
          fontWeight="bold"
        >
          Collections
        </Typography>

        <Divider sx={{ my: 2 }} />

        <Typography color="text.secondary">
          Preferred Collection Method
        </Typography>

        <Typography fontWeight={500}>
          {application.collection_preference ||
            "-"}
        </Typography>
      </Paper>

      {/* NOTES */}

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography
          variant="h6"
          fontWeight="bold"
        >
          Applicant Notes
        </Typography>

        <Divider sx={{ my: 2 }} />

        <Typography
          sx={{
            whiteSpace: "pre-wrap",
          }}
        >
          {application.notes ||
            "No notes provided."}
        </Typography>
      </Paper>

      {/* SUPPORTING DOCUMENTS */}

      <Paper
        sx={{
          p: 3,
          mb: 3,
          opacity: 0.55,
          backgroundColor: "#f5f5f5",
        }}
      >
        <Typography
          variant="h6"
          fontWeight="bold"
        >
          Supporting Documents
        </Typography>

        <Divider sx={{ my: 2 }} />

        <Typography color="text.secondary">
          Supporting document collection is
          currently unavailable.
        </Typography>
      </Paper>

      {/* LINKED RECORDS */}

      {(application.customer_id ||
        application.loan_id) && (
        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography
            variant="h6"
            fontWeight="bold"
          >
            Linked Records
          </Typography>

          <Divider sx={{ my: 2 }} />

          <Stack
            direction={{
              xs: "column",
              sm: "row",
            }}
            spacing={2}
          >
            {application.customer_id && (
              <Button
                variant="outlined"
                onClick={() =>
                  navigate(
                    `/customers/${application.customer_id}`
                  )
                }
              >
                View Customer
              </Button>
            )}

            {application.loan_id && (
              <Button
                variant="outlined"
                onClick={() =>
                  navigate(
                    `/loans/${application.loan_id}`
                  )
                }
              >
                View Loan
              </Button>
            )}
          </Stack>
        </Paper>
      )}

      {/* APPLICATION INFORMATION */}

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography
          variant="h6"
          fontWeight="bold"
        >
          Application Information
        </Typography>

        <Divider sx={{ my: 2 }} />

        <Grid container spacing={3}>
          <Grid item xs={12} md={4}>
            <Typography color="text.secondary">
              Application Number
            </Typography>

            <Typography fontWeight={500}>
              {application.application_number ||
                "-"}
            </Typography>
          </Grid>

          <Grid item xs={12} md={4}>
            <Typography color="text.secondary">
              Submitted
            </Typography>

            <Typography fontWeight={500}>
              {formatDateTime(
                application.created_at
              )}
            </Typography>
          </Grid>

          <Grid item xs={12} md={4}>
            <Typography color="text.secondary">
              Current Status
            </Typography>

            <Box sx={{ mt: 0.5 }}>
              <Chip
                label={formatStatus(
                  application.status
                )}
                color={getStatusColor(
                  application.status
                )}
                size="small"
              />
            </Box>
          </Grid>
        </Grid>
      </Paper>

      {/* ACTIONS */}

      <Paper sx={{ p: 3 }}>
        <Typography
          variant="h6"
          fontWeight="bold"
        >
          Application Actions
        </Typography>

        <Typography
          color="text.secondary"
          sx={{ mt: 1, mb: 3 }}
        >
          Review the application carefully before
          making a decision.
        </Typography>

        {/* MAKER CHECKER WARNING */}

        {isApplicationCreator &&
          application.status === "PENDING" && (
            <Alert
              severity="warning"
              sx={{ mb: 3 }}
            >
              <strong>
                Maker-checker control:
              </strong>{" "}
              You created this application. You
              cannot approve it. Another authorised
              user must approve this application.
            </Alert>
          )}

        {/* ALREADY APPROVED */}

        {application.status === "APPROVED" && (
          <Alert
            severity="success"
            sx={{ mb: 3 }}
          >
            This application has already been
            approved.
            {application.loan_id && (
              <>
                {" "}
                A loan has been linked to this
                application.
              </>
            )}
          </Alert>
        )}

        {/* ALREADY REJECTED */}

        {application.status === "REJECTED" && (
          <Alert
            severity="error"
            sx={{ mb: 3 }}
          >
            This application has already been
            rejected.
          </Alert>
        )}

        <Stack
          direction={{
            xs: "column",
            sm: "row",
          }}
          spacing={2}
        >
          <Button
            variant="contained"
            color="success"
            onClick={handleApprove}
            disabled={
              approving ||
              rejecting ||
              application.status !== "PENDING" ||
              isApplicationCreator
            }
          >
            {approving
              ? "Approving..."
              : isApplicationCreator
              ? "Approval Not Allowed"
              : "Approve Application"}
          </Button>

          <Button
            variant="outlined"
            color="error"
            disabled={
              approving ||
              rejecting ||
              application.status !== "PENDING"
            }
            onClick={openRejectDialog}
          >
            Reject Application
          </Button>

          <Button
            variant="outlined"
            onClick={() =>
              navigate("/applications")
            }
            disabled={approving || rejecting}
          >
            Back to Applications
          </Button>
        </Stack>
      </Paper>

      {/* REJECTION DIALOG */}

      <Dialog
        open={rejectDialogOpen}
        onClose={() => {
          if (!rejecting) {
            setRejectDialogOpen(false);
          }
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Reject Loan Application
        </DialogTitle>

        <DialogContent>
          <Typography
            color="text.secondary"
            sx={{ mb: 2 }}
          >
            Please provide a reason for rejecting
            this application. This reason will be
            saved with the application.
          </Typography>

          <TextField
            fullWidth
            multiline
            rows={5}
            label="Rejection Reason"
            value={rejectionReason}
            onChange={(event) =>
              setRejectionReason(
                event.target.value
              )
            }
            placeholder="Enter the reason for rejection..."
            required
            autoFocus
          />
        </DialogContent>

        <DialogActions>
          <Button
            onClick={() => {
              if (!rejecting) {
                setRejectDialogOpen(false);
                setRejectionReason("");
              }
            }}
            disabled={rejecting}
          >
            Cancel
          </Button>

          <Button
            variant="contained"
            color="error"
            onClick={handleReject}
            disabled={
              rejecting ||
              !rejectionReason.trim()
            }
          >
            {rejecting
              ? "Rejecting..."
              : "Confirm Rejection"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}