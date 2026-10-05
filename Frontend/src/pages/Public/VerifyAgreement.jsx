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

  const [companyName, setCompanyName] = useState("Company");
  const [companyRegistration, setCompanyRegistration] = useState("");
  const [companyAddress, setCompanyAddress] = useState("");
  const [companyPhone, setCompanyPhone] = useState("");
  const [companyWhatsapp, setCompanyWhatsapp] = useState("");
  const [companyEmail, setCompanyEmail] = useState("");

  useEffect(() => {
    loadCompanySettings();
  }, []);

  useEffect(() => {
    verifyAgreement();
  }, [token]);

  async function loadCompanySettings() {
    try {
      const { data, error } = await supabase
        .from("system_settings")
        .select(
          `
          company_name,
          company_registration_number,
          company_address,
          company_phone,
          company_whatsapp,
          company_email
          `
        )
        .maybeSingle();

      if (error) {
        console.error("LOAD COMPANY SETTINGS ERROR:", error);
        return;
      }

      if (data) {
        setCompanyName(data.company_name || "Company");
        setCompanyRegistration(
          data.company_registration_number || ""
        );
        setCompanyAddress(data.company_address || "");
        setCompanyPhone(data.company_phone || "");
        setCompanyWhatsapp(data.company_whatsapp || "");
        setCompanyEmail(data.company_email || "");
      }
    } catch (err) {
      console.error("LOAD COMPANY SETTINGS ERROR:", err);
    }
  }

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
            If you believe this is an error, please contact{" "}
            {companyName}.
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
            {companyName}
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
          This agreement has been successfully verified as an{" "}
          {companyName} agreement.
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
            {companyName}
          </Typography>

          {companyRegistration && (
            <Typography
              variant="body2"
              color="text.secondary"
            >
              Registration Number: {companyRegistration}
            </Typography>
          )}

          {companyAddress && (
            <Typography
              variant="body2"
              color="text.secondary"
            >
              {companyAddress}
            </Typography>
          )}

          {(companyPhone || companyWhatsapp) && (
            <Typography
              variant="body2"
              color="text.secondary"
            >
              {companyPhone && `Tel: ${companyPhone}`}
              {companyPhone && companyWhatsapp && " | "}
              {companyWhatsapp &&
                `WhatsApp: ${companyWhatsapp}`}
            </Typography>
          )}

          {companyEmail && (
            <Typography
              variant="body2"
              color="text.secondary"
            >
              {companyEmail}
            </Typography>
          )}

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
