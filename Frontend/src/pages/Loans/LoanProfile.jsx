import { useCallback, useEffect, useState } from "react";
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
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";

import {
  ArrowBack,
  Description,
  FolderOpen,
  History,
  OpenInNew,
  Payment,
  PictureAsPdf,
  Print,
  ReceiptLong,
  Verified,
} from "@mui/icons-material";

import {
  getLoan,
  getLoanTransactions,
  runDailyLoanProcessing,
  subscribeToLoan,
  removeLoanSubscription,
} from "../../services/loanService";

import { getLoanStatement } from "../../services/statementService";

import LoanTransactions from "../../components/loans/LoanTransactions";
import RecordPayment from "../Repayments/RecordPayment";


export default function LoanProfile() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [loan, setLoan] = useState(null);
  const [agreement, setAgreement] = useState(null);
  const [documents, setDocuments] = useState([]);

  const [statement, setStatement] = useState({
    transactions: [],
    overdues: [],
  });

  const [loading, setLoading] = useState(true);
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const [generatingAgreement, setGeneratingAgreement] = useState(false);
  const [generatingStatement, setGeneratingStatement] = useState(false);
  const [openingDocument, setOpeningDocument] = useState(false);

  const [tab, setTab] = useState(0);
  const [paymentOpen, setPaymentOpen] = useState(false);

  const [error, setError] = useState("");


  // ============================================================
  // CUSTOMER NAME
  // ============================================================

  const getCustomerName = useCallback(() => {
    if (!loan?.customers) {
      return "Customer";
    }

    const customer = loan.customers;

    return (
      `${customer.first_name || ""} ${customer.last_name || ""}`.trim() ||
      "Customer"
    );
  }, [loan]);


  // ============================================================
  // LOAD DOCUMENTS
  // ============================================================

  const loadDocuments = useCallback(
    async (loanId = id) => {
      if (!loanId) return;

      try {
        setLoadingDocuments(true);

        const { data, error: documentsError } = await supabase
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
          .eq("loan_id", loanId)
          .order("created_at", {
            ascending: false,
          });

        if (documentsError) {
          throw documentsError;
        }

        setDocuments(data || []);
      } catch (err) {
        console.error("DOCUMENTS ERROR:", err);
        setDocuments([]);
      } finally {
        setLoadingDocuments(false);
      }
    },
    [id]
  );


  // ============================================================
  // LOAD AGREEMENT
  // ============================================================

  const loadAgreement = useCallback(
    async (loanId = id) => {
      if (!loanId) return;

      try {
        const {
          data: agreementData,
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
          .eq("loan_id", loanId)
          .order("created_at", {
            ascending: false,
          })
          .limit(1)
          .maybeSingle();

        if (agreementError) {
          console.error(
            "AGREEMENT LOADING ERROR:",
            agreementError
          );

          setAgreement(null);
          return;
        }

        setAgreement(agreementData || null);
      } catch (err) {
        console.error(
          "AGREEMENT ERROR:",
          err
        );

        setAgreement(null);
      }
    },
    [id]
  );


  // ============================================================
  // LOAD STATEMENT
  // ============================================================

  const loadStatement = useCallback(
    async (loanId = id) => {
      if (!loanId) return;

      try {
        const statementData =
          await getLoanStatement(loanId);

        if (statementData) {
          setStatement({
            transactions:
              statementData.transactions || [],
            overdues:
              statementData.overdues || [],
          });
        } else {
          setStatement({
            transactions: [],
            overdues: [],
          });
        }
      } catch (err) {
        console.error(
          "STATEMENT LOADING ERROR:",
          err
        );

        setStatement({
          transactions: [],
          overdues: [],
        });
      }
    },
    [id]
  );


  // ============================================================
  // LOAD LOAN
  // ============================================================

  const loadLoan = useCallback(
    async (processInterest = true) => {
      if (!id) return;

      try {
        setLoading(true);
        setError("");

        // ------------------------------------------------------
        // RUN DAILY PROCESSING
        // ------------------------------------------------------

        if (processInterest) {
          try {
            await runDailyLoanProcessing();
          } catch (processingError) {
            console.error(
              "Daily loan processing failed:",
              processingError
            );

            // Do not prevent the profile from loading
            // if daily processing has a temporary problem.
          }
        }

        // ------------------------------------------------------
        // LOAD LOAN + TRANSACTIONS
        // ------------------------------------------------------

        const [loanData, transactionData] =
          await Promise.all([
            getLoan(id),
            getLoanTransactions(id),
          ]);

        if (!loanData) {
          throw new Error(
            "Loan could not be found."
          );
        }

        setLoan(loanData);

        // ------------------------------------------------------
        // LOAD OTHER DATA
        // ------------------------------------------------------

        await Promise.all([
          loadAgreement(id),
          loadDocuments(id),
          loadStatement(id),
        ]);

        return {
          loan: loanData,
          transactions: transactionData || [],
        };
      } catch (err) {
        console.error(
          "LOAN PROFILE ERROR:",
          err
        );

        setError(
          err?.message ||
            "Unable to load the loan profile."
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


  // ============================================================
  // INITIAL LOAD
  // ============================================================

  useEffect(() => {
    if (!id) return;

    loadLoan(true);
  }, [id, loadLoan]);


  // ============================================================
  // REAL-TIME LOAN UPDATES
  // ============================================================

  useEffect(() => {
    if (!id) return;

    let channel;

    try {
      channel = subscribeToLoan(
        id,
        async () => {
          console.log(
            "Loan profile realtime update received."
          );

          await loadLoan(false);
        }
      );
    } catch (err) {
      console.error(
        "REALTIME SUBSCRIPTION ERROR:",
        err
      );
    }

    return () => {
      if (channel) {
        removeLoanSubscription(channel);
      }
    };
  }, [id, loadLoan]);


  // ============================================================
  // SIGNED AGREEMENT DOCUMENT
  // ============================================================

  const signedAgreementDocument =
    documents.find(
      (document) =>
        document.document_type ===
          "Signed Loan Agreement" &&
        document.document_path &&
        (
          !agreement?.id ||
          document.agreement_id === agreement.id
        )
    );


  // ============================================================
  // OPEN STORED DOCUMENT
  // ============================================================

  const openStoredDocument = async (
    document
  ) => {
    try {
      if (!document?.document_path) {
        throw new Error(
          "This document does not have a storage path."
        );
      }

      setOpeningDocument(true);
      setError("");

      const {
        data,
        error: signedUrlError,
      } = await supabase.storage
        .from("loan-documents")
        .createSignedUrl(
          document.document_path,
          600
        );

      if (signedUrlError) {
        throw signedUrlError;
      }

      if (!data?.signedUrl) {
        throw new Error(
          "Could not create a secure document link."
        );
      }

      window.open(
        data.signedUrl,
        "_blank",
        "noopener,noreferrer"
      );
    } catch (err) {
      console.error(
        "DOCUMENT OPEN ERROR:",
        err
      );

      setError(
        err?.message ||
          "Unable to open the document."
      );
    } finally {
      setOpeningDocument(false);
    }
  };


  // ============================================================
  // PRINT / OPEN STORED SIGNED AGREEMENT
  // ============================================================

  const handlePrintAgreement = async () => {
    try {
      setGeneratingAgreement(true);
      setError("");

      const {
        data: document,
        error: documentError,
      } = await supabase
        .from("documents")
        .select(`
          id,
          agreement_id,
          document_type,
          document_name,
          document_path,
          created_at
        `)
        .eq("loan_id", id)
        .eq(
          "document_type",
          "Signed Loan Agreement"
        )
        .not(
          "document_path",
          "is",
          null
        )
        .order("created_at", {
          ascending: false,
        })
        .limit(1)
        .maybeSingle();

      if (documentError) {
        throw documentError;
      }

      if (!document) {
        throw new Error(
          "The customer's signed agreement has not been stored yet."
        );
      }

      if (!document.document_path) {
        throw new Error(
          "The signed agreement does not have a stored file."
        );
      }

      const {
        data,
        error: signedUrlError,
      } = await supabase.storage
        .from("loan-documents")
        .createSignedUrl(
          document.document_path,
          600
        );

      if (signedUrlError) {
        throw signedUrlError;
      }

      if (!data?.signedUrl) {
        throw new Error(
          "Could not create a secure link for the signed agreement."
        );
      }

      window.open(
        data.signedUrl,
        "_blank",
        "noopener,noreferrer"
      );
    } catch (err) {
      console.error(
        "PRINT AGREEMENT ERROR:",
        err
      );

      setError(
        err?.message ||
          "Unable to open the signed agreement."
      );
    } finally {
      setGeneratingAgreement(false);
    }
  };


  // ============================================================
  // PRINT / GENERATE STATEMENT
  // ============================================================

  const handlePrintStatement = async () => {
    try {
      if (!loan) {
        throw new Error(
          "Loan information is not available."
        );
      }

      setGeneratingStatement(true);
      setError("");

      const customerName =
        getCustomerName();

      const loanNumber =
        loan.loan_number || "-";

      const principalAmount =
        Number(
          loan.principal_amount || 0
        );

      const interestAmount =
        Number(
          loan.interest_amount || 0
        );

      const totalRepayment =
        Number(
          loan.total_repayment || 0
        );

      const currentBalance =
        Number(
          loan.current_balance || 0
        );

      const totalPaid =
        Number(
          loan.total_paid || 0
        );

      const interestRate =
        Number(
          loan.interest_rate || 0
        );

      const verificationToken =
        agreement?.verification_token || "";


      // --------------------------------------------------------
      // CREATE PDF
      // --------------------------------------------------------

      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });

      const pageWidth =
        pdf.internal.pageSize.getWidth();

      const pageHeight =
        pdf.internal.pageSize.getHeight();


      // --------------------------------------------------------
      // HEADER
      // --------------------------------------------------------

      pdf.setTextColor(
        23,
        37,
        84
      );

      pdf.setFontSize(20);
      pdf.setFont(
        "helvetica",
        "bold"
      );

      pdf.text(
        "UMHLOMUNYE FINANCE",
        15,
        18
      );

      pdf.setFontSize(9);
      pdf.setFont(
        "helvetica",
        "normal"
      );

      pdf.setTextColor(
        75,
        85,
        99
      );

      pdf.text(
        "Our dreams, Our hope",
        15,
        24
      );

      pdf.text(
        "Registration No: 2020/191721/07",
        15,
        30
      );

      pdf.text(
        "20 Jacaranda Street, Kinross, 2270",
        15,
        35
      );

      pdf.text(
        "Tel: 078 078 3879 | WhatsApp: 060 508 6672",
        15,
        40
      );

      pdf.text(
        "Email: umhlomunyeb@gmail.com",
        15,
        45
      );


      // --------------------------------------------------------
      // TITLE
      // --------------------------------------------------------

      pdf.setTextColor(
        23,
        37,
        84
      );

      pdf.setFontSize(18);
      pdf.setFont(
        "helvetica",
        "bold"
      );

      pdf.text(
        "LOAN STATEMENT",
        pageWidth - 15,
        20,
        {
          align: "right",
        }
      );

      pdf.setFontSize(8);
      pdf.setFont(
        "helvetica",
        "normal"
      );

      pdf.setTextColor(
        107,
        114,
        128
      );

      pdf.text(
        "Official Customer Statement",
        pageWidth - 15,
        26,
        {
          align: "right",
        }
      );


      // --------------------------------------------------------
      // QR CODE
      // --------------------------------------------------------

      if (verificationToken) {
        const verificationUrl =
          `${window.location.origin}/verify-agreement/${verificationToken}`;

        const qrDataUrl =
          await QRCode.toDataURL(
            verificationUrl,
            {
              width: 180,
              margin: 1,
            }
          );

        pdf.addImage(
          qrDataUrl,
          "PNG",
          pageWidth - 42,
          31,
          27,
          27
        );

        pdf.setFontSize(7);
        pdf.setTextColor(
          75,
          85,
          99
        );

        pdf.text(
          "Scan to verify",
          pageWidth - 28.5,
          61,
          {
            align: "center",
          }
        );
      }


      // --------------------------------------------------------
      // HEADER LINE
      // --------------------------------------------------------

      pdf.setDrawColor(
        23,
        37,
        84
      );

      pdf.setLineWidth(0.8);

      pdf.line(
        15,
        50,
        pageWidth - 15,
        50
      );


      // --------------------------------------------------------
      // CUSTOMER & LOAN INFORMATION
      // --------------------------------------------------------

      pdf.setFillColor(
        23,
        37,
        84
      );

      pdf.rect(
        15,
        58,
        pageWidth - 30,
        8,
        "F"
      );

      pdf.setTextColor(
        255,
        255,
        255
      );

      pdf.setFontSize(9);
      pdf.setFont(
        "helvetica",
        "bold"
      );

      pdf.text(
        "CUSTOMER & LOAN INFORMATION",
        18,
        63.5
      );

      autoTable(pdf, {
        startY: 66,
        margin: {
          left: 15,
          right: 15,
        },
        theme: "grid",
        styles: {
          fontSize: 8,
          cellPadding: 4,
        },
        headStyles: {
          fillColor: [
            229,
            231,
            235,
          ],
          textColor: [
            31,
            41,
            55,
          ],
          fontStyle: "bold",
        },
        body: [
          [
            "Customer",
            customerName,
            "Loan Number",
            loanNumber,
          ],
          [
            "Interest Rate",
            `${interestRate.toFixed(2)}%`,
            "Statement Date",
            new Date().toLocaleDateString(
              "en-ZA"
            ),
          ],
          [
            "First Payment Date",
            loan.first_payment_date
              ? new Date(
                  loan.first_payment_date
                ).toLocaleDateString(
                  "en-ZA"
                )
              : "-",
            "Next Interest Date",
            loan.next_interest_date
              ? new Date(
                  loan.next_interest_date
                ).toLocaleDateString(
                  "en-ZA"
                )
              : "-",
          ],
        ],
        columnStyles: {
          0: {
            fontStyle: "bold",
            cellWidth: 32,
          },
          1: {
            cellWidth: 58,
          },
          2: {
            fontStyle: "bold",
            cellWidth: 32,
          },
          3: {
            cellWidth: 58,
          },
        },
      });


      // --------------------------------------------------------
      // LOAN SUMMARY
      // --------------------------------------------------------

      let currentY =
        pdf.lastAutoTable.finalY + 10;

      pdf.setFillColor(
        23,
        37,
        84
      );

      pdf.rect(
        15,
        currentY,
        pageWidth - 30,
        8,
        "F"
      );

      pdf.setTextColor(
        255,
        255,
        255
      );

      pdf.setFontSize(9);
      pdf.setFont(
        "helvetica",
        "bold"
      );

      pdf.text(
        "LOAN SUMMARY",
        18,
        currentY + 5.5
      );

      currentY += 9;

      autoTable(pdf, {
        startY: currentY,
        margin: {
          left: 15,
          right: 15,
        },
        theme: "grid",
        styles: {
          fontSize: 8,
          cellPadding: 5,
        },
        body: [
          [
            "Principal",
            `R${principalAmount.toFixed(2)}`,
            "Interest",
            `R${interestAmount.toFixed(2)}`,
          ],
          [
            "Total Repayment",
            `R${totalRepayment.toFixed(2)}`,
            "Current Balance",
            `R${currentBalance.toFixed(2)}`,
          ],
          [
            "Total Paid",
            `R${totalPaid.toFixed(2)}`,
            "Interest Rate",
            `${interestRate.toFixed(2)}%`,
          ],
        ],
        columnStyles: {
          0: {
            fontStyle: "bold",
            cellWidth: 38,
          },
          1: {
            cellWidth: 52,
          },
          2: {
            fontStyle: "bold",
            cellWidth: 38,
          },
          3: {
            cellWidth: 52,
          },
        },
      });


      // --------------------------------------------------------
      // TRANSACTION HISTORY
      // --------------------------------------------------------

      currentY =
        pdf.lastAutoTable.finalY + 10;

      pdf.setFillColor(
        23,
        37,
        84
      );

      pdf.rect(
        15,
        currentY,
        pageWidth - 30,
        8,
        "F"
      );

      pdf.setTextColor(
        255,
        255,
        255
      );

      pdf.setFontSize(9);
      pdf.setFont(
        "helvetica",
        "bold"
      );

      pdf.text(
        "TRANSACTION HISTORY",
        18,
        currentY + 5.5
      );

      currentY += 9;


      const transactionRows =
        (
          statement.transactions || []
        ).map(
          (transaction) => {
            const date =
              transaction.transaction_date
                ? new Date(
                    transaction.transaction_date
                  ).toLocaleDateString(
                    "en-ZA"
                  )
                : "-";

            const description =
              transaction.description ||
              transaction.transaction_type ||
              "-";

            const debit =
              Number(
                transaction.debit || 0
              );

            const credit =
              Number(
                transaction.credit || 0
              );

            const balance =
              Number(
                transaction.balance || 0
              );

            return [
              date,
              description,
              debit > 0
                ? `R${debit.toFixed(2)}`
                : "-",
              credit > 0
                ? `R${credit.toFixed(2)}`
                : "-",
              `R${balance.toFixed(2)}`,
            ];
          }
        );


      if (transactionRows.length > 0) {
        autoTable(pdf, {
          startY: currentY,
          margin: {
            left: 15,
            right: 15,
          },
          theme: "grid",
          styles: {
            fontSize: 7.5,
            cellPadding: 3,
          },
          headStyles: {
            fillColor: [
              229,
              231,
              235,
            ],
            textColor: [
              31,
              41,
              55,
            ],
            fontStyle: "bold",
          },
          head: [
            [
              "Date",
              "Description",
              "Debit",
              "Credit",
              "Balance",
            ],
          ],
          body: transactionRows,
          columnStyles: {
            0: {
              cellWidth: 25,
            },
            1: {
              cellWidth: 75,
            },
            2: {
              cellWidth: 25,
              halign: "right",
            },
            3: {
              cellWidth: 25,
              halign: "right",
            },
            4: {
              cellWidth: 30,
              halign: "right",
            },
          },
        });
      } else {
        pdf.setTextColor(
          107,
          114,
          128
        );

        pdf.setFontSize(8);

        pdf.text(
          "No transactions recorded for this loan.",
          18,
          currentY + 6
        );
      }


      // --------------------------------------------------------
      // FOOTER
      // --------------------------------------------------------

      const footerY =
        pageHeight - 18;

      pdf.setDrawColor(
        209,
        213,
        219
      );

      pdf.setLineWidth(0.3);

      pdf.line(
        15,
        footerY - 6,
        pageWidth - 15,
        footerY - 6
      );

      pdf.setTextColor(
        107,
        114,
        128
      );

      pdf.setFontSize(7);

      pdf.text(
        'UMHLOMUNYE FINANCE | "Our dreams, Our hope"',
        pageWidth / 2,
        footerY,
        {
          align: "center",
        }
      );

      pdf.text(
        "This statement is generated from the official UMHLOMUNYE FINANCE loan management system.",
        pageWidth / 2,
        footerY + 4,
        {
          align: "center",
        }
      );


      // --------------------------------------------------------
      // PAGE NUMBERS
      // --------------------------------------------------------

      const totalPages =
        pdf.internal.getNumberOfPages();

      for (
        let pageNumber = 1;
        pageNumber <= totalPages;
        pageNumber++
      ) {
        pdf.setPage(pageNumber);

        pdf.setFontSize(7);

        pdf.setTextColor(
          107,
          114,
          128
        );

        pdf.text(
          `Page ${pageNumber} of ${totalPages}`,
          pageWidth - 15,
          pageHeight - 8,
          {
            align: "right",
          }
        );
      }


      // --------------------------------------------------------
      // CREATE BLOB
      // --------------------------------------------------------

      const pdfBlob =
        pdf.output("blob");

      if (!pdfBlob) {
        throw new Error(
          "Unable to generate the statement PDF."
        );
      }


      // --------------------------------------------------------
      // CURRENT USER
      // --------------------------------------------------------

      const {
        data: {
          user,
        },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) {
        throw userError;
      }

      if (!user) {
        throw new Error(
          "You must be logged in to store the statement."
        );
      }


      // --------------------------------------------------------
      // STORAGE PATH
      // --------------------------------------------------------

      const safeLoanNumber =
        loanNumber.replace(
          /[^a-zA-Z0-9_-]/g,
          "_"
        );

      const timestamp =
        new Date()
          .toISOString()
          .replace(
            /[:.]/g,
            "-"
          );

      const documentPath =
        `statements/${loan.customer_id}/${loan.id}/${safeLoanNumber}-statement-${timestamp}.pdf`;


      // --------------------------------------------------------
      // UPLOAD PDF
      // --------------------------------------------------------

      const {
        error: uploadError,
      } = await supabase.storage
        .from("loan-documents")
        .upload(
          documentPath,
          pdfBlob,
          {
            contentType:
              "application/pdf",
            upsert: false,
          }
        );

      if (uploadError) {
        throw uploadError;
      }


      // --------------------------------------------------------
      // SAVE DOCUMENT RECORD
      // --------------------------------------------------------

      const {
        data: documentRecord,
        error: documentError,
      } = await supabase
        .from("documents")
        .insert({
          customer_id:
            loan.customer_id,
          loan_id:
            loan.id,
          agreement_id:
            agreement?.id || null,
          document_type:
            "Loan Statement",
          document_name:
            `Loan Statement - ${loanNumber} - ${new Date().toLocaleDateString(
              "en-ZA"
            )}`,
          document_path:
            documentPath,
          created_by:
            user.id,
        })
        .select()
        .single();

      if (documentError) {
        await supabase.storage
          .from("loan-documents")
          .remove([
            documentPath,
          ]);

        throw documentError;
      }


      // --------------------------------------------------------
      // UPDATE DOCUMENT LIST
      // --------------------------------------------------------

      setDocuments(
        (previous) => [
          documentRecord,
          ...previous,
        ]
      );


      // --------------------------------------------------------
      // OPEN STORED PDF
      // --------------------------------------------------------

      await openStoredDocument(
        documentRecord
      );
    } catch (err) {
      console.error(
        "STATEMENT GENERATION ERROR:",
        err
      );

      setError(
        err?.message ||
          "Unable to generate and store the statement."
      );
    } finally {
      setGeneratingStatement(false);
    }
  };


  // ============================================================
  // PAYMENT SUCCESS
  // ============================================================

  const handlePaymentSuccess =
    async () => {
      setPaymentOpen(false);

      // Refresh without running the daily
      // interest engine a second time.
      await loadLoan(false);
    };


  // ============================================================
  // TAB CHANGE
  // ============================================================

  const handleTabChange = (
    _event,
    newValue
  ) => {
    setTab(newValue);

    if (newValue === 1) {
      loadStatement();
    }

    if (newValue === 2) {
      loadDocuments();
    }
  };


  // ============================================================
  // FORMAT MONEY
  // ============================================================

  const formatMoney = (value) =>
    Number(value || 0).toLocaleString(
      "en-ZA",
      {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }
    );


  // ============================================================
  // LOADING
  // ============================================================

  if (loading) {
    return (
      <Box
        sx={{
          minHeight: "70vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Stack
          spacing={2}
          alignItems="center"
        >
          <CircularProgress />

          <Typography color="text.secondary">
            Loading loan profile...
          </Typography>
        </Stack>
      </Box>
    );
  }


  // ============================================================
  // LOAN NOT FOUND
  // ============================================================

  if (!loan) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">
          {error || "Loan not found."}
        </Alert>

        <Button
          sx={{ mt: 2 }}
          startIcon={<ArrowBack />}
          onClick={() =>
            navigate("/loans")
          }
        >
          Back to Loans
        </Button>
      </Box>
    );
  }


  // ============================================================
  // VALUES
  // ============================================================

  const customerName =
    getCustomerName();

  const loanNumber =
    loan.loan_number || "-";

  const principalAmount =
    Number(
      loan.principal_amount || 0
    );

  const interestAmount =
    Number(
      loan.interest_amount || 0
    );

  const totalRepayment =
    Number(
      loan.total_repayment || 0
    );

  const currentBalance =
    Number(
      loan.current_balance || 0
    );

  const totalPaid =
    Number(
      loan.total_paid || 0
    );

  const interestRate =
    Number(
      loan.interest_rate || 0
    );


  // ============================================================
  // STATUS
  // ============================================================

  const loanStatus =
    String(
      loan.loan_status || "Unknown"
    );

  const isCompleted =
    loanStatus.toLowerCase() ===
    "completed";

  const isVoid =
    loanStatus.toLowerCase() ===
    "void";


  // ============================================================
  // RENDER
  // ============================================================

  return (
    <Box
      sx={{
        p: {
          xs: 2,
          md: 3,
        },
        maxWidth: 1500,
        mx: "auto",
      }}
    >

      {/* ====================================================== */}
      {/* HEADER */}
      {/* ====================================================== */}

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
        sx={{ mb: 3 }}
      >

        <Box>

          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            flexWrap="wrap"
          >

            <Button
              variant="outlined"
              startIcon={<ArrowBack />}
              onClick={() =>
                navigate("/loans")
              }
            >
              Back
            </Button>

            <Typography
              variant="h4"
              fontWeight={800}
            >
              Loan Profile
            </Typography>

            <Chip
              label={loanStatus}
              color={
                isCompleted
                  ? "success"
                  : isVoid
                  ? "error"
                  : "primary"
              }
              size="small"
            />

          </Stack>

          <Typography
            color="text.secondary"
            sx={{ mt: 0.5 }}
          >
            {loanNumber} • {customerName}
          </Typography>

        </Box>


        <Stack
          direction={{
            xs: "column",
            sm: "row",
          }}
          spacing={1}
        >

          <Button
            variant="outlined"
            startIcon={
              generatingStatement ? (
                <CircularProgress
                  size={18}
                  color="inherit"
                />
              ) : (
                <ReceiptLong />
              )
            }
            disabled={
              generatingStatement
            }
            onClick={
              handlePrintStatement
            }
          >
            {generatingStatement
              ? "Generating..."
              : "Generate Statement"}
          </Button>


          <Button
            variant="contained"
            startIcon={
              generatingAgreement ? (
                <CircularProgress
                  size={18}
                  color="inherit"
                />
              ) : (
                <PictureAsPdf />
              )
            }
            disabled={
              generatingAgreement ||
              !signedAgreementDocument
            }
            onClick={
              handlePrintAgreement
            }
          >
            {generatingAgreement
              ? "Opening..."
              : "Print Agreement"}
          </Button>

        </Stack>

      </Stack>


      {/* ====================================================== */}
      {/* ERROR */}
      {/* ====================================================== */}

      {error && (
        <Alert
          severity="error"
          sx={{ mb: 3 }}
          onClose={() =>
            setError("")
          }
        >
          {error}
        </Alert>
      )}


      {/* ====================================================== */}
      {/* LOAN SUMMARY */}
      {/* ====================================================== */}

      <Grid
        container
        spacing={2}
        sx={{ mb: 3 }}
      >

        <Grid
          size={{
            xs: 12,
            sm: 6,
            md: 3,
          }}
        >
          <Card>
            <CardContent>

              <Typography
                color="text.secondary"
                variant="body2"
              >
                Principal Amount
              </Typography>

              <Typography
                variant="h5"
                fontWeight={800}
                sx={{ mt: 1 }}
              >
                R{formatMoney(
                  principalAmount
                )}
              </Typography>

            </CardContent>
          </Card>
        </Grid>


        <Grid
          size={{
            xs: 12,
            sm: 6,
            md: 3,
          }}
        >
          <Card>
            <CardContent>

              <Typography
                color="text.secondary"
                variant="body2"
              >
                Interest
              </Typography>

              <Typography
                variant="h5"
                fontWeight={800}
                sx={{ mt: 1 }}
              >
                R{formatMoney(
                  interestAmount
                )}
              </Typography>

              <Typography
                variant="caption"
                color="text.secondary"
              >
                {interestRate.toFixed(2)}%
              </Typography>

            </CardContent>
          </Card>
        </Grid>


        <Grid
          size={{
            xs: 12,
            sm: 6,
            md: 3,
          }}
        >
          <Card>
            <CardContent>

              <Typography
                color="text.secondary"
                variant="body2"
              >
                Total Repayment
              </Typography>

              <Typography
                variant="h5"
                fontWeight={800}
                sx={{ mt: 1 }}
              >
                R{formatMoney(
                  totalRepayment
                )}
              </Typography>

            </CardContent>
          </Card>
        </Grid>


        <Grid
          size={{
            xs: 12,
            sm: 6,
            md: 3,
          }}
        >
          <Card>
            <CardContent>

              <Typography
                color="text.secondary"
                variant="body2"
              >
                Current Balance
              </Typography>

              <Typography
                variant="h5"
                fontWeight={800}
                sx={{ mt: 1 }}
              >
                R{formatMoney(
                  currentBalance
                )}
              </Typography>

              <Typography
                variant="caption"
                color="text.secondary"
              >
                Paid: R
                {formatMoney(
                  totalPaid
                )}
              </Typography>

            </CardContent>
          </Card>
        </Grid>

      </Grid>


      {/* ====================================================== */}
      {/* PAYMENT / INTEREST DATES */}
      {/* ====================================================== */}

      <Card sx={{ mb: 3 }}>
        <CardContent>

          <Typography
            variant="h6"
            fontWeight={700}
            sx={{ mb: 2 }}
          >
            Repayment Schedule
          </Typography>

          <Grid
            container
            spacing={2}
          >

            <Grid
              size={{
                xs: 12,
                sm: 6,
                md: 3,
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
                  First Payment Date
                </Typography>

                <Typography
                  fontWeight={700}
                  sx={{ mt: 0.5 }}
                >
                  {loan.first_payment_date
                    ? new Date(
                        loan.first_payment_date
                      ).toLocaleDateString(
                        "en-ZA"
                      )
                    : "Not recorded"}
                </Typography>
              </Paper>
            </Grid>


            <Grid
              size={{
                xs: 12,
                sm: 6,
                md: 3,
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
                  Next Payment Date
                </Typography>

                <Typography
                  fontWeight={700}
                  sx={{ mt: 0.5 }}
                >
                  {loan.next_payment_date
                    ? new Date(
                        loan.next_payment_date
                      ).toLocaleDateString(
                        "en-ZA"
                      )
                    : "Not scheduled"}
                </Typography>
              </Paper>
            </Grid>


            <Grid
              size={{
                xs: 12,
                sm: 6,
                md: 3,
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
                  Next Interest Date
                </Typography>

                <Typography
                  fontWeight={700}
                  sx={{ mt: 0.5 }}
                >
                  {loan.next_interest_date
                    ? new Date(
                        loan.next_interest_date
                      ).toLocaleDateString(
                        "en-ZA"
                      )
                    : "Not scheduled"}
                </Typography>
              </Paper>
            </Grid>


            <Grid
              size={{
                xs: 12,
                sm: 6,
                md: 3,
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
                  Last Payment Date
                </Typography>

                <Typography
                  fontWeight={700}
                  sx={{ mt: 0.5 }}
                >
                  {loan.last_payment_date
                    ? new Date(
                        loan.last_payment_date
                      ).toLocaleDateString(
                        "en-ZA"
                      )
                    : "No payment"}
                </Typography>
              </Paper>
            </Grid>

          </Grid>

        </CardContent>
      </Card>


      {/* ====================================================== */}
      {/* AGREEMENT */}
      {/* ====================================================== */}

      <Card sx={{ mb: 3 }}>
        <CardContent>

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

              <Stack
                direction="row"
                spacing={1}
                alignItems="center"
              >

                <Description />

                <Typography
                  variant="h6"
                  fontWeight={700}
                >
                  Loan Agreement
                </Typography>

              </Stack>

              {agreement ? (
                <>

                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mt: 0.5 }}
                  >
                    Agreement Number:{" "}
                    <strong>
                      {
                        agreement.agreement_number
                      }
                    </strong>
                  </Typography>

                  {agreement.accepted_at && (
                    <Typography
                      variant="body2"
                      color="text.secondary"
                    >
                      Accepted:{" "}
                      {new Date(
                        agreement.accepted_at
                      ).toLocaleString(
                        "en-ZA"
                      )}
                    </Typography>
                  )}

                </>
              ) : (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mt: 0.5 }}
                >
                  No agreement has been created
                  for this loan.
                </Typography>
              )}

            </Box>


            {agreement && (
              <Stack
                direction="row"
                spacing={1}
                alignItems="center"
                flexWrap="wrap"
              >

                <Chip
                  icon={
                    agreement.status ===
                    "Signed" ? (
                      <Verified />
                    ) : undefined
                  }
                  label={
                    agreement.status ||
                    "Pending"
                  }
                  color={
                    agreement.status ===
                    "Signed"
                      ? "success"
                      : "warning"
                  }
                  variant="outlined"
                />

                {signedAgreementDocument && (
                  <Chip
                    icon={
                      <PictureAsPdf />
                    }
                    label="PDF Stored"
                    color="success"
                    variant="outlined"
                  />
                )}

              </Stack>
            )}

          </Stack>


          {agreement &&
            agreement.status !==
              "Signed" && (
              <Alert
                severity="info"
                sx={{ mt: 2 }}
              >
                Agreement is awaiting customer
                acceptance. The official signed
                PDF will become available after
                the customer accepts the
                agreement.
              </Alert>
            )}


          {agreement &&
            agreement.status ===
              "Signed" &&
            !signedAgreementDocument && (
              <Alert
                severity="warning"
                sx={{ mt: 2 }}
              >
                The agreement is marked as signed,
                but the official signed PDF has
                not been stored yet.
              </Alert>
            )}

        </CardContent>
      </Card>


      {/* ====================================================== */}
      {/* QUICK ACTIONS */}
      {/* ====================================================== */}

      <Card sx={{ mb: 3 }}>
        <CardContent>

          <Typography
            variant="h6"
            fontWeight={700}
            sx={{ mb: 2 }}
          >
            Quick Actions
          </Typography>

          <Stack
            direction={{
              xs: "column",
              sm: "row",
            }}
            spacing={1.5}
          >

            <Button
              variant="outlined"
              startIcon={<Payment />}
              disabled={
                isCompleted ||
                isVoid ||
                currentBalance <= 0
              }
              onClick={() =>
                setPaymentOpen(true)
              }
            >
              Record Payment
            </Button>


            <Button
              variant="outlined"
              startIcon={
                generatingStatement ? (
                  <CircularProgress
                    size={18}
                    color="inherit"
                  />
                ) : (
                  <ReceiptLong />
                )
              }
              onClick={
                handlePrintStatement
              }
              disabled={
                generatingStatement
              }
            >
              {generatingStatement
                ? "Generating..."
                : "Generate Statement"}
            </Button>


            <Button
              variant="contained"
              startIcon={
                generatingAgreement ? (
                  <CircularProgress
                    size={18}
                    color="inherit"
                  />
                ) : (
                  <PictureAsPdf />
                )
              }
              disabled={
                generatingAgreement ||
                !signedAgreementDocument
              }
              onClick={
                handlePrintAgreement
              }
            >
              {generatingAgreement
                ? "Opening..."
                : "Print Agreement"}
            </Button>

          </Stack>

        </CardContent>
      </Card>


      {/* ====================================================== */}
      {/* TABS */}
      {/* ====================================================== */}

      <Card>

        <Tabs
          value={tab}
          onChange={handleTabChange}
          variant="scrollable"
          scrollButtons="auto"
        >

          <Tab
            icon={<History />}
            iconPosition="start"
            label="Transactions"
          />

          <Tab
            icon={<ReceiptLong />}
            iconPosition="start"
            label="Statement"
          />

          <Tab
            icon={<FolderOpen />}
            iconPosition="start"
            label={`Documents${
              documents.length
                ? ` (${documents.length})`
                : ""
            }`}
          />

        </Tabs>


        <Divider />


        {/* ==================================================== */}
        {/* TRANSACTIONS */}
        {/* ==================================================== */}

        {tab === 0 && (
          <Box sx={{ p: 3 }}>

            <LoanTransactions
              loanId={id}
            />

          </Box>
        )}


        {/* ==================================================== */}
        {/* STATEMENT */}
        {/* ==================================================== */}

        {tab === 1 && (
          <Box sx={{ p: 3 }}>

            <Stack
              direction={{
                xs: "column",
                sm: "row",
              }}
              justifyContent="space-between"
              alignItems={{
                xs: "flex-start",
                sm: "center",
              }}
              spacing={2}
              sx={{ mb: 3 }}
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
                  Complete financial position
                  and transaction history.
                </Typography>

              </Box>


              <Button
                variant="contained"
                startIcon={
                  generatingStatement ? (
                    <CircularProgress
                      size={18}
                      color="inherit"
                    />
                  ) : (
                    <ReceiptLong />
                  )
                }
                onClick={
                  handlePrintStatement
                }
                disabled={
                  generatingStatement
                }
              >
                {generatingStatement
                  ? "Generating..."
                  : "Generate Statement"}
              </Button>

            </Stack>


            <Grid
              container
              spacing={2}
            >

              <Grid
                size={{
                  xs: 12,
                  md: 3,
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
                    Principal
                  </Typography>

                  <Typography
                    variant="h6"
                    fontWeight={700}
                  >
                    R{formatMoney(
                      principalAmount
                    )}
                  </Typography>
                </Paper>
              </Grid>


              <Grid
                size={{
                  xs: 12,
                  md: 3,
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
                    Total Repayment
                  </Typography>

                  <Typography
                    variant="h6"
                    fontWeight={700}
                  >
                    R{formatMoney(
                      totalRepayment
                    )}
                  </Typography>
                </Paper>
              </Grid>


              <Grid
                size={{
                  xs: 12,
                  md: 3,
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
                    Total Paid
                  </Typography>

                  <Typography
                    variant="h6"
                    fontWeight={700}
                  >
                    R{formatMoney(
                      totalPaid
                    )}
                  </Typography>
                </Paper>
              </Grid>


              <Grid
                size={{
                  xs: 12,
                  md: 3,
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
                    Balance
                  </Typography>

                  <Typography
                    variant="h6"
                    fontWeight={700}
                  >
                    R{formatMoney(
                      currentBalance
                    )}
                  </Typography>
                </Paper>
              </Grid>

            </Grid>


            {/* OVERDUE INFORMATION */}

            {statement.overdues?.length >
              0 && (
              <Alert
                severity="warning"
                sx={{ mt: 3 }}
              >
                This loan has{" "}
                {statement.overdues.length}{" "}
                overdue item
                {statement.overdues.length !==
                1
                  ? "s"
                  : ""}.
              </Alert>
            )}


            <Box sx={{ mt: 3 }}>

              <Typography
                variant="subtitle1"
                fontWeight={700}
                sx={{ mb: 1 }}
              >
                Transactions
              </Typography>


              {statement.transactions
                .length === 0 ? (
                <Paper
                  variant="outlined"
                  sx={{ p: 3 }}
                >

                  <Typography
                    color="text.secondary"
                  >
                    No transactions recorded
                    for this loan.
                  </Typography>

                </Paper>
              ) : (
                <Paper
                  variant="outlined"
                  sx={{
                    overflow: "hidden",
                  }}
                >

                  {statement.transactions.map(
                    (
                      transaction,
                      index
                    ) => {

                      const debit =
                        Number(
                          transaction.debit ||
                            0
                        );

                      const credit =
                        Number(
                          transaction.credit ||
                            0
                        );

                      return (
                        <Box
                          key={
                            transaction.id ||
                            index
                          }
                          sx={{
                            p: 2,
                            borderBottom:
                              index <
                              statement
                                .transactions
                                .length -
                                1
                                ? "1px solid"
                                : "none",
                            borderColor:
                              "divider",
                          }}
                        >

                          <Stack
                            direction={{
                              xs: "column",
                              sm: "row",
                            }}
                            justifyContent="space-between"
                            spacing={1}
                          >

                            <Box>

                              <Typography
                                fontWeight={
                                  600
                                }
                              >
                                {
                                  transaction.description ||
                                  transaction.transaction_type ||
                                  "Transaction"
                                }
                              </Typography>

                              <Typography
                                variant="caption"
                                color="text.secondary"
                              >
                                {transaction.transaction_date
                                  ? new Date(
                                      transaction.transaction_date
                                    ).toLocaleDateString(
                                      "en-ZA"
                                    )
                                  : "-"}
                              </Typography>

                            </Box>


                            <Box
                              sx={{
                                textAlign: {
                                  xs: "left",
                                  sm: "right",
                                },
                              }}
                            >

                              {debit > 0 && (
                                <Typography
                                  fontWeight={
                                    700
                                  }
                                >
                                  Debit: R
                                  {formatMoney(
                                    debit
                                  )}
                                </Typography>
                              )}

                              {credit > 0 && (
                                <Typography
                                  fontWeight={
                                    700
                                  }
                                >
                                  Credit: R
                                  {formatMoney(
                                    credit
                                  )}
                                </Typography>
                              )}

                              <Typography
                                variant="caption"
                                color="text.secondary"
                              >
                                Balance: R
                                {formatMoney(
                                  transaction.balance
                                )}
                              </Typography>

                            </Box>

                          </Stack>

                        </Box>
                      );
                    }
                  )}

                </Paper>
              )}

            </Box>

          </Box>
        )}


        {/* ==================================================== */}
        {/* DOCUMENTS */}
        {/* ==================================================== */}

        {tab === 2 && (
          <Box sx={{ p: 3 }}>

            <Stack
              direction={{
                xs: "column",
                sm: "row",
              }}
              justifyContent="space-between"
              alignItems={{
                xs: "flex-start",
                sm: "center",
              }}
              spacing={2}
              sx={{ mb: 3 }}
            >

              <Box>

                <Typography
                  variant="h6"
                  fontWeight={700}
                >
                  Loan Documents
                </Typography>

                <Typography
                  variant="body2"
                  color="text.secondary"
                >
                  Official documents associated
                  with this loan.
                </Typography>

              </Box>


              <Button
                variant="outlined"
                startIcon={<FolderOpen />}
                onClick={() =>
                  loadDocuments()
                }
              >
                Refresh
              </Button>

            </Stack>


            {loadingDocuments ? (
              <Box
                sx={{
                  py: 6,
                  display: "flex",
                  justifyContent:
                    "center",
                }}
              >
                <CircularProgress />
              </Box>
            ) : documents.length ===
              0 ? (

              <Paper
                variant="outlined"
                sx={{ p: 5 }}
              >

                <Stack
                  alignItems="center"
                  spacing={1}
                >

                  <FolderOpen
                    sx={{
                      fontSize: 50,
                      color:
                        "text.secondary",
                    }}
                  />

                  <Typography
                    variant="h6"
                    fontWeight={700}
                  >
                    No documents found
                  </Typography>

                  <Typography
                    color="text.secondary"
                    textAlign="center"
                  >
                    Documents created for this
                    loan will appear here.
                  </Typography>

                </Stack>

              </Paper>

            ) : (

              <Stack spacing={2}>

                {documents.map(
                  (document) => (
                    <Paper
                      key={document.id}
                      variant="outlined"
                      sx={{
                        p: 2,
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

                        <Stack
                          direction="row"
                          spacing={2}
                          alignItems="center"
                        >

                          <Box
                            sx={{
                              width: 48,
                              height: 48,
                              borderRadius: 1,
                              display: "flex",
                              alignItems:
                                "center",
                              justifyContent:
                                "center",
                              bgcolor:
                                "grey.100",
                            }}
                          >
                            <Description
                              color="primary"
                            />
                          </Box>


                          <Box>

                            <Typography
                              fontWeight={700}
                            >
                              {
                                document.document_name
                              }
                            </Typography>

                            <Typography
                              variant="body2"
                              color="text.secondary"
                            >
                              {
                                document.document_type
                              }
                            </Typography>

                            {document.created_at && (
                              <Typography
                                variant="caption"
                                color="text.secondary"
                              >
                                Created:{" "}
                                {new Date(
                                  document.created_at
                                ).toLocaleString(
                                  "en-ZA"
                                )}
                              </Typography>
                            )}

                          </Box>

                        </Stack>


                        <Stack
                          direction="row"
                          spacing={1}
                          flexWrap="wrap"
                        >

                          {document.document_type ===
                            "Signed Loan Agreement" && (
                            <Chip
                              icon={
                                <Verified />
                              }
                              label="Official Signed Copy"
                              color="success"
                              size="small"
                            />
                          )}


                          {document.document_type ===
                            "Loan Statement" && (
                            <Chip
                              icon={
                                <ReceiptLong />
                              }
                              label="Official Statement"
                              color="primary"
                              size="small"
                            />
                          )}


                          <Button
                            variant="outlined"
                            startIcon={
                              openingDocument ? (
                                <CircularProgress
                                  size={16}
                                />
                              ) : (
                                <OpenInNew />
                              )
                            }
                            disabled={
                              !document.document_path ||
                              openingDocument
                            }
                            onClick={() =>
                              openStoredDocument(
                                document
                              )
                            }
                          >
                            View
                          </Button>


                          <Button
                            variant="contained"
                            startIcon={
                              <Print />
                            }
                            disabled={
                              !document.document_path
                            }
                            onClick={() =>
                              openStoredDocument(
                                document
                              )
                            }
                          >
                            Print
                          </Button>

                        </Stack>

                      </Stack>

                    </Paper>
                  )
                )}

              </Stack>
            )}

          </Box>
        )}

      </Card>


      {/* ====================================================== */}
      {/* PAYMENT DIALOG */}
      {/* ====================================================== */}

      <RecordPayment
        open={paymentOpen}
        loan={loan}
        onClose={() =>
          setPaymentOpen(false)
        }
        onSaved={
          handlePaymentSuccess
        }
      />

    </Box>
  );
}