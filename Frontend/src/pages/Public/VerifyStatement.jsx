import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";

import {
  Alert,
  Box,
  CircularProgress,
  Container,
  Paper,
  Stack,
  Typography,
} from "@mui/material";

export default function VerifyStatement() {
  const { token } = useParams();

  const [loading, setLoading] = useState(true);
  const [statement, setStatement] = useState(null);
  const [error, setError] = useState("");

  const [companyName, setCompanyName] = useState("Company");
  const [companyAddress, setCompanyAddress] = useState("");
  const [companyPhone, setCompanyPhone] = useState("");
  const [companyWhatsapp, setCompanyWhatsapp] = useState("");
  const [companyEmail, setCompanyEmail] = useState("");

  useEffect(() => {
    loadCompanySettings();
  }, []);

  useEffect(() => {
    verifyStatement();
  }, [token]);

  async function loadCompanySettings() {
    try {
      const { data, error } = await supabase
        .from("system_settings")
        .select(
          `
          company_name,
          company_address,
          company_phone,
          company_whatsapp,
          company_email
          `
        )
        .maybeSingle();

      if (error) {
        console.error(
          "LOAD COMPANY SETTINGS ERROR:",
          error
        );
        return;
      }

      if (data) {
        setCompanyName(data.company_name || "Company");
        setCompanyAddress(data.company_address || "");
        setCompanyPhone(data.company_phone || "");
        setCompanyWhatsapp(data.company_whatsapp || "");
        setCompanyEmail(data.company_email || "");
      }
    } catch (err) {
      console.error(
        "LOAD COMPANY SETTINGS ERROR:",
        err
      );
    }
  }

  async function verifyStatement() {
    try {
      setLoading(true);
      setError("");
      setStatement(null);

      if (!token) {
        throw new Error("Invalid verification link.");
      }

      const { data, error: rpcError } = await supabase.rpc(
        "verify_loan_statement",
        {
          p_token: token,
        }
      );

      if (rpcError) {
        console.error(
          "STATEMENT VERIFICATION ERROR:",
          rpcError
        );

        throw new Error(
          "Unable to verify this statement."
        );
      }

      if (!data || data.length === 0) {
        throw new Error(
          "This statement could not be verified. The verification link may be invalid or expired."
        );
      }

      const verifiedStatement = data[0];

      if (!verifiedStatement.statement_valid) {
        throw new Error(
          "This statement could not be authenticated."
        );
      }

      setStatement(verifiedStatement);
    } catch (err) {
      console.error(
        "VERIFY STATEMENT ERROR:",
        err
      );

      setError(
        err.message ||
          "Unable to verify this statement."
      );
    } finally {
      setLoading(false);
    }
  }

  function money(value) {
    return `R${Number(value || 0).toFixed(2)}`;
  }

  if (loading) {
    return (
      <Box
        sx={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#f5f7fa",
        }}
      >
        <Stack
          spacing={2}
          alignItems="center"
        >
          <CircularProgress />

          <Typography color="text.secondary">
            Verifying statement...
          </Typography>
        </Stack>
      </Box>
    );
  }

  if (error) {
    return (
      <Box
        sx={{
          minHeight: "100vh",
          backgroundColor: "#f5f7fa",
          py: 6,
        }}
      >
        <Container maxWidth="sm">
          <Paper
            elevation={3}
            sx={{
              p: 4,
              textAlign: "center",
              borderRadius: 2,
            }}
          >
            <Box
              sx={{
                width: 70,
                height: 70,
                borderRadius: "50%",
                backgroundColor: "#fdecec",
                color: "#c62828",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 20px",
                fontSize: 34,
                fontWeight: 700,
              }}
            >
              !
            </Box>

            <Typography
              variant="h5"
              fontWeight={700}
              gutterBottom
            >
              Statement Not Verified
            </Typography>

            <Typography
              color="text.secondary"
              sx={{ mb: 3 }}
            >
              {error}
            </Typography>

            <Typography
              variant="body2"
              color="text.secondary"
            >
              If you believe this statement should be
              valid, please contact {companyName}.
            </Typography>

            <Box sx={{ mt: 3 }}>
              <Typography
                variant="body2"
                fontWeight={600}
              >
                {companyName}
              </Typography>

              {companyPhone && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                >
                  Tel: {companyPhone}
                </Typography>
              )}

              {companyWhatsapp && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                >
                  WhatsApp: {companyWhatsapp}
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
            </Box>
          </Paper>
        </Container>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        minHeight: "100vh",
        backgroundColor: "#f5f7fa",
        py: {
          xs: 3,
          md: 6,
        },
      }}
    >
      <Container maxWidth="sm">
        <Paper
          elevation={3}
          sx={{
            overflow: "hidden",
            borderRadius: 2,
          }}
        >
          {/* HEADER */}

          <Box
            sx={{
              backgroundColor: "#17365d",
              color: "white",
              p: 3,
              textAlign: "center",
            }}
          >
            <Typography
              variant="h5"
              fontWeight={700}
            >
              {companyName}
            </Typography>
          </Box>

          {/* VERIFIED AREA */}

          <Box sx={{ p: 4 }}>
            <Box
              sx={{
                textAlign: "center",
                mb: 4,
              }}
            >
              <Box
                sx={{
                  width: 76,
                  height: 76,
                  borderRadius: "50%",
                  backgroundColor: "#e8f5e9",
                  color: "#2e7d32",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "0 auto 18px",
                  fontSize: 38,
                  fontWeight: 700,
                }}
              >
                ✓
              </Box>

              <Typography
                variant="h5"
                fontWeight={700}
                color="#2e7d32"
              >
                Statement Verified
              </Typography>

              <Typography
                color="text.secondary"
                sx={{ mt: 1 }}
              >
                This statement has been successfully
                authenticated against the {companyName}
                loan management system.
              </Typography>
            </Box>

            {/* STATEMENT DETAILS */}

            <Typography
              variant="h6"
              fontWeight={700}
              sx={{ mb: 2 }}
            >
              Statement Details
            </Typography>

            <Stack spacing={2}>
              <Detail
                label="Loan Number"
                value={statement.loan_number}
              />

              <Detail
                label="Customer"
                value={statement.customer_name}
              />

              <Detail
                label="Principal Amount"
                value={money(statement.principal_amount)}
              />

              <Detail
                label="Interest Rate"
                value={`${Number(
                  statement.interest_rate || 0
                ).toFixed(2)}%`}
              />

              <Detail
                label="Total Repayment"
                value={money(statement.total_repayment)}
              />

              <Detail
                label="Total Paid"
                value={money(statement.total_paid)}
              />

              <Detail
                label="Current Balance"
                value={money(statement.current_balance)}
              />

              <Detail
                label="Loan Status"
                value={statement.loan_status}
              />
            </Stack>

            {/* AUTHENTICITY */}

            <Alert
              severity="success"
              sx={{ mt: 4 }}
            >
              <strong>
                Authentic Statement
              </strong>

              <br />

              The information displayed above was
              retrieved directly from the {companyName}
              system using the secure statement
              verification reference.
            </Alert>

            {/* COMPANY */}

            <Box
              sx={{
                mt: 4,
                pt: 3,
                borderTop: "1px solid #e1e5eb",
                textAlign: "center",
              }}
            >
              <Typography fontWeight={700}>
                {companyName}
              </Typography>

              {companyAddress && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                >
                  {companyAddress}
                </Typography>
              )}

              {companyPhone && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                >
                  Tel: {companyPhone}
                </Typography>
              )}

              {companyWhatsapp && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                >
                  WhatsApp: {companyWhatsapp}
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
            </Box>
          </Box>
        </Paper>
      </Container>
    </Box>
  );
}

/*
 * ============================================================
 * DETAIL COMPONENT
 * ============================================================
 */

function Detail({ label, value }) {
  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: "space-between",
        gap: 2,
        p: 1.5,
        backgroundColor: "#f8fafc",
        borderRadius: 1,
      }}
    >
      <Typography
        variant="body2"
        color="text.secondary"
      >
        {label}
      </Typography>

      <Typography
        variant="body2"
        fontWeight={600}
        textAlign="right"
      >
        {value || "-"}
      </Typography>
    </Box>
  );
}
