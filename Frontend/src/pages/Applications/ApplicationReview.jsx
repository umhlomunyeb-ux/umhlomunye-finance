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
import { sendLoanEmail } from "../../services/emailService";

export default function ApplicationReview() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [application, setApplication] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  const [successMessage, setSuccessMessage] = useState("");

  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);

  const [rejectionReason, setRejectionReason] = useState("");

  const [customer, setCustomer] = useState(null);
  const [customerLoading, setCustomerLoading] = useState(false);
  const [customerError, setCustomerError] = useState("");

  const [documents, setDocuments] = useState([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentsError, setDocumentsError] = useState("");
  const [openingDocument, setOpeningDocument] = useState(null);

  // --------------------------------------------------
  // FIND EXISTING CUSTOMER
  // --------------------------------------------------

  async function findApplicationCustomer(applicationData) {
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

      const existingCustomer = await findCustomerByIdNumber(
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
      console.error("Unable to identify customer:", err);

      setCustomerError(
        err?.message || "Unable to identify the customer."
      );

      return null;
    } finally {
      setCustomerLoading(false);
    }
  }

  // --------------------------------------------------
  // LOAD SUPPORTING DOCUMENTS
  // --------------------------------------------------

  async function loadDocuments(applicationId) {
    try {
      setDocumentsLoading(true);
      setDocumentsError("");

      const { data, error: documentsQueryError } = await supabase
        .from("documents")
        .select("*")
        .eq("application_id", applicationId)
        .is("deleted_at", null)
        .order("created_at", {
          ascending: false,
        });

      if (documentsQueryError) {
        throw documentsQueryError;
      }

      setDocuments(data || []);
    } catch (err) {
      console.error(
        "Unable to load application documents:",
        err
      );

      setDocuments([]);
      setDocumentsError(
        err?.message ||
          "Unable to load supporting documents."
      );
    } finally {
      setDocumentsLoading(false);
    }
  }

  // --------------------------------------------------
  // OPEN SUPPORTING DOCUMENT
  // --------------------------------------------------

  async function openDocument(document) {
    try {
      setOpeningDocument(document.id);
      setDocumentsError("");

      if (!document.document_path) {
        throw new Error(
          "This document does not have a storage path."
        );
      }

      const { data, error: signedUrlError } =
        await supabase.storage
          .from("documents")
          .createSignedUrl(
            document.document_path,
            60 * 10
          );

      if (signedUrlError) {
        throw signedUrlError;
      }

      if (!data?.signedUrl) {
        throw new Error(
          "A secure document link could not be created."
        );
      }

      window.open(
        data.signedUrl,
        "_blank",
        "noopener,noreferrer"
      );
    } catch (err) {
      console.error(
        "Unable to open document:",
        err
      );

      setDocumentsError(
        err?.message ||
          "Unable to open the document."
      );
    } finally {
      setOpeningDocument(null);
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

      return user || null;
    } catch (err) {
      console.error(
        "Unable to load current user:",
        err
      );

      return null;
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

      await loadDocuments(data.id);
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

  function formatFileSize(bytes) {
    if (
      bytes === null ||
      bytes === undefined ||
      bytes === ""
    ) {
      return "-";
    }

    const size = Number(bytes);

    if (!Number.isFinite(size)) {
      return "-";
    }

    if (size < 1024) {
      return `${size} B`;
    }

    if (size < 1024 * 1024) {
      return `${(size / 1024).toFixed(1)} KB`;
    }

    if (size < 1024 * 1024 * 1024) {
      return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    }

    return `${(
      size /
      (1024 * 1024 * 1024)
    ).toFixed(1)} GB`;
  }

  function getDocumentDisplayName(document) {
    return (
      document.document_name ||
      document.document_type ||
      "Supporting Document"
    );
  }

  function getDocumentType(document) {
    return (
      document.document_type ||
      "Other"
    );
  }

  // --------------------------------------------------
  // APPROVE APPLICATION
  // --------------------------------------------------

  async function handleApprove() {
    try {
      setApproving(true);
      setError("");
      setSuccessMessage("");

      const user = await loadCurrentUser();

      if (!user) {
        throw new Error(
          "No logged-in user was found."
        );
      }

      if (application.status !== "PENDING") {
        throw new Error(
          `This application cannot be approved because its current status is ${formatStatus(
            application.status
          )}.`
        );
      }

      // -----------------------------------------------
      // APPROVE APPLICATION + CREATE LOAN + AGREEMENT
      // -----------------------------------------------

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

      const agreementId =
        data?.agreement_id ||
        data?.agreementId;

      if (!agreementId) {
        throw new Error(
          "The loan was approved, but no loan agreement was created."
        );
      }

      // -----------------------------------------------
      // LOAD SIGNING TOKEN
      // -----------------------------------------------

      const {
        data: agreement,
        error: agreementError,
      } = await supabase
        .from("loan_agreements")
        .select(
          `
            id,
            signing_token,
            agreement_number,
            status
          `
        )
        .eq("id", agreementId)
        .single();

      if (agreementError) {
        console.error(
          "AGREEMENT LOOKUP ERROR:",
          agreementError
        );

        throw new Error(
          `Loan approved, but the agreement could not be loaded: ${
            agreementError.message
          }`
        );
      }

      if (!agreement?.signing_token) {
        throw new Error(
          "Loan approved, but the agreement does not have a signing token."
        );
      }

      // -----------------------------------------------
      // BUILD PUBLIC SIGNING URL
      // -----------------------------------------------

      const agreementUrl =
        `${window.location.origin}/sign-agreement/${agreement.signing_token}`;

      console.log(
        "Agreement signing URL:",
        agreementUrl
      );

      // -----------------------------------------------
      // SEND AGREEMENT EMAIL
      // -----------------------------------------------

      const recipientEmail =
        application.email?.trim();

      const recipientName =
        [
          application.first_name,
          application.last_name,
        ]
          .filter(Boolean)
          .join(" ")
          .trim() ||
        "Customer";

      if (!recipientEmail) {
        console.warn(
          "Loan approved but no customer email address was available."
        );

        if (loanNumber) {
          setSuccessMessage(
            `Application approved successfully. Loan ${loanNumber} has been created, but the agreement could not be emailed because no customer email address was provided.`
          );
        } else {
          setSuccessMessage(
            "Application approved successfully, but the agreement could not be emailed because no customer email address was provided."
          );
        }

        await loadApplication();
        return;
      }

      try {
        await sendLoanEmail({
          notificationType: "AGREEMENT",

          applicationId:
            application.id,

          loanId:
            data?.loan_id ||
            data?.loanId ||
            null,

          recipientEmail,

          recipientName,

          applicationNumber:
            application.application_number ||
            null,

          loanNumber:
            loanNumber ||
            null,

          clientName:
            recipientName,

          amountRequested:
            application.amount_requested ||
            null,

          approvedAmount:
            data?.principal_amount ||
            null,

          agreementUrl,
        });

        console.log(
          "Agreement email sent successfully."
        );

        if (loanNumber) {
          setSuccessMessage(
            `Application approved successfully. Loan ${loanNumber} has been created and the agreement was emailed to ${recipientEmail}.`
          );
        } else {
          setSuccessMessage(
            `Application approved successfully and the agreement was emailed to ${recipientEmail}.`
          );
        }
      } catch (emailError) {
        console.error(
          "AGREEMENT EMAIL ERROR:",
          emailError
        );

        if (loanNumber) {
          setSuccessMessage(
            `Application approved successfully. Loan ${loanNumber} has been created, but the agreement email could not be sent.`
          );
        } else {
          setSuccessMessage(
            "Application approved successfully, but the agreement email could not be sent."
          );
        }

        setError(
          emailError?.message ||
            "The agreement was created, but the email could not be sent."
        );
      }

      // -----------------------------------------------
      // REFRESH APPLICATION
      // -----------------------------------------------

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

      const user = await loadCurrentUser();

      if (!user) {
        throw new Error(
          "No logged-in user was found."
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

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography
          variant="h6"
          fontWeight="bold"
        >
          ID Number
        </Typography>

        <Divider sx={{ my: 2 }} />

        <Typography color="text.secondary">
          South African ID Number
        </Typography>

        <Typography
          sx={{
            mt: 1,
            fontWeight: 600,
            fontSize: "1.1rem",
            letterSpacing: "0.05em",
          }}
        >
          {application.id_number || "Not captured"}
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

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography
          variant="h6"
          fontWeight="bold"
        >
          Supporting Documents
        </Typography>

        <Divider sx={{ my: 2 }} />

        {documentsLoading && (
          <Box
            sx={{
              py: 3,
              display: "flex",
              justifyContent: "center",
            }}
          >
            <CircularProgress size={28} />
          </Box>
        )}

        {documentsError && (
          <Alert
            severity="error"
            sx={{ mb: 2 }}
            onClose={() =>
              setDocumentsError("")
            }
          >
            {documentsError}
          </Alert>
        )}

        {!documentsLoading &&
          !documentsError &&
          documents.length === 0 && (
            <Typography color="text.secondary">
              No supporting documents were uploaded
              with this application.
            </Typography>
          )}

        {!documentsLoading &&
          documents.length > 0 && (
            <Stack spacing={2}>
              {documents.map((document) => (
                <Paper
                  key={document.id}
                  variant="outlined"
                  sx={{
                    p: 2,
                    borderRadius: 2,
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
                    <Box
                      sx={{
                        minWidth: 0,
                        flex: 1,
                      }}
                    >
                      <Typography
                        fontWeight="bold"
                        sx={{
                          wordBreak: "break-word",
                        }}
                      >
                        {getDocumentDisplayName(
                          document
                        )}
                      </Typography>

                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ mt: 0.5 }}
                      >
                        Type:{" "}
                        {getDocumentType(
                          document
                        )}
                      </Typography>

                      <Typography
                        variant="body2"
                        color="text.secondary"
                      >
                        Uploaded:{" "}
                        {formatDateTime(
                          document.created_at
                        )}
                      </Typography>

                      <Typography
                        variant="body2"
                        color="text.secondary"
                      >
                        Size:{" "}
                        {formatFileSize(
                          document.file_size_bytes ??
                            document.file_size
                        )}
                      </Typography>
                    </Box>

                    <Button
                      variant="outlined"
                      onClick={() =>
                        openDocument(document)
                      }
                      disabled={
                        openingDocument ===
                        document.id
                      }
                    >
                      {openingDocument ===
                      document.id
                        ? "Opening..."
                        : "Open Document"}
                    </Button>
                  </Stack>
                </Paper>
              ))}
            </Stack>
          )}
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
              application.status !== "PENDING"
            }
          >
            {approving
              ? "Approving..."
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