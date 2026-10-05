import { useCallback, useEffect, useMemo, useState } from "react";
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
  Stack,
  TextField,
  Typography,
} from "@mui/material";

import QRCode from "qrcode";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

import { supabase } from "../../lib/supabase";

import {
  drawPdfCompanyHeader,
  getPdfCompanyInfo,
  getPdfLogoDataUrl,
  getLogoAccentColor,
} from "../../services/pdfBrandingService";

const acceptanceText =
  "I have read, understood and agree to the terms and conditions of this loan agreement.";

const NEUTRAL_TEXT = [0, 0, 0];
const NEUTRAL_GREY = [80, 80, 80];
const LIGHT_GREY = [200, 200, 200];

function rgbToCss(rgb) {
  if (!Array.isArray(rgb) || rgb.length < 3) {
    return "rgb(80, 80, 80)";
  }

  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function safeString(value, fallback = "-") {
  if (
    value === null ||
    value === undefined ||
    String(value).trim() === ""
  ) {
    return fallback;
  }

  return String(value);
}

function formatCurrency(value) {
  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    return "R 0.00";
  }

  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatDate(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("en-ZA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function getAgreementCustomerName(agreement) {
  if (!agreement) {
    return "";
  }

  return (
    agreement.customer_name ||
    agreement.customer?.full_name ||
    agreement.customer?.name ||
    [
      agreement.customer?.first_name,
      agreement.customer?.last_name,
    ]
      .filter(Boolean)
      .join(" ") ||
    ""
  );
}

/* ============================================================
   MASTER STATEMENT TABLE STYLE
============================================================ */

function applyMasterTable(pdf, accent, options = {}) {
  const {
    startY,
    head,
    body,
    columnStyles,
    margin = 14,
    fontSize = 8,
  } = options;

  autoTable(pdf, {
    startY,

    margin: {
      left: margin,
      right: margin,
    },

    head,
    body,

    theme: "grid",

    styles: {
      font: "helvetica",
      fontSize,
      cellPadding: 3,
      textColor: NEUTRAL_TEXT,
      lineColor: accent,
      lineWidth: 0.2,
      valign: "middle",
    },

    headStyles: {
      fillColor: accent,
      textColor: [255, 255, 255],
      fontStyle: "bold",
      lineColor: accent,
      lineWidth: 0.2,
    },

    alternateRowStyles: {
      fillColor: [255, 255, 255],
    },

    columnStyles,
  });

  return (
    pdf.lastAutoTable?.finalY ||
    startY + 12
  );
}

/* ============================================================
   MASTER SECTION HEADING
============================================================ */

function drawSectionHeading(
  pdf,
  title,
  y,
  accent
) {
  pdf.setFont(
    "helvetica",
    "bold"
  );

  pdf.setFontSize(12);

  pdf.setTextColor(
    ...accent
  );

  pdf.text(
    title,
    14,
    y
  );

  pdf.setTextColor(
    ...NEUTRAL_TEXT
  );

  return y + 5;
}

/* ============================================================
   MASTER BODY TEXT
============================================================ */

function drawBodyText(
  pdf,
  text,
  x,
  y,
  width,
  options = {}
) {
  const {
    fontSize = 9,
    lineHeight = 4.5,
    fontStyle = "normal",
    color = NEUTRAL_TEXT,
  } = options;

  pdf.setFont(
    "helvetica",
    fontStyle
  );

  pdf.setFontSize(
    fontSize
  );

  pdf.setTextColor(
    ...color
  );

  const lines =
    pdf.splitTextToSize(
      safeString(text, ""),
      width
    );

  pdf.text(
    lines,
    x,
    y
  );

  return (
    y +
    lines.length *
      lineHeight
  );
}

/* ============================================================
   MASTER FOOTER
============================================================ */

function drawPdfFooter(pdf) {
  const pageCount =
    pdf.getNumberOfPages();

  const pageWidth =
    pdf.internal.pageSize.getWidth();

  const pageHeight =
    pdf.internal.pageSize.getHeight();

  for (
    let page = 1;
    page <= pageCount;
    page++
  ) {
    pdf.setPage(page);

    pdf.setDrawColor(
      ...LIGHT_GREY
    );

    pdf.setLineWidth(0.2);

    pdf.line(
      14,
      pageHeight - 15,
      pageWidth - 14,
      pageHeight - 15
    );

    pdf.setFont(
      "helvetica",
      "normal"
    );

    pdf.setFontSize(8);

    pdf.setTextColor(
      ...NEUTRAL_GREY
    );

    pdf.text(
      "Official Loan Agreement",
      14,
      pageHeight - 9
    );

    pdf.text(
      `Page ${page} of ${pageCount}`,
      pageWidth - 14,
      pageHeight - 9,
      {
        align: "right",
      }
    );
  }
}

/* ============================================================
   SIGNED AGREEMENT PDF
   Uses the Statement PDF as the master visual template.
============================================================ */

async function generateSignedAgreementPdf(
  agreement,
  customerName
) {
  if (!agreement) {
    throw new Error(
      "Agreement information is not available."
    );
  }

  const pdf = new jsPDF(
    "p",
    "mm",
    "a4"
  );

  const margin = 14;

  const pageWidth =
    pdf.internal.pageSize.getWidth();

  const contentWidth =
    pageWidth -
    margin * 2;

  const verificationToken =
    agreement.verification_token ||
    null;

  const verificationUrl =
    verificationToken
      ? `${window.location.origin}/verify-agreement/${verificationToken}`
      : null;

  /*
   * MASTER STATEMENT HEADER
   */
  const {
    contentStartY,
    accent,
  } =
    await drawPdfCompanyHeader(
      pdf,
      verificationUrl
    );

  /*
   * MASTER TITLE
   */
  let currentY =
    contentStartY;

  pdf.setFontSize(15);

  pdf.setFont(
    "helvetica",
    "bold"
  );

  pdf.setTextColor(
    ...accent
  );

  pdf.text(
    "LOAN AGREEMENT",
    margin,
    currentY
  );

  pdf.setTextColor(
    ...NEUTRAL_TEXT
  );

  /*
   * AGREEMENT INFORMATION
   */
  const detailsStartY =
    currentY + 8;

  const agreementRows = [
    [
      "Agreement Number",
      safeString(
        agreement.agreement_number
      ),
    ],
    [
      "Loan Number",
      safeString(
        agreement.loan_number
      ),
    ],
    [
      "Agreement Version",
      safeString(
        agreement.agreement_version ||
          agreement.version
      ),
    ],
    [
      "Customer",
      safeString(
        customerName
      ),
    ],
  ];

  applyMasterTable(
    pdf,
    accent,
    {
      startY:
        detailsStartY,

      head: [
        [
          "Agreement Information",
          "Value",
        ],
      ],

      body:
        agreementRows,

      columnStyles: {
        0: {
          cellWidth: 72,
          fontStyle: "bold",
        },

        1: {
          cellWidth: 108,
        },
      },
    }
  );

  currentY =
    pdf.lastAutoTable?.finalY ||
    detailsStartY + 20;

  /*
   * LOAN DETAILS
   */
  currentY += 12;

  currentY =
    drawSectionHeading(
      pdf,
      "Loan Details",
      currentY,
      accent
    );

  const loanRows = [
    [
      "Customer Name",
      safeString(
        customerName
      ),
    ],
    [
      "Loan Number",
      safeString(
        agreement.loan_number
      ),
    ],
    [
      "Principal Amount",
      formatCurrency(
        agreement.principal_amount
      ),
    ],
    [
      "Interest Rate",
      `${safeString(
        agreement.interest_rate,
        "0"
      )}%`,
    ],
    [
      "Interest Amount",
      formatCurrency(
        agreement.interest_amount
      ),
    ],
    [
      "Total Repayment",
      formatCurrency(
        agreement.total_repayment
      ),
    ],
    [
      "Current Balance",
      formatCurrency(
        agreement.current_balance
      ),
    ],
    [
      "First Payment Date",
      formatDate(
        agreement.first_payment_date
      ),
    ],
    [
      "Next Payment Date",
      formatDate(
        agreement.next_payment_date
      ),
    ],
  ];

  applyMasterTable(
    pdf,
    accent,
    {
      startY:
        currentY,

      head: [
        [
          "Loan Information",
          "Details",
        ],
      ],

      body:
        loanRows,

      columnStyles: {
        0: {
          cellWidth: 72,
          fontStyle: "bold",
        },

        1: {
          cellWidth: 108,
        },
      },
    }
  );

  currentY =
    pdf.lastAutoTable?.finalY ||
    currentY + 20;

  /*
   * TERMS AND CONDITIONS
   */
  currentY += 12;

  currentY =
    drawSectionHeading(
      pdf,
      "Terms and Conditions",
      currentY,
      accent
    );

  const terms =
    Array.isArray(
      agreement.terms
    )
      ? agreement.terms
      : [];

  if (terms.length > 0) {
    for (
      let index = 0;
      index < terms.length;
      index++
    ) {
      const term =
        terms[index];

      const title =
        term.title ||
        term.heading ||
        `Term ${index + 1}`;

      const body =
        term.content ||
        term.text ||
        term.description ||
        "";

      /*
       * Start a new page when required.
       *
       * IMPORTANT:
       * This is intentionally inside the async
       * function so the header can be awaited safely.
       */
      if (
        currentY >
        pdf.internal.pageSize.getHeight() -
          35
      ) {
        pdf.addPage();

        const newHeader =
          await drawPdfCompanyHeader(
            pdf,
            verificationUrl
          );

        currentY =
          newHeader.contentStartY;
      }

      pdf.setFont(
        "helvetica",
        "bold"
      );

      pdf.setFontSize(9);

      pdf.setTextColor(
        ...NEUTRAL_TEXT
      );

      pdf.text(
        `${index + 1}. ${safeString(
          title,
          ""
        )}`,
        margin,
        currentY
      );

      currentY += 4;

      currentY =
        drawBodyText(
          pdf,
          body,
          margin,
          currentY,
          contentWidth,
          {
            fontSize: 9,
            lineHeight: 4.5,
          }
        );

      currentY += 4;
    }
  } else {
    const agreementTerms =
      agreement.terms_and_conditions ||
      agreement.terms_text ||
      agreement.agreement_terms ||
      "";

    if (agreementTerms) {
      currentY =
        drawBodyText(
          pdf,
          agreementTerms,
          margin,
          currentY,
          contentWidth,
          {
            fontSize: 9,
            lineHeight: 4.5,
          }
        );

      currentY += 4;
    }
  }

  /*
   * ELECTRONIC ACCEPTANCE
   */
  if (
    currentY >
    pdf.internal.pageSize.getHeight() -
      85
  ) {
    pdf.addPage();

    const newHeader =
      await drawPdfCompanyHeader(
        pdf,
        verificationUrl
      );

    currentY =
      newHeader.contentStartY;
  }

  currentY += 8;

  currentY =
    drawSectionHeading(
      pdf,
      "Electronic Acceptance Record",
      currentY,
      accent
    );

  const acceptanceDate =
    agreement.accepted_at ||
    agreement.acceptance_date ||
    agreement.signed_at ||
    null;

  const acceptanceRows = [
    [
      "Customer Name",
      safeString(
        agreement.customer_name ||
          customerName
      ),
    ],
    [
      "Acceptance Date & Time",
      formatDateTime(
        acceptanceDate
      ),
    ],
    [
      "Digital Signature Reference",
      safeString(
        agreement.signature_reference ||
          agreement.digital_signature_reference
      ),
    ],
    [
      "Acceptance",
      "Accepted electronically",
    ],
    [
      "Acceptance Statement",
      acceptanceText,
    ],
  ];

  applyMasterTable(
    pdf,
    accent,
    {
      startY:
        currentY,

      head: [
        [
          "Acceptance Field",
          "Recorded Value",
        ],
      ],

      body:
        acceptanceRows,

      columnStyles: {
        0: {
          cellWidth: 65,
          fontStyle: "bold",
        },

        1: {
          cellWidth: 115,
        },
      },
    }
  );

  currentY =
    pdf.lastAutoTable?.finalY ||
    currentY + 20;

  /*
   * AUTHENTICITY AND VERIFICATION
   */
  if (
    currentY >
    pdf.internal.pageSize.getHeight() -
      65
  ) {
    pdf.addPage();

    const newHeader =
      await drawPdfCompanyHeader(
        pdf,
        verificationUrl
      );

    currentY =
      newHeader.contentStartY;
  }

  currentY += 12;

  currentY =
    drawSectionHeading(
      pdf,
      "Authenticity and Verification",
      currentY,
      accent
    );

  currentY =
    drawBodyText(
      pdf,
      "This document is the electronically accepted loan agreement associated with the agreement and verification records maintained by the lending system.",
      margin,
      currentY,
      contentWidth,
      {
        fontSize: 9,
        lineHeight: 4.5,
      }
    );

  currentY += 5;

  /*
   * Verification QR.
   *
   * The master header already contains the QR.
   * This second QR is retained at the verification
   * section because it provides a direct verification
   * reference in the body of the agreement.
   */
  if (verificationUrl) {
    try {
      const qrDataUrl =
        await QRCode.toDataURL(
          verificationUrl,
          {
            errorCorrectionLevel:
              "M",
            margin: 1,
            width: 300,
          }
        );

      pdf.addImage(
        qrDataUrl,
        "PNG",
        margin,
        currentY,
        31,
        31
      );

      pdf.setFont(
        "helvetica",
        "normal"
      );

      pdf.setFontSize(7);

      pdf.setTextColor(
        ...NEUTRAL_GREY
      );

      pdf.text(
        "Scan to verify",
        margin + 15.5,
        currentY + 35,
        {
          align: "center",
        }
      );

      const urlX =
        margin + 38;

      const urlY =
        currentY + 8;

      const wrappedUrl =
        pdf.splitTextToSize(
          verificationUrl,
          contentWidth - 38
        );

      pdf.text(
        wrappedUrl,
        urlX,
        urlY
      );

      pdf.setTextColor(
        ...NEUTRAL_TEXT
      );
    } catch (qrError) {
      console.warn(
        "PDF VERIFICATION QR ERROR:",
        qrError
      );
    }
  }

  /*
   * MASTER FOOTER
   */
  drawPdfFooter(
    pdf
  );

  return pdf;
}

/* ============================================================
   SIGN AGREEMENT PAGE
============================================================ */

export default function SignAgreement() {
  const {
    token,
    agreementId,
  } = useParams();

  const isSameComputerMode =
    Boolean(agreementId);

  const [agreement, setAgreement] =
    useState(null);

  const [customerName, setCustomerName] =
    useState("");

  const [accepted, setAccepted] =
    useState(false);

  const [qrCode, setQrCode] =
    useState("");

  const [loading, setLoading] =
    useState(true);

  const [submitting, setSubmitting] =
    useState(false);

  const [error, setError] =
    useState("");

  const [success, setSuccess] =
    useState(false);

  const [companyInfo, setCompanyInfo] =
    useState({
      companyName: "",
      shortName: "",
      companyAddress: "",
      companyPhone: "",
      companyWhatsapp: "",
      companyEmail: "",
      companyLogoUrl: "",
    });

  const [brandAccent, setBrandAccent] =
    useState([
      80,
      80,
      80,
    ]);

  const [companyLogo, setCompanyLogo] =
    useState(null);

  /* ==========================================================
     CENTRALIZED BRANDING
  ========================================================== */

  useEffect(() => {
    let active = true;

    async function loadBranding() {
      try {
        const info =
          await getPdfCompanyInfo();

        if (!active) {
          return;
        }

        setCompanyInfo(
          info
        );

        const logo =
          await getPdfLogoDataUrl(
            info.companyLogoUrl
          );

        if (!active) {
          return;
        }

        setCompanyLogo(
          logo
        );

        const accent =
          await getLogoAccentColor(
            logo
          );

        if (!active) {
          return;
        }

        setBrandAccent(
          accent
        );
      } catch (brandingError) {
        console.error(
          "BRANDING LOAD ERROR:",
          brandingError
        );
      }
    }

    loadBranding();

    return () => {
      active = false;
    };
  }, []);

  /* ==========================================================
     LOAD AGREEMENT
  ========================================================== */

  const loadAgreement =
    useCallback(
      async () => {
        setLoading(true);
        setError("");

        try {
          let agreementData =
            null;

          /*
           * PUBLIC ONLINE SIGNING
           */
          if (
            !isSameComputerMode
          ) {
            if (!token) {
              throw new Error(
                "The agreement signing link is invalid."
              );
            }

            const {
              data,
              error:
                agreementError,
            } =
              await supabase.rpc(
                "get_agreement_for_signing",
                {
                  p_signing_token:
                    token,
                }
              );

            if (
              agreementError
            ) {
              throw agreementError;
            }

            agreementData =
              Array.isArray(data)
                ? data[0]
                : data;

            if (
              !agreementData
            ) {
              throw new Error(
                "Agreement not found or the signing link is no longer valid."
              );
            }
          }

          /*
           * SAME-COMPUTER SIGNING
           */
          else {
            const {
              data: agreementRow,
              error:
                agreementError,
            } =
              await supabase
                .from(
                  "loan_agreements"
                )
                .select("*")
                .eq(
                  "id",
                  agreementId
                )
                .maybeSingle();

            if (
              agreementError
            ) {
              throw agreementError;
            }

            if (
              !agreementRow
            ) {
              throw new Error(
                "Agreement not found."
              );
            }

            if (
              agreementRow.status &&
              String(
                agreementRow.status
              ).toLowerCase() !==
                "pending"
            ) {
              throw new Error(
                "This agreement is no longer awaiting acceptance."
              );
            }

            if (
              !agreementRow.signing_token
            ) {
              throw new Error(
                "This agreement does not have a valid signing token."
              );
            }

            let customerData =
              null;

            if (
              agreementRow.customer_id
            ) {
              const {
                data,
                error:
                  customerError,
              } =
                await supabase
                  .from(
                    "customers"
                  )
                  .select(
                    "id, first_name, last_name, full_name, name"
                  )
                  .eq(
                    "id",
                    agreementRow.customer_id
                  )
                  .maybeSingle();

              if (
                customerError
              ) {
                throw customerError;
              }

              customerData =
                data;
            }

            let loanData =
              null;

            if (
              agreementRow.loan_id
            ) {
              const {
                data,
                error:
                  loanError,
              } =
                await supabase
                  .from(
                    "loans"
                  )
                  .select("*")
                  .eq(
                    "id",
                    agreementRow.loan_id
                  )
                  .maybeSingle();

              if (
                loanError
              ) {
                throw loanError;
              }

              loanData =
                data;
            }

            agreementData = {
              ...agreementRow,
              ...(loanData || {}),
              customer:
                customerData,
              customer_name:
                agreementRow.customer_name ||
                customerData?.full_name ||
                customerData?.name ||
                [
                  customerData?.first_name,
                  customerData?.last_name,
                ]
                  .filter(Boolean)
                  .join(" "),
            };
          }

          /*
           * REQUIRE VERIFICATION TOKEN
           */
          if (
            !agreementData.verification_token
          ) {
            throw new Error(
              "This agreement does not have a verification token."
            );
          }

          const derivedName =
            getAgreementCustomerName(
              agreementData
            );

          setAgreement(
            agreementData
          );

          setCustomerName(
            derivedName
          );

          /*
           * QR FOR ONLINE PAGE
           */
          const verificationUrl =
            `${window.location.origin}/verify-agreement/${agreementData.verification_token}`;

          const qr =
            await QRCode.toDataURL(
              verificationUrl,
              {
                errorCorrectionLevel:
                  "M",
                margin: 1,
                width: 300,
              }
            );

          setQrCode(
            qr
          );
        } catch (loadError) {
          console.error(
            "LOAD AGREEMENT ERROR:",
            loadError
          );

          setError(
            loadError?.message ||
              "Unable to load the loan agreement."
          );
        } finally {
          setLoading(false);
        }
      },
      [
        agreementId,
        isSameComputerMode,
        token,
      ]
    );

  useEffect(() => {
    loadAgreement();
  }, [
    loadAgreement,
  ]);

  /* ==========================================================
     ACCEPT AGREEMENT
  ========================================================== */

  const handleAccept =
    useCallback(
      async () => {
        if (!agreement) {
          return;
        }

        const trimmedName =
          customerName.trim();

        if (!trimmedName) {
          setError(
            "Please enter your full name."
          );
          return;
        }

        if (!accepted) {
          setError(
            "Please confirm that you have read, understood and agree to the terms and conditions."
          );
          return;
        }

        setSubmitting(true);
        setError("");

        try {
          const signingToken =
            agreement.signing_token ||
            token;

          if (
            !signingToken
          ) {
            throw new Error(
              "A valid signing token is required."
            );
          }

          /*
           * ACCEPTANCE RPC
           */
          const {
            error:
              acceptanceError,
          } =
            await supabase.rpc(
              "accept_loan_agreement",
              {
                p_signing_token:
                  signingToken,

                p_customer_name:
                  trimmedName,

                p_acceptance_text:
                  acceptanceText,

                p_ip_address:
                  null,

                p_user_agent:
                  typeof navigator !==
                  "undefined"
                    ? navigator.userAgent
                    : null,
              }
            );

          if (
            acceptanceError
          ) {
            throw acceptanceError;
          }

          /*
           * RELOAD SIGNED AGREEMENT
           */
          let signedAgreement =
            null;

          const {
            data,
            error:
              reloadError,
          } =
            await supabase.rpc(
              "get_agreement_for_signing",
              {
                p_signing_token:
                  signingToken,
              }
            );

          if (
            reloadError
          ) {
            throw reloadError;
          }

          signedAgreement =
            Array.isArray(data)
              ? data[0]
              : data;

          signedAgreement =
            signedAgreement ||
            agreement;

          const agreementForPdf =
            {
              ...agreement,
              ...signedAgreement,
              customer_name:
                signedAgreement?.customer_name ||
                trimmedName,
            };

          /*
           * GENERATE SIGNED PDF
           */
          const pdf =
            await generateSignedAgreementPdf(
              agreementForPdf,
              trimmedName
            );

          const pdfBlob =
            pdf.output(
              "blob"
            );

          /*
           * EXISTING EDGE FUNCTION
           */
          const formData =
            new FormData();

          formData.append(
            "agreement_id",
            String(
              agreementForPdf.id ||
                agreementId ||
                ""
            )
          );

          formData.append(
            "signing_token",
            String(
              signingToken
            )
          );

          formData.append(
            "pdf",
            pdfBlob,
            `${
              agreementForPdf.agreement_number ||
              "loan-agreement"
            }-signed.pdf`
          );

          const {
            data:
              functionData,
            error:
              functionError,
          } =
            await supabase.functions.invoke(
              "create-signed-agreement-document",
              {
                body: formData,
              }
            );

          if (
            functionError
          ) {
            throw functionError;
          }

          if (
            !functionData
          ) {
            throw new Error(
              "The signed agreement document service returned no response."
            );
          }

          if (
            functionData.success ===
              false ||
            !functionData.document_path
          ) {
            throw new Error(
              functionData.message ||
                "The signed agreement PDF could not be stored."
            );
          }

          setAgreement(
            agreementForPdf
          );

          setCustomerName(
            trimmedName
          );

          setSuccess(
            true
          );
        } catch (acceptError) {
          console.error(
            "ACCEPT AGREEMENT ERROR:",
            acceptError
          );

          setError(
            acceptError?.message ||
              "Unable to accept the agreement."
          );
        } finally {
          setSubmitting(false);
        }
      },
      [
        accepted,
        agreement,
        agreementId,
        customerName,
        token,
      ]
    );

  /* ==========================================================
     BRANDING
  ========================================================== */

  const brandColor =
    useMemo(
      () =>
        rgbToCss(
          brandAccent
        ),
      [brandAccent]
    );

  const companyDisplayName =
    companyInfo.companyName ||
    companyInfo.shortName ||
    "Loan Agreement";

  /* ==========================================================
     LOADING
  ========================================================== */

  if (loading) {
    return (
      <Box
        sx={{
          minHeight: "100vh",
          bgcolor: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <CircularProgress
          sx={{
            color: brandColor,
          }}
        />
      </Box>
    );
  }

  /* ==========================================================
     SUCCESS
  ========================================================== */

  if (success) {
    return (
      <Box
        sx={{
          minHeight: "100vh",
          bgcolor: "#fff",
          px: 2,
          py: 4,
        }}
      >
        <Paper
          elevation={0}
          sx={{
            maxWidth: 760,
            mx: "auto",
            border:
              "1px solid",
            borderColor:
              "divider",
            borderRadius: 0,
            p: {
              xs: 3,
              md: 5,
            },
          }}
        >
          <Stack
            spacing={3}
            alignItems="center"
            textAlign="center"
          >
            {companyLogo && (
              <Box
                component="img"
                src={companyLogo}
                alt={
                  companyDisplayName
                }
                sx={{
                  width: 150,
                  maxHeight: 100,
                  objectFit:
                    "contain",
                }}
              />
            )}

            <Divider
              flexItem
              sx={{
                borderColor:
                  brandColor,
                borderBottomWidth: 2,
              }}
            />

            <Typography
              variant="h5"
              fontWeight={700}
              sx={{
                color:
                  brandColor,
              }}
            >
              Agreement Accepted
            </Typography>

            <Typography>
              The loan agreement has
              been electronically
              accepted and the signed
              document has been recorded
              successfully.
            </Typography>

            {agreement?.agreement_number && (
              <Typography
                fontWeight={600}
              >
                Agreement Number:{" "}
                {
                  agreement.agreement_number
                }
              </Typography>
            )}

            <Button
              variant="contained"
              onClick={() => {
                if (
                  isSameComputerMode &&
                  agreement?.loan_id
                ) {
                  window.location.href =
                    `/loans/${agreement.loan_id}`;
                  return;
                }

                window.location.href =
                  "/";
              }}
              sx={{
                bgcolor:
                  brandColor,
                borderRadius: 0,
                "&:hover": {
                  bgcolor:
                    brandColor,
                },
              }}
            >
              Continue
            </Button>
          </Stack>
        </Paper>
      </Box>
    );
  }

  /* ==========================================================
     NOT FOUND
  ========================================================== */

  if (!agreement) {
    return (
      <Box
        sx={{
          minHeight: "100vh",
          bgcolor: "#fff",
          px: 2,
          py: 4,
        }}
      >
        <Paper
          elevation={0}
          sx={{
            maxWidth: 760,
            mx: "auto",
            border:
              "1px solid",
            borderColor:
              "divider",
            borderRadius: 0,
            p: 4,
          }}
        >
          <Typography
            variant="h6"
            fontWeight={700}
            sx={{
              color:
                brandColor,
              mb: 2,
            }}
          >
            Loan Agreement
          </Typography>

          <Divider
            sx={{
              borderColor:
                brandColor,
              borderBottomWidth: 2,
              mb: 3,
            }}
          />

          <Alert
            severity="error"
            sx={{
              borderRadius: 0,
            }}
          >
            {error ||
              "Agreement not found."}
          </Alert>
        </Paper>
      </Box>
    );
  }

  /* ==========================================================
     AGREEMENT DETAILS
  ========================================================== */

  const agreementNumber =
    agreement.agreement_number ||
    "-";

  const loanNumber =
    agreement.loan_number ||
    "-";

  const principalAmount =
    formatCurrency(
      agreement.principal_amount
    );

  const interestRate =
    `${safeString(
      agreement.interest_rate,
      "0"
    )}%`;

  const interestAmount =
    formatCurrency(
      agreement.interest_amount
    );

  const totalRepayment =
    formatCurrency(
      agreement.total_repayment
    );

  const firstPaymentDate =
    formatDate(
      agreement.first_payment_date
    );

  const nextPaymentDate =
    formatDate(
      agreement.next_payment_date
    );

  const onlineTerms =
    Array.isArray(
      agreement.terms
    )
      ? agreement.terms
      : [];

  /* ==========================================================
     SIGNING PAGE
  ========================================================== */

  return (
    <Box
      sx={{
        minHeight: "100vh",
        bgcolor: "#fff",
        px: {
          xs: 1.5,
          sm: 2,
        },
        py: {
          xs: 2,
          md: 4,
        },
      }}
    >
      <Paper
        elevation={0}
        sx={{
          maxWidth: 950,
          mx: "auto",
          bgcolor: "#fff",
          border:
            "1px solid",
          borderColor:
            "divider",
          borderRadius: 0,
          overflow: "hidden",
        }}
      >
        <Box
          sx={{
            p: {
              xs: 2,
              sm: 3,
              md: 4,
            },
          }}
        >
          {/* ==================================================
              MASTER HEADER
          ================================================== */}

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns:
                "34px minmax(0, 1fr) 70px",
              columnGap: 2,
              alignItems:
                "start",
            }}
          >
            <Box
              sx={{
                width: 34,
                height: 34,
                mt: 0.25,
              }}
            >
              {companyLogo && (
                <Box
                  component="img"
                  src={companyLogo}
                  alt={
                    companyDisplayName
                  }
                  sx={{
                    width: 34,
                    height: 34,
                    objectFit:
                      "contain",
                  }}
                />
              )}
            </Box>

            <Box>
              <Typography
                sx={{
                  fontSize:
                    "0.9rem",
                  fontWeight: 700,
                  lineHeight: 1.2,
                }}
              >
                {
                  companyDisplayName
                }
              </Typography>

              {companyInfo.companyAddress && (
                <Typography
                  sx={{
                    fontSize:
                      "0.72rem",
                    lineHeight: 1.35,
                  }}
                >
                  {
                    companyInfo.companyAddress
                  }
                </Typography>
              )}

              {companyInfo.companyPhone && (
                <Typography
                  sx={{
                    fontSize:
                      "0.72rem",
                    lineHeight: 1.35,
                  }}
                >
                  Tel:{" "}
                  {
                    companyInfo.companyPhone
                  }
                </Typography>
              )}

              {companyInfo.companyWhatsapp && (
                <Typography
                  sx={{
                    fontSize:
                      "0.72rem",
                    lineHeight: 1.35,
                  }}
                >
                  WhatsApp:{" "}
                  {
                    companyInfo.companyWhatsapp
                  }
                </Typography>
              )}

              {companyInfo.companyEmail && (
                <Typography
                  sx={{
                    fontSize:
                      "0.72rem",
                    lineHeight: 1.35,
                  }}
                >
                  Email:{" "}
                  {
                    companyInfo.companyEmail
                  }
                </Typography>
              )}
            </Box>

            <Box
              sx={{
                display:
                  "flex",
                flexDirection:
                  "column",
                alignItems:
                  "center",
              }}
            >
              {qrCode && (
                <Box
                  component="img"
                  src={qrCode}
                  alt="Scan to verify"
                  sx={{
                    width: 70,
                    height: 70,
                  }}
                />
              )}

              <Typography
                sx={{
                  fontSize:
                    "0.58rem",
                  mt: 0.25,
                  textAlign:
                    "center",
                }}
              >
                Scan to verify
              </Typography>
            </Box>
          </Box>

          <Divider
            sx={{
              my: 2,
              borderColor:
                brandColor,
              borderBottomWidth: 2,
            }}
          />

          {/* ==================================================
              TITLE
          ================================================== */}

          <Typography
            sx={{
              fontSize:
                "1.35rem",
              fontWeight: 700,
              color:
                brandColor,
              mb: 1,
            }}
          >
            LOAN AGREEMENT
          </Typography>

          <Typography
            sx={{
              fontSize:
                "0.78rem",
              mb: 3,
            }}
          >
            Official electronically
            accepted agreement
          </Typography>

          {/* ==================================================
              AGREEMENT INFORMATION
          ================================================== */}

          <Box
            sx={{
              border:
                "1px solid",
              borderColor:
                "divider",
              mb: 3,
            }}
          >
            {[
              [
                "Agreement Number",
                agreementNumber,
              ],
              [
                "Loan Number",
                loanNumber,
              ],
              [
                "Agreement Version",
                safeString(
                  agreement.agreement_version ||
                    agreement.version
                ),
              ],
            ].map(
              ([label, value]) => (
                <Box
                  key={label}
                  sx={{
                    display:
                      "grid",
                    gridTemplateColumns:
                      {
                        xs: "1fr",
                        sm: "180px 1fr",
                      },
                    borderBottom:
                      "1px solid",
                    borderColor:
                      "divider",
                    "&:last-child":
                      {
                        borderBottom:
                          0,
                      },
                  }}
                >
                  <Box
                    sx={{
                      px: 1.5,
                      py: 1,
                      fontWeight: 700,
                      fontSize:
                        "0.78rem",
                    }}
                  >
                    {label}
                  </Box>

                  <Box
                    sx={{
                      px: 1.5,
                      py: 1,
                      fontSize:
                        "0.78rem",
                    }}
                  >
                    {value}
                  </Box>
                </Box>
              )
            )}
          </Box>

          {/* ==================================================
              CUSTOMER
          ================================================== */}

          <Typography
            sx={{
              fontSize:
                "1rem",
              fontWeight: 700,
              color:
                brandColor,
              mb: 1,
            }}
          >
            Customer
          </Typography>

          <Box
            sx={{
              border:
                "1px solid",
              borderColor:
                "divider",
              p: 1.5,
              mb: 3,
              fontSize:
                "0.85rem",
            }}
          >
            {
              customerName
            }
          </Box>

          {/* ==================================================
              LOAN DETAILS
          ================================================== */}

          <Typography
            sx={{
              fontSize:
                "1rem",
              fontWeight: 700,
              color:
                brandColor,
              mb: 1,
            }}
          >
            Loan Details
          </Typography>

          <Box
            sx={{
              border:
                "1px solid",
              borderColor:
                "divider",
              mb: 3,
            }}
          >
            {[
              [
                "Principal Amount",
                principalAmount,
              ],
              [
                "Interest Rate",
                interestRate,
              ],
              [
                "Interest Amount",
                interestAmount,
              ],
              [
                "Total Repayment",
                totalRepayment,
              ],
              [
                "Current Balance",
                formatCurrency(
                  agreement.current_balance
                ),
              ],
              [
                "First Payment Date",
                firstPaymentDate,
              ],
              [
                "Next Payment Date",
                nextPaymentDate,
              ],
            ].map(
              ([label, value]) => (
                <Box
                  key={label}
                  sx={{
                    display:
                      "grid",
                    gridTemplateColumns:
                      {
                        xs: "1fr",
                        sm: "180px 1fr",
                      },
                    borderBottom:
                      "1px solid",
                    borderColor:
                      "divider",
                    "&:last-child":
                      {
                        borderBottom:
                          0,
                      },
                  }}
                >
                  <Box
                    sx={{
                      px: 1.5,
                      py: 1,
                      fontWeight: 700,
                      fontSize:
                        "0.78rem",
                    }}
                  >
                    {label}
                  </Box>

                  <Box
                    sx={{
                      px: 1.5,
                      py: 1,
                      fontSize:
                        "0.78rem",
                    }}
                  >
                    {value}
                  </Box>
                </Box>
              )
            )}
          </Box>

          {/* ==================================================
              TERMS
          ================================================== */}

          <Typography
            sx={{
              fontSize:
                "1rem",
              fontWeight: 700,
              color:
                brandColor,
              mb: 1,
            }}
          >
            Terms and Conditions
          </Typography>

          <Box
            sx={{
              mb: 3,
            }}
          >
            {onlineTerms.length >
            0 ? (
              onlineTerms.map(
                (term, index) => (
                  <Box
                    key={
                      term.id ||
                      `${index}-${term.title}`
                    }
                    sx={{
                      mb: 2,
                    }}
                  >
                    <Typography
                      sx={{
                        fontSize:
                          "0.84rem",
                        fontWeight: 700,
                        mb: 0.5,
                      }}
                    >
                      {index + 1}.{" "}
                      {term.title ||
                        term.heading ||
                        `Term ${
                          index + 1
                        }`}
                    </Typography>

                    <Typography
                      sx={{
                        fontSize:
                          "0.82rem",
                        lineHeight:
                          1.65,
                      }}
                    >
                      {term.content ||
                        term.text ||
                        term.description ||
                        ""}
                    </Typography>
                  </Box>
                )
              )
            ) : (
              <Typography
                sx={{
                  fontSize:
                    "0.82rem",
                  lineHeight:
                    1.65,
                  whiteSpace:
                    "pre-line",
                }}
              >
                {agreement.terms_and_conditions ||
                  agreement.terms_text ||
                  agreement.agreement_terms ||
                  "The terms and conditions of this loan agreement apply to the loan described above."}
              </Typography>
            )}
          </Box>

          <Divider
            sx={{
              my: 3,
              borderColor:
                brandColor,
            }}
          />

          {/* ==================================================
              ELECTRONIC ACCEPTANCE
          ================================================== */}

          <Typography
            sx={{
              fontSize:
                "1rem",
              fontWeight: 700,
              color:
                brandColor,
              mb: 1,
            }}
          >
            Electronic Acceptance
          </Typography>

          <Typography
            sx={{
              fontSize:
                "0.82rem",
              lineHeight:
                1.6,
              mb: 2,
            }}
          >
            Confirm your full name
            and accept the agreement
            electronically.
          </Typography>

          <TextField
            fullWidth
            label="Customer Name"
            value={
              customerName
            }
            onChange={(
              event
            ) => {
              setCustomerName(
                event.target.value
              );
              setError("");
            }}
            disabled={
              submitting
            }
            margin="normal"
            size="small"
          />

          <FormControlLabel
            control={
              <Checkbox
                checked={
                  accepted
                }
                onChange={(
                  event
                ) => {
                  setAccepted(
                    event.target
                      .checked
                  );
                  setError("");
                }}
                disabled={
                  submitting
                }
                sx={{
                  "&.Mui-checked":
                    {
                      color:
                        brandColor,
                    },
                }}
              />
            }
            label={
              acceptanceText
            }
            sx={{
              alignItems:
                "flex-start",
              mt: 1,
              "& .MuiFormControlLabel-label":
                {
                  fontSize:
                    "0.82rem",
                  lineHeight:
                    1.5,
                },
            }}
          />

          {error && (
            <Alert
              severity="error"
              sx={{
                mt: 2,
                borderRadius: 0,
              }}
            >
              {error}
            </Alert>
          )}

          <Box
            sx={{
              mt: 3,
              display: "flex",
              justifyContent:
                "flex-end",
            }}
          >
            <Button
              variant="contained"
              onClick={
                handleAccept
              }
              disabled={
                submitting ||
                !accepted ||
                !customerName.trim()
              }
              sx={{
                bgcolor:
                  brandColor,
                borderRadius: 0,
                px: 4,
                "&:hover": {
                  bgcolor:
                    brandColor,
                },
              }}
            >
              {submitting ? (
                <CircularProgress
                  size={22}
                  sx={{
                    color:
                      "#fff",
                  }}
                />
              ) : (
                "Accept Agreement"
              )}
            </Button>
          </Box>

          {/* ==================================================
              FOOTER
          ================================================== */}

          <Divider
            sx={{
              mt: 4,
              mb: 1.5,
              borderColor:
                "divider",
            }}
          />

          <Typography
            sx={{
              fontSize:
                "0.7rem",
              textAlign:
                "center",
            }}
          >
            {
              companyDisplayName
            }
          </Typography>
        </Box>
      </Paper>
    </Box>
  );
}