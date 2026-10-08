import jsPDF from "jspdf";

import { supabase } from "../lib/supabase";

import {
  drawPdfCompanyHeader,
  getPdfVerificationUrl,
} from "./pdfBrandingService";

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toNumber(value));
}

function formatDate(value) {
  if (!value) return "-";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "-";

  return new Intl.DateTimeFormat("en-ZA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export async function generateAndStorePaidUpLetter(loanId) {
  if (!loanId) {
    throw new Error("Loan ID is required.");
  }

  const { data: loan, error: loanError } = await supabase
    .from("loans")
    .select(`
      *,
      customers (
        id,
        customer_number,
        first_name,
        last_name,
        email
      )
    `)
    .eq("id", loanId)
    .single();

  if (loanError) {
    throw loanError;
  }

  if (toNumber(loan.current_balance) > 0) {
    throw new Error(
      "The Paid-Up Letter is only available when the loan balance is R0.00."
    );
  }

  const customerName =
    `${loan.customers?.first_name || ""} ${loan.customers?.last_name || ""}`.trim() ||
    "Customer";

  const pdf = new jsPDF();

  const verificationUrl = loan.statement_verification_token
    ? getPdfVerificationUrl(
        loan.statement_verification_token,
        "statement"
      )
    : null;

  const { contentStartY, accent } =
    await drawPdfCompanyHeader(pdf, verificationUrl);

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(15);
  pdf.setTextColor(...accent);
  pdf.text("PAID-UP LETTER", 14, contentStartY);

  pdf.setTextColor(0, 0, 0);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);

  let y = contentStartY + 12;

  pdf.text(`Customer: ${customerName}`, 14, y);
  y += 7;
  pdf.text(
    `Customer Number: ${loan.customers?.customer_number || "-"}`,
    14,
    y
  );
  y += 7;
  pdf.text(`Loan Number: ${loan.loan_number || "-"}`, 14, y);
  y += 7;
  pdf.text(
    `Paid-Up Date: ${formatDate(loan.last_payment_date || new Date())}`,
    14,
    y
  );

  y += 14;

  pdf.setFont("helvetica", "bold");
  pdf.text("ACCOUNT STATUS", 14, y);

  y += 9;

  pdf.setFont("helvetica", "normal");
  pdf.text(
    "This letter confirms that the above-mentioned loan account has been paid in full.",
    14,
    y,
    { maxWidth: 180 }
  );

  y += 16;

  pdf.setFont("helvetica", "bold");
  pdf.text("Final Outstanding Balance", 14, y);

  pdf.setFont("helvetica", "normal");
  pdf.text(formatCurrency(loan.current_balance), 95, y);

  y += 12;

  pdf.setFont("helvetica", "normal");
  pdf.text(
    "The loan account is therefore recorded as paid up and no further amount is outstanding.",
    14,
    y,
    { maxWidth: 180 }
  );

  const pageHeight = pdf.internal.pageSize.height;

  pdf.setFontSize(8);
  pdf.setTextColor(90, 90, 90);
  pdf.text(
    "This is a system-generated paid-up letter.",
    14,
    pageHeight - 12
  );

  const blob = pdf.output("blob");

  const safeLoanNumber = String(
    loan.loan_number || loan.id
  ).replace(/[^a-zA-Z0-9_-]/g, "_");

  const fileName =
    `${safeLoanNumber}-paid-up-letter.pdf`;

  const documentPath =
    `paid-up-letters/${loan.customer_id}/${loan.id}/${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from("loan-documents")
    .upload(documentPath, blob, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (uploadError) {
    throw uploadError;
  }

  const {
    data: userData,
  } = await supabase.auth.getUser();

  const { data: existing } = await supabase
    .from("documents")
    .select("id")
    .eq("loan_id", loan.id)
    .eq("document_type", "Paid-Up Letter")
    .eq("is_archived", false)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const metadata = {
    customer_id: loan.customer_id,
    loan_id: loan.id,
    document_type: "Paid-Up Letter",
    document_category: "LOAN",
    document_name: `Paid-Up Letter - ${safeLoanNumber}`,
    document_path: documentPath,
    created_by: userData?.user?.id || null,
    mime_type: "application/pdf",
    file_size_bytes: blob.size,
    source_type: "SYSTEM_GENERATED",
    retention_policy: "LOAN_DOCUMENT",
    retention_status: "ACTIVE",
    verification_status: "VERIFIED",
    is_archived: false,
    deleted_at: null,
    version_number: 1,
  };

  let document;

  if (existing?.id) {
    const { data, error } = await supabase
      .from("documents")
      .update(metadata)
      .eq("id", existing.id)
      .select()
      .single();

    if (error) throw error;
    document = data;
  } else {
    const { data, error } = await supabase
      .from("documents")
      .insert(metadata)
      .select()
      .single();

    if (error) throw error;
    document = data;
  }

  return {
    loan,
    customerEmail: loan.customers?.email || "",
    customerName,
    document,
    documentPath,
  };
}
