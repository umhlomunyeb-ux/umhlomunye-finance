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
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";

import {
  ArrowBack,
  Description,
  Download,
  FolderOpen,
  History,
  OpenInNew,
  Payment,
  PictureAsPdf,
  ReceiptLong,
  Verified,
} from "@mui/icons-material";

import { getLoan } from "../../services/LoanService";
import { getLoanStatement } from "../../services/statementService";
import { getLoanTransactions } from "../../services/transactionService";
import RecordPayment from "../Repayments/RecordPayment";

const actionButtonSx = {
  minWidth: 180,
  width: 180,
  height: 42,
  textTransform: "none",
  fontWeight: 700,
  whiteSpace: "nowrap",
};

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatCurrency(value) {
  return `R${toNumber(value).toFixed(2)}`;
}

function formatDate(value) {
  if (!value) return "-";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleDateString("en-ZA");
}

function formatDateTime(value) {
  if (!value) return "-";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString("en-ZA");
}

function getTransactionDebit(transaction) {
  return toNumber(transaction?.debit);
}

function getTransactionCredit(transaction) {
  return toNumber(transaction?.credit);
}

function getTransactionBalance(transaction) {
  return toNumber(transaction?.balance);
}

/*
 * IMPORTANT:
 * Transactions must always display in chronological order.
 *
 * Oldest / first recorded transaction = TOP
 * Newest / latest transaction = BOTTOM
 *
 * transaction_date is the primary chronological field.
 * created_at is used as a tie-breaker when two transactions
 * have the same transaction date/time.
 */
function sortTransactionsChronologically(transactionList) {
  return [...(transactionList || [])].sort((a, b) => {
    const dateA = new Date(
      a?.transaction_date || a?.created_at || 0
    ).getTime();

    const dateB = new Date(
      b?.transaction_date || b?.created_at || 0
    ).getTime();

    if (dateA !== dateB) {
      return dateA - dateB;
    }

    const createdA = new Date(
      a?.created_at || 0
    ).getTime();

    const createdB = new Date(
      b?.created_at || 0
    ).getTime();

    if (createdA !== createdB) {
      return createdA - createdB;
    }

    return String(a?.id || "").localeCompare(
      String(b?.id || "")
    );
  });
}

export default function LoanProfile() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [loan, setLoan] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [agreement, setAgreement] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [transactions, setTransactions] = useState([]);

  const [statement, setStatement] = useState({
    transactions: [],
    overdues: [],
  });

  const [loading, setLoading] = useState(true);
  const [loadingTransactions, setLoadingTransactions] =
    useState(false);
  const [generatingStatement, setGeneratingStatement] =
    useState(false);
  const [generatingPaidUpLetter, setGeneratingPaidUpLetter] =
    useState(false);

  const [error, setError] = useState("");

  const [tab, setTab] = useState(0);

  const [paymentDialogOpen, setPaymentDialogOpen] =
    useState(false);

  const currentLoanBalance = useMemo(() => {
    if (!loan) return 0;

    const value =
      loan.current_balance ??
      loan.balance ??
      0;

    return toNumber(value);
  }, [loan]);

  const isPaidUp = useMemo(
    () => currentLoanBalance <= 0,
    [currentLoanBalance]
  );

  const agreementStatus = useMemo(
    () =>
      String(
        agreement?.status || ""
      )
        .trim()
        .toLowerCase(),
    [agreement]
  );

  const isAgreementPending = useMemo(
    () => agreementStatus === "pending",
    [agreementStatus]
  );

  const isAgreementSigned = useMemo(
    () => agreementStatus === "signed",
    [agreementStatus]
  );

  const hasAgreement = useMemo(
    () => Boolean(agreement?.id),
    [agreement]
  );

  const safeLoanNumber = useMemo(
    () =>
      loan?.loan_number ||
      `LOAN-${id}`,
    [loan, id]
  );

  const loadTransactions = useCallback(
    async (loanId) => {
      if (!loanId) return [];

      setLoadingTransactions(true);

      try {
        const data =
          await getLoanTransactions(loanId);

        const normalized = (data || []).map(
          (transaction) => ({
            ...transaction,
            debit: toNumber(
              transaction.debit
            ),
            credit: toNumber(
              transaction.credit
            ),
            balance: toNumber(
              transaction.balance
            ),
          })
        );

        const chronological =
          sortTransactionsChronologically(
            normalized
          );

        setTransactions(chronological);

        return chronological;
      } catch (err) {
        console.error(
          "LOAD TRANSACTIONS ERROR:",
          err
        );
        throw err;
      } finally {
        setLoadingTransactions(false);
      }
    },
    []
  );

  const loadAgreement = useCallback(
    async (loanId) => {
      if (!loanId) return null;

      const {
        data,
        error: agreementError,
      } = await supabase
        .from("loan_agreements")
        .select("*")
        .eq("loan_id", loanId)
        .maybeSingle();

      if (agreementError) {
        console.error(
          "LOAD AGREEMENT ERROR:",
          agreementError
        );
        throw agreementError;
      }

      setAgreement(data || null);

      return data || null;
    },
    []
  );

  const loadDocuments = useCallback(
    async (loanId, customerId) => {
      if (!loanId) return [];

      let query = supabase
        .from("documents")
        .select("*")
        .eq("loan_id", loanId)
        .order("created_at", {
          ascending: false,
        });

      if (customerId) {
        query = query.or(
          `loan_id.eq.${loanId},customer_id.eq.${customerId}`
        );
      }

      const {
        data,
        error: documentsError,
      } = await query;

      if (documentsError) {
        console.error(
          "LOAD DOCUMENTS ERROR:",
          documentsError
        );
        throw documentsError;
      }

      const uniqueDocuments = [];
      const seen = new Set();

      for (const document of data || []) {
        const key =
          document.id ||
          document.path ||
          `${document.document_type}-${document.document_name}`;

        if (!seen.has(key)) {
          seen.add(key);
          uniqueDocuments.push(document);
        }
      }

      setDocuments(uniqueDocuments);

      return uniqueDocuments;
    },
    []
  );

  const loadLoan = useCallback(
    async () => {
      if (!id) {
        setError("Loan ID is missing.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");

      try {
        const loanData =
          await getLoan(id);

        if (!loanData) {
          throw new Error(
            "Loan not found."
          );
        }

        /*
         * =====================================================
         * LOAD CUSTOMER INFORMATION
         *
         * LoanService returns the Supabase relationship as
         * "customers", not "customer".
         *
         * We normalize it to "customer" so the rest of this
         * LoanProfile can continue using loan.customer.
         * =====================================================
         */
        let customerData =
          loanData.customer ||
          loanData.customers ||
          null;

        /*
         * If the relationship was not returned for any reason,
         * explicitly load the customer using customer_id.
         */
        if (
          !customerData &&
          loanData.customer_id
        ) {
          const {
            data: fetchedCustomer,
            error: customerError,
          } = await supabase
            .from("customers")
            .select("*")
            .eq(
              "id",
              loanData.customer_id
            )
            .maybeSingle();

          if (customerError) {
            console.error(
              "LOAD CUSTOMER ERROR:",
              customerError
            );
          } else {
            customerData =
              fetchedCustomer || null;
          }
        }

        /*
         * Normalize the customer name so the UI can display
         * it even when the customers table stores first_name
         * and last_name separately.
         */
        if (customerData) {
          customerData = {
            ...customerData,
            full_name:
              customerData.full_name ||
              customerData.name ||
              [
                customerData.first_name,
                customerData.last_name,
              ]
                .filter(Boolean)
                .join(" ") ||
              "-",
          };
        }

        setCustomer(customerData);

        /*
         * Attach the customer as "customer" to the loan object.
         * This keeps all existing loan.customer references
         * working throughout LoanProfile.
         */
        setLoan({
          ...loanData,
          customer: customerData,
        });

        const transactionData =
          await loadTransactions(id);

        try {
          await loadAgreement(id);
        } catch (agreementError) {
          console.error(
            agreementError
          );
        }

        try {
          await loadDocuments(
            id,
            loanData.customer_id
          );
        } catch (documentsError) {
          console.error(
            documentsError
          );
        }

        try {
          const statementData =
            await getLoanStatement(id);

          setStatement({
            transactions:
              transactionData,
            overdues:
              statementData?.overdues ||
              [],
          });
        } catch (statementError) {
          console.error(
            "LOAD STATEMENT DATA ERROR:",
            statementError
          );

          setStatement({
            transactions:
              transactionData,
            overdues: [],
          });
        }
      } catch (err) {
        console.error(
          "LOAD LOAN ERROR:",
          err
        );
        setError(
          err?.message ||
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
      loadTransactions,
    ]
  );

  useEffect(() => {
    loadLoan();
  }, [loadLoan]);

  const handlePaymentComplete =
    async () => {
      setPaymentDialogOpen(false);

      try {
        await loadLoan();
      } catch (err) {
        console.error(err);
      }
    };

  const getDocumentUrl =
    useCallback(
      async (document) => {
        if (!document?.path) {
          throw new Error(
            "Document path is missing."
          );
        }

        const {
          data,
          error: urlError,
        } =
          await supabase.storage
            .from("loan-documents")
            .createSignedUrl(
              document.path,
              60 * 60
            );

        if (urlError) {
          throw urlError;
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

  const handleOpenDocument =
    useCallback(
      async (document) => {
        try {
          const url =
            await getDocumentUrl(
              document
            );

          window.open(
            url,
            "_blank",
            "noopener,noreferrer"
          );
        } catch (err) {
          console.error(
            "OPEN DOCUMENT ERROR:",
            err
          );

          window.alert(
            err?.message ||
              "Unable to open document."
          );
        }
      },
      [getDocumentUrl]
    );

  const generateStatementPdf =
    useCallback(
      async (
        freshTransactions = transactions
      ) => {
        if (!loan) {
          throw new Error(
            "Loan information is not available."
          );
        }

        const chronologicalTransactions =
          sortTransactionsChronologically(
            freshTransactions
          );

        const pdf = new jsPDF();

        const pageWidth =
          pdf.internal.pageSize.getWidth();

        pdf.setFontSize(18);
        pdf.setFont(
          "helvetica",
          "bold"
        );
        pdf.text(
          "UMHLOMUNYE FINANCE",
          14,
          18
        );

        pdf.setFontSize(9);
        pdf.setFont(
          "helvetica",
          "normal"
        );
        pdf.text(
          "Our dreams, Our hope",
          14,
          24
        );

        pdf.setFontSize(10);
        pdf.text(
          "20 Jacaranda Street, Kinross, 2270",
          14,
          31
        );
        pdf.text(
          "Tel: 078 078 3879",
          14,
          36
        );
        pdf.text(
          "WhatsApp: 060 508 6672",
          14,
          41
        );
        pdf.text(
          "Email: umhlomunyeb@gmail.com",
          14,
          46
        );

        pdf.setFontSize(15);
        pdf.setFont(
          "helvetica",
          "bold"
        );
        pdf.text(
          "LOAN STATEMENT",
          14,
          58
        );

        pdf.setFontSize(10);
        pdf.setFont(
          "helvetica",
          "normal"
        );

        pdf.text(
          `Loan Number: ${safeLoanNumber}`,
          14,
          66
        );

        pdf.text(
          `Customer: ${
            loan.customer
              ?.full_name ||
            customer?.full_name ||
            customer?.name ||
            "Customer"
          }`,
          14,
          72
        );

        pdf.text(
          `Principal Amount: ${formatCurrency(
            loan.principal_amount
          )}`,
          14,
          78
        );

        pdf.text(
          `Current Balance: ${formatCurrency(
            currentLoanBalance
          )}`,
          14,
          84
        );

        pdf.text(
          `Statement Date: ${formatDate(
            new Date()
          )}`,
          14,
          90
        );

        const tableRows =
          chronologicalTransactions.map(
            (transaction) => [
              formatDate(
                transaction.transaction_date
              ),
              transaction.transaction_type ||
                "-",
              transaction.description ||
                "-",
              formatCurrency(
                getTransactionDebit(
                  transaction
                )
              ),
              formatCurrency(
                getTransactionCredit(
                  transaction
                )
              ),
              formatCurrency(
                getTransactionBalance(
                  transaction
                )
              ),
            ]
          );

        autoTable(pdf, {
          startY: 98,
          head: [
            [
              "Date",
              "Type",
              "Description",
              "Debit",
              "Credit",
              "Balance",
            ],
          ],
          body:
            tableRows.length > 0
              ? tableRows
              : [
                  [
                    "-",
                    "-",
                    "No transactions found.",
                    "-",
                    "-",
                    "-",
                  ],
                ],
          theme: "grid",
          styles: {
            fontSize: 8,
            cellPadding: 3,
          },
          headStyles: {
            fontStyle: "bold",
          },
          columnStyles: {
            0: {
              cellWidth: 24,
            },
            1: {
              cellWidth: 24,
            },
            2: {
              cellWidth: 55,
            },
            3: {
              halign: "right",
              cellWidth: 25,
            },
            4: {
              halign: "right",
              cellWidth: 25,
            },
            5: {
              halign: "right",
              cellWidth: 25,
            },
          },
        });

        let finalY =
          pdf.lastAutoTable?.finalY ||
          110;

        if (
          statement.overdues?.length >
          0
        ) {
          finalY += 12;

          pdf.setFontSize(12);
          pdf.setFont(
            "helvetica",
            "bold"
          );
          pdf.text(
            "Overdue Items",
            14,
            finalY
          );

          const overdueRows =
            statement.overdues.map(
              (overdue) => [
                formatDate(
                  overdue.due_date ||
                    overdue.expected_date
                ),
                formatCurrency(
                  overdue.amount_due ||
                    overdue.expected_amount
                ),
                formatCurrency(
                  overdue.amount_paid ||
                    overdue.paid_amount
                ),
                formatCurrency(
                  overdue.amount_outstanding ||
                    overdue.outstanding_amount
                ),
                overdue.status || "-",
              ]
            );

          autoTable(pdf, {
            startY: finalY + 5,
            head: [
              [
                "Due Date",
                "Expected",
                "Paid",
                "Outstanding",
                "Status",
              ],
            ],
            body: overdueRows,
            theme: "grid",
            styles: {
              fontSize: 8,
              cellPadding: 3,
            },
          });

          finalY =
            pdf.lastAutoTable?.finalY ||
            finalY + 20;
        }

        finalY += 15;

        pdf.setFontSize(9);
        pdf.setFont(
          "helvetica",
          "normal"
        );
        pdf.text(
          "This statement is generated from the Umhlomunye Finance loan records.",
          14,
          finalY
        );

        const verificationToken =
          loan.statement_verification_token ||
          loan.verification_token ||
          null;

        if (verificationToken) {
          const verificationUrl =
            `${window.location.origin}/verify-statement/${verificationToken}`;

          try {
            const qrDataUrl =
              await QRCode.toDataURL(
                verificationUrl,
                {
                  width: 110,
                  margin: 1,
                }
              );

            pdf.addImage(
              qrDataUrl,
              "PNG",
              pageWidth - 45,
              14,
              30,
              30
            );

            pdf.setFontSize(7);
            pdf.text(
              "Scan to verify",
              pageWidth - 43,
              48
            );
          } catch (qrError) {
            console.error(
              "QR CODE ERROR:",
              qrError
            );
          }
        }

        return pdf;
      },
      [
        customer,
        currentLoanBalance,
        loan,
        safeLoanNumber,
        statement.overdues,
        transactions,
      ]
    );

  const handlePrintStatement =
    useCallback(async () => {
      if (!loan) return;

      setGeneratingStatement(true);

      try {
        const freshTransactions =
          await loadTransactions(id);

        const chronologicalTransactions =
          sortTransactionsChronologically(
            freshTransactions
          );

        setStatement((current) => ({
          ...current,
          transactions:
            chronologicalTransactions,
        }));

        const pdf =
          await generateStatementPdf(
            chronologicalTransactions
          );

        const timestamp =
          new Date()
            .toISOString()
            .replace(
              /[:.]/g,
              "-"
            );

        const fileName =
          `${safeLoanNumber}-statement-${timestamp}.pdf`;

        const blob =
          pdf.output("blob");

        const path =
          `statements/${loan.customer_id}/${loan.id}/${fileName}`;

        const {
          error: uploadError,
        } =
          await supabase.storage
            .from("loan-documents")
            .upload(
              path,
              blob,
              {
                contentType:
                  "application/pdf",
                upsert: false,
              }
            );

        if (uploadError) {
          console.error(
            "STATEMENT UPLOAD ERROR:",
            uploadError
          );
        } else {
          const {
            data: userData,
          } =
            await supabase.auth.getUser();

          const {
            error: documentError,
          } =
            await supabase
              .from("documents")
              .insert({
                customer_id:
                  loan.customer_id,
                loan_id: loan.id,
                agreement_id:
                  agreement?.id ||
                  null,
                document_type:
                  "Loan Statement",
                document_name:
                  fileName,
                path,
                created_by:
                  userData?.user?.id ||
                  null,
              });

          if (documentError) {
            console.error(
              "STATEMENT DOCUMENT RECORD ERROR:",
              documentError
            );
          } else {
            await loadDocuments(
              id,
              loan.customer_id
            );
          }
        }

        pdf.save(fileName);
      } catch (err) {
        console.error(
          "GENERATE STATEMENT ERROR:",
          err
        );

        window.alert(
          err?.message ||
            "Unable to generate statement."
        );
      } finally {
        setGeneratingStatement(
          false
        );
      }
    }, [
      agreement,
      generateStatementPdf,
      id,
      loadDocuments,
      loadTransactions,
      loan,
      safeLoanNumber,
    ]);

  const handleOpenStatement =
    useCallback(async () => {
      if (!loan) return;

      setGeneratingStatement(true);

      try {
        const freshTransactions =
          await loadTransactions(id);

        const chronologicalTransactions =
          sortTransactionsChronologically(
            freshTransactions
          );

        setStatement((current) => ({
          ...current,
          transactions:
            chronologicalTransactions,
        }));

        const pdf =
          await generateStatementPdf(
            chronologicalTransactions
          );

        const blobUrl =
          pdf.output("bloburl");

        window.open(
          blobUrl,
          "_blank",
          "noopener,noreferrer"
        );
      } catch (err) {
        console.error(
          "OPEN STATEMENT ERROR:",
          err
        );

        window.alert(
          err?.message ||
            "Unable to open statement."
        );
      } finally {
        setGeneratingStatement(
          false
        );
      }
    }, [
      generateStatementPdf,
      id,
      loadTransactions,
      loan,
    ]);

  const handlePaidUpLetter =
    useCallback(async () => {
      if (!loan || !isPaidUp) return;

      setGeneratingPaidUpLetter(
        true
      );

      try {
        const pdf = new jsPDF();

        const pageWidth =
          pdf.internal.pageSize.getWidth();

        pdf.setFontSize(18);
        pdf.setFont(
          "helvetica",
          "bold"
        );
        pdf.text(
          "UMHLOMUNYE FINANCE",
          14,
          18
        );

        pdf.setFontSize(9);
        pdf.setFont(
          "helvetica",
          "normal"
        );
        pdf.text(
          "Our dreams, Our hope",
          14,
          24
        );

        pdf.setFontSize(10);
        pdf.text(
          "20 Jacaranda Street, Kinross, 2270",
          14,
          31
        );
        pdf.text(
          "Tel: 078 078 3879",
          14,
          36
        );
        pdf.text(
          "WhatsApp: 060 508 6672",
          14,
          41
        );
        pdf.text(
          "Email: umhlomunyeb@gmail.com",
          14,
          46
        );

        pdf.setFontSize(17);
        pdf.setFont(
          "helvetica",
          "bold"
        );
        pdf.text(
          "PAID-UP LETTER",
          14,
          63
        );

        pdf.setFontSize(11);
        pdf.setFont(
          "helvetica",
          "normal"
        );

        const customerName =
          loan.customer
            ?.full_name ||
          customer?.full_name ||
          customer?.name ||
          "Customer";

        pdf.text(
          `Date: ${formatDate(
            new Date()
          )}`,
          14,
          76
        );

        pdf.text(
          `Loan Number: ${safeLoanNumber}`,
          14,
          84
        );

        pdf.text(
          `Customer: ${customerName}`,
          14,
          92
        );

        const body =
          "This letter confirms that the above-mentioned loan account has been paid in full and that the current outstanding balance recorded on the account is R0.00.";

        const wrappedBody =
          pdf.splitTextToSize(
            body,
            pageWidth - 28
          );

        pdf.text(
          wrappedBody,
          14,
          108
        );

        const nextY =
          108 +
          wrappedBody.length * 7 +
          15;

        pdf.text(
          "The loan account is therefore recorded as paid up as at the date of this letter.",
          14,
          nextY
        );

        pdf.setFont(
          "helvetica",
          "bold"
        );

        pdf.text(
          "UMHLOMUNYE FINANCE",
          14,
          nextY + 30
        );

        pdf.setFont(
          "helvetica",
          "normal"
        );

        pdf.text(
          "Authorised Representative",
          14,
          nextY + 37
        );

        if (
          loan.statement_verification_token
        ) {
          const verificationUrl =
            `${window.location.origin}/verify-statement/${loan.statement_verification_token}`;

          try {
            const qrDataUrl =
              await QRCode.toDataURL(
                verificationUrl,
                {
                  width: 120,
                  margin: 1,
                }
              );

            pdf.addImage(
              qrDataUrl,
              "PNG",
              pageWidth - 48,
              14,
              32,
              32
            );

            pdf.setFontSize(7);
            pdf.text(
              "Verify",
              pageWidth - 39,
              50
            );
          } catch (qrError) {
            console.error(
              "PAID-UP QR ERROR:",
              qrError
            );
          }
        }

        const timestamp =
          new Date()
            .toISOString()
            .replace(
              /[:.]/g,
              "-"
            );

        const fileName =
          `${safeLoanNumber}-paid-up-letter-${timestamp}.pdf`;

        const blob =
          pdf.output("blob");

        const path =
          `paid-up-letters/${loan.customer_id}/${loan.id}/${fileName}`;

        const {
          error: uploadError,
        } =
          await supabase.storage
            .from("loan-documents")
            .upload(
              path,
              blob,
              {
                contentType:
                  "application/pdf",
                upsert: false,
              }
            );

        if (uploadError) {
          throw uploadError;
        }

        const {
          data: userData,
        } =
          await supabase.auth.getUser();

        const {
          error: documentError,
        } =
          await supabase
            .from("documents")
            .insert({
              customer_id:
                loan.customer_id,
              loan_id: loan.id,
              agreement_id:
                agreement?.id ||
                null,
              document_type:
                "Paid-Up Letter",
              document_name:
                fileName,
              path,
              created_by:
                userData?.user?.id ||
                null,
            });

        if (documentError) {
          throw documentError;
        }

        await loadDocuments(
          id,
          loan.customer_id
        );

        pdf.save(fileName);
      } catch (err) {
        console.error(
          "PAID-UP LETTER ERROR:",
          err
        );

        window.alert(
          err?.message ||
            "Unable to generate paid-up letter."
        );
      } finally {
        setGeneratingPaidUpLetter(
          false
        );
      }
    }, [
      agreement,
      customer,
      id,
      isPaidUp,
      loadDocuments,
      loan,
      safeLoanNumber,
    ]);

  const handleDownloadDocument =
    useCallback(
      async (document) => {
        try {
          const url =
            await getDocumentUrl(
              document
            );

          const response =
            await fetch(url);

          if (!response.ok) {
            throw new Error(
              "Unable to download document."
            );
          }

          const blob =
            await response.blob();

          const blobUrl =
            URL.createObjectURL(blob);

          const link =
            window.document.createElement(
              "a"
            );

          link.href = blobUrl;

          link.download =
            document.document_name ||
            document.name ||
            "document.pdf";

          window.document.body.appendChild(
            link
          );

          link.click();

          link.remove();

          URL.revokeObjectURL(
            blobUrl
          );
        } catch (err) {
          console.error(
            "DOWNLOAD DOCUMENT ERROR:",
            err
          );

          window.alert(
            err?.message ||
              "Unable to download document."
          );
        }
      },
      [getDocumentUrl]
    );

  const handleViewAgreement =
    () => {
      if (!agreement?.id) return;

      const agreementDocument =
        documents.find(
          (document) =>
            document.agreement_id ===
              agreement.id &&
            String(
              document.document_type ||
                ""
            )
              .toLowerCase()
              .includes("agreement")
        );

      if (agreementDocument) {
        handleOpenDocument(
          agreementDocument
        );
        return;
      }

      const fallbackDocument =
        documents.find((document) =>
          String(
            document.document_type ||
              ""
          )
            .toLowerCase()
            .includes(
              "signed loan agreement"
            )
        );

      if (fallbackDocument) {
        handleOpenDocument(
          fallbackDocument
        );
        return;
      }

      window.alert(
        "Agreement document is not available yet."
      );
    };

  if (loading) {
    return (
      <Box
        sx={{
          minHeight: "60vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">
          {error}
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

  if (!loan) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning">
          Loan could not be found.
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

  return (
    <Box
      sx={{
        p: {
          xs: 1.5,
          md: 3,
        },
      }}
    >
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
          <Button
            startIcon={<ArrowBack />}
            onClick={() =>
              navigate("/loans")
            }
            sx={{
              mb: 1,
              textTransform: "none",
            }}
          >
            Back to Loans
          </Button>

          <Typography
            variant="h4"
            sx={{ fontWeight: 800 }}
          >
            Loan Profile
          </Typography>

          <Typography
            variant="body2"
            color="text.secondary"
          >
            {safeLoanNumber}
          </Typography>
        </Box>

        <Chip
          label={
            isPaidUp
              ? "Paid Up"
              : "Active"
          }
          color={
            isPaidUp
              ? "success"
              : "primary"
          }
          sx={{
            fontWeight: 700,
            alignSelf: {
              xs: "flex-start",
              md: "center",
            },
          }}
        />
      </Stack>

      {/* =====================================================
          CUSTOMER / LOAN / ACTIONS
      ====================================================== */}

      <Grid
        container
        spacing={2.5}
        alignItems="stretch"
        sx={{ mb: 2.5 }}
      >
        {/* CUSTOMER INFORMATION */}
        <Grid
          item
          xs={12}
          md={6}
          sx={{
            minWidth: 0,
            display: "flex",
          }}
        >
          <Card
            elevation={0}
            sx={{
              border: "1px solid",
              borderColor: "divider",
              width: "100%",
              height: "100%",
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <CardContent
              sx={{
                p: 3,
                flex: 1,
                display: "flex",
                flexDirection: "column",
              }}
            >
              <Typography
                variant="h6"
                sx={{
                  fontWeight: 800,
                  mb: 2.5,
                }}
              >
                Customer Information
              </Typography>

              <Grid
                container
                spacing={2.5}
                sx={{
                  flex: 1,
                }}
              >
                {/* ROW 1 - FULL NAME */}
                <Grid
                  item
                  xs={12}
                  sm={6}
                  sx={{ minWidth: 0 }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      display="block"
                    >
                      Full Name
                    </Typography>

                    <Typography
                      sx={{
                        fontWeight: 700,
                        overflowWrap:
                          "anywhere",
                      }}
                    >
                      {loan.customer
                        ?.full_name ||
                        customer?.full_name ||
                        customer?.name ||
                        [
                          customer?.first_name,
                          customer?.last_name,
                        ]
                          .filter(Boolean)
                          .join(" ") ||
                        "-"}
                    </Typography>
                  </Box>
                </Grid>

                {/* ROW 1 - ID NUMBER */}
                <Grid
                  item
                  xs={12}
                  sm={6}
                  sx={{ minWidth: 0 }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      display="block"
                    >
                      ID Number
                    </Typography>

                    <Typography
                      sx={{
                        fontWeight: 700,
                        overflowWrap:
                          "anywhere",
                      }}
                    >
                      {loan.customer
                        ?.id_number ||
                        customer?.id_number ||
                        customer?.identity_number ||
                        "-"}
                    </Typography>
                  </Box>
                </Grid>

                {/* ROW 2 - PHONE */}
                <Grid
                  item
                  xs={12}
                  sm={6}
                  sx={{ minWidth: 0 }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      display="block"
                    >
                      Phone
                    </Typography>

                    <Typography
                      sx={{
                        fontWeight: 700,
                        overflowWrap:
                          "anywhere",
                      }}
                    >
                      {loan.customer
                        ?.phone ||
                        loan.customer
                          ?.phone_number ||
                        customer?.phone ||
                        customer?.phone_number ||
                        "-"}
                    </Typography>
                  </Box>
                </Grid>

                {/* ROW 2 - EMAIL */}
                <Grid
                  item
                  xs={12}
                  sm={6}
                  sx={{ minWidth: 0 }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      display="block"
                    >
                      Email
                    </Typography>

                    <Typography
                      sx={{
                        fontWeight: 700,
                        overflowWrap:
                          "anywhere",
                      }}
                    >
                      {loan.customer
                        ?.email ||
                        customer?.email ||
                        "-"}
                    </Typography>
                  </Box>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        {/* LOAN INFORMATION */}
        <Grid
          item
          xs={12}
          md={6}
          sx={{
            minWidth: 0,
            display: "flex",
          }}
        >
          <Card
            elevation={0}
            sx={{
              border: "1px solid",
              borderColor: "divider",
              width: "100%",
              height: "100%",
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <CardContent
              sx={{
                p: 3,
                flex: 1,
                display: "flex",
                flexDirection: "column",
              }}
            >
              <Typography
                variant="h6"
                sx={{
                  fontWeight: 800,
                  mb: 2.5,
                }}
              >
                Loan Information
              </Typography>

              <Grid
                container
                spacing={2.5}
                sx={{
                  flex: 1,
                }}
              >
                {/* ROW 1 - LOAN NUMBER */}
                <Grid
                  item
                  xs={12}
                  sm={4}
                  sx={{ minWidth: 0 }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      display="block"
                    >
                      Loan Number
                    </Typography>

                    <Typography
                      variant="h6"
                      sx={{
                        fontWeight: 800,
                        overflowWrap:
                          "anywhere",
                      }}
                    >
                      {safeLoanNumber}
                    </Typography>
                  </Box>
                </Grid>

                {/* ROW 1 - LOAN STATUS */}
                <Grid
                  item
                  xs={12}
                  sm={4}
                  sx={{ minWidth: 0 }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      display="block"
                    >
                      Loan Status
                    </Typography>

                    <Box sx={{ mt: 0.5 }}>
                      <Chip
                        size="small"
                        label={
                          isPaidUp
                            ? "Paid Up"
                            : "Active"
                        }
                        color={
                          isPaidUp
                            ? "success"
                            : "primary"
                        }
                        sx={{
                          fontWeight: 700,
                        }}
                      />
                    </Box>
                  </Box>
                </Grid>

                {/* ROW 1 - PRINCIPAL AMOUNT */}
                <Grid
                  item
                  xs={12}
                  sm={4}
                  sx={{ minWidth: 0 }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      display="block"
                    >
                      Principal Amount
                    </Typography>

                    <Typography
                      sx={{
                        fontWeight: 700,
                      }}
                    >
                      {formatCurrency(
                        loan.principal_amount
                      )}
                    </Typography>
                  </Box>
                </Grid>

                {/* ROW 2 - CURRENT BALANCE */}
                <Grid
                  item
                  xs={12}
                  sm={4}
                  sx={{ minWidth: 0 }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      display="block"
                    >
                      Current Balance
                    </Typography>

                    <Typography
                      variant="h5"
                      sx={{
                        fontWeight: 800,
                      }}
                    >
                      {formatCurrency(
                        currentLoanBalance
                      )}
                    </Typography>
                  </Box>
                </Grid>

                {/* ROW 2 - INTEREST RATE */}
                <Grid
                  item
                  xs={12}
                  sm={4}
                  sx={{ minWidth: 0 }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      display="block"
                    >
                      Interest Rate
                    </Typography>

                    <Typography
                      sx={{
                        fontWeight: 700,
                      }}
                    >
                      {loan.interest_rate !=
                      null
                        ? `${loan.interest_rate}%`
                        : loan.interest_percentage !=
                          null
                        ? `${loan.interest_percentage}%`
                        : "-"}
                    </Typography>
                  </Box>
                </Grid>

                {/* ROW 2 - AGREEMENT */}
                <Grid
                  item
                  xs={12}
                  sm={4}
                  sx={{ minWidth: 0 }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      display="block"
                    >
                      Agreement
                    </Typography>

                    <Typography
                      sx={{
                        fontWeight: 700,
                        overflowWrap:
                          "anywhere",
                      }}
                    >
                      {agreement
                        ?.agreement_number ||
                        "Not created"}
                    </Typography>
                  </Box>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        {/* LOAN ACTIONS */}
        <Grid
          item
          xs={12}
          sx={{ minWidth: 0 }}
        >
          <Card
            elevation={0}
            sx={{
              border: "1px solid",
              borderColor: "divider",
              minWidth: 0,
            }}
          >
            <CardContent sx={{ p: 3 }}>
              <Typography
                variant="h6"
                sx={{
                  fontWeight: 800,
                  mb: 2,
                }}
              >
                Loan Actions
              </Typography>

              <Box
                sx={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 1.5,
                  width: "100%",
                  minWidth: 0,
                }}
              >
                <Button
                  variant="contained"
                  startIcon={<Payment />}
                  onClick={() =>
                    setPaymentDialogOpen(
                      true
                    )
                  }
                  sx={actionButtonSx}
                >
                  Record Payment
                </Button>

                <Button
                  variant="outlined"
                  startIcon={
                    <PictureAsPdf />
                  }
                  onClick={
                    handleOpenStatement
                  }
                  disabled={
                    generatingStatement
                  }
                  sx={actionButtonSx}
                >
                  {generatingStatement
                    ? "Opening..."
                    : "View Statement"}
                </Button>

                <Button
                  variant="outlined"
                  startIcon={
                    <Download />
                  }
                  onClick={
                    handlePrintStatement
                  }
                  disabled={
                    generatingStatement
                  }
                  sx={actionButtonSx}
                >
                  {generatingStatement
                    ? "Generating..."
                    : "Download Statement"}
                </Button>

                <Button
                  variant="outlined"
                  startIcon={
                    <Description />
                  }
                  onClick={() => {
                    if (
                      hasAgreement &&
                      isAgreementPending
                    ) {
                      navigate(
                        `/sign-agreement/offline/${agreement.id}`
                      );
                    }
                  }}
                  disabled={
                    !hasAgreement ||
                    !isAgreementPending
                  }
                  sx={actionButtonSx}
                >
                  Sign Agreement
                </Button>

                <Button
                  variant="outlined"
                  startIcon={
                    <Verified />
                  }
                  onClick={
                    handleViewAgreement
                  }
                  disabled={
                    !hasAgreement ||
                    !isAgreementSigned
                  }
                  sx={actionButtonSx}
                >
                  View Agreement
                </Button>

                <Button
                  variant="outlined"
                  startIcon={
                    <ReceiptLong />
                  }
                  onClick={
                    handlePaidUpLetter
                  }
                  disabled={
                    !isPaidUp ||
                    generatingPaidUpLetter
                  }
                  sx={actionButtonSx}
                >
                  {generatingPaidUpLetter
                    ? "Generating..."
                    : "Paid-Up Letter"}
                </Button>

                <Button
                  variant="outlined"
                  startIcon={
                    <FolderOpen />
                  }
                  onClick={() =>
                    setTab(3)
                  }
                  sx={actionButtonSx}
                >
                  Documents
                </Button>
              </Box>

              <Divider
                sx={{ my: 2.5 }}
              />

              <Box
                sx={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 3,
                  minWidth: 0,
                }}
              >
                <Box
                  sx={{ minWidth: 160 }}
                >
                  <Typography
                    variant="caption"
                    color="text.secondary"
                  >
                    Agreement
                  </Typography>

                  <Typography
                    sx={{
                      fontWeight: 700,
                      overflowWrap:
                        "anywhere",
                    }}
                  >
                    {agreement
                      ?.agreement_number ||
                      "Not created"}
                  </Typography>
                </Box>

                <Box
                  sx={{ minWidth: 160 }}
                >
                  <Typography
                    variant="caption"
                    color="text.secondary"
                  >
                    Agreement Status
                  </Typography>

                  <Box>
                    <Chip
                      size="small"
                      label={
                        agreement?.status ||
                        "Not available"
                      }
                      color={
                        isAgreementSigned
                          ? "success"
                          : isAgreementPending
                          ? "warning"
                          : "default"
                      }
                      sx={{
                        mt: 0.5,
                        fontWeight: 700,
                      }}
                    />
                  </Box>
                </Box>

                <Box
                  sx={{ minWidth: 160 }}
                >
                  <Typography
                    variant="caption"
                    color="text.secondary"
                  >
                    Agreement Version
                  </Typography>

                  <Typography
                    sx={{
                      fontWeight: 700,
                    }}
                  >
                    {agreement
                      ?.agreement_version ||
                      "-"}
                  </Typography>
                </Box>

                {agreement?.signed_at && (
                  <Box
                    sx={{
                      minWidth: 220,
                    }}
                  >
                    <Typography
                      variant="caption"
                      color="text.secondary"
                    >
                      Signed
                    </Typography>

                    <Typography
                      sx={{
                        fontWeight: 700,
                        overflowWrap:
                          "anywhere",
                      }}
                    >
                      {formatDateTime(
                        agreement.signed_at
                      )}
                    </Typography>
                  </Box>
                )}
              </Box>

              {!hasAgreement && (
                <Alert
                  severity="info"
                  sx={{ mt: 2 }}
                >
                  No loan agreement has
                  been created for this
                  loan yet.
                </Alert>
              )}

              {hasAgreement &&
                isAgreementPending && (
                  <Alert
                    severity="warning"
                    sx={{ mt: 2 }}
                  >
                    Agreement is pending
                    customer acceptance.
                    The customer can sign
                    it on this computer
                    using the{" "}
                    <strong>
                      Sign Agreement
                    </strong>{" "}
                    button.
                  </Alert>
                )}

              {hasAgreement &&
                isAgreementSigned && (
                  <Alert
                    severity="success"
                    sx={{ mt: 2 }}
                  >
                    This loan agreement
                    has been signed.
                  </Alert>
                )}

              {!isPaidUp && (
                <Alert
                  severity="info"
                  sx={{ mt: 2 }}
                >
                  The Paid-Up Letter
                  remains unavailable
                  until the loan balance
                  reaches R0.00.
                </Alert>
              )}

              {isPaidUp && (
                <Alert
                  severity="success"
                  sx={{ mt: 2 }}
                >
                  This loan has a zero
                  outstanding balance.
                  The Paid-Up Letter is
                  available.
                </Alert>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* =====================================================
          TABS
      ====================================================== */}

      <Grid container spacing={2.5}>
        <Grid item xs={12}>
          <Paper
            elevation={0}
            sx={{
              border: "1px solid",
              borderColor: "divider",
              overflow: "hidden",
            }}
          >
            <Tabs
              value={tab}
              onChange={(_, value) =>
                setTab(value)
              }
              variant="scrollable"
              scrollButtons="auto"
            >
              <Tab
                icon={<History />}
                iconPosition="start"
                label="Transactions"
              />

              <Tab
                icon={
                  <PictureAsPdf />
                }
                iconPosition="start"
                label="Statement"
              />

              <Tab
                icon={<Description />}
                iconPosition="start"
                label="Agreement"
              />

              <Tab
                icon={<FolderOpen />}
                iconPosition="start"
                label="Documents"
              />
            </Tabs>

            <Divider />

            {/* TRANSACTIONS */}
            {tab === 0 && (
              <Box sx={{ p: 2.5 }}>
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  alignItems="center"
                  sx={{ mb: 2 }}
                >
                  <Box>
                    <Typography
                      variant="h6"
                      sx={{
                        fontWeight: 800,
                      }}
                    >
                      Loan Transactions
                    </Typography>

                    <Typography
                      variant="body2"
                      color="text.secondary"
                    >
                      Transactions for{" "}
                      {safeLoanNumber}
                    </Typography>
                  </Box>

                  {loadingTransactions && (
                    <CircularProgress
                      size={24}
                    />
                  )}
                </Stack>

                <Box
                  sx={{
                    overflowX: "auto",
                  }}
                >
                  <Box
                    component="table"
                    sx={{
                      width: "100%",
                      borderCollapse:
                        "collapse",
                      minWidth: 800,
                      "& th, & td": {
                        borderBottom:
                          "1px solid",
                        borderColor:
                          "divider",
                        padding:
                          "12px 10px",
                        textAlign: "left",
                      },
                      "& th": {
                        fontWeight: 800,
                        backgroundColor:
                          "background.default",
                      },
                    }}
                  >
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Type</th>
                        <th>
                          Description
                        </th>
                        <th
                          style={{
                            textAlign:
                              "right",
                          }}
                        >
                          Debit
                        </th>
                        <th
                          style={{
                            textAlign:
                              "right",
                          }}
                        >
                          Credit
                        </th>
                        <th
                          style={{
                            textAlign:
                              "right",
                          }}
                        >
                          Balance
                        </th>
                      </tr>
                    </thead>

                    <tbody>
                      {transactions.length ===
                        0 && (
                        <tr>
                          <td
                            colSpan={6}
                            style={{
                              textAlign:
                                "center",
                            }}
                          >
                            No transactions
                            found.
                          </td>
                        </tr>
                      )}

                      {transactions.map(
                        (transaction) => (
                          <tr
                            key={
                              transaction.id
                            }
                          >
                            <td>
                              {formatDate(
                                transaction.transaction_date
                              )}
                            </td>

                            <td>
                              {transaction.transaction_type ||
                                "-"}
                            </td>

                            <td>
                              {transaction.description ||
                                "-"}
                            </td>

                            <td
                              style={{
                                textAlign:
                                  "right",
                              }}
                            >
                              {getTransactionDebit(
                                transaction
                              ) > 0
                                ? formatCurrency(
                                    getTransactionDebit(
                                      transaction
                                    )
                                  )
                                : "-"}
                            </td>

                            <td
                              style={{
                                textAlign:
                                  "right",
                              }}
                            >
                              {getTransactionCredit(
                                transaction
                              ) > 0
                                ? formatCurrency(
                                    getTransactionCredit(
                                      transaction
                                    )
                                  )
                                : "-"}
                            </td>

                            <td
                              style={{
                                textAlign:
                                  "right",
                                fontWeight: 700,
                              }}
                            >
                              {formatCurrency(
                                getTransactionBalance(
                                  transaction
                                )
                              )}
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </Box>
                </Box>
              </Box>
            )}

            {/* STATEMENT */}
            {tab === 1 && (
              <Box sx={{ p: 2.5 }}>
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
                  sx={{ mb: 2 }}
                >
                  <Box>
                    <Typography
                      variant="h6"
                      sx={{
                        fontWeight: 800,
                      }}
                    >
                      Loan Statement
                    </Typography>

                    <Typography
                      variant="body2"
                      color="text.secondary"
                    >
                      Statement for{" "}
                      {safeLoanNumber}
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
                        <OpenInNew />
                      }
                      onClick={
                        handleOpenStatement
                      }
                      disabled={
                        generatingStatement
                      }
                      sx={{
                        textTransform:
                          "none",
                      }}
                    >
                      Open PDF
                    </Button>

                    <Button
                      variant="contained"
                      startIcon={
                        <Download />
                      }
                      onClick={
                        handlePrintStatement
                      }
                      disabled={
                        generatingStatement
                      }
                      sx={{
                        textTransform:
                          "none",
                      }}
                    >
                      Download PDF
                    </Button>
                  </Stack>
                </Stack>

                <Card
                  elevation={0}
                  sx={{
                    border: "1px solid",
                    borderColor:
                      "divider",
                    mb: 2,
                  }}
                >
                  <CardContent>
                    <Grid
                      container
                      spacing={2}
                    >
                      <Grid
                        item
                        xs={12}
                        sm={4}
                      >
                        <Typography
                          variant="caption"
                          color="text.secondary"
                        >
                          Loan Number
                        </Typography>

                        <Typography
                          sx={{
                            fontWeight: 800,
                          }}
                        >
                          {safeLoanNumber}
                        </Typography>
                      </Grid>

                      <Grid
                        item
                        xs={12}
                        sm={4}
                      >
                        <Typography
                          variant="caption"
                          color="text.secondary"
                        >
                          Principal
                        </Typography>

                        <Typography
                          sx={{
                            fontWeight: 800,
                          }}
                        >
                          {formatCurrency(
                            loan.principal_amount
                          )}
                        </Typography>
                      </Grid>

                      <Grid
                        item
                        xs={12}
                        sm={4}
                      >
                        <Typography
                          variant="caption"
                          color="text.secondary"
                        >
                          Current Balance
                        </Typography>

                        <Typography
                          sx={{
                            fontWeight: 800,
                          }}
                        >
                          {formatCurrency(
                            currentLoanBalance
                          )}
                        </Typography>
                      </Grid>
                    </Grid>
                  </CardContent>
                </Card>

                <Box
                  sx={{
                    overflowX: "auto",
                  }}
                >
                  <Box
                    component="table"
                    sx={{
                      width: "100%",
                      borderCollapse:
                        "collapse",
                      minWidth: 800,
                      "& th, & td": {
                        borderBottom:
                          "1px solid",
                        borderColor:
                          "divider",
                        padding:
                          "12px 10px",
                        textAlign: "left",
                      },
                      "& th": {
                        fontWeight: 800,
                        backgroundColor:
                          "background.default",
                      },
                    }}
                  >
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Type</th>
                        <th>
                          Description
                        </th>
                        <th
                          style={{
                            textAlign:
                              "right",
                          }}
                        >
                          Debit
                        </th>
                        <th
                          style={{
                            textAlign:
                              "right",
                          }}
                        >
                          Credit
                        </th>
                        <th
                          style={{
                            textAlign:
                              "right",
                          }}
                        >
                          Balance
                        </th>
                      </tr>
                    </thead>

                    <tbody>
                      {transactions.length ===
                        0 && (
                        <tr>
                          <td
                            colSpan={6}
                            style={{
                              textAlign:
                                "center",
                            }}
                          >
                            No transactions
                            found.
                          </td>
                        </tr>
                      )}

                      {transactions.map(
                        (transaction) => (
                          <tr
                            key={
                              transaction.id
                            }
                          >
                            <td>
                              {formatDate(
                                transaction.transaction_date
                              )}
                            </td>

                            <td>
                              {transaction.transaction_type ||
                                "-"}
                            </td>

                            <td>
                              {transaction.description ||
                                "-"}
                            </td>

                            <td
                              style={{
                                textAlign:
                                  "right",
                              }}
                            >
                              {getTransactionDebit(
                                transaction
                              ) > 0
                                ? formatCurrency(
                                    getTransactionDebit(
                                      transaction
                                    )
                                  )
                                : "-"}
                            </td>

                            <td
                              style={{
                                textAlign:
                                  "right",
                              }}
                            >
                              {getTransactionCredit(
                                transaction
                              ) > 0
                                ? formatCurrency(
                                    getTransactionCredit(
                                      transaction
                                    )
                                  )
                                : "-"}
                            </td>

                            <td
                              style={{
                                textAlign:
                                  "right",
                                fontWeight: 700,
                              }}
                            >
                              {formatCurrency(
                                getTransactionBalance(
                                  transaction
                                )
                              )}
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </Box>
                </Box>

                {statement.overdues?.length >
                  0 && (
                  <Box sx={{ mt: 4 }}>
                    <Typography
                      variant="h6"
                      sx={{
                        fontWeight: 800,
                        mb: 2,
                      }}
                    >
                      Overdues
                    </Typography>

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
                          "& th, & td": {
                            borderBottom:
                              "1px solid",
                            borderColor:
                              "divider",
                            padding:
                              "12px 10px",
                          },
                          "& th": {
                            fontWeight: 800,
                            backgroundColor:
                              "background.default",
                          },
                        }}
                      >
                        <thead>
                          <tr>
                            <th>
                              Due Date
                            </th>
                            <th>
                              Expected
                            </th>
                            <th>
                              Paid
                            </th>
                            <th>
                              Outstanding
                            </th>
                            <th>
                              Status
                            </th>
                          </tr>
                        </thead>

                        <tbody>
                          {statement.overdues.map(
                            (
                              overdue,
                              index
                            ) => (
                              <tr
                                key={
                                  overdue.id ||
                                  index
                                }
                              >
                                <td>
                                  {formatDate(
                                    overdue.due_date ||
                                      overdue.expected_date
                                  )}
                                </td>

                                <td>
                                  {formatCurrency(
                                    overdue.amount_due ||
                                      overdue.expected_amount
                                  )}
                                </td>

                                <td>
                                  {formatCurrency(
                                    overdue.amount_paid ||
                                      overdue.paid_amount
                                  )}
                                </td>

                                <td>
                                  {formatCurrency(
                                    overdue.amount_outstanding ||
                                      overdue.outstanding_amount
                                  )}
                                </td>

                                <td>
                                  <Chip
                                    size="small"
                                    label={
                                      overdue.status ||
                                      "-"
                                    }
                                    color={
                                      String(
                                        overdue.status ||
                                          ""
                                      ).toLowerCase() ===
                                      "resolved"
                                        ? "success"
                                        : "warning"
                                    }
                                  />
                                </td>
                              </tr>
                            )
                          )}
                        </tbody>
                      </Box>
                    </Box>
                  </Box>
                )}
              </Box>
            )}

            {/* AGREEMENT */}
            {tab === 2 && (
              <Box sx={{ p: 2.5 }}>
                <Typography
                  variant="h6"
                  sx={{
                    fontWeight: 800,
                    mb: 2,
                  }}
                >
                  Loan Agreement
                </Typography>

                {!agreement ? (
                  <Alert severity="info">
                    No agreement has been
                    created for this loan.
                  </Alert>
                ) : (
                  <Card
                    elevation={0}
                    sx={{
                      border: "1px solid",
                      borderColor:
                        "divider",
                    }}
                  >
                    <CardContent>
                      <Grid
                        container
                        spacing={2}
                      >
                        <Grid
                          item
                          xs={12}
                          sm={6}
                        >
                          <Typography
                            variant="caption"
                            color="text.secondary"
                          >
                            Agreement Number
                          </Typography>

                          <Typography
                            sx={{
                              fontWeight: 800,
                            }}
                          >
                            {agreement.agreement_number ||
                              "-"}
                          </Typography>
                        </Grid>

                        <Grid
                          item
                          xs={12}
                          sm={6}
                        >
                          <Typography
                            variant="caption"
                            color="text.secondary"
                          >
                            Version
                          </Typography>

                          <Typography
                            sx={{
                              fontWeight: 800,
                            }}
                          >
                            {agreement.agreement_version ||
                              "-"}
                          </Typography>
                        </Grid>

                        <Grid
                          item
                          xs={12}
                          sm={6}
                        >
                          <Typography
                            variant="caption"
                            color="text.secondary"
                          >
                            Status
                          </Typography>

                          <Box
                            sx={{ mt: 0.5 }}
                          >
                            <Chip
                              label={
                                agreement.status ||
                                "Unknown"
                              }
                              color={
                                isAgreementSigned
                                  ? "success"
                                  : isAgreementPending
                                  ? "warning"
                                  : "default"
                              }
                            />
                          </Box>
                        </Grid>

                        <Grid
                          item
                          xs={12}
                          sm={6}
                        >
                          <Typography
                            variant="caption"
                            color="text.secondary"
                          >
                            Generated
                          </Typography>

                          <Typography
                            sx={{
                              fontWeight: 700,
                            }}
                          >
                            {formatDateTime(
                              agreement.generated_at ||
                                agreement.created_at
                            )}
                          </Typography>
                        </Grid>

                        {agreement.accepted_at && (
                          <Grid
                            item
                            xs={12}
                            sm={6}
                          >
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              Accepted
                            </Typography>

                            <Typography
                              sx={{
                                fontWeight: 700,
                              }}
                            >
                              {formatDateTime(
                                agreement.accepted_at
                              )}
                            </Typography>
                          </Grid>
                        )}

                        {agreement.signed_at && (
                          <Grid
                            item
                            xs={12}
                            sm={6}
                          >
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              Signed
                            </Typography>

                            <Typography
                              sx={{
                                fontWeight: 700,
                              }}
                            >
                              {formatDateTime(
                                agreement.signed_at
                              )}
                            </Typography>
                          </Grid>
                        )}
                      </Grid>

                      <Divider
                        sx={{
                          my: 2.5,
                        }}
                      />

                      <Stack
                        direction={{
                          xs: "column",
                          sm: "row",
                        }}
                        spacing={1.5}
                      >
                        <Button
                          variant="contained"
                          startIcon={
                            <Description />
                          }
                          onClick={() => {
                            if (
                              isAgreementPending &&
                              agreement.id
                            ) {
                              navigate(
                                `/sign-agreement/offline/${agreement.id}`
                              );
                            }
                          }}
                          disabled={
                            !isAgreementPending
                          }
                          sx={{
                            textTransform:
                              "none",
                            fontWeight: 700,
                          }}
                        >
                          Sign Agreement on
                          This Computer
                        </Button>

                        <Button
                          variant="outlined"
                          startIcon={
                            <OpenInNew />
                          }
                          onClick={
                            handleViewAgreement
                          }
                          disabled={
                            !isAgreementSigned
                          }
                          sx={{
                            textTransform:
                              "none",
                            fontWeight: 700,
                          }}
                        >
                          View Signed Agreement
                        </Button>
                      </Stack>
                    </CardContent>
                  </Card>
                )}
              </Box>
            )}

            {/* DOCUMENTS */}
            {tab === 3 && (
              <Box sx={{ p: 2.5 }}>
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
                  sx={{ mb: 2 }}
                >
                  <Box>
                    <Typography
                      variant="h6"
                      sx={{
                        fontWeight: 800,
                      }}
                    >
                      Loan Documents
                    </Typography>

                    <Typography
                      variant="body2"
                      color="text.secondary"
                    >
                      Documents associated
                      with{" "}
                      {safeLoanNumber}
                    </Typography>
                  </Box>

                  <Button
                    variant="outlined"
                    startIcon={
                      <FolderOpen />
                    }
                    onClick={() =>
                      loadDocuments(
                        id,
                        loan.customer_id
                      )
                    }
                    sx={{
                      textTransform:
                        "none",
                    }}
                  >
                    Refresh
                  </Button>
                </Stack>

                {documents.length ===
                0 ? (
                  <Alert severity="info">
                    No documents found
                    for this loan.
                  </Alert>
                ) : (
                  <Stack spacing={1.5}>
                    {documents.map(
                      (document) => (
                        <Paper
                          key={
                            document.id ||
                            document.path ||
                            document.document_name
                          }
                          variant="outlined"
                          sx={{ p: 2 }}
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
                              <Typography
                                sx={{
                                  fontWeight: 800,
                                }}
                              >
                                {document.document_name ||
                                  document.name ||
                                  "Document"}
                              </Typography>

                              <Typography
                                variant="body2"
                                color="text.secondary"
                              >
                                {document.document_type ||
                                  "Document"}
                              </Typography>

                              <Typography
                                variant="caption"
                                color="text.secondary"
                              >
                                {formatDateTime(
                                  document.created_at
                                )}
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
                                size="small"
                                variant="outlined"
                                startIcon={
                                  <OpenInNew />
                                }
                                onClick={() =>
                                  handleOpenDocument(
                                    document
                                  )
                                }
                                sx={{
                                  textTransform:
                                    "none",
                                }}
                              >
                                Open
                              </Button>

                              <Button
                                size="small"
                                variant="outlined"
                                startIcon={
                                  <Download />
                                }
                                onClick={() =>
                                  handleDownloadDocument(
                                    document
                                  )
                                }
                                sx={{
                                  textTransform:
                                    "none",
                                }}
                              >
                                Download
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
          </Paper>
        </Grid>
      </Grid>

      {/* PAYMENT DIALOG */}
      <Dialog
        open={paymentDialogOpen}
        onClose={() =>
          setPaymentDialogOpen(false)
        }
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>
          Record Payment
        </DialogTitle>

        <DialogContent dividers>
          <RecordPayment
            loanId={loan.id}
            onSuccess={
              handlePaymentComplete
            }
            onCancel={() =>
              setPaymentDialogOpen(false)
            }
          />
        </DialogContent>

        <DialogActions>
          <Button
            onClick={() =>
              setPaymentDialogOpen(false)
            }
            sx={{
              textTransform: "none",
            }}
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}