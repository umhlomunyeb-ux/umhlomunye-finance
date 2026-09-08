import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import QRCode from "qrcode";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

import { supabase } from "../../lib/supabase";

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
  Grid,
  IconButton,
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";

import {
  ArrowBack,
  Close,
  Description,
  Download,
  Email,
  FolderOpen,
  History,
  PictureAsPdf,
  Print,
  ReceiptLong,
} from "@mui/icons-material";

import {
  getLoan,
  getLoanTransactions,
  runDailyLoanProcessing,
  subscribeToLoan,
  removeLoanSubscription,
} from "../../services/loanService";

import {
  getLoanStatement,
  getExistingLoanStatementDocument,
} from "../../services/statementService";

import LoanTransactions from "../../components/loans/LoanTransactions";


/* =========================================================
   HELPERS
========================================================= */

function toNumber(value) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : 0;
}


function formatMoney(value) {
  return `R ${toNumber(value).toFixed(2)}`;
}


function formatDate(value) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleDateString("en-ZA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}


function formatDateTime(value) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleString("en-ZA");
}


/* =========================================================
   BLOB → BASE64
========================================================= */

async function blobToBase64(blob) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onloadend = () => {
      const result = String(
        reader.result || ""
      );

      const commaIndex =
        result.indexOf(",");

      resolve(
        commaIndex >= 0
          ? result.slice(
              commaIndex + 1
            )
          : result
      );
    };

    reader.onerror = reject;

    reader.readAsDataURL(blob);
  });
}


/* =========================================================
   SAFE FILE NAME
========================================================= */

function safeFileName(value) {
  return String(value || "Loan Document")
    .replace(/\.pdf$/i, "")
    .replace(/[^\w.-]+/g, "_");
}


/* =========================================================
   GET SETTLEMENT VALIDITY DATE
     
   BUSINESS RULE:
   If interest updates on the 15th,
   settlement quote is valid until the 14th.
========================================================= */

function getSettlementValidUntil(nextInterestDate) {
  if (!nextInterestDate) {
    return null;
  }

  const date = new Date(
    nextInterestDate
  );

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  date.setDate(
    date.getDate() - 1
  );

  return date;
}


/* =========================================================
   COMPONENT
========================================================= */

export default function LoanProfile() {
  const { id } = useParams();
  const navigate = useNavigate();


  /* =======================================================
     STATE
  ======================================================= */

  const [loan, setLoan] =
    useState(null);

  const [transactions, setTransactions] =
    useState([]);

  const [agreement, setAgreement] =
    useState(null);

  const [documents, setDocuments] =
    useState([]);

  const [statement, setStatement] =
    useState({
      transactions: [],
      overdues: [],
    });

  const [loading, setLoading] =
    useState(true);

  const [loadingDocuments, setLoadingDocuments] =
    useState(false);

  const [openingDocument, setOpeningDocument] =
    useState(false);

  const [generatingSettlement, setGeneratingSettlement] =
    useState(false);

  const [sendingEmail, setSendingEmail] =
    useState(false);

  const [emailSuccess, setEmailSuccess] =
    useState("");

  const [tab, setTab] =
    useState(0);

  const [error, setError] =
    useState("");


  /* -------------------------------------------------------
     DOCUMENT VIEWER
  ------------------------------------------------------- */

  const [documentViewerOpen, setDocumentViewerOpen] =
    useState(false);

  const [documentViewerUrl, setDocumentViewerUrl] =
    useState("");

  const [documentViewerName, setDocumentViewerName] =
    useState("");

  const [documentViewerType, setDocumentViewerType] =
    useState("");

  const [documentViewerBlobUrl, setDocumentViewerBlobUrl] =
    useState(null);


  /* =======================================================
     CUSTOMER NAME
  ======================================================= */

  const customerName = useMemo(() => {
    if (!loan?.customers) {
      return "Customer";
    }

    return (
      `${loan.customers.first_name || ""} ${
        loan.customers.last_name || ""
      }`.trim() || "Customer"
    );
  }, [loan]);


  /* =======================================================
     LOAD DOCUMENTS
  ======================================================= */

  const loadDocuments = useCallback(
    async () => {
      if (!id) {
        return;
      }

      setLoadingDocuments(true);

      try {
        const {
          data,
          error: documentError,
        } = await supabase
          .from("documents")
          .select(`
            id,
            customer_id,
            loan_id,
            agreement_id,
            document_type,
            document_name,
            document_path,
            created_by,
            created_at
          `)
          .eq("loan_id", id)
          .order("created_at", {
            ascending: false,
          });

        if (documentError) {
          throw documentError;
        }

        setDocuments(data || []);
      } catch (documentError) {
        console.error(
          "LOAD DOCUMENTS ERROR:",
          documentError
        );

        setError(
          documentError?.message ||
            "Unable to load loan documents."
        );
      } finally {
        setLoadingDocuments(false);
      }
    },
    [id]
  );


  /* =======================================================
     LOAD AGREEMENT
  ======================================================= */

  const loadAgreement = useCallback(
    async () => {
      if (!id) {
        return;
      }

      try {
        const {
          data,
          error: agreementError,
        } = await supabase
          .from("loan_agreements")
          .select(`
            id,
            loan_id,
            customer_id,
            agreement_number,
            agreement_version,
            verification_token,
            signing_token,
            status,
            accepted_at,
            generated_at,
            created_at,
            document_path
          `)
          .eq("loan_id", id)
          .order("created_at", {
            ascending: false,
          })
          .limit(1)
          .maybeSingle();

        if (agreementError) {
          throw agreementError;
        }

        setAgreement(data || null);
      } catch (agreementError) {
        console.error(
          "LOAD AGREEMENT ERROR:",
          agreementError
        );
      }
    },
    [id]
  );


  /* =======================================================
     LOAD STATEMENT DATA
  ======================================================= */

  const loadStatement = useCallback(
    async () => {
      if (!id) {
        return;
      }

      try {
        const data =
          await getLoanStatement(id);

        setStatement({
          transactions:
            data?.transactions || [],
          overdues:
            data?.overdues || [],
        });
      } catch (statementError) {
        console.error(
          "LOAD STATEMENT ERROR:",
          statementError
        );

        setStatement({
          transactions: [],
          overdues: [],
        });
      }
    },
    [id]
  );


  /* =======================================================
     LOAD LOAN
  ======================================================= */

  const loadLoan = useCallback(
    async (
      processInterest = false
    ) => {
      if (!id) {
        setError(
          "Loan ID is missing."
        );

        setLoading(false);

        return;
      }

      try {
        setError("");

        if (processInterest) {
          try {
            await runDailyLoanProcessing();
          } catch (processingError) {
            console.warn(
              "DAILY LOAN PROCESSING WARNING:",
              processingError
            );
          }
        }

        const [
          loanData,
          transactionData,
        ] = await Promise.all([
          getLoan(id),
          getLoanTransactions(id),
        ]);

        setLoan(loanData);

        setTransactions(
          transactionData || []
        );

        await Promise.all([
          loadAgreement(),
          loadDocuments(),
          loadStatement(),
        ]);
      } catch (loadError) {
        console.error(
          "LOAD LOAN PROFILE ERROR:",
          loadError
        );

        setError(
          loadError?.message ||
            "Unable to load loan."
        );
      } finally {
        setLoading(false);
      }
    },
    [
      id,
      loadAgreement,
      loadDocuments,
      loadStatement,
    ]
  );


  /* =======================================================
     INITIAL LOAD
  ======================================================= */

  useEffect(() => {
    loadLoan(true);
  }, [loadLoan]);


  /* =======================================================
     REALTIME
  ======================================================= */

  useEffect(() => {
    if (!id) {
      return undefined;
    }

    let channel;

    try {
      channel = subscribeToLoan(
        id,
        async () => {
          await loadLoan(false);
        }
      );
    } catch (subscriptionError) {
      console.error(
        "LOAN SUBSCRIPTION ERROR:",
        subscriptionError
      );
    }

    return () => {
      if (channel) {
        removeLoanSubscription(
          channel
        );
      }
    };
  }, [id, loadLoan]);


  /* =======================================================
     DOCUMENT LOOKUPS
  ======================================================= */

  const signedAgreementDocument =
    useMemo(() => {
      return documents.find(
        (document) =>
          document.document_type ===
            "Signed Loan Agreement" &&
          document.document_path &&
          (
            !agreement?.id ||
            document.agreement_id ===
              agreement.id
          )
      );
    }, [
      documents,
      agreement,
    ]);


  const statementDocument =
    useMemo(() => {
      return documents.find(
        (document) =>
          document.document_type ===
            "Statement" &&
          document.document_path
      );
    }, [documents]);


  /* =======================================================
     CREATE SIGNED STORAGE URL
  ======================================================= */

  const getSignedDocumentUrl =
    useCallback(
      async (
        documentPath
      ) => {
        if (!documentPath) {
          throw new Error(
            "Document file is not available."
          );
        }

        const {
          data,
          error: signedUrlError,
        } = await supabase.storage
          .from("loan-documents")
          .createSignedUrl(
            documentPath,
            60 * 60
          );

        if (signedUrlError) {
          throw signedUrlError;
        }

        if (!data?.signedUrl) {
          throw new Error(
            "Unable to create document URL."
          );
        }

        return data.signedUrl;
      },
      []
    );


  /* =======================================================
     OPEN DOCUMENT VIEWER
  ======================================================= */

  const openDocumentViewer =
    useCallback(
      async ({
        documentPath,
        documentName,
        documentType,
        blobUrl = null,
      }) => {
        try {
          setError("");
          setEmailSuccess("");
          setOpeningDocument(true);

          let url = blobUrl;

          if (!url) {
            url =
              await getSignedDocumentUrl(
                documentPath
              );
          }

          setDocumentViewerUrl(
            url
          );

          setDocumentViewerName(
            documentName ||
              "Document"
          );

          setDocumentViewerType(
            documentType ||
              "Document"
          );

          setDocumentViewerBlobUrl(
            blobUrl
          );

          setDocumentViewerOpen(
            true
          );
        } catch (openError) {
          console.error(
            "OPEN DOCUMENT ERROR:",
            openError
          );

          setError(
            openError?.message ||
              "Unable to open document."
          );
        } finally {
          setOpeningDocument(false);
        }
      },
      [getSignedDocumentUrl]
    );


  /* =======================================================
     CLOSE DOCUMENT VIEWER
  ======================================================= */

  const closeDocumentViewer =
    useCallback(() => {
      setDocumentViewerOpen(
        false
      );

      if (
        documentViewerBlobUrl
      ) {
        URL.revokeObjectURL(
          documentViewerBlobUrl
        );
      }

      setDocumentViewerBlobUrl(
        null
      );

      setDocumentViewerUrl(
        ""
      );

      setDocumentViewerName(
        ""
      );

      setDocumentViewerType(
        ""
      );

      setEmailSuccess("");
    }, [
      documentViewerBlobUrl,
    ]);


  /* =======================================================
     VIEW STATEMENT
     
     IMPORTANT:
     THIS NEVER GENERATES A STATEMENT.
     IT ONLY RETRIEVES THE EXISTING ONE.
  ======================================================= */

  const handleViewStatement =
    async () => {
      try {
        setError("");
        setOpeningDocument(true);

        const existingStatement =
          statementDocument ||
          await getExistingLoanStatementDocument(
            id
          );

        if (
          !existingStatement?.document_path
        ) {
          throw new Error(
            "No statement exists for this loan yet."
          );
        }

        await openDocumentViewer({
          documentPath:
            existingStatement.document_path,

          documentName:
            existingStatement.document_name ||
            `Loan Statement - ${
              loan?.loan_number || ""
            }`,

          documentType:
            "Statement",
        });
      } catch (statementError) {
        console.error(
          "VIEW STATEMENT ERROR:",
          statementError
        );

        setError(
          statementError?.message ||
            "Unable to open the statement."
        );
      } finally {
        setOpeningDocument(false);
      }
    };


  /* =======================================================
     VIEW AGREEMENT
  ======================================================= */

  const handleViewAgreement =
    async () => {
      try {
        setError("");

        if (
          !signedAgreementDocument?.document_path
        ) {
          throw new Error(
            "The signed loan agreement is not available."
          );
        }

        await openDocumentViewer({
          documentPath:
            signedAgreementDocument.document_path,

          documentName:
            signedAgreementDocument.document_name ||
            "Signed Loan Agreement",

          documentType:
            "Signed Loan Agreement",
        });
      } catch (agreementError) {
        console.error(
          "VIEW AGREEMENT ERROR:",
          agreementError
        );

        setError(
          agreementError?.message ||
            "Unable to open the agreement."
        );
      }
    };


  /* =======================================================
     GENERATE SETTLEMENT LETTER
     
     BUSINESS RULE:
     
     If next interest update date = 15th,
     settlement quote is valid until the 14th.
     
     The QR code contains the same settlement
     information displayed on the PDF.
  ======================================================= */

  const generateSettlementLetter =
    async () => {
      if (!loan) {
        throw new Error(
          "Loan information is not available."
        );
      }

      const doc =
        new jsPDF();

      const loanNumber =
        loan.loan_number ||
        "N/A";

      const customerNumber =
        loan.customers?.customer_number ||
        "N/A";

      const issuedDate =
        new Date();

      const today =
        issuedDate.toLocaleDateString(
          "en-ZA"
        );

      const currentBalance =
        toNumber(
          loan.current_balance
        );

      const nextInterestDate =
        loan.next_interest_date;

      let validUntilDate =
        getSettlementValidUntil(
          nextInterestDate
        );

      /*
       * Fallback only if the loan does not
       * currently have a next interest date.
       */
      if (!validUntilDate) {
        validUntilDate =
          new Date(
            issuedDate
          );

        validUntilDate.setDate(
          validUntilDate.getDate() +
            1
        );
      }

      const validUntil =
        validUntilDate.toLocaleDateString(
          "en-ZA"
        );


      /* ---------------------------------------------------
         QR CODE
      --------------------------------------------------- */

      const qrText = [
        "UMHLOMUNYE FINANCE",
        "Settlement Letter",
        `Loan Number: ${loanNumber}`,
        `Customer Number: ${customerNumber}`,
        `Customer: ${customerName}`,
        `Settlement Amount: ${formatMoney(
          currentBalance
        )}`,
        `Date Issued: ${today}`,
        `Valid Until: ${validUntil}`,
        `Next Interest Update: ${
          nextInterestDate
            ? formatDate(
                nextInterestDate
              )
            : "Not available"
        }`,
      ].join("\n");

      const qrDataUrl =
        await QRCode.toDataURL(
          qrText,
          {
            width: 220,
            margin: 1,
            errorCorrectionLevel:
              "M",
          }
        );


      /* ---------------------------------------------------
         PROFESSIONAL HEADER
         
         QR CODE IS TOP-RIGHT
      --------------------------------------------------- */

      doc.setFontSize(
        20
      );

      doc.setFont(
        "helvetica",
        "bold"
      );

      doc.text(
        "UMHLOMUNYE FINANCE",
        15,
        20
      );

      doc.setFontSize(
        10
      );

      doc.setFont(
        "helvetica",
        "normal"
      );

      doc.text(
        "Our dreams, Our hope",
        15,
        27
      );


      /* ---------------------------------------------------
         QR TOP RIGHT
      --------------------------------------------------- */

      doc.addImage(
        qrDataUrl,
        "PNG",
        158,
        7,
        37,
        37
      );

      doc.setFontSize(
        7
      );

      doc.setFont(
        "helvetica",
        "normal"
      );

      doc.text(
        "Scan to verify",
        176.5,
        47,
        {
          align: "center",
        }
      );


      /* ---------------------------------------------------
         HEADER LINE
      --------------------------------------------------- */

      doc.setDrawColor(
        120
      );

      doc.line(
        15,
        53,
        195,
        53
      );


      /* ---------------------------------------------------
         TITLE
      --------------------------------------------------- */

      doc.setFontSize(
        16
      );

      doc.setFont(
        "helvetica",
        "bold"
      );

      doc.text(
        "SETTLEMENT LETTER",
        105,
        68,
        {
          align: "center",
        }
      );


      /* ---------------------------------------------------
         ISSUE + VALIDITY
      --------------------------------------------------- */

      doc.setFontSize(
        10
      );

      doc.setFont(
        "helvetica",
        "normal"
      );

      doc.text(
        `Date Issued: ${today}`,
        15,
        82
      );

      doc.setFont(
        "helvetica",
        "bold"
      );

      doc.text(
        `Settlement Quote Valid Until: ${validUntil}`,
        15,
        90
      );


      /* ---------------------------------------------------
         CUSTOMER INFORMATION
      --------------------------------------------------- */

      doc.setFont(
        "helvetica",
        "bold"
      );

      doc.text(
        "CUSTOMER INFORMATION",
        15,
        108
      );

      doc.setFont(
        "helvetica",
        "normal"
      );

      doc.text(
        `Customer Name: ${customerName}`,
        15,
        117
      );

      doc.text(
        `Customer Number: ${customerNumber}`,
        15,
        124
      );

      doc.text(
        `Loan Number: ${loanNumber}`,
        15,
        131
      );


      /* ---------------------------------------------------
         SETTLEMENT AMOUNT
      --------------------------------------------------- */

      doc.setFont(
        "helvetica",
        "bold"
      );

      doc.text(
        "SETTLEMENT AMOUNT",
        15,
        150
      );

      doc.setFontSize(
        16
      );

      doc.text(
        formatMoney(
          currentBalance
        ),
        15,
        162
      );

      doc.setFontSize(
        10
      );

      doc.setFont(
        "helvetica",
        "normal"
      );


      /* ---------------------------------------------------
         SETTLEMENT MESSAGE
      --------------------------------------------------- */

      const settlementText =
        currentBalance <= 0
          ? "This loan has been fully settled. No further amount is outstanding."
          : `The current outstanding settlement amount on loan ${loanNumber} is ${formatMoney(
              currentBalance
            )}. This settlement quotation is valid until ${validUntil}.`;

      const textLines =
        doc.splitTextToSize(
          settlementText,
          175
        );

      doc.text(
        textLines,
        15,
        176
      );


      /* ---------------------------------------------------
         LOAN SUMMARY
      --------------------------------------------------- */

      const summaryStart =
        198;

      doc.setFont(
        "helvetica",
        "bold"
      );

      doc.text(
        "LOAN SUMMARY",
        15,
        summaryStart
      );

      autoTable(
        doc,
        {
          startY:
            summaryStart + 5,

          head: [
            [
              "Description",
              "Amount",
            ],
          ],

          body: [
            [
              "Principal Amount",
              formatMoney(
                loan.principal_amount
              ),
            ],

            [
              "Interest Amount",
              formatMoney(
                loan.interest_amount
              ),
            ],

            [
              "Total Repayment",
              formatMoney(
                loan.total_repayment
              ),
            ],

            [
              "Total Paid",
              formatMoney(
                loan.total_paid
              ),
            ],

            [
              "Current Settlement Balance",
              formatMoney(
                loan.current_balance
              ),
            ],
          ],

          theme:
            "grid",

          styles: {
            fontSize: 9,
          },

          headStyles: {
            fontStyle:
              "bold",
          },
        }
      );


      /* ---------------------------------------------------
         VALIDITY NOTE
      --------------------------------------------------- */

      let finalY =
        doc.lastAutoTable?.finalY ||
        245;

      finalY +=
        12;

      doc.setFont(
        "helvetica",
        "bold"
      );

      doc.text(
        "SETTLEMENT VALIDITY",
        15,
        finalY
      );

      finalY +=
        7;

      doc.setFont(
        "helvetica",
        "normal"
      );

      const validityText =
        `This settlement quotation is valid until ${validUntil}. ` +
        (
          nextInterestDate
            ? `The next interest update date is ${formatDate(
                nextInterestDate
              )}. `
            : ""
        ) +
        "If settlement is not completed within the validity period, " +
        "a new settlement quotation may be required.";

      const validityLines =
        doc.splitTextToSize(
          validityText,
          175
        );

      doc.text(
        validityLines,
        15,
        finalY
      );


      /* ---------------------------------------------------
         SIGNATURE
      --------------------------------------------------- */

      finalY +=
        validityLines.length *
          5 +
        18;

      doc.setFont(
        "helvetica",
        "bold"
      );

      doc.text(
        "Umhlomunye Finance",
        15,
        finalY
      );

      doc.setFont(
        "helvetica",
        "normal"
      );

      doc.text(
        "Authorised Representative",
        15,
        finalY + 7
      );


      /* ---------------------------------------------------
         FOOTER
      --------------------------------------------------- */

      doc.setFontSize(
        8
      );

      doc.setFont(
        "helvetica",
        "normal"
      );

      doc.text(
        "This document reflects the loan information available in the Umhlomunye Finance system at the time of issuance.",
        105,
        285,
        {
          align: "center",
        }
      );


      return {
        doc,
        validUntil,
        qrText,
      };
    };


  /* =======================================================
     VIEW SETTLEMENT LETTER
  ======================================================= */

  const handleViewSettlement =
    async () => {
      try {
        setError("");
        setEmailSuccess("");
        setGeneratingSettlement(
          true
        );

        const {
          doc,
        } =
          await generateSettlementLetter();

        const blob =
          doc.output(
            "blob"
          );

        const blobUrl =
          URL.createObjectURL(
            blob
          );

        await openDocumentViewer({
          documentName:
            `Settlement Letter - ${
              loan?.loan_number || ""
            }`,

          documentType:
            "Settlement Letter",

          blobUrl,
        });
      } catch (
        settlementError
      ) {
        console.error(
          "SETTLEMENT LETTER ERROR:",
          settlementError
        );

        setError(
          settlementError?.message ||
            "Unable to generate settlement letter."
        );
      } finally {
        setGeneratingSettlement(
          false
        );
      }
    };


  /* =======================================================
     PRINT DOCUMENT
  ======================================================= */

  const handlePrint =
    () => {
      if (!documentViewerUrl) {
        return;
      }

      const printWindow =
        window.open(
          documentViewerUrl,
          "_blank"
        );

      if (!printWindow) {
        setError(
          "Please allow pop-ups to print the document."
        );

        return;
      }
    };


  /* =======================================================
     DOWNLOAD DOCUMENT
  ======================================================= */

  const handleDownload =
    async () => {
      if (!documentViewerUrl) {
        return;
      }

      try {
        setError("");

        const response =
          await fetch(
            documentViewerUrl
          );

        if (!response.ok) {
          throw new Error(
            "Unable to download document."
          );
        }

        const blob =
          await response.blob();

        const blobUrl =
          URL.createObjectURL(
            blob
          );

        const anchor =
          document.createElement(
            "a"
          );

        anchor.href =
          blobUrl;

        anchor.download =
          documentViewerName
            ? `${safeFileName(
                documentViewerName
              )}.pdf`
            : "document.pdf";

        document.body.appendChild(
          anchor
        );

        anchor.click();

        anchor.remove();

        setTimeout(
          () => {
            URL.revokeObjectURL(
              blobUrl
            );
          },
          1000
        );
      } catch (
        downloadError
      ) {
        console.error(
          "DOWNLOAD DOCUMENT ERROR:",
          downloadError
        );

        setError(
          downloadError?.message ||
            "Unable to download document."
        );
      }
    };


  /* =======================================================
     EMAIL DOCUMENT
     
     IMPORTANT:
     
     The actual PDF currently being viewed is downloaded
     from documentViewerUrl and converted to Base64.
     
     The Base64 PDF is sent as a REAL attachment to Brevo.
     
     For Settlement Letters:
     
     1. The exact PDF being viewed is emailed.
     2. Only after the email succeeds, that exact PDF
        is saved into Supabase Storage.
     3. A new Documents record is created.
     4. Previous settlement letters are never overwritten.
  ======================================================= */

  const handleEmail =
    async () => {
      if (!documentViewerUrl) {
        return;
      }

      if (!loan) {
        setError(
          "Loan information is not available."
        );

        return;
      }

      const recipientEmail =
        loan?.customers?.email ||
        loan?.customers?.email_address ||
        loan?.customers?.emailAddress ||
        "";

      if (!recipientEmail) {
        setError(
          "Customer email address is not available."
        );

        return;
      }

      try {
        setError("");
        setEmailSuccess("");
        setSendingEmail(
          true
        );


        /* -------------------------------------------------
           GET THE EXACT PDF CURRENTLY BEING VIEWED
        ------------------------------------------------- */

        const response =
          await fetch(
            documentViewerUrl
          );

        if (!response.ok) {
          throw new Error(
            "Unable to retrieve the document for emailing."
          );
        }

        const blob =
          await response.blob();

        if (
          !blob ||
          blob.size === 0
        ) {
          throw new Error(
            "The document is empty and cannot be emailed."
          );
        }

        const base64 =
          await blobToBase64(
            blob
          );


        /* -------------------------------------------------
           FILE NAME
        ------------------------------------------------- */

        const fileName =
          `${safeFileName(
            documentViewerName ||
              documentViewerType ||
              "Loan Document"
          )}.pdf`;


        /* -------------------------------------------------
           SEND ACTUAL PDF ATTACHMENT
        ------------------------------------------------- */

        const {
          data,
          error: emailError,
        } =
          await supabase.functions.invoke(
            "send-loan-email",
            {
              body: {
                notificationType:
                  "DOCUMENT",

                loanId:
                  loan.id,

                recipientEmail,

                recipientName:
                  customerName,

                clientName:
                  customerName,

                loanNumber:
                  loan.loan_number ||
                  "",

                documentType:
                  documentViewerType ||
                  "Loan Document",

                documentName:
                  fileName,

                attachment: {
                  name:
                    fileName,

                  content:
                    base64,

                  contentType:
                    "application/pdf",
                },
              },
            }
          );


        if (emailError) {
          throw emailError;
        }

        if (
          !data?.success
        ) {
          throw new Error(
            data?.error ||
              "Unable to send the email."
          );
        }


        /* -------------------------------------------------
           SAVE EXACT SENT SETTLEMENT LETTER
           
           Only after Brevo confirms success.
           
           Each settlement gets a unique storage path,
           therefore old settlement letters remain intact.
        ------------------------------------------------- */

        if (
          documentViewerType ===
          "Settlement Letter"
        ) {
          if (
            !loan.customer_id
          ) {
            throw new Error(
              "Customer ID is missing from the loan."
            );
          }


          const timestamp =
            new Date()
              .toISOString()
              .replace(
                /[:.]/g,
                "-"
              );


          const storagePath =
            `settlements/${loan.customer_id}/${loan.id}/${timestamp}-${fileName}`;


          const {
            error:
              uploadError,
          } =
            await supabase.storage
              .from(
                "loan-documents"
              )
              .upload(
                storagePath,
                blob,
                {
                  contentType:
                    "application/pdf",

                  upsert:
                    false,
                }
              );


          if (
            uploadError
          ) {
            throw uploadError;
          }


          const {
            data:
              authData,
          } =
            await supabase.auth.getUser();


          const createdBy =
            authData?.user?.id ||
            null;


          const {
            error:
              documentInsertError,
          } =
            await supabase
              .from(
                "documents"
              )
              .insert({
                customer_id:
                  loan.customer_id,

                loan_id:
                  loan.id,

                agreement_id:
                  null,

                document_type:
                  "Settlement Letter",

                document_name:
                  fileName,

                document_path:
                  storagePath,

                created_by:
                  createdBy,
              });


          if (
            documentInsertError
          ) {
            /*
             * If the Documents record fails,
             * remove the uploaded copy so that
             * the database and storage do not disagree.
             */
            await supabase.storage
              .from(
                "loan-documents"
              )
              .remove([
                storagePath,
              ]);

            throw documentInsertError;
          }


          await loadDocuments();
        }


        /* -------------------------------------------------
           SUCCESS
        ------------------------------------------------- */

        setEmailSuccess(
          `The ${(
            documentViewerType ||
            "document"
          ).toLowerCase()} was emailed successfully to ${recipientEmail}.`
        );
      } catch (
        emailSendError
      ) {
        console.error(
          "EMAIL DOCUMENT ERROR:",
          emailSendError
        );

        setError(
          emailSendError?.message ||
            "Unable to email the document."
        );
      } finally {
        setSendingEmail(
          false
        );
      }
    };


  /* =======================================================
     TAB CHANGE
  ======================================================= */

  const handleTabChange =
    (
      _event,
      newValue
    ) => {
      setTab(
        newValue
      );

      if (
        newValue === 1
      ) {
        loadStatement();
      }

      if (
        newValue === 2
      ) {
        loadDocuments();
      }
    };


  /* =======================================================
     LOADING
  ======================================================= */

  if (loading) {
    return (
      <Box
        sx={{
          display:
            "flex",

          justifyContent:
            "center",

          alignItems:
            "center",

          minHeight:
            "60vh",
        }}
      >
        <CircularProgress />
      </Box>
    );
  }


  /* =======================================================
     NO LOAN
  ======================================================= */

  if (!loan) {
    return (
      <Box
        sx={{
          p: 3,
        }}
      >
        <Alert severity="error">
          {error ||
            "Loan could not be found."}
        </Alert>

        <Button
          sx={{
            mt: 2,
          }}
          startIcon={
            <ArrowBack />
          }
          onClick={() =>
            navigate(
              "/loans"
            )
          }
        >
          Back to Loans
        </Button>
      </Box>
    );
  }


  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <Box
      sx={{
        p: {
          xs: 2,
          md: 3,
        },
      }}
    >

      {/* ===================================================
          PAGE HEADER
      =================================================== */}

      <Stack
        direction={{
          xs: "column",
          md: "row",
        }}
        justifyContent="space-between"
        alignItems={{
          xs: "stretch",
          md: "center",
        }}
        spacing={2}
        sx={{
          mb: 3,
        }}
      >
        <Box>
          <Button
            startIcon={
              <ArrowBack />
            }
            onClick={() =>
              navigate(
                "/loans"
              )
            }
            sx={{
              mb: 1,
            }}
          >
            Back to Loans
          </Button>

          <Typography
            variant="h4"
            fontWeight={700}
          >
            Loan Profile
          </Typography>

          <Typography
            color="text.secondary"
          >
            {loan.loan_number}
          </Typography>
        </Box>

        <Chip
          label={
            loan.loan_status ||
            "Unknown"
          }
          color={
            String(
              loan.loan_status
            ).toLowerCase() ===
            "active"
              ? "success"
              : String(
                    loan.loan_status
                  ).toLowerCase() ===
                  "completed"
                ? "primary"
                : "default"
          }
          sx={{
            alignSelf: {
              xs: "flex-start",
              md: "center",
            },
          }}
        />
      </Stack>


      {/* ===================================================
          ERROR
      =================================================== */}

      {error && (
        <Alert
          severity="error"
          sx={{
            mb: 3,
          }}
          onClose={() =>
            setError("")
          }
        >
          {error}
        </Alert>
      )}


      {/* ===================================================
          EMAIL SUCCESS
      =================================================== */}

      {emailSuccess && (
        <Alert
          severity="success"
          sx={{
            mb: 3,
          }}
          onClose={() =>
            setEmailSuccess("")
          }
        >
          {emailSuccess}
        </Alert>
      )}


      {/* ===================================================
          CUSTOMER + LOAN SUMMARY
      =================================================== */}

      <Grid
        container
        spacing={2}
        sx={{
          mb: 3,
        }}
      >

        <Grid
          item
          xs={12}
          md={6}
        >
          <Card>
            <CardContent>

              <Typography
                variant="h6"
                fontWeight={700}
                gutterBottom
              >
                Customer
              </Typography>

              <Divider
                sx={{
                  mb: 2,
                }}
              />

              <Stack spacing={1}>

                <Typography>
                  <strong>
                    Name:
                  </strong>{" "}
                  {customerName}
                </Typography>

                <Typography>
                  <strong>
                    Customer Number:
                  </strong>{" "}
                  {loan.customers
                    ?.customer_number ||
                    "—"}
                </Typography>

                <Typography>
                  <strong>
                    Loan Number:
                  </strong>{" "}
                  {loan.loan_number ||
                    "—"}
                </Typography>

              </Stack>

            </CardContent>
          </Card>
        </Grid>


        <Grid
          item
          xs={12}
          md={6}
        >
          <Card>
            <CardContent>

              <Typography
                variant="h6"
                fontWeight={700}
                gutterBottom
              >
                Loan Summary
              </Typography>

              <Divider
                sx={{
                  mb: 2,
                }}
              />

              <Grid
                container
                spacing={2}
              >

                <Grid
                  item
                  xs={6}
                >
                  <Typography
                    variant="body2"
                    color="text.secondary"
                  >
                    Principal
                  </Typography>

                  <Typography
                    fontWeight={700}
                  >
                    {formatMoney(
                      loan.principal_amount
                    )}
                  </Typography>
                </Grid>


                <Grid
                  item
                  xs={6}
                >
                  <Typography
                    variant="body2"
                    color="text.secondary"
                  >
                    Interest
                  </Typography>

                  <Typography
                    fontWeight={700}
                  >
                    {formatMoney(
                      loan.interest_amount
                    )}
                  </Typography>
                </Grid>


                <Grid
                  item
                  xs={6}
                >
                  <Typography
                    variant="body2"
                    color="text.secondary"
                  >
                    Total Repayment
                  </Typography>

                  <Typography
                    fontWeight={700}
                  >
                    {formatMoney(
                      loan.total_repayment
                    )}
                  </Typography>
                </Grid>


                <Grid
                  item
                  xs={6}
                >
                  <Typography
                    variant="body2"
                    color="text.secondary"
                  >
                    Total Paid
                  </Typography>

                  <Typography
                    fontWeight={700}
                  >
                    {formatMoney(
                      loan.total_paid
                    )}
                  </Typography>
                </Grid>


                <Grid
                  item
                  xs={12}
                >
                  <Paper
                    variant="outlined"
                    sx={{
                      p: 2,
                      mt: 1,
                    }}
                  >
                    <Typography
                      variant="body2"
                      color="text.secondary"
                    >
                      Current Balance
                    </Typography>

                    <Typography
                      variant="h5"
                      fontWeight={800}
                    >
                      {formatMoney(
                        loan.current_balance
                      )}
                    </Typography>
                  </Paper>
                </Grid>

              </Grid>

            </CardContent>
          </Card>
        </Grid>

      </Grid>


      {/* ===================================================
          THREE MAIN DOCUMENT BUTTONS
      =================================================== */}

      <Card
        sx={{
          mb: 3,
        }}
      >
        <CardContent>

          <Typography
            variant="h6"
            fontWeight={700}
            gutterBottom
          >
            Loan Documents
          </Typography>

          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              mb: 2,
            }}
          >
            Open the latest loan documents.
          </Typography>

          <Stack
            direction={{
              xs: "column",
              sm: "row",
            }}
            spacing={2}
          >

            {/* STATEMENT */}

            <Button
              variant="contained"
              startIcon={
                openingDocument ? (
                  <CircularProgress
                    size={18}
                    color="inherit"
                  />
                ) : (
                  <ReceiptLong />
                )
              }
              onClick={
                handleViewStatement
              }
              disabled={
                openingDocument ||
                !statementDocument
              }
              sx={{
                minWidth: {
                  xs: "100%",
                  sm: 170,
                },
              }}
            >
              Statement
            </Button>


            {/* AGREEMENT */}

            <Button
              variant="contained"
              startIcon={
                <Description />
              }
              onClick={
                handleViewAgreement
              }
              disabled={
                openingDocument ||
                !signedAgreementDocument
              }
              sx={{
                minWidth: {
                  xs: "100%",
                  sm: 170,
                },
              }}
            >
              Agreement
            </Button>


            {/* SETTLEMENT LETTER */}

            <Button
              variant="contained"
              startIcon={
                generatingSettlement ? (
                  <CircularProgress
                    size={18}
                    color="inherit"
                  />
                ) : (
                  <PictureAsPdf />
                )
              }
              onClick={
                handleViewSettlement
              }
              disabled={
                generatingSettlement
              }
              sx={{
                minWidth: {
                  xs: "100%",
                  sm: 210,
                },
              }}
            >
              Settlement Letter
            </Button>

          </Stack>


          {!statementDocument && (
            <Alert
              severity="warning"
              sx={{
                mt: 2,
              }}
            >
              No statement document exists
              for this loan.
            </Alert>
          )}


          {!signedAgreementDocument && (
            <Alert
              severity="warning"
              sx={{
                mt: 2,
              }}
            >
              No signed loan agreement is
              available for this loan.
            </Alert>
          )}

        </CardContent>
      </Card>


      {/* ===================================================
          TABS
      =================================================== */}

      <Card>

        <Tabs
          value={tab}
          onChange={
            handleTabChange
          }
          variant="scrollable"
          scrollButtons="auto"
        >

          <Tab
            icon={
              <History />
            }
            iconPosition="start"
            label="Transactions"
          />

          <Tab
            icon={
              <ReceiptLong />
            }
            iconPosition="start"
            label="Statement"
          />

          <Tab
            icon={
              <FolderOpen />
            }
            iconPosition="start"
            label="Documents"
          />

        </Tabs>


        <Divider />


        {/* =================================================
            TRANSACTIONS TAB
        ================================================= */}

        {tab === 0 && (
          <CardContent>

            <LoanTransactions
              loanId={id}
              transactions={
                transactions
              }
            />

          </CardContent>
        )}


        {/* =================================================
            STATEMENT TAB
        ================================================= */}

        {tab === 1 && (
          <CardContent>

            <Stack
              direction={{
                xs: "column",
                md: "row",
              }}
              justifyContent="space-between"
              spacing={2}
              sx={{
                mb: 2,
              }}
            >

              <Box>

                <Typography
                  variant="h6"
                  fontWeight={700}
                >
                  Loan Statement
                </Typography>

                <Typography
                  variant="body2"
                  color="text.secondary"
                >
                  This is the current
                  transaction history for
                  this loan.
                </Typography>

              </Box>


              <Button
                variant="outlined"
                startIcon={
                  <ReceiptLong />
                }
                onClick={
                  handleViewStatement
                }
                disabled={
                  !statementDocument
                }
              >
                Open Statement
              </Button>

            </Stack>


            {statement.transactions
              .length === 0 ? (

              <Alert severity="info">
                No transactions found.
              </Alert>

            ) : (

              <Box
                sx={{
                  overflowX:
                    "auto",
                }}
              >

                <Box
                  component="table"
                  sx={{
                    width: "100%",
                    borderCollapse:
                      "collapse",
                    minWidth: 700,
                  }}
                >

                  <Box
                    component="thead"
                  >

                    <Box
                      component="tr"
                    >

                      {[
                        "Date",
                        "Type",
                        "Description",
                        "Debit",
                        "Credit",
                        "Balance",
                      ].map(
                        (
                          heading
                        ) => (
                          <Box
                            component="th"
                            key={
                              heading
                            }
                            sx={{
                              textAlign:
                                "left",
                              p: 1.5,
                              borderBottom:
                                "1px solid",
                              borderColor:
                                "divider",
                            }}
                          >
                            {heading}
                          </Box>
                        )
                      )}

                    </Box>

                  </Box>


                  <Box
                    component="tbody"
                  >

                    {statement.transactions.map(
                      (
                        transaction
                      ) => (

                        <Box
                          component="tr"
                          key={
                            transaction.id
                          }
                        >

                          <Box
                            component="td"
                            sx={{
                              p: 1.5,
                              borderBottom:
                                "1px solid",
                              borderColor:
                                "divider",
                            }}
                          >
                            {formatDate(
                              transaction.transaction_date
                            )}
                          </Box>


                          <Box
                            component="td"
                            sx={{
                              p: 1.5,
                              borderBottom:
                                "1px solid",
                              borderColor:
                                "divider",
                            }}
                          >
                            {transaction.transaction_type ||
                              "—"}
                          </Box>


                          <Box
                            component="td"
                            sx={{
                              p: 1.5,
                              borderBottom:
                                "1px solid",
                              borderColor:
                                "divider",
                            }}
                          >
                            {transaction.description ||
                              "—"}
                          </Box>


                          <Box
                            component="td"
                            sx={{
                              p: 1.5,
                              borderBottom:
                                "1px solid",
                              borderColor:
                                "divider",
                            }}
                          >
                            {formatMoney(
                              transaction.debit
                            )}
                          </Box>


                          <Box
                            component="td"
                            sx={{
                              p: 1.5,
                              borderBottom:
                                "1px solid",
                              borderColor:
                                "divider",
                            }}
                          >
                            {formatMoney(
                              transaction.credit
                            )}
                          </Box>


                          <Box
                            component="td"
                            sx={{
                              p: 1.5,
                              borderBottom:
                                "1px solid",
                              borderColor:
                                "divider",
                              fontWeight:
                                700,
                            }}
                          >
                            {formatMoney(
                              transaction.balance
                            )}
                          </Box>

                        </Box>

                      )
                    )}

                  </Box>

                </Box>

              </Box>

            )}

          </CardContent>
        )}


        {/* =================================================
            DOCUMENTS TAB
        ================================================= */}

        {tab === 2 && (
          <CardContent>

            <Typography
              variant="h6"
              fontWeight={700}
              gutterBottom
            >
              Documents
            </Typography>


            {loadingDocuments ? (

              <Box
                sx={{
                  display:
                    "flex",
                  justifyContent:
                    "center",
                  py: 4,
                }}
              >
                <CircularProgress />
              </Box>

            ) : documents.length ===
              0 ? (

              <Alert severity="info">
                No documents found for
                this loan.
              </Alert>

            ) : (

              <Stack spacing={2}>

                {documents.map(
                  (
                    document
                  ) => (

                    <Paper
                      key={
                        document.id
                      }
                      variant="outlined"
                      sx={{
                        p: 2,
                      }}
                    >

                      <Stack
                        direction={{
                          xs: "column",
                          sm: "row",
                        }}
                        justifyContent="space-between"
                        alignItems={{
                          xs: "stretch",
                          sm: "center",
                        }}
                        spacing={2}
                      >

                        <Box>

                          <Stack
                            direction="row"
                            spacing={1}
                            alignItems="center"
                            sx={{
                              mb: 0.5,
                            }}
                          >

                            <PictureAsPdf
                              fontSize="small"
                            />

                            <Typography
                              fontWeight={
                                700
                              }
                            >
                              {
                                document.document_name
                              }
                            </Typography>

                          </Stack>


                          <Typography
                            variant="body2"
                            color="text.secondary"
                          >
                            Type:{" "}
                            {
                              document.document_type
                            }
                          </Typography>


                          <Typography
                            variant="body2"
                            color="text.secondary"
                          >
                            Created:{" "}
                            {formatDateTime(
                              document.created_at
                            )}
                          </Typography>

                        </Box>


                        <Button
                          variant="outlined"
                          startIcon={
                            <FolderOpen />
                          }
                          onClick={() =>
                            openDocumentViewer(
                              {
                                documentPath:
                                  document.document_path,

                                documentName:
                                  document.document_name,

                                documentType:
                                  document.document_type,
                              }
                            )
                          }
                          disabled={
                            !document.document_path
                          }
                        >
                          View
                        </Button>

                      </Stack>

                    </Paper>

                  )
                )}

              </Stack>

            )}

          </CardContent>
        )}

      </Card>


      {/* ===================================================
          DOCUMENT VIEWER
      =================================================== */}

      <Dialog
        open={
          documentViewerOpen
        }
        onClose={
          closeDocumentViewer
        }
        fullScreen
      >

        <DialogTitle
          sx={{
            display:
              "flex",
            alignItems:
              "center",
            justifyContent:
              "space-between",
            gap: 2,
          }}
        >

          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
          >

            <PictureAsPdf />

            <Box>

              <Typography
                fontWeight={700}
              >
                {documentViewerName ||
                  "Document"}
              </Typography>

              <Typography
                variant="caption"
                color="text.secondary"
              >
                {documentViewerType}
              </Typography>

            </Box>

          </Stack>


          <IconButton
            onClick={
              closeDocumentViewer
            }
            aria-label="Close"
          >
            <Close />
          </IconButton>

        </DialogTitle>


        <Divider />


        <DialogContent
          sx={{
            p: 0,
            backgroundColor:
              "#525659",
            overflow:
              "hidden",
          }}
        >

          {documentViewerUrl ? (

            <Box
              component="iframe"
              src={
                documentViewerUrl
              }
              title={
                documentViewerName ||
                "Document Viewer"
              }
              sx={{
                width: "100%",
                height: "100%",
                border: 0,
                display:
                  "block",
              }}
            />

          ) : (

            <Box
              sx={{
                display:
                  "flex",
                justifyContent:
                  "center",
                alignItems:
                  "center",
                height: "100%",
              }}
            >
              <CircularProgress />
            </Box>

          )}

        </DialogContent>


        <DialogActions
          sx={{
            p: 2,
            gap: 1,
            borderTop:
              "1px solid",
            borderColor:
              "divider",
            flexWrap:
              "wrap",
          }}
        >

          <Button
            variant="contained"
            startIcon={
              <Print />
            }
            onClick={
              handlePrint
            }
            disabled={
              !documentViewerUrl
            }
          >
            Print
          </Button>


          <Button
            variant="contained"
            startIcon={
              <Download />
            }
            onClick={
              handleDownload
            }
            disabled={
              !documentViewerUrl
            }
          >
            Download
          </Button>


          <Button
            variant="contained"
            startIcon={
              sendingEmail ? (
                <CircularProgress
                  size={18}
                  color="inherit"
                />
              ) : (
                <Email />
              )
            }
            onClick={
              handleEmail
            }
            disabled={
              !documentViewerUrl ||
              sendingEmail
            }
          >
            {sendingEmail
              ? "Sending..."
              : "Email"}
          </Button>


          <Button
            variant="outlined"
            onClick={
              closeDocumentViewer
            }
            disabled={
              sendingEmail
            }
          >
            Close
          </Button>

        </DialogActions>

      </Dialog>

    </Box>
  );
}