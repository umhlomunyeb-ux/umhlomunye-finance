import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Divider,
  FormControlLabel,
  Paper,
  TextField,
  Typography,
} from "@mui/material";
import QRCode from "qrcode";
import { supabase } from "../../lib/supabase";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const acceptanceText =
  "I have read, understood and agree to the terms and conditions of this loan agreement.";

  const generateSignedAgreementPdf = async (agreement, acceptance) => {
  const doc = new jsPDF("p", "mm", "a4");

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const margin = 18;
  const contentWidth = pageWidth - margin * 2;

  const verificationUrl =
    `${window.location.origin}/verify-agreement/` +
    agreement.verification_token;

  const qrCode = await QRCode.toDataURL(verificationUrl, {
    width: 220,
    margin: 1,
    errorCorrectionLevel: "H",
  });

  // ---------------------------------------------------------
  // HEADER
  // ---------------------------------------------------------

  doc.setFillColor(15, 39, 71);
  doc.rect(0, 0, pageWidth, 30, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);

  doc.text("UMHLOMUNYE FINANCE", margin, 12);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);

  doc.text(
    "Our dreams, Our hope",
    margin,
    18
  );

  doc.setFontSize(7);

  doc.text(
    "Reg. No. 2020/191721/07",
    margin,
    23
  );

  doc.text(
    "20 Jacaranda Street, Kinross, 2270",
    margin + 38,
    23
  );

  doc.text(
    "Tel: 078 078 3879 | WhatsApp: 060 508 6672",
    margin,
    27
  );

  doc.text(
    "Email: umhlomunyeb@gmail.com",
    margin + 80,
    27
  );

  // ---------------------------------------------------------
  // QR CODE - TOP RIGHT
  // ---------------------------------------------------------

  doc.addImage(
    qrCode,
    "PNG",
    pageWidth - margin - 30,
    34,
    30,
    30
  );

  doc.setTextColor(15, 39, 71);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);

  doc.text(
    "VERIFY AGREEMENT",
    pageWidth - margin - 30,
    67
  );

  // ---------------------------------------------------------
  // TITLE
  // ---------------------------------------------------------

  doc.setTextColor(15, 39, 71);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);

  doc.text(
    "LOAN AGREEMENT",
    margin,
    48
  );

  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(80, 80, 80);

  doc.text(
    "Official electronically accepted agreement",
    margin,
    54
  );

  // ---------------------------------------------------------
  // AGREEMENT INFORMATION
  // ---------------------------------------------------------

  autoTable(doc, {
    startY: 72,
    margin: {
      left: margin,
      right: margin,
    },
    theme: "grid",
    head: [
      [
        "Agreement Number",
        "Loan Number",
        "Agreement Version",
      ],
    ],
    body: [
      [
        agreement.agreement_number || "-",
        agreement.loan_number || "-",
        agreement.agreement_version || "-",
      ],
    ],
    styles: {
      fontSize: 8,
      cellPadding: 4,
    },
    headStyles: {
      fillColor: [15, 39, 71],
      textColor: 255,
      fontStyle: "bold",
    },
  });

  // ---------------------------------------------------------
  // CUSTOMER
  // ---------------------------------------------------------

  let y = doc.lastAutoTable.finalY + 10;

  doc.setTextColor(15, 39, 71);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);

  doc.text("CUSTOMER DETAILS", margin, y);

  y += 6;

  autoTable(doc, {
    startY: y,
    margin: {
      left: margin,
      right: margin,
    },
    theme: "grid",
    body: [
      ["Customer Name", agreement.customer_name || "-"],
      ["Loan Number", agreement.loan_number || "-"],
      ["Agreement Number", agreement.agreement_number || "-"],
    ],
    styles: {
      fontSize: 8,
      cellPadding: 4,
    },
    columnStyles: {
      0: {
        fontStyle: "bold",
        cellWidth: 55,
      },
      1: {
        cellWidth: contentWidth - 55,
      },
    },
  });

  // ---------------------------------------------------------
  // LOAN DETAILS
  // ---------------------------------------------------------

  y = doc.lastAutoTable.finalY + 10;

  doc.setTextColor(15, 39, 71);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);

  doc.text("LOAN DETAILS", margin, y);

  y += 6;

  const money = (value) =>
    `R${Number(value || 0).toFixed(2)}`;

  autoTable(doc, {
    startY: y,
    margin: {
      left: margin,
      right: margin,
    },
    theme: "grid",
    body: [
      [
        "Principal Amount",
        money(agreement.principal_amount),
      ],
      [
        "Interest Rate",
        `${Number(agreement.interest_rate || 0).toFixed(2)}%`,
      ],
      [
        "Interest Amount",
        money(agreement.interest_amount),
      ],
      [
        "Total Repayment",
        money(agreement.total_repayment),
      ],
      [
        "Current Balance",
        money(agreement.current_balance),
      ],
      [
        "First Payment Date",
        agreement.first_payment_date || "-",
      ],
      [
        "Next Payment Date",
        agreement.next_payment_date || "-",
      ],
    ],
    styles: {
      fontSize: 8,
      cellPadding: 4,
    },
    columnStyles: {
      0: {
        fontStyle: "bold",
        cellWidth: 55,
      },
      1: {
        cellWidth: contentWidth - 55,
      },
    },
  });

  // ---------------------------------------------------------
  // TERMS AND CONDITIONS
  // ---------------------------------------------------------

  y = doc.lastAutoTable.finalY + 12;

  doc.setTextColor(15, 39, 71);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);

  doc.text("TERMS AND CONDITIONS", margin, y);

  y += 7;

  const terms = [
    [
      "1.",
      "Loan Agreement",
      "This agreement records the terms governing the loan advanced by Umhlomunye Finance to the customer."
    ],
    [
      "2.",
      "Principal Amount",
      "The principal amount is the amount advanced to the customer as recorded in the loan details above."
    ],
    [
      "3.",
      "Interest",
      "Interest is charged at the rate stated in this agreement and forms part of the customer's repayment obligation."
    ],
    [
      "4.",
      "Repayment",
      "The customer agrees to repay the amount due according to the applicable repayment schedule."
    ],
    [
      "5.",
      "Payment Dates",
      "The customer is responsible for making payments on or before the applicable payment dates."
    ],
    [
      "6.",
      "Payment Allocation",
      "Payments received may be allocated against amounts due in accordance with the lender's applicable repayment rules."
    ],
    [
      "7.",
      "Outstanding Balance",
      "The outstanding balance may change following payments, interest calculations and other applicable charges."
    ],
    [
      "8.",
      "Early Payment",
      "The customer may make payment before the scheduled payment date, subject to the applicable terms."
    ],
    [
      "9.",
      "Default",
      "Failure to meet repayment obligations may result in the account being treated as overdue."
    ],
    [
      "10.",
      "Customer Information",
      "The customer confirms that information supplied in connection with this loan is accurate and complete."
    ],
    [
      "11.",
      "Communication",
      "The customer agrees that the lender may communicate regarding the loan using the contact information supplied."
    ],
    [
      "12.",
      "Electronic Agreement",
      "This agreement may be accepted electronically and electronic acceptance constitutes confirmation of the customer's agreement to these terms."
    ],
    [
      "13.",
      "Digital Signature",
      "The customer's electronic acceptance is recorded as a digital signature reference together with the acceptance date and time."
    ],
    [
      "14.",
      "Electronic Records",
      "Electronic records maintained by the lender may be used as evidence of the agreement and acceptance."
    ],
    [
      "15.",
      "Verification",
      "The authenticity of this agreement may be checked using the verification QR code or verification facility provided by Umhlomunye Finance."
    ],
    [
      "16.",
      "Agreement Documents",
      "The electronically accepted agreement may be stored electronically as an official loan document."
    ],
    [
      "17.",
      "Customer Responsibility",
      "The customer remains responsible for complying with the repayment obligations contained in this agreement."
    ],
    [
      "18.",
      "Changes",
      "Any changes to the contractual terms must be recorded through an authorised process."
    ],
    [
      "19.",
      "Notices",
      "Important notices relating to the loan may be provided using the customer's registered contact details."
    ],
    [
      "20.",
      "Confidentiality",
      "Information relating to the customer's loan will be handled in accordance with applicable requirements."
    ],
    [
      "21.",
      "Applicable Law",
      "This agreement is subject to applicable laws and regulatory requirements governing the lending relationship."
    ],
    [
      "22.",
      "Customer Confirmation",
      "The customer confirms that they have had an opportunity to review the agreement before accepting it."
    ],
    [
      "23.",
      "Acceptance",
      "By electronically accepting this agreement, the customer confirms that they agree to the terms contained in this document."
    ],
    [
      "24.",
      "Entire Agreement",
      "This document records the loan agreement accepted electronically by the customer."
    ],
  ];

  autoTable(doc, {
    startY: y,
    margin: {
      left: margin,
      right: margin,
      bottom: 25,
    },
    theme: "grid",
    body: terms,
    styles: {
      fontSize: 7.5,
      cellPadding: 3,
      valign: "top",
      overflow: "linebreak",
    },
    columnStyles: {
      0: {
        cellWidth: 10,
        fontStyle: "bold",
      },
      1: {
        cellWidth: 38,
        fontStyle: "bold",
      },
      2: {
        cellWidth: contentWidth - 48,
      },
    },
  });

  // ---------------------------------------------------------
  // ELECTRONIC ACCEPTANCE
  // ---------------------------------------------------------

  y = doc.lastAutoTable.finalY + 12;

  if (y > pageHeight - 85) {
    doc.addPage();
    y = 25;
  }

  doc.setTextColor(15, 39, 71);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);

  doc.text(
    "ELECTRONIC ACCEPTANCE RECORD",
    margin,
    y
  );

  y += 7;

  const acceptedAt = acceptance.accepted_at
    ? new Date(acceptance.accepted_at).toLocaleString("en-ZA")
    : "-";

  autoTable(doc, {
    startY: y,
    margin: {
      left: margin,
      right: margin,
    },
    theme: "grid",
    body: [
      [
        "Customer Name",
        acceptance.customer_name_at_acceptance || "-"
      ],
      [
        "Acceptance Date & Time",
        acceptedAt
      ],
      [
        "Digital Signature Reference",
        acceptance.digital_signature_reference || "-"
      ],
      [
        "Acceptance",
        "Electronically accepted"
      ],
      [
        "Acceptance Statement",
        acceptance.acceptance_text || "-"
      ],
    ],
    styles: {
      fontSize: 8,
      cellPadding: 4,
      valign: "top",
    },
    columnStyles: {
      0: {
        fontStyle: "bold",
        cellWidth: 60,
      },
      1: {
        cellWidth: contentWidth - 60,
      },
    },
  });

  // ---------------------------------------------------------
  // AUTHENTICITY
  // ---------------------------------------------------------

  y = doc.lastAutoTable.finalY + 10;

  if (y > pageHeight - 70) {
    doc.addPage();
    y = 25;
  }

  doc.setTextColor(15, 39, 71);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);

  doc.text(
    "AUTHENTICITY VERIFICATION",
    margin,
    y
  );

  y += 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(70, 70, 70);

  doc.text(
    "Scan the QR code to verify the authenticity of this agreement.",
    margin,
    y
  );

  doc.addImage(
    qrCode,
    "PNG",
    pageWidth - margin - 35,
    y + 5,
    35,
    35
  );

  doc.setFontSize(7);

  const verificationLines = doc.splitTextToSize(
    verificationUrl,
    contentWidth - 45
  );

  doc.text(
    verificationLines,
    margin,
    y + 12
  );

  // ---------------------------------------------------------
  // FOOTER
  // ---------------------------------------------------------

  const totalPages = doc.getNumberOfPages();

  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);

    doc.setDrawColor(200, 200, 200);

    doc.line(
      margin,
      pageHeight - 14,
      pageWidth - margin,
      pageHeight - 14
    );

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(100, 100, 100);

    doc.text(
      "UMHLOMUNYE FINANCE • Official Loan Agreement",
      margin,
      pageHeight - 8
    );

    doc.text(
      `Page ${i} of ${totalPages}`,
      pageWidth - margin,
      pageHeight - 8,
      { align: "right" }
    );
  }

  return doc.output("blob");
};

export default function SignAgreement() {
  const { token } = useParams();

  const [agreement, setAgreement] = useState(null);
  const [customerName, setCustomerName] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [qrCode, setQrCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    loadAgreement();
  }, [token]);

  async function loadAgreement() {
    try {
      setLoading(true);
      setError("");

      const { data, error } = await supabase.rpc(
        "get_agreement_for_signing",
        {
          p_signing_token: token,
        }
      );

      if (error) {
        throw error;
      }

      if (!data || data.length === 0) {
        setError("This agreement link is invalid or has expired.");
        return;
      }

      const agreementData = data[0];

      setAgreement(agreementData);

      const fullCustomerName =
        agreementData.customer_name ||
        `${agreementData.first_name || ""} ${
          agreementData.last_name || ""
        }`.trim();

      setCustomerName(fullCustomerName);

      /*
       * QR CODE
       *
       * The QR contains the secure agreement link.
       * When the system is deployed, window.location.origin
       * will automatically become the public Umhlomunye Finance URL.
       */
      const agreementUrl =
        `${window.location.origin}/verify-agreement/` +
        agreementData.verification_token;

      const qrDataUrl = await QRCode.toDataURL(agreementUrl, {
        width: 220,
        margin: 1,
        errorCorrectionLevel: "H",
      });

      setQrCode(qrDataUrl);
    } catch (err) {
      console.error("LOAD AGREEMENT ERROR:", err);
      setError(
        err?.message || "Unable to load the loan agreement."
      );
    } finally {
      setLoading(false);
    }
  }

  const handleAccept = async () => {
    if (!customerName.trim()) {
      setError("Please enter your full name.");
      return;
    }

    if (!accepted) {
      setError(
        "Please tick the agreement checkbox before submitting."
      );
      return;
    }

    try {
      setSubmitting(true);
      setError("");

      // -------------------------------------------------------
      // 1. RECORD CUSTOMER ACCEPTANCE
      // -------------------------------------------------------

      const { data: agreementId, error: acceptError } =
        await supabase.rpc(
          "accept_loan_agreement",
          {
            p_signing_token: token,
            p_customer_name: customerName.trim(),
            p_acceptance_text: acceptanceText,
            p_ip_address: null,
            p_user_agent: navigator.userAgent,
          }
        );

      if (acceptError) {
        throw acceptError;
      }

      if (!agreementId) {
        throw new Error(
          "The agreement was accepted, but no agreement ID was returned."
        );
      }

      // -------------------------------------------------------
      // 2. LOAD THE SIGNED AGREEMENT
      // -------------------------------------------------------

      const { data: signedAgreement, error: signedError } =
        await supabase
          .from("loan_agreements")
          .select(`
            id,
            loan_id,
            customer_id,
            agreement_number,
            agreement_version,
            status,
            generated_at,
            accepted_at,
            digital_signature_reference,
            acceptance_text,
            customer_name_at_acceptance,
            verification_token
          `)
          .eq("id", agreementId)
          .single();

      if (signedError) {
        throw signedError;
      }

      if (!signedAgreement) {
        throw new Error(
          "Unable to retrieve the accepted agreement."
        );
      }

      // -------------------------------------------------------
      // 3. LOAD LOAN + CUSTOMER INFORMATION
      // -------------------------------------------------------

      const { data: loanData, error: loanError } =
        await supabase
          .from("loans")
          .select(`
            loan_number,
            principal_amount,
            interest_rate,
            interest_amount,
            total_repayment,
            current_balance,
            first_payment_date,
            next_payment_date
          `)
          .eq("id", signedAgreement.loan_id)
          .single();

      if (loanError) {
        throw loanError;
      }

      const agreementForPdf = {
        ...signedAgreement,
        ...loanData,
        customer_name:
          signedAgreement.customer_name_at_acceptance ||
          customerName.trim(),
      };

      // -------------------------------------------------------
      // 4. GENERATE THE OFFICIAL SIGNED PDF
      // -------------------------------------------------------

      const pdfBlob = await generateSignedAgreementPdf(
        agreementForPdf,
        signedAgreement
      );

      // -------------------------------------------------------
      // 5. SEND SIGNED PDF TO SECURE EDGE FUNCTION
      // -------------------------------------------------------

      if (!(pdfBlob instanceof Blob)) {
        throw new Error(
          "The signed agreement PDF could not be generated."
        );
      }

      if (!signedAgreement.verification_token) {
        throw new Error(
          "The accepted agreement does not have a verification token."
        );
      }

      const { data: agreementWithToken, error: tokenError } =
        await supabase
          .from("loan_agreements")
          .select(`
            id,
            signing_token,
            agreement_number,
            document_path
          `)
          .eq("id", signedAgreement.id)
          .single();

      if (tokenError) {
        throw tokenError;
      }

      if (!agreementWithToken?.signing_token) {
        throw new Error(
          "The accepted agreement does not have a valid signing token."
        );
      }

      // -------------------------------------------------------
      // 6. PREPARE PDF FOR SECURE SERVER-SIDE STORAGE
      // -------------------------------------------------------

      const formData = new FormData();

      formData.append(
        "agreement_id",
        signedAgreement.id
      );

      formData.append(
        "signing_token",
        agreementWithToken.signing_token
      );

      formData.append(
        "pdf",
        pdfBlob,
        `${signedAgreement.agreement_number}-signed.pdf`
      );

      // -------------------------------------------------------
      // 7. CALL SECURE EDGE FUNCTION
      // -------------------------------------------------------

      const {
        data: functionData,
        error: functionError,
      } =
        await supabase.functions.invoke(
          "create-signed-agreement-document",
          {
            body: formData,
          }
        );

      if (functionError) {
        console.error(
          "Signed agreement document function error:",
          functionError
        );

        let functionMessage = functionError.message;

        try {
          if (functionError.context) {
            const responseBody = await functionError.context.json();

            console.error(
              "Signed agreement Edge Function response:",
              responseBody
            );

            if (responseBody?.error) {
              functionMessage = responseBody.error;
            }
          }
        } catch (parseError) {
          console.error(
            "Could not read Edge Function error response:",
            parseError
          );
        }

        throw new Error(functionMessage);
      }

      if (!functionData?.success) {
        throw new Error(
          functionData?.error ||
            "The official signed document could not be stored."
        );
      }

      if (!functionData.document_path) {
        throw new Error(
          "The agreement was accepted, but no document path was returned."
        );
      }

      console.log(
        "Official signed agreement stored successfully:",
        functionData.document_path
      );

      // -------------------------------------------------------
      // 8. EVERYTHING SUCCESSFUL
      // -------------------------------------------------------

      setSuccess(true);

      // -------------------------------------------------------
      // 9. EVERYTHING SUCCESSFUL
      // -------------------------------------------------------

      setSuccess(true);

    } catch (err) {
      console.error(
        "Agreement acceptance/storage error:",
        err
      );

      setError(
        err?.message ||
          "The agreement was accepted, but we could not complete the document storage process."
      );
    } finally {
      setSubmitting(false);
    }
  };

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

  if (success) {
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
            textAlign: "center",
            borderRadius: 3,
          }}
        >
          <Typography
            variant="h4"
            sx={{
              fontWeight: 700,
              color: "#12355b",
              mb: 2,
            }}
          >
            Agreement Accepted
          </Typography>

          <Typography
            variant="h6"
            sx={{
              fontWeight: 600,
              mb: 2,
            }}
          >
            Congratulations!
          </Typography>

          <Typography sx={{ mb: 3 }}>
            Your loan agreement has been successfully accepted
            electronically.
          </Typography>

          {agreement?.agreement_number && (
            <Alert severity="success" sx={{ mb: 3 }}>
              Agreement Number:{" "}
              <strong>{agreement.agreement_number}</strong>
            </Alert>
          )}

          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mb: 3 }}
          >
            Your electronic acceptance has been recorded together
            with the acceptance date and time.
          </Typography>

          <Button
            variant="contained"
            onClick={() => {
                window.location.href = "/";
            }}
            sx={{
                backgroundColor: "#12355b",
                px: 5,
                py: 1.2,
                fontWeight: 700,
                "&:hover": {
                backgroundColor: "#0d2945",
                },
            }}
          >
            Close
          </Button>

          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: 3 }}
          >
            Thank you for choosing Umhlomunye Finance.
          </Typography>
        </Paper>
      </Box>
    );
  }

  if (!agreement) {
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
          elevation={3}
          sx={{
            maxWidth: 600,
            width: "100%",
            p: 4,
            borderRadius: 3,
          }}
        >
          <Alert severity="error">
            {error || "Agreement not found."}
          </Alert>
        </Paper>
      </Box>
    );
  }

  const principal = Number(
    agreement.principal_amount || 0
  );

  const interestRate = Number(
    agreement.interest_rate || 0
  );

  const interestAmount = Number(
    agreement.interest_amount || 0
  );

  const totalRepayment = Number(
    agreement.total_repayment || 0
  );

  const loanNumber =
    agreement.loan_number || "N/A";

  const agreementNumber =
    agreement.agreement_number || "N/A";

  return (
    <Box
      sx={{
        minHeight: "100vh",
        backgroundColor: "#eef1f5",
        py: 4,
        px: 2,
      }}
    >
      <Paper
        elevation={4}
        sx={{
          maxWidth: 950,
          mx: "auto",
          p: {
            xs: 2,
            sm: 4,
            md: 6,
          },
          borderRadius: 2,
        }}
      >
        {/* =====================================================
            HEADER
        ====================================================== */}

        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 3,
            mb: 4,
          }}
        >
          <Box sx={{ flex: 1 }}>
            <Box
              sx={{
                width: 180,
                height: 70,
                border: "1px solid #d5dbe1",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                mb: 2,
                backgroundColor: "#fff",
              }}
            >
              <Typography
                sx={{
                  fontWeight: 800,
                  color: "#12355b",
                  fontSize: 18,
                  textAlign: "center",
                }}
              >
                UMHLOMUNYE
                <br />
                FINANCE
              </Typography>
            </Box>

            <Typography
              variant="h4"
              sx={{
                fontWeight: 800,
                color: "#12355b",
                letterSpacing: 0.5,
              }}
            >
              LOAN AGREEMENT
            </Typography>

            <Typography
              sx={{
                color: "#667085",
                mt: 0.5,
                fontStyle: "italic",
              }}
            >
              Our dreams, Our hope
            </Typography>

            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ mt: 2 }}
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
              Email: umhlomunyeb@gmail.com
            </Typography>
          </Box>

          {/* =================================================
              QR CODE
          ================================================== */}

          <Box
            sx={{
              width: 150,
              minWidth: 150,
              textAlign: "center",
            }}
          >
            {qrCode && (
              <Box
                component="img"
                src={qrCode}
                alt="Agreement QR Code"
                sx={{
                  width: 130,
                  height: 130,
                  display: "block",
                  mx: "auto",
                }}
              />
            )}

            <Typography
              variant="caption"
              sx={{
                display: "block",
                mt: 1,
                fontWeight: 700,
                color: "#12355b",
              }}
            >
              VERIFY AGREEMENT
            </Typography>

            <Typography
              variant="caption"
              color="text.secondary"
            >
              Scan this QR code to access this secure agreement.
            </Typography>
          </Box>
        </Box>

        <Divider sx={{ mb: 4 }} />

        {/* =====================================================
            AGREEMENT IDENTIFICATION
        ====================================================== */}

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

            <Typography
              sx={{
                fontWeight: 700,
                fontSize: 17,
              }}
            >
              {agreementNumber}
            </Typography>
          </Box>

          <Box>
            <Typography
              variant="body2"
              color="text.secondary"
            >
              Loan Number
            </Typography>

            <Typography
              sx={{
                fontWeight: 700,
                fontSize: 17,
              }}
            >
              {loanNumber}
            </Typography>
          </Box>

          <Box>
            <Typography
              variant="body2"
              color="text.secondary"
            >
              Customer
            </Typography>

            <Typography
              sx={{
                fontWeight: 700,
                fontSize: 17,
              }}
            >
              {customerName || "N/A"}
            </Typography>
          </Box>

          <Box>
            <Typography
              variant="body2"
              color="text.secondary"
            >
              Agreement Version
            </Typography>

            <Typography
              sx={{
                fontWeight: 700,
                fontSize: 17,
              }}
            >
              {agreement.version || "1.0"}
            </Typography>
          </Box>
        </Box>

        {/* =====================================================
            LOAN DETAILS
        ====================================================== */}

        <Typography
          variant="h6"
          sx={{
            fontWeight: 800,
            color: "#12355b",
            mb: 2,
          }}
        >
          1. Loan Details
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
          <Paper
            variant="outlined"
            sx={{ p: 2 }}
          >
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

          <Paper
            variant="outlined"
            sx={{ p: 2 }}
          >
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

          <Paper
            variant="outlined"
            sx={{ p: 2 }}
          >
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

          <Paper
            variant="outlined"
            sx={{ p: 2 }}
          >
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

        {/* =====================================================
            AGREEMENT TERMS
        ====================================================== */}

        <Typography
          variant="h6"
          sx={{
            fontWeight: 800,
            color: "#12355b",
            mb: 2,
          }}
        >
          2. Terms and Conditions
        </Typography>

        <Box sx={{ mb: 4 }}>
          <Typography paragraph>
            <strong>2.1 Loan Advance.</strong> Umhlomunye Finance
            agrees to advance the principal amount stated in this
            agreement to the customer, subject to the terms and
            conditions contained herein.
          </Typography>

          <Typography paragraph>
            <strong>2.2 Interest.</strong> Interest will be charged
            at the rate stated in this agreement and will be
            calculated in accordance with the applicable loan
            product and system rules.
          </Typography>

          <Typography paragraph>
            <strong>2.3 Repayment.</strong> The customer agrees to
            repay the total amount due according to the agreed
            repayment schedule.
          </Typography>

          <Typography paragraph>
            <strong>2.4 Payment Dates.</strong> The scheduled payment
            date recorded against the loan remains the applicable
            payment date for the relevant repayment cycle.
          </Typography>

          <Typography paragraph>
            <strong>2.5 Partial Payments.</strong> Where permitted,
            the customer may make partial payments. Multiple
            payments may be accumulated toward the applicable
            repayment obligation.
          </Typography>

          <Typography paragraph>
            <strong>2.6 Payment Records.</strong> All payments
            received by Umhlomunye Finance will be recorded against
            the customer's loan account.
          </Typography>

          <Typography paragraph>
            <strong>2.7 Outstanding Balance.</strong> The customer
            remains responsible for any outstanding amount reflected
            on the loan account.
          </Typography>

          <Typography paragraph>
            <strong>2.8 Interest Events.</strong> Where applicable,
            interest may be applied to the outstanding balance in
            accordance with the loan's repayment cycle.
          </Typography>

          <Typography paragraph>
            <strong>2.9 Overdue Amounts.</strong> Where the required
            amount has not been paid by the applicable due date, an
            overdue amount may be recorded against the relevant
            repayment cycle.
          </Typography>

          <Typography paragraph>
            <strong>2.10 Account Information.</strong> The customer
            may request information concerning transactions,
            payments, balances and other information relating to the
            loan account.
          </Typography>

          <Typography paragraph>
            <strong>2.11 Electronic Acceptance.</strong> The
            customer's electronic acceptance of this agreement is
            recorded by the system together with the acceptance
            information available at the time of acceptance.
          </Typography>

          <Typography paragraph>
            <strong>2.12 Customer Responsibility.</strong> The
            customer is responsible for reviewing this agreement
            carefully before accepting it.
          </Typography>

          <Typography paragraph>
            <strong>2.13 Accuracy of Information.</strong> The
            customer confirms that the information supplied in
            connection with the loan application is accurate and
            complete to the best of their knowledge.
          </Typography>

          <Typography paragraph>
            <strong>2.14 Contact Details.</strong> The customer
            should notify Umhlomunye Finance of any changes to
            relevant contact information.
          </Typography>

          <Typography paragraph>
            <strong>2.15 Notices.</strong> Communications concerning
            the loan may be sent using the contact information
            provided by the customer, including permitted electronic
            communication channels.
          </Typography>

          <Typography paragraph>
            <strong>2.16 Default.</strong> Failure to meet repayment
            obligations may result in the account being treated in
            accordance with the applicable loan terms and applicable
            law.
          </Typography>

          <Typography paragraph>
            <strong>2.17 Account Closure.</strong> Once all amounts
            owing under the loan have been paid, the loan account
            may be closed in accordance with the system records.
          </Typography>

          <Typography paragraph>
            <strong>2.18 Records.</strong> Umhlomunye Finance may
            maintain electronic records relating to the loan,
            payments, agreement acceptance and account activity.
          </Typography>

          <Typography paragraph>
            <strong>2.19 Digital Records.</strong> Electronic records
            generated by the system may include timestamps,
            agreement references and transaction information.
          </Typography>

          <Typography paragraph>
            <strong>2.20 Agreement Integrity.</strong> The agreement
            number and QR reference are intended to assist with
            identifying and verifying the agreement.
          </Typography>

          <Typography paragraph>
            <strong>2.21 Customer Review.</strong> The customer
            confirms that they have been given an opportunity to
            read and understand the agreement before acceptance.
          </Typography>

          <Typography paragraph>
            <strong>2.22 Voluntary Acceptance.</strong> By completing
            the electronic acceptance process, the customer
            indicates their intention to be bound by the agreement,
            subject to applicable law.
          </Typography>

          <Typography paragraph>
            <strong>2.23 Applicable Law.</strong> This agreement is
            intended to operate subject to the laws and regulations
            applicable in the Republic of South Africa.
          </Typography>

          <Typography paragraph>
            <strong>2.24 Entire Agreement.</strong> This agreement,
            together with applicable loan records and schedules,
            represents the terms applicable to the loan transaction.
          </Typography>
        </Box>

        <Divider sx={{ mb: 4 }} />

        {/* =====================================================
            ELECTRONIC ACCEPTANCE
        ====================================================== */}

        <Typography
          variant="h6"
          sx={{
            fontWeight: 800,
            color: "#12355b",
            mb: 2,
          }}
        >
          3. Electronic Acceptance
        </Typography>

        <Alert
          severity="info"
          sx={{
            mb: 3,
          }}
        >
          Please read the complete agreement carefully before
          accepting it electronically.
        </Alert>

        <Typography sx={{ mb: 3 }}>
          By ticking the checkbox below and submitting this form,
          you confirm that you have read, understood and agree to
          the terms and conditions of this loan agreement.
        </Typography>

        <TextField
          fullWidth
          label="Full Name"
          value={customerName}
          onChange={(e) =>
            setCustomerName(e.target.value)
          }
          sx={{ mb: 2 }}
        />

        <FormControlLabel
          control={
            <Checkbox
              checked={accepted}
              onChange={(e) =>
                setAccepted(e.target.checked)
              }
            />
          }
          label={acceptanceText}
          sx={{
            alignItems: "flex-start",
            mb: 2,
          }}
        />

        {error && (
          <Alert
            severity="error"
            sx={{ mb: 2 }}
          >
            {error}
          </Alert>
        )}

        <Button
          fullWidth
          variant="contained"
          size="large"
          disabled={submitting}
          onClick={handleAccept}
          sx={{
            backgroundColor: "#12355b",
            py: 1.6,
            fontSize: 16,
            fontWeight: 700,
            "&:hover": {
              backgroundColor: "#0d2945",
            },
          }}
        >
          {submitting
            ? "Submitting Agreement..."
            : "Submit & Accept Agreement"}
        </Button>

        {/* =====================================================
            FOOTER
        ====================================================== */}

        <Divider sx={{ my: 4 }} />

        <Box
          sx={{
            textAlign: "center",
          }}
        >
          <Typography
            variant="body2"
            sx={{
              fontWeight: 700,
              color: "#12355b",
            }}
          >
            UMHLOMUNYE FINANCE
          </Typography>

          <Typography
            variant="caption"
            color="text.secondary"
          >
            Our dreams, Our hope
          </Typography>

          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              display: "block",
              mt: 1,
            }}
          >
            Agreement Number: {agreementNumber}
          </Typography>

          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              display: "block",
            }}
          >
            Scan the QR code at the top of this agreement to access
            the secure agreement link.
          </Typography>
        </Box>
      </Paper>
    </Box>
  );
}





