import { createClient } from "npm:@supabase/supabase-js@2";
import jsPDF from "npm:jspdf@4.2.1";
import autoTable from "npm:jspdf-autotable@5.0.8";
import QRCode from "npm:qrcode@1.5.4";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SECRET_KEYS = JSON.parse(
  Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"
);

const SUPABASE_SECRET_KEY =
  SUPABASE_SECRET_KEYS["default"] ?? "";
const STATEMENT_GENERATOR_SECRET = Deno.env.get("STATEMENT_GENERATOR_SECRET") ?? "";
const PUBLIC_APP_URL = Deno.env.get("PUBLIC_APP_URL") ?? "https://umhlomunye-finance2.umhlomunyeb.workers.dev";
const DOCUMENT_BUCKET = "documents";
const STATEMENT_DOCUMENT_TYPE = "Statement";
const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});
/* =========================================================
   HELPERS
========================================================= */ function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}
function getAuthorizationToken(req) {
  const header = req.headers.get("Authorization") ?? "";
  if (!header.startsWith("Bearer ")) {
    return "";
  }
  return header.substring(7).trim();
}
function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
function safeFileName(value) {
  return String(value ?? "loan").replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
}
function formatDate(value) {
  if (!value) {
    return "";
  }
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleDateString("en-ZA", {
    timeZone: "Africa/Johannesburg"
  });
}
function formatMoney(value) {
  return toNumber(value).toLocaleString("en-ZA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}
function transactionDate(transaction) {
  return transaction?.transaction_date ?? transaction?.created_at ?? null;
}
/* =========================================================
   LOAD LOAN DATA
========================================================= */ async function getLoan(loanId) {
  const { data, error } = await supabase.from("loans").select(`
      *,
      customers (
        customer_number,
        first_name,
        last_name
      )
    `).eq("id", loanId).maybeSingle();
  if (error) {
    throw new Error(`Failed to load loan: ${error.message}`);
  }
  if (!data) {
    throw new Error(`Loan not found: ${loanId}`);
  }
  return data;
}
/* =========================================================
   LOAD TRANSACTIONS
========================================================= */ async function getTransactions(loanId) {
  const { data, error } = await supabase.from("loan_transactions").select("*").eq("loan_id", loanId).order("transaction_date", {
    ascending: true
  }).order("created_at", {
    ascending: true
  });
  if (error) {
    throw new Error(`Failed to load loan transactions: ${error.message}`);
  }
  return data ?? [];
}
/* =========================================================
   LOAD OVERDUES
========================================================= */ async function getOverdues(loanId) {
  const { data, error } = await supabase.from("loan_overdues").select("*").eq("loan_id", loanId).order("cycle_payment_date", {
    ascending: true
  });
  if (error) {
    throw new Error(`Failed to load loan overdues: ${error.message}`);
  }
  return data ?? [];
}
/* =========================================================
   EXISTING STATEMENT
========================================================= */ async function getExistingStatement(loanId) {
  const { data, error } = await supabase.from("documents").select("*").eq("loan_id", loanId).eq("document_type", STATEMENT_DOCUMENT_TYPE).eq("is_archived", false).is("deleted_at", null).order("created_at", {
    ascending: false
  }).limit(1).maybeSingle();
  if (error) {
    throw new Error(`Failed to find existing statement: ${error.message}`);
  }
  return data;
}
/* =========================================================
   DOCUMENT HISTORY
========================================================= */ async function recordDocumentHistory(documentId, action, options = {}) {
  const { error } = await supabase.rpc("record_document_history", {
    p_document_id: documentId,
    p_action: action,
    p_previous_document_id: options.previousDocumentId ?? null,
    p_new_document_id: options.newDocumentId ?? null,
    p_document_snapshot: options.documentSnapshot ?? null,
    p_previous_snapshot: options.previousSnapshot ?? null,
    p_notes: options.notes ?? null
  });
  if (error) {
    throw new Error(`Failed to record document history: ${error.message}`);
  }
}
/* =========================================================
   PDF GENERATION
========================================================= */ async function buildStatementPdf(loan, transactions, overdues) {
  const doc = new jsPDF();
  const customer = loan.customers ?? {};
  const customerName = [
    customer.first_name,
    customer.last_name
  ].filter(Boolean).join(" ") || "N/A";
  const loanNumber = loan.loan_number ?? loan.loan_no ?? loan.id;
  const customerNumber = customer.customer_number ?? loan.customer_number ?? "N/A";
  const generatedDate = new Date().toLocaleDateString("en-ZA", {
    timeZone: "Africa/Johannesburg"
  });
  /* =======================================================
     VERIFICATION QR
  ======================================================= */ if (loan.statement_verification_token) {
    const verificationUrl = `${PUBLIC_APP_URL}/verify-statement/${loan.statement_verification_token}`;
    try {
      const qrDataUrl = await QRCode.toDataURL(verificationUrl, {
        width: 300,
        margin: 1
      });
      doc.addImage(qrDataUrl, "PNG", 165, 10, 30, 30);
    } catch (error) {
      console.error("Failed to generate statement QR code:", error);
    }
  }
  /* =======================================================
     HEADER
  ======================================================= */ doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("UMHLOMUNYE FINANCE", 14, 20);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text("Our dreams, Our hope", 14, 27);
  doc.setFontSize(15);
  doc.setFont("helvetica", "bold");
  doc.text("Loan Statement", 14, 40);
  /* =======================================================
     CUSTOMER INFORMATION
  ======================================================= */ doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Customer: ${customerName}`, 14, 49);
  doc.text(`Customer Number: ${customerNumber}`, 14, 56);
  doc.text(`Loan Number: ${loanNumber}`, 14, 63);
  doc.text(`Generated: ${generatedDate}`, 14, 70);
  /* =======================================================
     LOAN SUMMARY
  ======================================================= */ const principalAmount = toNumber(loan.principal_amount ?? loan.loan_amount ?? loan.amount);
  const interestRate = toNumber(loan.interest_rate);
  const interestAmount = toNumber(loan.interest_amount);
  const totalRepayment = toNumber(loan.total_repayment ?? loan.total_amount);
  const totalPaid = toNumber(loan.total_paid);
  const currentBalance = toNumber(loan.current_balance);
  autoTable(doc, {
    startY: 77,
    head: [
      [
        "Loan Summary",
        "Amount"
      ]
    ],
    body: [
      [
        "Principal Amount",
        formatMoney(principalAmount)
      ],
      [
        "Interest Rate",
        `${formatMoney(interestRate)}%`
      ],
      [
        "Interest Amount",
        formatMoney(interestAmount)
      ],
      [
        "Total Repayment",
        formatMoney(totalRepayment)
      ],
      [
        "Total Paid",
        formatMoney(totalPaid)
      ],
      [
        "Current Balance",
        formatMoney(currentBalance)
      ]
    ],
    theme: "grid",
    styles: {
      fontSize: 9
    },
    headStyles: {
      fontStyle: "bold"
    }
  });
  /* =======================================================
     TRANSACTION HISTORY
  ======================================================= */ const transactionStartY = (doc.lastAutoTable?.finalY + 10) ?? 150;
  const transactionRows = transactions.map((transaction)=>{
    const debit = toNumber(transaction.debit);
    const credit = toNumber(transaction.credit);
    const balance = toNumber(transaction.balance);
    return [
      formatDate(transactionDate(transaction)),
      transaction.transaction_type ?? transaction.type ?? "",
      transaction.description ?? "",
      debit > 0 ? formatMoney(debit) : "",
      credit > 0 ? formatMoney(credit) : "",
      formatMoney(balance)
    ];
  });
  autoTable(doc, {
    startY: transactionStartY,
    head: [
      [
        "Date",
        "Type",
        "Description",
        "Debit",
        "Credit",
        "Balance"
      ]
    ],
    body: transactionRows,
    theme: "grid",
    styles: {
      fontSize: 8
    },
    headStyles: {
      fontStyle: "bold"
    },
    columnStyles: {
      0: {
        cellWidth: 24
      },
      1: {
        cellWidth: 25
      },
      2: {
        cellWidth: 55
      },
      3: {
        halign: "right"
      },
      4: {
        halign: "right"
      },
      5: {
        halign: "right"
      }
    }
  });
  /* =======================================================
     OVERDUE SECTION
  ======================================================= */ if (overdues.length > 0) {
    const overdueStartY = (doc.lastAutoTable?.finalY + 10) ?? 200;
    const overdueRows = overdues.map((overdue)=>{
      const amountDue = toNumber(overdue.overdue_amount);
      const amountPaid = toNumber(overdue.amount_paid);
      const outstanding = Math.max(amountDue - amountPaid, 0);
      return [
        formatDate(overdue.cycle_payment_date),
        formatMoney(amountDue),
        formatMoney(amountPaid),
        formatMoney(outstanding),
        overdue.status ?? ""
      ];
    });
    autoTable(doc, {
      startY: overdueStartY,
      head: [
        [
          "Payment Date",
          "Amount Due",
          "Amount Paid",
          "Outstanding",
          "Status"
        ]
      ],
      body: overdueRows,
      theme: "grid",
      styles: {
        fontSize: 8
      },
      headStyles: {
        fontStyle: "bold"
      }
    });
  }
  /* =======================================================
     FOOTER
  ======================================================= */ const pageCount = doc.internal.getNumberOfPages();
  for(let page = 1; page <= pageCount; page++){
    doc.setPage(page);
    const pageHeight = doc.internal.pageSize.height;
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text("Umhlomunye Finance", 14, pageHeight - 10);
    doc.text(`Page ${page} of ${pageCount}`, 170, pageHeight - 10);
  }
  return doc.output("arraybuffer");
}
/* =========================================================
   CREATE / UPDATE STATEMENT
========================================================= */ async function createOrUpdateStatement(loanId) {
  const loan = await getLoan(loanId);
  const transactions = await getTransactions(loanId);
  const overdues = await getOverdues(loanId);
  /*
   * A statement is only meaningful once the loan
   * has at least one transaction.
   */ if (transactions.length === 0) {
    return {
      loan_id: loanId,
      status: "SKIPPED",
      reason: "No loan transactions found."
    };
  }
  if (!loan.statement_verification_token) {
    return {
      loan_id: loanId,
      status: "SKIPPED",
      reason: "Loan does not have a statement verification token."
    };
  }
  const pdfArrayBuffer = await buildStatementPdf(loan, transactions, overdues);
  const pdfBytes = new Uint8Array(pdfArrayBuffer);
  const customerId = loan.customer_id;
  const loanNumber = loan.loan_number ?? loan.loan_no ?? loan.id;
  const safeLoanNumber = safeFileName(loanNumber);
  /*
   * Permanent statement location.
   *
   * This remains inside the central documents bucket.
   */ const documentPath = `statements/${customerId}/${loan.id}/${safeLoanNumber}-statement.pdf`;
  const { data: existingDocument, error: existingError } = await supabase.from("documents").select("*").eq("loan_id", loanId).eq("document_type", STATEMENT_DOCUMENT_TYPE).eq("is_archived", false).is("deleted_at", null).order("created_at", {
    ascending: false
  }).limit(1).maybeSingle();
  if (existingError) {
    throw new Error(`Failed to locate existing statement: ${existingError.message}`);
  }
  /* =======================================================
     STORAGE
  ======================================================= */ const { error: uploadError } = await supabase.storage.from(DOCUMENT_BUCKET).upload(documentPath, pdfBytes, {
    contentType: "application/pdf",
    upsert: true
  });
  if (uploadError) {
    throw new Error(`Failed to upload statement PDF: ${uploadError.message}`);
  }
  /* =======================================================
     UPDATE EXISTING STATEMENT
  ======================================================= */ if (existingDocument) {
    const previousSnapshot = {
      ...existingDocument
    };
    const { data: updatedDocument, error: updateError } = await supabase.from("documents").update({
      document_name: `${safeLoanNumber}-statement.pdf`,
      document_path: documentPath,
      mime_type: "application/pdf",
      source_type: "SYSTEM",
      document_category: "LOAN",
      loan_number_snapshot: loanNumber,
      customer_id_number_snapshot: loan.customers?.id_number ?? null,
      verification_status: "VERIFIED",
      is_archived: false,
      deleted_at: null
    }).eq("id", existingDocument.id).select().single();
    if (updateError) {
      throw new Error(`Failed to update statement document: ${updateError.message}`);
    }
    await recordDocumentHistory(existingDocument.id, "UPDATED", {
      documentSnapshot: updatedDocument,
      previousSnapshot,
      notes: "Loan statement automatically regenerated after a loan transaction."
    });
    return {
      loan_id: loanId,
      status: "UPDATED",
      document_id: existingDocument.id,
      document_path: documentPath
    };
  }
  /* =======================================================
     CREATE FIRST STATEMENT
  ======================================================= */ const documentGroupId = crypto.randomUUID();
  const { data: createdDocument, error: insertError } = await supabase.from("documents").insert({
    customer_id: customerId,
    loan_id: loanId,
    document_type: STATEMENT_DOCUMENT_TYPE,
    document_name: `${safeLoanNumber}-statement.pdf`,
    document_path: documentPath,
    created_by: null,
    mime_type: "application/pdf",
    source_type: "SYSTEM",
    document_category: "LOAN",
    loan_number_snapshot: loanNumber,
    customer_id_number_snapshot: loan.customers?.id_number ?? null,
    verification_status: "VERIFIED",
    is_archived: false,
    deleted_at: null,
    document_group_id: documentGroupId,
    version_number: 1
  }).select().single();
  if (insertError) {
    /*
     * Do not leave an orphaned PDF if the metadata
     * record could not be created.
     */ await supabase.storage.from(DOCUMENT_BUCKET).remove([
      documentPath
    ]);
    throw new Error(`Failed to create statement document: ${insertError.message}`);
  }
  await recordDocumentHistory(createdDocument.id, "CREATED", {
    documentSnapshot: createdDocument,
    notes: "Loan statement automatically created from the first loan transaction."
  });
  return {
    loan_id: loanId,
    status: "CREATED",
    document_id: createdDocument.id,
    document_path: documentPath
  };
}
/* =========================================================
   REQUEST HANDLER
========================================================= */ Deno.serve(async (req)=>{
  try {
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "authorization, content-type",
          "Access-Control-Allow-Methods": "POST, OPTIONS"
        }
      });
    }
    if (req.method !== "POST") {
      return jsonResponse({
        error: "Method not allowed."
      }, 405);
    }
    /* =====================================================
       INTERNAL AUTHENTICATION
    ===================================================== */ if (!STATEMENT_GENERATOR_SECRET) {
      console.error("STATEMENT_GENERATOR_SECRET is not configured.");
      return jsonResponse({
        error: "Statement generator is not configured."
      }, 500);
    }
    const token = getAuthorizationToken(req);
    if (!token || token !== STATEMENT_GENERATOR_SECRET) {
      return jsonResponse({
        error: "Unauthorized."
      }, 401);
    }
    /* =====================================================
       REQUEST BODY
    ===================================================== */ let body = {};
    try {
      body = await req.json();
    } catch  {
      return jsonResponse({
        error: "Request body must be valid JSON."
      }, 400);
    }
    let loanIds = [];
    if (typeof body.loan_id === "string" && body.loan_id.trim()) {
      loanIds.push(body.loan_id.trim());
    }
    if (Array.isArray(body.loan_ids)) {
      loanIds = [
        ...loanIds,
        ...body.loan_ids.filter((value)=>typeof value === "string" && value.trim()).map((value)=>value.trim())
      ];
    }
    loanIds = [
      ...new Set(loanIds)
    ];
    if (loanIds.length === 0) {
      return jsonResponse({
        error: "At least one loan_id is required."
      }, 400);
    }
    const results = [];
    for (const loanId of loanIds){
      try {
        const result = await createOrUpdateStatement(loanId);
        results.push(result);
      } catch (error) {
        console.error(`Statement generation failed for loan ${loanId}:`, error);
        results.push({
          loan_id: loanId,
          status: "ERROR",
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    const failed = results.filter((result)=>result.status === "ERROR");
    return jsonResponse({
      success: failed.length === 0,
      processed: results.length,
      failed: failed.length,
      results
    }, failed.length === results.length ? 500 : 200);
  } catch (error) {
    console.error("generate-loan-statements error:", error);
    return jsonResponse({
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});
