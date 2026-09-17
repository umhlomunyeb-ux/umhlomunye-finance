import { supabase } from "../lib/supabase";

export async function addLoanApplication(applicationData) {
  const {
    first_name,
    last_name,
    cellphone,
    email,
    physical_address,
    id_number,
    employer,
    employment_status,
    monthly_income,
    other_income,
    bank_name,
    account_number,
    amount_requested,
    loan_purpose,
    preferred_payment_date,
    collection_preference,
    notes,
  } = applicationData;

  const { data, error } = await supabase.rpc("submit_loan_application", {
    p_first_name: first_name,
    p_last_name: last_name,
    p_cellphone: cellphone,
    p_email: email,
    p_physical_address: physical_address,
    p_employer: employer,
    p_employment_status: employment_status,
    p_monthly_income: monthly_income,
    p_other_income: other_income,
    p_bank_name: bank_name,
    p_account_number: account_number,
    p_amount_requested: amount_requested,
    p_loan_purpose: loan_purpose,
    p_preferred_payment_date: preferred_payment_date,
    p_collection_preference: collection_preference,
    p_notes: notes,
    p_id_number: id_number ?? null,
  });

  if (error) throw error;

  return Array.isArray(data) ? data[0] : data;
}

export async function uploadPublicApplicationDocument({
  applicationId,
  uploadToken,
  documentType,
  file,
}) {
  if (!applicationId) {
    throw new Error("Application ID is required.");
  }

  if (!uploadToken) {
    throw new Error("Application upload token is required.");
  }

  if (!documentType) {
    throw new Error("Document type is required.");
  }

  if (!file) {
    throw new Error("A document file is required.");
  }

  const formData = new FormData();

  formData.append("application_id", applicationId);
  formData.append("upload_token", uploadToken);
  formData.append("document_type", documentType);
  formData.append("file", file);

  const { data, error } = await supabase.functions.invoke(
    "public-application-upload",
    {
      body: formData,
    }
  );

  if (error) {
    throw error;
  }

  if (!data?.success) {
    throw new Error(
      data?.error || "The supporting document could not be uploaded."
    );
  }

  return data;
}

export async function getLoanApplications() {
  const { data, error } = await supabase
    .from("loan_applications")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;

  return data || [];
}

export async function getLoanApplication(id) {
  const { data, error } = await supabase
    .from("loan_applications")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;

  return data;
}

export async function updateLoanApplicationStatus(
  id,
  status,
  rejectionReason = null
) {
  const { data, error } = await supabase
    .from("loan_applications")
    .update({
      status,
      rejection_reason: rejectionReason,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;

  return data;
}

export async function deleteLoanApplication(id) {
  const { error } = await supabase
    .from("loan_applications")
    .delete()
    .eq("id", id);

  if (error) throw error;
}