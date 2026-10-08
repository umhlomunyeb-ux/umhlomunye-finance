import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import QRCode from "qrcode";

import { supabase } from "../lib/supabase";
import { getSystemSettings } from "./settingsService";

/* =========================================================
   CONSTANTS
========================================================= */

const DOCUMENT_BUCKET = "documents";
const STATEMENT_DOCUMENT_TYPE = "Statement";

/* =========================================================
   HELPERS
========================================================= */

function toNumber(value) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : 0;
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

function getErrorMessage(error, fallback) {
  return error?.message || fallback;
}

/* =========================================================
   GET PUBLIC APPLICATION URL
========================================================= */

function getPublicAppUrl() {
  const configuredUrl =
    import.meta.env.VITE_PUBLIC_APP_URL;

  if (configuredUrl) {
    return configuredUrl.replace(/\/+$/, "");
  }

  return window.location.origin.replace(/\/+$/, "");
}

/* =========================================================
   RECORD DOCUMENT HISTORY
========================================================= */

async function recordDocumentHistory({
  documentId,
  action,
  previousDocumentId = null,
  newDocumentId = null,
  documentSnapshot = null,
  previousSnapshot = null,
  notes = null,
}) {
  const { error } = await supabase.rpc(
    "record_document_history",
    {
      p_document_id:
        documentId || null,

      p_action:
        action,

      p_previous_document_id:
        previousDocumentId || null,

      p_new_document_id:
        newDocumentId || null,

      p_document_snapshot:
        documentSnapshot || null,

      p_previous_snapshot:
        previousSnapshot || null,

      p_notes:
        notes || null,
    }
  );

  if (error) {
    console.error(
      "RECORD DOCUMENT HISTORY ERROR:",
      error
    );

    throw error;
  }
}

/* =========================================================
   GET LOAN STATEMENT DATA
========================================================= */

export async function getLoanStatement(
  loanId
) {
  if (!loanId) {
    throw new Error(
      "Loan ID is required."
    );
  }

  const {
    data: transactions,
    error: transactionError,
  } = await supabase
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

  const {
    data: overdues,
    error: overdueError,
  } = await supabase
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
    transactions:
      transactions || [],

    overdues:
      overdues || [],
  };
}

/* =========================================================
   GET EXISTING STATEMENT DOCUMENT

   IMPORTANT:
   ONE STATEMENT PER LOAN.
========================================================= */

export async function getExistingLoanStatementDocument(
  loanId
) {
  if (!loanId) {
    throw new Error(
      "Loan ID is required."
    );
  }

  const {
    data,
    error,
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
      created_at,
      document_category,
      customer_id_number_snapshot,
      loan_number_snapshot,
      mime_type,
      file_size_bytes,
      file_hash_sha256,
      source_type,
      retention_policy,
      retention_until,
      retention_status,
      financial_period_type,
      financial_period_start,
      financial_period_end,
      verification_status,
      is_archived,
      archived_at,
      archived_by,
      document_group_id,
      version_number,
      replacement_of_document_id,
      replaced_by_document_id,
      deleted_at
    `)
    .eq(
      "loan_id",
      loanId
    )
    .eq(
      "document_type",
      STATEMENT_DOCUMENT_TYPE
    )
    .eq(
      "is_archived",
      false
    )
    .is(
      "deleted_at",
      null
    )
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

  const customerName =
    getCustomerName(loan);

  const loanNumber =
    loan.loan_number || "N/A";

  const customerNumber =
    loan.customers?.customer_number ||
    "N/A";

  const generatedDate =
    new Date().toLocaleDateString(
      "en-ZA"
    );

  const settings =
    await getSystemSettings();

  const companyName =
    settings?.company_name ||
    "Company";

  /* -------------------------------------------------------
     STATEMENT VERIFICATION QR
  ------------------------------------------------------- */

  let qrCode = null;

  if (
    loan.statement_verification_token
  ) {
    const publicAppUrl =
      getPublicAppUrl();

    const verificationUrl =
      `${publicAppUrl}/verify-statement/` +
      loan.statement_verification_token;

    qrCode =
      await QRCode.toDataURL(
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

  doc.setFontSize(20);
  doc.setFont(
    "helvetica",
    "bold"
  );

  doc.text(
    companyName,
    85,
    18,
    {
      align: "center",
    }
  );

  doc.setFontSize(9);
  doc.setFont(
    "helvetica",
    "normal"
  );

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
    doc.setFont(
      "helvetica",
      "normal"
    );

    doc.text(
      "Scan to verify",
      179,
      37,
      {
        align: "center",
      }
    );
  }

  /* -------------------------------------------------------
     HEADER LINES
  ------------------------------------------------------- */

  doc.setDrawColor(120);

  doc.line(
    15,
    41,
    158,
    41
  );

  doc.line(
    164,
    41,
    195,
    41
  );

  /* -------------------------------------------------------
     CUSTOMER INFORMATION
  ------------------------------------------------------- */

  doc.setFontSize(11);
  doc.setFont(
    "helvetica",
    "bold"
  );

  doc.text(
    "CUSTOMER INFORMATION",
    15,
    52
  );

  doc.setFont(
    "helvetica",
    "normal"
  );

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
    `Loan Status: ${
      loan.loan_status || "N/A"
    }`,
    120,
    67
  );

  /* -------------------------------------------------------
     LOAN SUMMARY
  ------------------------------------------------------- */

  doc.setFont(
    "helvetica",
    "bold"
  );

  doc.text(
    "LOAN SUMMARY",
    15,
    88
  );

  doc.setFont(
    "helvetica",
    "normal"
  );

  const summaryRows = [
    [
      "Principal Amount",
      money(
        loan.principal_amount
      ),
    ],
    [
      "Interest Rate",
      `${toNumber(
        loan.interest_rate
      ).toFixed(2)}%`,
    ],
    [
      "Interest Amount",
      money(
        loan.interest_amount
      ),
    ],
    [
      "Total Repayment",
      money(
        loan.total_repayment
      ),
    ],
    [
      "Total Paid",
      money(
        loan.total_paid
      ),
    ],
    [
      "Current Balance",
      money(
        loan.current_balance
      ),
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

  const transactionStart =
    doc.lastAutoTable.finalY +
    12;

  doc.setFont(
    "helvetica",
    "bold"
  );

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
              ).toLocaleDateString(
                "en-ZA"
              )
            : "";

        return [
          date,
          transaction.transaction_type ||
            "",
          transaction.description ||
            "",
          money(
            transaction.debit
          ),
          money(
            transaction.credit
          ),
          money(
            transaction.balance
          ),
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
      doc.lastAutoTable.finalY +
      12;

    doc.setFont(
      "helvetica",
      "bold"
    );

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
              ).toLocaleDateString(
                "en-ZA"
              )
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
      companyName,
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
     GET LOAN
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
     VERIFY STATEMENT TOKEN
  ------------------------------------------------------- */

  if (
    !loan.statement_verification_token
  ) {
    throw new Error(
      "This loan does not have a statement verification token."
    );
  }

  /* -------------------------------------------------------
     GET CURRENT TRANSACTION DATA
  ------------------------------------------------------- */

  const {
    transactions,
    overdues,
  } =
    await getLoanStatement(
      loanId
    );

  /* -------------------------------------------------------
     BUILD PDF
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
     GET CURRENT USER
  ------------------------------------------------------- */

  const {
    data: {
      user,
    },
  } =
    await supabase.auth.getUser();

  /* -------------------------------------------------------
     PERMANENT STATEMENT PATH
     
     ONE FILE PER LOAN.
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

  const documentName =
    `Loan Statement - ${safeLoanNumber}`;

  /* -------------------------------------------------------
     GET EXISTING DOCUMENT FIRST
  ------------------------------------------------------- */

  const existing =
    await getExistingLoanStatementDocument(
      loanId
    );

  /* -------------------------------------------------------
     UPLOAD / OVERWRITE PDF
  ------------------------------------------------------- */

  const {
    error: uploadError,
  } =
    await supabase.storage
      .from(DOCUMENT_BUCKET)
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
     DOCUMENT METADATA
  ------------------------------------------------------- */

  const documentMetadata = {
    customer_id:
      loan.customer_id,

    loan_id:
      loan.id,

    document_type:
      STATEMENT_DOCUMENT_TYPE,

    document_name:
      documentName,

    document_path:
      documentPath,

    created_by:
      user?.id ||
      existing?.created_by ||
      null,

    mime_type:
      "application/pdf",

    source_type:
      "SYSTEM_GENERATED",

    document_category:
      "LOAN",

    loan_number_snapshot:
      loan.loan_number ||
      null,

    verification_status:
      "VERIFIED",

    is_archived:
      false,

    deleted_at:
      null,
  };

  /* =======================================================
     EXISTING STATEMENT
  ======================================================= */

  if (existing) {
    const previousSnapshot = {
      id:
        existing.id,

      customer_id:
        existing.customer_id,

      loan_id:
        existing.loan_id,

      document_type:
        existing.document_type,

      document_name:
        existing.document_name,

      document_path:
        existing.document_path,

      created_by:
        existing.created_by,

      created_at:
        existing.created_at,

      version_number:
        existing.version_number,

      document_group_id:
        existing.document_group_id,
    };

    const {
      data,
      error,
    } =
      await supabase
        .from("documents")
        .update(
          documentMetadata
        )
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

    try {
      await recordDocumentHistory({
        documentId:
          existing.id,

        action:
          "UPDATED",

        documentSnapshot:
          data,

        previousSnapshot,

        notes:
          "Loan statement automatically regenerated after a loan transaction.",
      });
    } catch (historyError) {
      /*
       * The statement itself has already been
       * updated successfully. Do not undo the
       * statement because the audit operation failed.
       */
      console.error(
        "STATEMENT UPDATE HISTORY ERROR:",
        historyError
      );
    }

    return data;
  }

  /* =======================================================
     FIRST STATEMENT
  ======================================================= */

  const documentGroupId =
    crypto.randomUUID();

  const insertData = {
    ...documentMetadata,

    document_group_id:
      documentGroupId,

    version_number:
      1,
  };

  const {
    data,
    error,
  } =
    await supabase
      .from("documents")
      .insert([
        insertData,
      ])
      .select()
      .single();

  if (error) {
    console.error(
      "CREATE STATEMENT DOCUMENT ERROR:",
      error
    );

    /*
     * The PDF has already been uploaded.
     * Remove it if the metadata insert fails.
     */
    await supabase.storage
      .from(DOCUMENT_BUCKET)
      .remove([
        documentPath,
      ])
      .catch(() => {});

    throw error;
  }

  try {
    await recordDocumentHistory({
      documentId:
        data.id,

      action:
        "CREATED",

      newDocumentId:
        data.id,

      documentSnapshot:
        data,

      notes:
        "Loan statement automatically created from the first loan transaction.",
    });
  } catch (historyError) {
    /*
     * Do not delete the working statement because
     * history recording failed.
     */
    console.error(
      "STATEMENT CREATION HISTORY ERROR:",
      historyError
    );
  }

  return data;
}

/* =========================================================
   DEFAULT EXPORT
========================================================= */

const statementService = {
  getLoanStatement,
  getExistingLoanStatementDocument,
  createOrUpdateLoanStatement,
};

export default statementService;
