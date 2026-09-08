import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

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
  Stack,
  TextField,
  Typography,
} from "@mui/material";

import { supabase } from "../../lib/supabase";
import { findCustomerByIdNumber } from "../../services/customerService";

export default function MobileApplicationReview() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [application, setApplication] = useState(null);
  const [customer, setCustomer] = useState(null);

  const [loading, setLoading] = useState(true);
  const [customerLoading, setCustomerLoading] = useState(false);

  const [error, setError] = useState("");
  const [customerError, setCustomerError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const [currentUserId, setCurrentUserId] = useState(null);

  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");

  async function loadApplication() {
    try {
      setLoading(true);
      setError("");

      const { data, error } = await supabase
        .from("loan_applications")
        .select("*")
        .eq("id", id)
        .single();

      if (error) throw error;

      setApplication(data);

      if (data.id_number) {
        await findApplicationCustomer(data);
      } else {
        setCustomer(null);
        setCustomerError("");
      }
    } catch (err) {
      console.error("Unable to load application:", err);
      setError(err?.message || "Unable to load application.");
    } finally {
      setLoading(false);
    }
  }

  async function findApplicationCustomer(applicationData) {
    try {
      setCustomerLoading(true);
      setCustomerError("");
      setCustomer(null);

      if (!applicationData.id_number) return null;

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

  async function loadCurrentUser() {
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) throw userError;

      setCurrentUserId(user?.id || null);
    } catch (err) {
      console.error("Unable to load current user:", err);
      setCurrentUserId(null);
    }
  }

  useEffect(() => {
    loadApplication();
    loadCurrentUser();
  }, [id]);

  function formatMoney(value) {
    if (value === null || value === undefined || value === "") {
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
      month: "short",
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
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
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

  const isApplicationCreator = Boolean(
    application?.created_by &&
      currentUserId &&
      application.created_by === currentUserId
  );

  const canApprove =
    application?.status === "PENDING" &&
    !isApplicationCreator &&
    !approving &&
    !rejecting;

  const canReject =
    application?.status === "PENDING" &&
    !approving &&
    !rejecting;

  async function handleApprove() {
    try {
      setApproving(true);
      setError("");
      setSuccessMessage("");

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) throw userError;

      if (!user) {
        throw new Error("No logged-in administrator was found.");
      }

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

      const { data, error } = await supabase.rpc(
        "approve_loan_application",
        {
          p_application_id: application.id,
          p_approved_by: user.id,
        }
      );

      if (error) throw error;

      const loanNumber =
        data?.loan_number ||
        data?.loanNumber ||
        data?.loan?.loan_number;

      if (loanNumber) {
        setSuccessMessage(
          `Application approved. Loan ${loanNumber} has been created.`
        );
      } else {
        setSuccessMessage(
          "Application approved successfully."
        );
      }

      await loadApplication();
    } catch (err) {
      console.error("Unable to approve application:", err);

      setError(
        err?.message || "Unable to approve application."
      );
    } finally {
      setApproving(false);
    }
  }

  function openRejectDialog() {
    setError("");
    setRejectionReason("");
    setRejectDialogOpen(true);
  }

  async function handleReject() {
    try {
      if (!rejectionReason.trim()) {
        setError("Please enter a rejection reason.");
        return;
      }

      setRejecting(true);
      setError("");
      setSuccessMessage("");

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) throw userError;

      if (!user) {
        throw new Error("No logged-in administrator was found.");
      }

      if (application.status !== "PENDING") {
        throw new Error(
          `This application cannot be rejected because its current status is ${formatStatus(
            application.status
          )}.`
        );
      }

      const { error } = await supabase.rpc(
        "reject_loan_application",
        {
          p_application_id: application.id,
          p_rejected_by: user.id,
          p_rejection_reason: rejectionReason.trim(),
        }
      );

      if (error) throw error;

      setRejectDialogOpen(false);
      setRejectionReason("");

      setSuccessMessage(
        "Application rejected successfully."
      );

      await loadApplication();
    } catch (err) {
      console.error("Unable to reject application:", err);

      setError(
        err?.message || "Unable to reject application."
      );
    } finally {
      setRejecting(false);
    }
  }

  if (loading) {
    return (
      <Box
        sx={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#f5f6f8",
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  if (error && !application) {
    return (
      <Box
        sx={{
          minHeight: "100vh",
          p: 2,
          backgroundColor: "#f5f6f8",
        }}
      >
        <Alert severity="error">{error}</Alert>

        <Button
          fullWidth
          sx={{ mt: 2 }}
          variant="outlined"
          onClick={() =>
            navigate("/mobile/application-review")
          }
        >
          Back to Applications
        </Button>
      </Box>
    );
  }

  if (!application) {
    return (
      <Box
        sx={{
          minHeight: "100vh",
          p: 2,
          backgroundColor: "#f5f6f8",
        }}
      >
        <Typography>
          Application not found.
        </Typography>

        <Button
          fullWidth
          sx={{ mt: 2 }}
          variant="outlined"
          onClick={() =>
            navigate("/mobile/application-review")
          }
        >
          Back to Applications
        </Button>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        minHeight: "100vh",
        backgroundColor: "#f5f6f8",
        pb: 12,
      }}
    >
      {/* MOBILE HEADER */}

      <Box
        sx={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          backgroundColor: "white",
          borderBottom: "1px solid",
          borderColor: "divider",
          px: 2,
          py: 1.5,
        }}
      >
        <Stack
          direction="row"
          alignItems="center"
          spacing={1}
        >
          <Button
            size="small"
            onClick={() =>
              navigate("/mobile/application-review")
            }
            sx={{
              minWidth: "auto",
              fontSize: "24px",
              px: 1,
            }}
          >
            ←
          </Button>

          <Box sx={{ flex: 1 }}>
            <Typography
              fontWeight="bold"
              sx={{ fontSize: "17px" }}
            >
              Loan Application
            </Typography>

            <Typography
              variant="caption"
              color="text.secondary"
            >
              {application.application_number || "-"}
            </Typography>
          </Box>

          <Chip
            label={formatStatus(application.status)}
            color={getStatusColor(application.status)}
            size="small"
            sx={{ fontWeight: "bold" }}
          />
        </Stack>
      </Box>

      <Box sx={{ p: 1.5 }}>

        {/* ERROR */}

        {error && (
          <Alert
            severity="error"
            sx={{ mb: 1.5 }}
            onClose={() => setError("")}
          >
            {error}
          </Alert>
        )}

        {/* SUCCESS */}

        {successMessage && (
          <Alert
            severity="success"
            sx={{ mb: 1.5 }}
            onClose={() =>
              setSuccessMessage("")
            }
          >
            {successMessage}
          </Alert>
        )}

        {/* APPLICANT */}

        <Card sx={{ mb: 1.5 }}>
          <CardContent>
            <Typography
              variant="caption"
              color="text.secondary"
            >
              APPLICANT
            </Typography>

            <Typography
              variant="h6"
              fontWeight="bold"
              sx={{ mt: 0.5 }}
            >
              {application.first_name || ""}{" "}
              {application.last_name || ""}
            </Typography>

            <Typography
              color="text.secondary"
              sx={{ mt: 0.5 }}
            >
              Submitted{" "}
              {formatDateTime(
                application.created_at
              )}
            </Typography>

            <Divider sx={{ my: 2 }} />

            <Stack spacing={1}>
              <InfoRow
                label="Cellphone"
                value={
                  application.cellphone || "-"
                }
              />

              <InfoRow
                label="Email"
                value={
                  application.email || "-"
                }
              />

              <InfoRow
                label="Address"
                value={
                  application.physical_address || "-"
                }
              />
            </Stack>
          </CardContent>
        </Card>

        {/* LOAN REQUEST */}

        <Card
          sx={{
            mb: 1.5,
            border: "2px solid",
            borderColor: "primary.main",
          }}
        >
          <CardContent>
            <Typography
              variant="caption"
              color="text.secondary"
            >
              LOAN REQUEST
            </Typography>

            <Typography
              variant="h4"
              fontWeight="bold"
              sx={{ mt: 0.5 }}
            >
              R{" "}
              {formatMoney(
                application.amount_requested
              )}
            </Typography>

            <Divider sx={{ my: 2 }} />

            <Stack spacing={1}>
              <InfoRow
                label="Purpose"
                value={
                  application.loan_purpose || "-"
                }
              />

              <InfoRow
                label="Preferred payment date"
                value={formatDate(
                  application.preferred_payment_date
                )}
              />
            </Stack>
          </CardContent>
        </Card>

        {/* EMPLOYMENT */}

        <Section title="Employment & Income">
          <InfoRow
            label="Employer"
            value={
              application.employer || "-"
            }
          />

          <InfoRow
            label="Employment status"
            value={
              application.employment_status || "-"
            }
          />

          <InfoRow
            label="Monthly income"
            value={`R ${formatMoney(
              application.monthly_income
            )}`}
          />

          <InfoRow
            label="Other income"
            value={`R ${formatMoney(
              application.other_income
            )}`}
          />
        </Section>

        {/* BANKING */}

        <Section title="Banking Information">
          <InfoRow
            label="Bank"
            value={
              application.bank_name || "-"
            }
          />

          <InfoRow
            label="Account number"
            value={
              application.account_number || "-"
            }
          />
        </Section>

        {/* COLLECTIONS */}

        <Section title="Collections">
          <InfoRow
            label="Preferred method"
            value={
              application.collection_preference ||
              "-"
            }
          />
        </Section>

        {/* EXISTING CUSTOMER */}

        <Section title="Existing Customer">
          {customerLoading && (
            <Alert severity="info">
              Identifying existing customer...
            </Alert>
          )}

          {customerError && (
            <Alert severity="warning">
              {customerError}
            </Alert>
          )}

          {!customerLoading &&
            !customerError &&
            !customer && (
              <Typography color="text.secondary">
                No existing customer linked.
              </Typography>
            )}

          {customer && (
            <Stack spacing={1.5}>
              <InfoRow
                label="Customer number"
                value={
                  customer.customer_number || "-"
                }
              />

              <InfoRow
                label="Name"
                value={`${customer.first_name || ""} ${
                  customer.last_name || ""
                }`}
              />

              <InfoRow
                label="Cellphone"
                value={
                  customer.cellphone || "-"
                }
              />
            </Stack>
          )}
        </Section>

        {/* IDENTIFICATION */}

        <Section title="Identification">
          <Alert severity="info">
            ID number collection is currently
            unavailable.
          </Alert>
        </Section>

        {/* NOTES */}

        <Section title="Applicant Notes">
          <Typography
            sx={{
              whiteSpace: "pre-wrap",
              lineHeight: 1.6,
            }}
          >
            {application.notes ||
              "No notes provided."}
          </Typography>
        </Section>

        {/* DOCUMENTS */}

        <Section title="Supporting Documents">
          <Alert severity="info">
            Supporting document collection is
            currently unavailable.
          </Alert>
        </Section>

        {/* LINKED RECORD INFORMATION */}

        {(application.customer_id ||
          application.loan_id) && (
          <Section title="Linked Records">
            <Stack spacing={1}>
              {application.customer_id && (
                <InfoRow
                  label="Customer record"
                  value="Customer linked to this application"
                />
              )}

              {application.loan_id && (
                <InfoRow
                  label="Loan record"
                  value="Loan linked to this application"
                />
              )}
            </Stack>
          </Section>
        )}

        {/* APPLICATION INFORMATION */}

        <Section title="Application Information">
          <InfoRow
            label="Application number"
            value={
              application.application_number || "-"
            }
          />

          <InfoRow
            label="Submitted"
            value={formatDateTime(
              application.created_at
            )}
          />

          <InfoRow
            label="Status"
            value={
              <Chip
                label={formatStatus(
                  application.status
                )}
                color={getStatusColor(
                  application.status
                )}
                size="small"
              />
            }
          />
        </Section>

        {/* MAKER CHECKER */}

        {isApplicationCreator &&
          application.status === "PENDING" && (
            <Alert
              severity="warning"
              sx={{ mb: 1.5 }}
            >
              <strong>
                Maker-checker control
              </strong>

              <br />

              You created this application.
              Another authorised user must
              approve it.
            </Alert>
          )}

        {/* APPROVED */}

        {application.status === "APPROVED" && (
          <Alert
            severity="success"
            sx={{ mb: 1.5 }}
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

        {/* REJECTED */}

        {application.status === "REJECTED" && (
          <Alert
            severity="error"
            sx={{ mb: 1.5 }}
          >
            This application has already been
            rejected.
          </Alert>
        )}
      </Box>

      {/* BOTTOM ACTION BAR */}

      <Box
        sx={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 30,
          backgroundColor: "white",
          borderTop: "1px solid",
          borderColor: "divider",
          p: 1.5,
          boxShadow:
            "0 -4px 12px rgba(0,0,0,0.08)",
        }}
      >
        <Stack
          direction="row"
          spacing={1}
        >
          <Button
            fullWidth
            variant="outlined"
            color="error"
            onClick={openRejectDialog}
            disabled={!canReject}
            sx={{
              minHeight: 52,
              fontWeight: "bold",
            }}
          >
            {rejecting
              ? "Rejecting..."
              : "Reject"}
          </Button>

          <Button
            fullWidth
            variant="contained"
            color="success"
            onClick={handleApprove}
            disabled={!canApprove}
            sx={{
              minHeight: 52,
              fontWeight: "bold",
            }}
          >
            {approving
              ? "Approving..."
              : isApplicationCreator &&
                application.status === "PENDING"
              ? "Approval Not Allowed"
              : "Approve"}
          </Button>
        </Stack>
      </Box>

      {/* REJECTION DIALOG */}

      <Dialog
        open={rejectDialogOpen}
        onClose={() => {
          if (!rejecting) {
            setRejectDialogOpen(false);
          }
        }}
        fullWidth
        fullScreen
      >
        <DialogTitle>
          Reject Application
        </DialogTitle>

        <DialogContent>
          <Typography
            color="text.secondary"
            sx={{ mb: 2 }}
          >
            Please provide a reason for rejecting
            this application.
          </Typography>

          <TextField
            fullWidth
            multiline
            minRows={8}
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

        <DialogActions
          sx={{
            p: 2,
            gap: 1,
          }}
        >
          <Button
            fullWidth
            variant="outlined"
            onClick={() => {
              if (!rejecting) {
                setRejectDialogOpen(false);
                setRejectionReason("");
              }
            }}
            disabled={rejecting}
            sx={{ minHeight: 50 }}
          >
            Cancel
          </Button>

          <Button
            fullWidth
            variant="contained"
            color="error"
            onClick={handleReject}
            disabled={
              rejecting ||
              !rejectionReason.trim()
            }
            sx={{ minHeight: 50 }}
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

function Section({ title, children }) {
  return (
    <Card sx={{ mb: 1.5 }}>
      <CardContent>
        <Typography
          variant="subtitle1"
          fontWeight="bold"
          sx={{ mb: 2 }}
        >
          {title}
        </Typography>

        <Stack spacing={1.5}>
          {children}
        </Stack>
      </CardContent>
    </Card>
  );
}

function InfoRow({ label, value }) {
  return (
    <Box>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{
          display: "block",
        }}
      >
        {label}
      </Typography>

      <Typography
        sx={{
          fontWeight: 500,
          wordBreak: "break-word",
        }}
      >
        {value || "-"}
      </Typography>
    </Box>
  );
}