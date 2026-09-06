import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Alert,
  Box,
  CircularProgress,
  Divider,
  Paper,
  Typography,
} from "@mui/material";
import { supabase } from "../../lib/supabase";

export default function VerifyAgreement() {
  const { token } = useParams();

  const [agreement, setAgreement] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    verifyAgreement();
  }, [token]);

  async function verifyAgreement() {
    try {
      setLoading(true);
      setError("");

      const { data, error } = await supabase.rpc(
        "verify_loan_agreement",
        {
          p_token: token,
        }
      );

      if (error) {
        throw error;
      }

      if (!data || data.length === 0) {
        setError(
          "This agreement could not be verified. The verification link may be invalid."
        );
        return;
      }

      setAgreement(data[0]);
    } catch (err) {
      console.error("VERIFY AGREEMENT ERROR:", err);
      setError(
        err?.message || "Unable to verify this agreement."
      );
    } finally {
      setLoading(false);
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
          backgroundColor: "#f4f6f8",
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  if (error || !agreement) {
    return (
      <Box
        sx={{
          minHeight: "100vh",
          backgroundColor: "#f4f6f8",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          p: 3,
        }}
      >
        <Paper
          elevation={4}
          sx={{
            maxWidth: 650,
            width: "100%",
            p: 5,
            borderRadius: 3,
            textAlign: "center",
          }}
        >
          <Typography
            variant="h4"
            sx={{
              fontWeight: 800,
              color: "#b42318",
              mb: 3,
            }}
          >
            Agreement Not Verified
          </Typography>

          <Alert severity="error">
            {error || "Agreement not found."}
          </Alert>

          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: 3 }}
          >
            If you believe this is an error, please contact
            Umhlomunye Finance.
          </Typography>
        </Paper>
      </Box>
    );
  }

  const principal = Number(
    agreement.principal_amount || 0
  );

  const interestAmount = Number(
    agreement.interest_amount || 0
  );

  const totalRepayment = Number(
    agreement.total_repayment || 0
  );

  const interestRate = Number(
    agreement.interest_rate || 0
  );

  return (
    <Box
      sx={{
        minHeight: "100vh",
        backgroundColor: "#f4f6f8",
        py: 4,
        px: 2,
      }}
    >
      <Paper
        elevation={4}
        sx={{
          maxWidth: 750,
          mx: "auto",
          p: {
            xs: 3,
            sm: 5,
          },
          borderRadius: 3,
        }}
      >
        {/* HEADER */}

        <Box
          sx={{
            textAlign: "center",
            mb: 3,
          }}
        >
          <Typography
            variant="h4"
            sx={{
              fontWeight: 800,
              color: "#12355b",
            }}
          >
            UMHLOMUNYE FINANCE
          </Typography>

          <Typography
            sx={{
              fontStyle: "italic",
              color: "text.secondary",
              mt: 0.5,
            }}
          >
            Our dreams, Our hope
          </Typography>

          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: 1 }}
          >
            Agreement Verification
          </Typography>
        </Box>

        <Divider sx={{ mb: 4 }} />

        {/* VERIFIED STATUS */}

        <Alert
          severity="success"
          sx={{
            mb: 4,
            fontWeight: 600,
          }}
        >
          This agreement has been successfully verified as an
          Umhlomunye Finance agreement.
        </Alert>

        {/* AGREEMENT DETAILS */}

        <Typography
          variant="h6"
          sx={{
            fontWeight: 800,
            color: "#12355b",
            mb: 2,
          }}
        >
          Agreement Information
        </Typography>

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "1fr",
              sm: "1fr 1fr",
            },
            gap: 2,
            mb: 4,
          }}
        >
          <Box>
            <Typography
              variant="body2"
              color="text.secondary"
            >
              Agreement Number
            </Typography>

            <Typography sx={{ fontWeight: 700 }}>
              {agreement.agreement_number}
            </Typography>
          </Box>

          <Box>
            <Typography
              variant="body2"
              color="text.secondary"
            >
              Loan Number
            </Typography>

            <Typography sx={{ fontWeight: 700 }}>
              {agreement.loan_number || "N/A"}
            </Typography>
          </Box>

          <Box>
            <Typography
              variant="body2"
              color="text.secondary"
            >
              Customer
            </Typography>

            <Typography sx={{ fontWeight: 700 }}>
              {agreement.customer_name || "N/A"}
            </Typography>
          </Box>

          <Box>
            <Typography
              variant="body2"
              color="text.secondary"
            >
              Agreement Status
            </Typography>

            <Typography sx={{ fontWeight: 700 }}>
              {agreement.agreement_status || "N/A"}
            </Typography>
          </Box>
        </Box>

        {/* LOAN DETAILS */}

        <Typography
          variant="h6"
          sx={{
            fontWeight: 800,
            color: "#12355b",
            mb: 2,
          }}
        >
          Loan Information
        </Typography>

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "1fr",
              sm: "1fr 1fr",
            },
            gap: 2,
            mb: 4,
          }}
        >
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography
              variant="body2"
              color="text.secondary"
            >
              Principal Amount
            </Typography>

            <Typography
              variant="h6"
              sx={{ fontWeight: 700 }}
            >
              R{principal.toFixed(2)}
            </Typography>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography
              variant="body2"
              color="text.secondary"
            >
              Interest Rate
            </Typography>

            <Typography
              variant="h6"
              sx={{ fontWeight: 700 }}
            >
              {interestRate.toFixed(2)}%
            </Typography>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography
              variant="body2"
              color="text.secondary"
            >
              Interest Amount
            </Typography>

            <Typography
              variant="h6"
              sx={{ fontWeight: 700 }}
            >
              R{interestAmount.toFixed(2)}
            </Typography>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography
              variant="body2"
              color="text.secondary"
            >
              Total Repayment
            </Typography>

            <Typography
              variant="h6"
              sx={{ fontWeight: 700 }}
            >
              R{totalRepayment.toFixed(2)}
            </Typography>
          </Paper>
        </Box>

        {/* ACCEPTANCE */}

        <Typography
          variant="h6"
          sx={{
            fontWeight: 800,
            color: "#12355b",
            mb: 2,
          }}
        >
          Agreement Acceptance
        </Typography>

        <Box
          sx={{
            backgroundColor: "#f8fafc",
            borderRadius: 2,
            p: 3,
            mb: 4,
          }}
        >
          <Typography
            variant="body2"
            color="text.secondary"
          >
            Acceptance Date
          </Typography>

          <Typography
            sx={{
              fontWeight: 700,
              mt: 0.5,
            }}
          >
            {agreement.accepted_at
              ? new Date(
                  agreement.accepted_at
                ).toLocaleString("en-ZA")
              : "Not yet accepted"}
          </Typography>
        </Box>

        {/* COMPANY DETAILS */}

        <Divider sx={{ mb: 3 }} />

        <Box sx={{ textAlign: "center" }}>
          <Typography
            sx={{
              fontWeight: 800,
              color: "#12355b",
            }}
          >
            UMHLOMUNYE FINANCE
          </Typography>

          <Typography
            variant="body2"
            color="text.secondary"
          >
            Registration Number: 2020/191721/07
          </Typography>

          <Typography
            variant="body2"
            color="text.secondary"
          >
            20 Jacaranda Street, Kinross, 2270
          </Typography>

          <Typography
            variant="body2"
            color="text.secondary"
          >
            Tel: 078 078 3879 | WhatsApp: 060 508 6672
          </Typography>

          <Typography
            variant="body2"
            color="text.secondary"
          >
            umhlomunyeb@gmail.com
          </Typography>

          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              display: "block",
              mt: 2,
            }}
          >
            This page is provided to assist with verification of
            the authenticity of the agreement.
          </Typography>
        </Box>
      </Paper>
    </Box>
  );
}