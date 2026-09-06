import { useState } from "react";
import {
  Box,
  Button,
  Paper,
  Typography,
  Alert,
  CircularProgress,
} from "@mui/material";

import { sendLoanEmail } from "../services/emailService";

export default function TestEmail() {
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function handleSendTest() {
    setSending(true);
    setMessage("");
    setError("");

    try {
      const result = await sendLoanEmail({
        notificationType: "PENDING_REVIEW",

        recipientEmail: "smndlamini@gmail.com",

        recipientName: "Administrator",

        applicationNumber: "TEST-000001",

        clientName: "Test Client",

        amountRequested: 5000,
      });

      console.log("Brevo test result:", result);

      setMessage(
        "Test email sent successfully. Check smndlamini@gmail.com."
      );
    } catch (err) {
      console.error("Brevo test failed:", err);

      setError(
        err?.message ||
          "The test email could not be sent."
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <Box sx={{ p: 3 }}>
      <Paper
        elevation={3}
        sx={{
          maxWidth: 600,
          mx: "auto",
          p: 4,
        }}
      >
        <Typography
          variant="h5"
          fontWeight="bold"
          gutterBottom
        >
          Brevo Email Test
        </Typography>

        <Typography
          variant="body1"
          color="text.secondary"
          sx={{ mb: 3 }}
        >
          This will send a test pending-review email to:
        </Typography>

        <Typography
          variant="body1"
          fontWeight="bold"
          sx={{ mb: 3 }}
        >
          smndlamini@gmail.com
        </Typography>

        {message && (
          <Alert
            severity="success"
            sx={{ mb: 3 }}
          >
            {message}
          </Alert>
        )}

        {error && (
          <Alert
            severity="error"
            sx={{ mb: 3 }}
          >
            {error}
          </Alert>
        )}

        <Button
          variant="contained"
          fullWidth
          onClick={handleSendTest}
          disabled={sending}
        >
          {sending ? (
            <>
              <CircularProgress
                size={20}
                sx={{ mr: 1 }}
              />
              Sending...
            </>
          ) : (
            "Send Test Email"
          )}
        </Button>
      </Paper>
    </Box>
  );
}