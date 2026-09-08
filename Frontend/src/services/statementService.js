import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import QRCode from "qrcode";

import { supabase } from "../lib/supabase";

/* =========================================================
   HELPERS
========================================================= */

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function money(value) {
  return `R ${toNumber(value).toFixed(2)}`;
}

function getCustomerName(loan) {
  const customer = loan?.customers;

  if (!customer) {
    return "Customer";
  }

  return (
    `${customer.first_name || ""} ${
      customer.last_name || ""
    }`.trim() || "Customer"
  );
}

/* =========================================================
   GET PUBLIC APPLICATION URL
========================================================= */

function getPublicAppUrl() {
  /*
   * IMPORTANT:
   * Set VITE_PUBLIC_APP_URL in your production environment.
   *
   * Example:
   *
   * VITE_PUBLIC_APP_URL=https://your-domain.com
   *
   * During local development, window.location.origin is used
   * as a fallback.
   */

  const configuredUrl =
    import.meta.env.VITE_PUBLIC_APP_URL;

  if (configuredUrl) {
    return configuredUrl.replace(/\/+$/, "");
  }

  return window.location.origin.replace(/\/+$/, "");
}

/* =========================================================
   GET LOAN STATEMENT DATA
========================================================= */

export async function getLoanStatement(loanId) {
  if (!loanId) {
    throw new Error("Loan ID is required.");
  }

  const { data: transactions, error: transactionError } =
    await supabase
      .from("loan_transactions")
      .select("*")
      .eq("loan_id", loanId)
      .order("transaction_date", {
        ascending: true,
      })
      .order("created_at", {
        ascending: true,
      });

  if (transactionError) {
    console.error(
      "GET STATEMENT TRANSACTIONS ERROR:",
      transactionError
    );

    throw transactionError;
  }

  const { data: overdues, error: overdueError } =
    await supabase
      .from("loan_overdues")
      .select("*")
      .eq("loan_id", loanId)
      .order("cycle_payment_date", {
        ascending: true,
      });

  if (overdueError) {
    console.error(
      "GET STATEMENT OVERDUES ERROR:",
      overdueError
    );

    throw overdueError;
  }

  return {
    transactions: transactions || [],
    overdues: overdues || [],
  };
}

/* =========================================================
   GET EXISTING STATEMENT DOCUMENT

   IMPORTANT:
   THIS DOES NOT CREATE ANYTHING.
========================================================= */

export async function getExistingLoanStatementDocument(
  loanId
) {
  if (!loanId) {
    throw new Error("Loan ID is required.");
  }

  const { data, error } = await supabase
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
    .eq("document_type", "Statement")
    .not("document_path", "is", null)
    .order("created_at", {
      ascending: false,
    })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(
      "GET EXISTING STATEMENT ERROR:",
      error
    );

    throw error;
  }

  return data || null;
}

/* =========================================================
   BUILD STATEMENT PDF
========================================================= */

async function buildStatementPdf(
  loan,
  transactions,
  overdues = []
) {
  const doc = new jsPDF();

  const customerName = getCustomerName(loan);

  const loanNumber =
    loan.loan_number || "N/A";

  const customerNumber =
    loan.customers?.customer_number || "N/A";

  const generatedDate =
    new Date().toLocaleDateString("en-ZA");

  /* -------------------------------------------------------
     STATEMENT VERIFICATION QR
  ------------------------------------------------------- */

  let qrCode = null;

  if (loan.statement_verification_token) {
    const publicAppUrl =
      getPublicAppUrl();

    const verificationUrl =
      `${publicAppUrl}/verify-statement/` +
      loan.statement_verification_token;

    qrCode = await QRCode.toDataURL(
      verificationUrl,
      {
        width: 300,
        margin: 1,
        errorCorrectionLevel: "H",
      }
    );
  }

  /* -------------------------------------------------------
     HEADER
  ------------------------------------------------------- */

  /*
   * Keep the company heading away from the QR code.
   */

  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");

  doc.text(
    "UMHLOMUNYE FINANCE",
    85,
    18,
    {
      align: "center",
    }
  );

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");

  doc.text(
    "Our dreams, Our hope",
    85,
    25,
    {
      align: "center",
    }
  );

  doc.text(
    "Loan Statement",
    85,
    34,
    {
      align: "center",
    }
  );

  /* -------------------------------------------------------
     QR CODE - TOP RIGHT
  ------------------------------------------------------- */

  if (qrCode) {
    doc.addImage(
      qrCode,
      "PNG",
      164,
      5,
      30,
      30
    );

    doc.setFontSize(6.5);
    doc.setFont("helvetica", "normal");

    doc.text(
      "Scan to verify",
      179,
      37,
      {
        align: "center",
      }
    );
  }

  doc.setDrawColor(120);

  /*
 * Separator line stops before the QR code
 * so it cannot cross through the QR area.
 */

  doc.setDrawColor(120);

  /* Left section of header */
  doc.line(15, 41, 158, 41);

  /* Right section underneath QR */
  doc.line(164, 41, 195, 41);

  /* -------------------------------------------------------
     CUSTOMER INFORMATION
  ------------------------------------------------------- */

  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");

  doc.text(
    "CUSTOMER INFORMATION",
    15,
    52
  );

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  doc.text(
    `Customer Name: ${customerName}`,
    15,
    60
  );

  doc.text(
    `Customer Number: ${customerNumber}`,
    15,
    67
  );

  doc.text(
    `Loan Number: ${loanNumber}`,
    15,
    74
  );

  doc.text(
    `Statement Date: ${generatedDate}`,
    120,
    60
  );

  doc.text(
    `Loan Status: ${loan.loan_status || "N/A"}`,
    120,
    67
  );

  /* -------------------------------------------------------
     LOAN SUMMARY
  ------------------------------------------------------- */

  doc.setFont("helvetica", "bold");

  doc.text(
    "LOAN SUMMARY",
    15,
    88
  );

  doc.setFont("helvetica", "normal");

  const summaryRows = [
    [
      "Principal Amount",
      money(loan.principal_amount),
    ],
    [
      "Interest Rate",
      `${toNumber(
        loan.interest_rate
      ).toFixed(2)}%`,
    ],
    [
      "Interest Amount",
      money(loan.interest_amount),
    ],
    [
      "Total Repayment",
      money(loan.total_repayment),
    ],
    [
      "Total Paid",
      money(loan.total_paid),
    ],
    [
      "Current Balance",
      money(loan.current_balance),
    ],
  ];

  autoTable(doc, {
    startY: 93,
    head: [
      [
        "Description",
        "Amount",
      ],
    ],
    body: summaryRows,
    theme: "grid",
    styles: {
      fontSize: 9,
    },
    headStyles: {
      fontStyle: "bold",
    },
  });

  /* -------------------------------------------------------
     TRANSACTIONS
  ------------------------------------------------------- */

  let transactionStart =
    doc.lastAutoTable.finalY + 12;

  doc.setFont("helvetica", "bold");

  doc.text(
    "TRANSACTION HISTORY",
    15,
    transactionStart
  );

  const transactionRows =
    (transactions || []).map(
      (transaction) => {
        const date =
          transaction.transaction_date
            ? new Date(
                transaction.transaction_date
              ).toLocaleDateString("en-ZA")
            : "";

        return [
          date,
          transaction.transaction_type || "",
          transaction.description || "",
          money(transaction.debit),
          money(transaction.credit),
          money(transaction.balance),
        ];
      }
    );

  autoTable(doc, {
    startY:
      transactionStart + 5,

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
      transactionRows.length > 0
        ? transactionRows
        : [
            [
              "",
              "",
              "No transactions recorded",
              "",
              "",
              "",
            ],
          ],

    theme: "grid",

    styles: {
      fontSize: 8,
    },

    headStyles: {
      fontStyle: "bold",
    },
  });

  /* -------------------------------------------------------
     OVERDUES
  ------------------------------------------------------- */

  if (
    overdues &&
    overdues.length > 0
  ) {
    const overdueStart =
      doc.lastAutoTable.finalY + 12;

    doc.setFont("helvetica", "bold");

    doc.text(
      "OVERDUE INFORMATION",
      15,
      overdueStart
    );

    const overdueRows =
      overdues.map(
        (overdue) => [
          overdue.cycle_payment_date
            ? new Date(
                overdue.cycle_payment_date
              ).toLocaleDateString("en-ZA")
            : "",

          money(
            overdue.amount_due
          ),

          money(
            overdue.amount_paid
          ),

          money(
            overdue.amount_outstanding
          ),

          overdue.status || "",
        ]
      );

    autoTable(doc, {
      startY:
        overdueStart + 5,

      head: [
        [
          "Payment Date",
          "Amount Due",
          "Amount Paid",
          "Outstanding",
          "Status",
        ],
      ],

      body: overdueRows,

      theme: "grid",

      styles: {
        fontSize: 8,
      },

      headStyles: {
        fontStyle: "bold",
      },
    });
  }

  /* -------------------------------------------------------
     FOOTER
  ------------------------------------------------------- */

  const pageCount =
    doc.internal.getNumberOfPages();

  for (
    let page = 1;
    page <= pageCount;
    page++
  ) {
    doc.setPage(page);

    const pageHeight =
      doc.internal.pageSize.height;

    doc.setFontSize(8);
    doc.setFont(
      "helvetica",
      "normal"
    );

    doc.text(
      "Umhlomunye Finance",
      15,
      pageHeight - 12
    );

    doc.text(
      `Page ${page} of ${pageCount}`,
      195,
      pageHeight - 12,
      {
        align: "right",
      }
    );
  }

  return doc;
}

/* =========================================================
   CREATE OR UPDATE THE ONE STATEMENT
========================================================= */

export async function createOrUpdateLoanStatement(
  loanId
) {
  if (!loanId) {
    throw new Error(
      "Loan ID is required."
    );
  }

  /* -------------------------------------------------------
     Get loan
  ------------------------------------------------------- */

  const {
    data: loan,
    error: loanError,
  } = await supabase
    .from("loans")
    .select(`
      *,
      customers (
        customer_number,
        first_name,
        last_name
      )
    `)
    .eq("id", loanId)
    .single();

  if (loanError) {
    console.error(
      "GET LOAN FOR STATEMENT ERROR:",
      loanError
    );

    throw loanError;
  }

  /* -------------------------------------------------------
     Make sure the loan has a verification token
  ------------------------------------------------------- */

  if (
    !loan.statement_verification_token
  ) {
    throw new Error(
      "This loan does not have a statement verification token."
    );
  }

  /* -------------------------------------------------------
     Get latest transaction data
  ------------------------------------------------------- */

  const {
    transactions,
    overdues,
  } =
    await getLoanStatement(
      loanId
    );

  /* -------------------------------------------------------
     Build PDF
  ------------------------------------------------------- */

  const doc =
    await buildStatementPdf(
      loan,
      transactions,
      overdues
    );

  const pdfBlob =
    doc.output("blob");

  /* -------------------------------------------------------
     Get logged-in user
  ------------------------------------------------------- */

  const {
    data: {
      user,
    },
  } =
    await supabase.auth.getUser();

  /* -------------------------------------------------------
     ONE PERMANENT PATH

     IMPORTANT:
     We deliberately DO NOT add timestamps.
  ------------------------------------------------------- */

  const safeLoanNumber =
    String(
      loan.loan_number ||
        loan.id
    ).replace(
      /[^a-zA-Z0-9_-]/g,
      "_"
    );

  const documentPath =
    `statements/${loan.customer_id}/${loan.id}/${safeLoanNumber}-statement.pdf`;

  /* -------------------------------------------------------
     Upload / replace PDF
  ------------------------------------------------------- */

  const {
    error: uploadError,
  } =
    await supabase.storage
      .from("loan-documents")
      .upload(
        documentPath,
        pdfBlob,
        {
          contentType:
            "application/pdf",
          upsert: true,
        }
      );

  if (uploadError) {
    console.error(
      "UPLOAD STATEMENT ERROR:",
      uploadError
    );

    throw uploadError;
  }

  /* -------------------------------------------------------
     Find existing Statement document

     We NEVER insert another statement
     if one exists.
  ------------------------------------------------------- */

  const existing =
    await getExistingLoanStatementDocument(
      loanId
    );

  const documentName =
    `Loan Statement - ${safeLoanNumber}`;

  if (existing) {
    const {
      data,
      error,
    } =
      await supabase
        .from("documents")
        .update({
          customer_id:
            loan.customer_id,

          loan_id:
            loan.id,

          document_type:
            "Statement",

          document_name:
            documentName,

          document_path:
            documentPath,

          created_by:
            user?.id ||
            existing.created_by ||
            null,
        })
        .eq(
          "id",
          existing.id
        )
        .select()
        .single();

    if (error) {
      console.error(
        "UPDATE STATEMENT DOCUMENT ERROR:",
        error
      );

      throw error;
    }

    return data;
  }

  /* -------------------------------------------------------
     No statement exists yet.

     Create the FIRST and ONLY one.
  ------------------------------------------------------- */

  const {
    data,
    error,
  } =
    await supabase
      .from("documents")
      .insert([
        {
          customer_id:
            loan.customer_id,

          loan_id:
            loan.id,

          document_type:
            "Statement",

          document_name:
            documentName,

          document_path:
            documentPath,

          created_by:
            user?.id || null,
        },
      ])
      .select()
      .single();

  if (error) {
    console.error(
      "CREATE STATEMENT DOCUMENT ERROR:",
      error
    );

    throw error;
  }

  return data;
}

/* =========================================================
   EXPORT
========================================================= */

const statementService = {
  getLoanStatement,
  getExistingLoanStatementDocument,
  createOrUpdateLoanStatement,
};

export default statementService;