import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import QRCode from "qrcode";

import { supabase } from "../../lib/supabase";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
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
  PictureAsPdf,
  Print,
  ReceiptLong,
} from "@mui/icons-material";

import { getLoan } from "../../services/loanService";
import { getLoanStatement } from "../../services/statementService";
import { getLoanTransactions } from "../../services/transactionService";
import { getSystemSettings } from "../../services/settingsService";

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

/*
 * ============================================================
 * PDF LOGO HELPERS
 * ============================================================
 */

async function imageUrlToDataUrl(url) {
  if (!url) return null;

  if (String(url).startsWith("data:image/")) {
    return url;
  }

  try {
    const response = await fetch(url, {
      mode: "cors",
    });

    if (!response.ok) {
      return null;
    }

    const blob = await response.blob();

    return await new Promise((resolve) => {
      const reader = new FileReader();

      reader.onloadend = () => {
        resolve(reader.result || null);
      };

      reader.onerror = () => {
        resolve(null);
      };

      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.warn(
      "PDF LOGO LOAD ERROR:",
      error
    );

    return null;
  }
}

/*
 * Detect a usable accent colour from the uploaded company logo.
 *
 * White / transparent pixels are ignored so that a white logo
 * does not become the statement theme.
 *
 * Falls back to the existing company navy colour.
 */
async function getLogoAccentColor(logoDataUrl) {
  const fallback = [23, 37, 84];

  if (!logoDataUrl) {
    return fallback;
  }

  try {
    const image = await new Promise(
      (resolve, reject) => {
        const img = new Image();

        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = logoDataUrl;
      }
    );

    const canvas = document.createElement("canvas");
    const size = 64;

    canvas.width = size;
    canvas.height = size;

    const context = canvas.getContext("2d");

    if (!context) {
      return fallback;
    }

    context.drawImage(
      image,
      0,
      0,
      size,
      size
    );

    const imageData = context
      .getImageData(
        0,
        0,
        size,
        size
      )
      .data;

    let red = 0;
    let green = 0;
    let blue = 0;
    let count = 0;

    for (
      let index = 0;
      index < imageData.length;
      index += 4
    ) {
      const alpha = imageData[index + 3];

      if (alpha < 80) {
        continue;
      }

      const r = imageData[index];
      const g = imageData[index + 1];
      const b = imageData[index + 2];

      if (
        r > 245 &&
        g > 245 &&
        b > 245
      ) {
        continue;
      }

      red += r;
      green += g;
      blue += b;
      count += 1;
    }

    if (!count) {
      return fallback;
    }

    red = Math.round(red / count);
    green = Math.round(green / count);
    blue = Math.round(blue / count);

    const maximum = Math.max(
      red,
      green,
      blue
    );

    const minimum = Math.min(
      red,
      green,
      blue
    );

    if (
      maximum - minimum < 18
    ) {
      return fallback;
    }

    const factor =
      maximum > 210
        ? 0.65
        : 1;

    return [
      Math.max(
        20,
        Math.min(
          180,
          Math.round(red * factor)
        )
      ),
      Math.max(
        20,
        Math.min(
          180,
          Math.round(green * factor)
        )
      ),
      Math.max(
        20,
        Math.min(
          180,
          Math.round(blue * factor)
        )
      ),
    ];
  } catch {
    return fallback;
  }
}

/*
 * ============================================================
 * LOAN STATEMENT MASTER PDF HEADER
 * ============================================================
 *
 * LEFT:
 *   Company logo
 *   Company name + information/contact information
 *   displayed BESIDE the logo
 *
 * RIGHT:
 *   QR code
 *
 * IMPORTANT:
 * The company name is part of the company information block.
 * It is NOT rendered as a separate document heading.
 * ============================================================
 */
async function drawLoanStatementPdfHeader(
  pdf,
  verificationUrl
) {
  const settings = await getSystemSettings();

  const logoUrl =
    settings?.company_logo_url || "";

  const companyName =
    settings?.company_name || "";

  const companyAddress =
    settings?.company_address || "";

  const companyPhone =
    settings?.company_phone || "";

  const companyWhatsApp =
    settings?.company_whatsapp || "";

  const companyEmail =
    settings?.company_email || "";

  const logoDataUrl =
    await imageUrlToDataUrl(
      logoUrl
    );

  const accent =
    await getLogoAccentColor(
      logoDataUrl
    );

  /*
   * COMPANY LOGO — TOP LEFT
   */
  if (logoDataUrl) {
    try {
      pdf.addImage(
        logoDataUrl,
        "AUTO",
        14,
        10,
        34,
        34
      );
    } catch (error) {
      console.warn(
        "PDF LOGO DRAW ERROR:",
        error
      );
    }
  }

  /*
   * COMPANY INFORMATION — BESIDE LOGO
   */
  const companyInfoLines = [
    companyName,
    companyAddress,
    companyPhone
      ? `Tel: ${companyPhone}`
      : "",
    companyWhatsApp
      ? `WhatsApp: ${companyWhatsApp}`
      : "",
    companyEmail
      ? `Email: ${companyEmail}`
      : "",
  ].filter(Boolean);

  const companyInfoX = 54;
  const companyInfoWidth = 100;

  let textY = 15;

  companyInfoLines.forEach(
    (line, index) => {
      pdf.setFont(
        "helvetica",
        index === 0
          ? "bold"
          : "normal"
      );

      pdf.setFontSize(
        index === 0
          ? 9
          : 7.8
      );

      const wrapped =
        pdf.splitTextToSize(
          String(line),
          companyInfoWidth
        );

      pdf.text(
        wrapped,
        companyInfoX,
        textY
      );

      textY +=
        wrapped.length * 3.8 + 0.8;
    }
  );

  /*
   * QR CODE — TOP RIGHT
   */
  const qrTarget =
    verificationUrl ||
    (
      typeof window !== "undefined"
        ? window.location.href
        : ""
    );

  if (qrTarget) {
    try {
      const qrDataUrl =
        await QRCode.toDataURL(
          qrTarget,
          {
            errorCorrectionLevel: "M",
            margin: 1,
            width: 300,
          }
        );

      pdf.addImage(
        qrDataUrl,
        "PNG",
        165,
        10,
        31,
        31
      );

      pdf.setFont(
        "helvetica",
        "normal"
      );

      pdf.setFontSize(7);

      pdf.text(
        verificationUrl
          ? "Scan to verify"
          : "Scan to open",
        180.5,
        45,
        {
          align: "center",
        }
      );
    } catch (error) {
      console.warn(
        "PDF QR ERROR:",
        error
      );
    }
  }

  const dividerY = Math.max(
    51,
    textY + 3
  );

  pdf.setDrawColor(
    ...accent
  );

  pdf.setLineWidth(0.8);

  pdf.line(
    14,
    dividerY,
    196,
    dividerY
  );

  return {
    contentStartY:
      dividerY + 10,
    accent,
  };
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

  const [generatingSettlementLetter, setGeneratingSettlementLetter] =
    useState(false);

  const [error, setError] = useState("");

  const [tab, setTab] = useState(0);

  /*
   * The document currently selected under Loan Actions.
   *
   * statement
   * agreement
   * paid_up_letter
   * settlement_letter
   */
  const [selectedLoanDocument, setSelectedLoanDocument] =
    useState("");

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
    () =>
      agreementStatus === "pending",
    [agreementStatus]
  );

  const isAgreementSigned = useMemo(
    () =>
      agreementStatus === "signed",
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
          await getLoanTransactions(
            loanId
          );

        const normalized = (
          data || []
        ).map(
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

        setTransactions(
          chronological
        );

        return chronological;
      } catch (err) {
        console.error(
          "LOAD TRANSACTIONS ERROR:",
          err
        );

        throw err;
      } finally {
        setLoadingTransactions(
          false
        );
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
          document.document_path ||
          `${document.document_type}-${document.document_name}`;

        if (!seen.has(key)) {
          seen.add(key);
          uniqueDocuments.push(
            document
          );
        }
      }

      setDocuments(
        uniqueDocuments
      );

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

        let customerData =
          loanData.customer ||
          loanData.customers ||
          null;

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
              fetchedCustomer ||
              null;
          }
        }

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

        setCustomer(
          customerData
        );

        setLoan({
          ...loanData,
          customer:
            customerData,
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
            await getLoanStatement(
              id
            );

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

  const getDocumentUrl =
    useCallback(
      async (document) => {
        const documentPath =
          document?.document_path ||
          document?.path;

        if (!documentPath) {
          throw new Error(
            "Document path is missing."
          );
        }

        const preferredBucket =
          documentPath.startsWith(
            "paid-up-letters/"
          ) ||
          documentPath.startsWith(
            "settlements/"
          ) ||
          documentPath.startsWith(
            "agreements/"
          ) ||
          documentPath.startsWith(
            "statements/"
          )
            ? "loan-documents"
            : "documents";

        const buckets = [
          preferredBucket,
          preferredBucket ===
          "loan-documents"
            ? "documents"
            : "loan-documents",
        ];

        let lastError = null;

        for (const bucket of buckets) {
          const {
            data,
            error: urlError,
          } =
            await supabase.storage
              .from(bucket)
              .createSignedUrl(
                documentPath,
                60 * 60
              );

          if (
            !urlError &&
            data?.signedUrl
          ) {
            return data.signedUrl;
          }

          lastError = urlError;
        }

        throw (
          lastError ||
          new Error(
            "Unable to create document URL."
          )
        );
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

  /*
   * ============================================================
   * PRINT PDF
   * ============================================================
   */
  const printPdf =
    useCallback(
      async (pdf) => {
        const blob =
          pdf.output("blob");

        const blobUrl =
          URL.createObjectURL(
            blob
          );

        const printWindow =
          window.open(
            blobUrl,
            "_blank"
          );

        if (!printWindow) {
          URL.revokeObjectURL(
            blobUrl
          );

          throw new Error(
            "The print window was blocked by the browser. Please allow pop-ups for this site."
          );
        }

        const printDocument = () => {
          try {
            printWindow.focus();
            printWindow.print();
          } catch (error) {
            console.warn(
              "PDF PRINT ERROR:",
              error
            );
          }
        };

        printWindow.onload =
          printDocument;

        /*
         * Some browsers display PDFs through their built-in
         * PDF viewer and do not fire the normal load event.
         * Give the viewer a moment and then attempt printing.
         */
        setTimeout(
          printDocument,
          1200
        );

        setTimeout(
          () => {
            URL.revokeObjectURL(
              blobUrl
            );
          },
          10000
        );
      },
      []
    );

  /*
   * ============================================================
   * GENERATE LOAN STATEMENT PDF
   * ============================================================
   */
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

        const verificationToken =
          loan.statement_verification_token ||
          loan.verification_token ||
          null;

        const verificationUrl =
          verificationToken
            ? `${window.location.origin}/verify-statement/${verificationToken}`
            : null;

        const {
          contentStartY,
          accent,
        } =
          await drawLoanStatementPdfHeader(
            pdf,
            verificationUrl
          );

        pdf.setFontSize(15);

        pdf.setFont(
          "helvetica",
          "bold"
        );

        pdf.setTextColor(
          ...accent
        );

        pdf.text(
          "LOAN STATEMENT",
          14,
          contentStartY
        );

        pdf.setTextColor(
          0,
          0,
          0
        );

        pdf.setFontSize(10);

        pdf.setFont(
          "helvetica",
          "normal"
        );

        const detailsStartY =
          contentStartY + 8;

        pdf.text(
          `Loan Number: ${safeLoanNumber}`,
          14,
          detailsStartY
        );

        const customerName =
          loan.customer
            ?.full_name ||
          customer?.full_name ||
          customer?.name ||
          "Customer";

        pdf.text(
          `Customer: ${customerName}`,
          14,
          detailsStartY + 6
        );

        pdf.text(
          `Principal Amount: ${formatCurrency(
            loan.principal_amount
          )}`,
          14,
          detailsStartY + 12
        );

        pdf.text(
          `Current Balance: ${formatCurrency(
            currentLoanBalance
          )}`,
          14,
          detailsStartY + 18
        );

        pdf.text(
          `Statement Date: ${formatDate(
            new Date()
          )}`,
          14,
          detailsStartY + 24
        );

        const tableStartY =
          detailsStartY + 32;

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
          startY: tableStartY,

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
            lineColor: accent,
            lineWidth: 0.2,
          },

          headStyles: {
            fillColor: accent,
            textColor: [
              255,
              255,
              255,
            ],
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
          tableStartY + 12;

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

          pdf.setTextColor(
            ...accent
          );

          pdf.text(
            "Overdue Items",
            14,
            finalY
          );

          pdf.setTextColor(
            0,
            0,
            0
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

                overdue.status ||
                  "-",
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
              lineColor: accent,
              lineWidth: 0.2,
            },

            headStyles: {
              fillColor: accent,
              textColor: [
                255,
                255,
                255,
              ],
              fontStyle: "bold",
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

        pdf.setTextColor(
          0,
          0,
          0
        );

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

  /*
   * ============================================================
   * SAVE GENERATED DOCUMENT RECORD
   * ============================================================
   */
  const saveGeneratedDocument =
    useCallback(
      async ({
        pdf,
        fileName,
        path,
        documentType,
      }) => {
        const blob =
          pdf.output("blob");

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
                loan?.customer_id ||
                null,

              loan_id:
                loan?.id ||
                null,

              agreement_id:
                agreement?.id ||
                null,

              document_type:
                documentType,

              document_category:
                "LOAN",

              document_name:
                fileName,

              document_path:
                path,

              created_by:
                userData?.user?.id ||
                null,

              mime_type:
                "application/pdf",

              file_size_bytes:
                blob.size,

              source_type:
                "SYSTEM_GENERATED",

              retention_policy:
                "LOAN_DOCUMENT",

              retention_status:
                "ACTIVE",

              verification_status:
                "VERIFIED",

              is_archived:
                false,

              version_number:
                1,
            });

        if (documentError) {
          throw documentError;
        }

        await loadDocuments(
          id,
          loan?.customer_id
        );

        return blob;
      },
      [
        agreement,
        id,
        loadDocuments,
        loan,
      ]
    );

  /*
   * ============================================================
   * FIND EXISTING DOCUMENT
   * ============================================================
   */
  const findLoanDocument =
    useCallback(
      (documentKey) => {
        if (!documents?.length) {
          return null;
        }

        const matchingDocuments =
          documents.filter(
            (document) => {
              const type =
                String(
                  document?.document_type ||
                    ""
                ).toLowerCase();

              const path =
                String(
                  document?.document_path ||
                    document?.path ||
                    ""
                ).toLowerCase();

              if (
                documentKey ===
                "agreement"
              ) {
                return (
                  document.agreement_id ===
                    agreement?.id &&
                  type.includes(
                    "agreement"
                  )
                );
              }

              if (
                documentKey ===
                "paid_up_letter"
              ) {
                return (
                  type.includes(
                    "paid-up"
                  ) ||
                  type.includes(
                    "paid up"
                  ) ||
                  path.includes(
                    "paid-up-letters/"
                  )
                );
              }

              if (
                documentKey ===
                "settlement_letter"
              ) {
                return (
                  type.includes(
                    "settlement"
                  ) ||
                  path.includes(
                    "settlements/"
                  )
                );
              }

              if (
                documentKey ===
                "statement"
              ) {
                return (
                  type.includes(
                    "statement"
                  ) ||
                  path.includes(
                    "statements/"
                  )
                );
              }

              return false;
            }
          );

        return (
          matchingDocuments[0] ||
          null
        );
      },
      [
        agreement,
        documents,
      ]
    );

  /*
   * ============================================================
   * STATEMENT GENERATION
   * ============================================================
   */
  const handleGenerateStatement =
    useCallback(
      async () => {
        if (!loan) {
          throw new Error(
            "Loan information is not available."
          );
        }

        const freshTransactions =
          await loadTransactions(id);

        const chronologicalTransactions =
          sortTransactionsChronologically(
            freshTransactions
          );

        setStatement(
          (current) => ({
            ...current,
            transactions:
              chronologicalTransactions,
          })
        );

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

        /*
         * Keep the existing statement storage behaviour.
         */
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

                loan_id:
                  loan.id,

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

        return {
          pdf,
          fileName,
        };
      },
      [
        agreement,
        generateStatementPdf,
        id,
        loadDocuments,
        loadTransactions,
        loan,
        safeLoanNumber,
      ]
    );

  /*
   * ============================================================
   * PAID-UP LETTER PDF
   * ============================================================
   */
  const generatePaidUpLetterPdf =
  useCallback(
    async () => {
      if (!loan || !isPaidUp) {
        throw new Error(
          "The Paid-Up Letter is only available when the loan balance is R0.00."
        );
      }

      const pdf = new jsPDF();

      const pageWidth =
        pdf.internal.pageSize.getWidth();

      const verificationToken =
        loan.statement_verification_token ||
        loan.verification_token ||
        null;

      const verificationUrl =
        verificationToken
          ? `${window.location.origin}/verify-statement/${verificationToken}`
          : null;

      const {
        contentStartY,
        accent,
      } =
        await import(
          "../../services/pdfBrandingService"
        ).then(
          (module) =>
            module.drawPdfCompanyHeader(
              pdf,
              verificationUrl
            )
        );

      /*
       * DOCUMENT TITLE
       * Same styling as the Statement master template.
       */
      pdf.setFontSize(15);

      pdf.setFont(
        "helvetica",
        "bold"
      );

      pdf.setTextColor(
        ...accent
      );

      pdf.text(
        "PAID-UP LETTER",
        14,
        contentStartY
      );

      pdf.setTextColor(
        0,
        0,
        0
      );

      /*
       * LOAN / CUSTOMER DETAILS
       */
      const detailsStartY =
        contentStartY + 10;

      pdf.setFontSize(10);

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
        detailsStartY
      );

      pdf.text(
        `Loan Number: ${safeLoanNumber}`,
        14,
        detailsStartY + 6
      );

      pdf.text(
        `Customer: ${customerName}`,
        14,
        detailsStartY + 12
      );

      pdf.text(
        "Status: PAID UP",
        14,
        detailsStartY + 18
      );

      pdf.text(
        "Current Balance: R0.00",
        14,
        detailsStartY + 24
      );

      /*
       * LETTER BODY
       */
      const bodyStartY =
        detailsStartY + 38;

      pdf.setFontSize(10);

      pdf.setFont(
        "helvetica",
        "normal"
      );

      const paragraphs = [
        "This letter confirms that the above-mentioned loan account has been paid in full and that the current outstanding balance recorded on the account is R0.00.",

        "The loan account is therefore recorded as paid up as at the date of this letter.",
      ];

      let currentY = bodyStartY;

      paragraphs.forEach(
        (paragraph, index) => {
          const wrapped =
            pdf.splitTextToSize(
              paragraph,
              pageWidth - 28
            );

          pdf.text(
            wrapped,
            14,
            currentY
          );

          currentY +=
            wrapped.length * 5 +
            (index === 0 ? 12 : 0);
        }
      );

      /*
       * AUTHORISED REPRESENTATIVE
       */
      currentY += 25;

      pdf.setFontSize(9);

      pdf.setFont(
        "helvetica",
        "normal"
      );

      pdf.text(
        "Authorised Representative",
        14,
        currentY
      );

      /*
       * FOOTER
       * Keep the document clean and consistent
       * with the Statement master style.
       */
      pdf.setFontSize(8);

      pdf.setTextColor(
        0,
        0,
        0
      );

      pdf.text(
        `Generated: ${formatDate(
          new Date()
        )}`,
        14,
        pdf.internal.pageSize.getHeight() - 14
      );

      return pdf;
    },
    [
      customer,
      isPaidUp,
      loan,
      safeLoanNumber,
    ]
  );

  /*
   * ============================================================
   * SETTLEMENT LETTER PDF
   * ============================================================
   */
 const generateSettlementLetterPdf =
  useCallback(
    async () => {
      if (!loan) {
        throw new Error(
          "Loan information is not available."
        );
      }

      const pdf = new jsPDF();

      const pageWidth =
        pdf.internal.pageSize.getWidth();

      const verificationToken =
        loan.statement_verification_token ||
        loan.verification_token ||
        null;

      const verificationUrl =
        verificationToken
          ? `${window.location.origin}/verify-statement/${verificationToken}`
          : null;

      const {
        contentStartY,
        accent,
      } =
        await import(
          "../../services/pdfBrandingService"
        ).then(
          (module) =>
            module.drawPdfCompanyHeader(
              pdf,
              verificationUrl
            )
        );

      /*
       * DOCUMENT TITLE
       * Same styling as the Statement master template.
       */
      pdf.setFontSize(15);

      pdf.setFont(
        "helvetica",
        "bold"
      );

      pdf.setTextColor(
        ...accent
      );

      pdf.text(
        "SETTLEMENT LETTER",
        14,
        contentStartY
      );

      pdf.setTextColor(
        0,
        0,
        0
      );

      /*
       * LOAN / CUSTOMER DETAILS
       */
      const detailsStartY =
        contentStartY + 10;

      pdf.setFontSize(10);

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
        detailsStartY
      );

      pdf.text(
        `Loan Number: ${safeLoanNumber}`,
        14,
        detailsStartY + 6
      );

      pdf.text(
        `Customer: ${customerName}`,
        14,
        detailsStartY + 12
      );

      pdf.text(
        `Original Principal Amount: ${formatCurrency(
          loan.principal_amount
        )}`,
        14,
        detailsStartY + 18
      );

      pdf.text(
        `Current Outstanding Balance: ${formatCurrency(
          currentLoanBalance
        )}`,
        14,
        detailsStartY + 24
      );

      /*
       * LETTER BODY
       */
      const bodyStartY =
        detailsStartY + 38;

      const body =
        "This letter confirms the current settlement amount recorded on the above-mentioned loan account as at the date of this letter. The settlement amount is subject to any transactions, interest, fees or other applicable charges recorded on the account after the date of this letter.";

      const wrappedBody =
        pdf.splitTextToSize(
          body,
          pageWidth - 28
        );

      pdf.setFontSize(10);

      pdf.setFont(
        "helvetica",
        "normal"
      );

      pdf.text(
        wrappedBody,
        14,
        bodyStartY
      );

      /*
       * SETTLEMENT AMOUNT
       */
      const settlementY =
        bodyStartY +
        wrappedBody.length * 5 +
        16;

      pdf.setFontSize(12);

      pdf.setFont(
        "helvetica",
        "bold"
      );

      pdf.setTextColor(
        ...accent
      );

      pdf.text(
        "Settlement Amount",
        14,
        settlementY
      );

      pdf.setTextColor(
        0,
        0,
        0
      );

      pdf.setFontSize(14);

      pdf.setFont(
        "helvetica",
        "bold"
      );

      pdf.text(
        formatCurrency(
          currentLoanBalance
        ),
        14,
        settlementY + 9
      );

      /*
       * AUTHORISED REPRESENTATIVE
       */
      pdf.setFontSize(9);

      pdf.setFont(
        "helvetica",
        "normal"
      );

      pdf.text(
        "Authorised Representative",
        14,
        settlementY + 42
      );

      /*
       * FOOTER
       * Consistent with the Statement master style.
       */
      pdf.setFontSize(8);

      pdf.setTextColor(
        0,
        0,
        0
      );

      pdf.text(
        `Generated: ${formatDate(
          new Date()
        )}`,
        14,
        pdf.internal.pageSize.getHeight() - 14
      );

      return pdf;
    },
    [
      customer,
      currentLoanBalance,
      loan,
      safeLoanNumber,
    ]
  );

  /*
   * ============================================================
   * DOCUMENT ACTION HANDLER
   * ============================================================
   */
  const handleLoanDocumentAction =
    useCallback(
      async (
        documentKey,
        action
      ) => {
        if (!loan) return;

        try {
          /*
           * =====================================================
           * STATEMENT
           * =====================================================
           */
          if (
            documentKey ===
            "statement"
          ) {
            setGeneratingStatement(
              true
            );

            const {
              pdf,
              fileName,
            } =
              await handleGenerateStatement();

            if (
              action ===
              "view"
            ) {
              const blobUrl =
                pdf.output(
                  "bloburl"
                );

              window.open(
                blobUrl,
                "_blank",
                "noopener,noreferrer"
              );

              return;
            }

            if (
              action ===
              "print"
            ) {
              await printPdf(
                pdf
              );

              return;
            }

            if (
              action ===
              "download"
            ) {
              pdf.save(
                fileName
              );

              return;
            }
          }

          /*
           * =====================================================
           * AGREEMENT
           * =====================================================
           */
          if (
            documentKey ===
            "agreement"
          ) {
            const agreementDocument =
              findLoanDocument(
                "agreement"
              );

            if (
              !agreementDocument
            ) {
              window.alert(
                isAgreementPending
                  ? "The agreement has not been signed yet."
                  : "Agreement document is not available yet."
              );

              return;
            }

            if (
              action ===
              "view"
            ) {
              await handleOpenDocument(
                agreementDocument
              );

              return;
            }

            if (
              action ===
              "download"
            ) {
              await handleDownloadDocument(
                agreementDocument
              );

              return;
            }

            if (
              action ===
              "print"
            ) {
              const url =
                await getDocumentUrl(
                  agreementDocument
                );

              const response =
                await fetch(url);

              if (!response.ok) {
                throw new Error(
                  "Unable to load agreement for printing."
                );
              }

              const blob =
                await response.blob();

              const pdf =
                await new Promise(
                  (
                    resolve,
                    reject
                  ) => {
                    const reader =
                      new FileReader();

                    reader.onload =
                      () => {
                        try {
                          resolve(
                            reader.result
                          );
                        } catch (error) {
                          reject(
                            error
                          );
                        }
                      };

                    reader.onerror =
                      reject;

                    reader.readAsArrayBuffer(
                      blob
                    );
                  }
                );

              const blobUrl =
                URL.createObjectURL(
                  new Blob(
                    [pdf],
                    {
                      type: "application/pdf",
                    }
                  )
                );

              const printWindow =
                window.open(
                  blobUrl,
                  "_blank"
                );

              if (!printWindow) {
                URL.revokeObjectURL(
                  blobUrl
                );

                throw new Error(
                  "The print window was blocked by the browser. Please allow pop-ups for this site."
                );
              }

              const printAgreement =
                () => {
                  try {
                    printWindow.focus();
                    printWindow.print();
                  } catch (
                    printError
                  ) {
                    console.warn(
                      "AGREEMENT PRINT ERROR:",
                      printError
                    );
                  }
                };

              printWindow.onload =
                printAgreement;

              setTimeout(
                printAgreement,
                1200
              );

              setTimeout(
                () => {
                  URL.revokeObjectURL(
                    blobUrl
                  );
                },
                10000
              );

              return;
            }
          }

          /*
           * =====================================================
           * PAID-UP LETTER
           * =====================================================
           */
          if (
            documentKey ===
            "paid_up_letter"
          ) {
            if (!isPaidUp) {
              window.alert(
                "The Paid-Up Letter is only available when the loan balance is R0.00."
              );

              return;
            }

            setGeneratingPaidUpLetter(
              true
            );

            const pdf =
              await generatePaidUpLetterPdf();

            const timestamp =
              new Date()
                .toISOString()
                .replace(
                  /[:.]/g,
                  "-"
                );

            const fileName =
              `${safeLoanNumber}-paid-up-letter-${timestamp}.pdf`;

            const path =
              `paid-up-letters/${loan.customer_id}/${loan.id}/${fileName}`;

            /*
             * Generate and store the letter when the user requests
             * any of the document actions.
             */
            const existingDocument =
              findLoanDocument(
                "paid_up_letter"
              );

            /*
             * View / Print / Download uses the newly generated
             * document so the current zero balance is reflected.
             */
            if (
              action ===
              "view"
            ) {
              const blobUrl =
                pdf.output(
                  "bloburl"
                );

              window.open(
                blobUrl,
                "_blank",
                "noopener,noreferrer"
              );
            } else if (
              action ===
              "print"
            ) {
              await printPdf(
                pdf
              );
            } else if (
              action ===
              "download"
            ) {
              pdf.save(
                fileName
              );
            }

            /*
             * Store the generated letter unless an identical
             * generated document is already being used.
             *
             * A new generation is intentionally stored so the
             * document represents the current loan state.
             */
            await saveGeneratedDocument({
              pdf,
              fileName,
              path,
              documentType:
                "Paid-Up Letter",
            });

            void existingDocument;
          }

          /*
           * =====================================================
           * SETTLEMENT LETTER
           * =====================================================
           */
          if (
            documentKey ===
            "settlement_letter"
          ) {
            setGeneratingSettlementLetter(
              true
            );

            const pdf =
              await generateSettlementLetterPdf();

            const timestamp =
              new Date()
                .toISOString()
                .replace(
                  /[:.]/g,
                  "-"
                );

            const fileName =
              `${safeLoanNumber}-settlement-letter-${timestamp}.pdf`;

            const path =
              `settlements/${loan.customer_id}/${loan.id}/${fileName}`;

            if (
              action ===
              "view"
            ) {
              const blobUrl =
                pdf.output(
                  "bloburl"
                );

              window.open(
                blobUrl,
                "_blank",
                "noopener,noreferrer"
              );
            } else if (
              action ===
              "print"
            ) {
              await printPdf(
                pdf
              );
            } else if (
              action ===
              "download"
            ) {
              pdf.save(
                fileName
              );
            }

            await saveGeneratedDocument({
              pdf,
              fileName,
              path,
              documentType:
                "Settlement Letter",
            });
          }
        } catch (err) {
          console.error(
            "LOAN DOCUMENT ACTION ERROR:",
            err
          );

          window.alert(
            err?.message ||
              "Unable to process the document."
          );
        } finally {
          setGeneratingStatement(
            false
          );

          setGeneratingPaidUpLetter(
            false
          );

          setGeneratingSettlementLetter(
            false
          );
        }
      },
      [
        findLoanDocument,
        generatePaidUpLetterPdf,
        generateSettlementLetterPdf,
        handleGenerateStatement,
        handleOpenDocument,
        getDocumentUrl,
        isAgreementPending,
        isPaidUp,
        loan,
        printPdf,
        saveGeneratedDocument,
        safeLoanNumber,
      ]
    );

  /*
   * ============================================================
   * DOWNLOAD DOCUMENT
   * ============================================================
   */
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
            URL.createObjectURL(
              blob
            );

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
              .includes(
                "agreement"
              )
        );

      if (agreementDocument) {
        handleOpenDocument(
          agreementDocument
        );

        return;
      }

      const fallbackDocument =
        documents.find(
          (document) =>
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
          md={12}
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
          md={12}
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

        {/* ===================================================
            LOAN ACTIONS
        ==================================================== */}
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

              {/* PRIMARY DOCUMENT BUTTONS */}
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
                  variant={
                    selectedLoanDocument ===
                    "statement"
                      ? "contained"
                      : "outlined"
                  }
                  startIcon={
                    <PictureAsPdf />
                  }
                  onClick={() =>
                    setSelectedLoanDocument(
                      "statement"
                    )
                  }
                  sx={actionButtonSx}
                >
                  Statement
                </Button>

                <Button
                  variant={
                    selectedLoanDocument ===
                    "agreement"
                      ? "contained"
                      : "outlined"
                  }
                  startIcon={
                    <Description />
                  }
                  onClick={() =>
                    setSelectedLoanDocument(
                      "agreement"
                    )
                  }
                  disabled={!hasAgreement}
                  sx={actionButtonSx}
                >
                  Agreement
                </Button>

                <Button
                  variant={
                    selectedLoanDocument ===
                    "paid_up_letter"
                      ? "contained"
                      : "outlined"
                  }
                  startIcon={
                    <ReceiptLong />
                  }
                  onClick={() =>
                    setSelectedLoanDocument(
                      "paid_up_letter"
                    )
                  }
                  disabled={!isPaidUp}
                  sx={actionButtonSx}
                >
                  Paid Up Letter
                </Button>

                <Button
                  variant={
                    selectedLoanDocument ===
                    "settlement_letter"
                      ? "contained"
                      : "outlined"
                  }
                  startIcon={
                    <ReceiptLong />
                  }
                  onClick={() =>
                    setSelectedLoanDocument(
                      "settlement_letter"
                    )
                  }
                  sx={actionButtonSx}
                >
                  Settlement Letter
                </Button>
              </Box>

              {/* DOCUMENT ACTIONS */}
              {selectedLoanDocument && (
                <>
                  <Divider
                    sx={{ my: 2.5 }}
                  />

                  <Typography
                    variant="subtitle1"
                    sx={{
                      fontWeight: 800,
                      mb: 1.5,
                    }}
                  >
                    {selectedLoanDocument ===
                    "statement"
                      ? "Statement"
                      : selectedLoanDocument ===
                        "agreement"
                      ? "Agreement"
                      : selectedLoanDocument ===
                        "paid_up_letter"
                      ? "Paid Up Letter"
                      : "Settlement Letter"}
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
                      startIcon={
                        <OpenInNew />
                      }
                      onClick={() =>
                        handleLoanDocumentAction(
                          selectedLoanDocument,
                          "view"
                        )
                      }
                      disabled={
                        generatingStatement ||
                        generatingPaidUpLetter ||
                        generatingSettlementLetter
                      }
                      sx={
                        actionButtonSx
                      }
                    >
                      View
                    </Button>

                    <Button
                      variant="outlined"
                      startIcon={
                        <Print />
                      }
                      onClick={() =>
                        handleLoanDocumentAction(
                          selectedLoanDocument,
                          "print"
                        )
                      }
                      disabled={
                        generatingStatement ||
                        generatingPaidUpLetter ||
                        generatingSettlementLetter
                      }
                      sx={
                        actionButtonSx
                      }
                    >
                      Print
                    </Button>

                    <Button
                      variant="outlined"
                      startIcon={
                        <Download />
                      }
                      onClick={() =>
                        handleLoanDocumentAction(
                          selectedLoanDocument,
                          "download"
                        )
                      }
                      disabled={
                        generatingStatement ||
                        generatingPaidUpLetter ||
                        generatingSettlementLetter
                      }
                      sx={
                        actionButtonSx
                      }
                    >
                      Download
                    </Button>
                  </Stack>

                  {selectedLoanDocument ===
                    "agreement" &&
                    isAgreementPending && (
                      <Alert
                        severity="warning"
                        sx={{ mt: 2 }}
                      >
                        The agreement is
                        still pending
                        customer acceptance.
                        The signed agreement
                        will become available
                        after it has been
                        signed.
                      </Alert>
                    )}

                  {selectedLoanDocument ===
                    "agreement" &&
                    isAgreementSigned && (
                      <Alert
                        severity="success"
                        sx={{ mt: 2 }}
                      >
                        The signed agreement
                        is available.
                      </Alert>
                    )}

                  {selectedLoanDocument ===
                    "paid_up_letter" &&
                    !isPaidUp && (
                      <Alert
                        severity="info"
                        sx={{ mt: 2 }}
                      >
                        The Paid Up Letter
                        becomes available
                        when the loan balance
                        reaches R0.00.
                      </Alert>
                    )}
                </>
              )}

              <Divider
                sx={{ my: 2.5 }}
              />

              {/* AGREEMENT INFORMATION */}
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
                    from the Agreement tab.
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
                  The Paid Up Letter
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
                  The Paid Up Letter is
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
                      onClick={() =>
                        handleLoanDocumentAction(
                          "statement",
                          "view"
                        )
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
                      onClick={() =>
                        handleLoanDocumentAction(
                          "statement",
                          "download"
                        )
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
                            document.document_path ||
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
    </Box>
  );
}