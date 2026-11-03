import { supabase } from "../lib/supabase";
import { sendLoanEmail } from "./emailService";

export async function getInvestorFundingOverview() {
  const [investorsResult, requestsResult, borrowingsResult] = await Promise.all([
    supabase.from("investors").select("*").order("investor_name"),
    supabase.from("investor_funding_requests").select("*").order("created_at", { ascending: false }),
    supabase
      .from("company_borrowings")
      .select("*, investors(investor_name,email,cellphone), loan_applications(application_number,first_name,last_name), investor_interest_charges(*), investor_repayments(*)")
      .not("investor_id", "is", null)
      .order("borrowing_date", { ascending: false }),
  ]);

  for (const result of [investorsResult, requestsResult, borrowingsResult]) {
    if (result.error) throw result.error;
  }

  return {
    investors: investorsResult.data || [],
    requests: requestsResult.data || [],
    borrowings: (borrowingsResult.data || []).map((borrowing) => ({
      ...borrowing,
      investor_interest_charges: [...(borrowing.investor_interest_charges || [])].sort(
        (a, b) => new Date(a.charge_date) - new Date(b.charge_date)
      ),
      investor_repayments: [...(borrowing.investor_repayments || [])].sort(
        (a, b) => new Date(a.repayment_date) - new Date(b.repayment_date)
      ),
    })),
  };
}

export async function createInvestor({ investorName, email, cellphone, notes }) {
  const { data, error } = await supabase.rpc("create_investor", {
    p_investor_name: investorName.trim(),
    p_email: email?.trim() || null,
    p_cellphone: cellphone?.trim() || null,
    p_notes: notes?.trim() || null,
  });
  if (error) throw error;
  return data;
}

export async function recordInvestorFunding({ requestId, investorId, amount, receivedDate, bankReference }) {
  const { data, error } = await supabase.rpc("record_investor_funding_received", {
    p_request_id: requestId,
    p_investor_id: investorId,
    p_amount: Number(amount),
    p_received_date: receivedDate,
    p_bank_reference: bankReference.trim(),
  });
  if (error) throw error;
  return data;
}

export async function recordInvestorRepayment({ borrowingId, amount, repaymentDate, reference, description }) {
  const { data, error } = await supabase.rpc("record_investor_repayment", {
    p_borrowing_id: borrowingId,
    p_amount: Number(amount),
    p_repayment_date: repaymentDate,
    p_reference: reference.trim(),
    p_description: description?.trim() || null,
  });
  if (error) throw error;
  return data;
}

export async function sendPendingInvestorFundingAlerts(requests) {
  const pending = requests.filter(
    (request) => request.status === "REQUESTED" && ["PENDING", "FAILED"].includes(request.alert_status)
  );
  if (!pending.length) return;

  const { data: admins, error: adminsError } = await supabase
    .from("users")
    .select("email,full_name")
    .eq("role", "admin")
    .eq("is_active", true)
    .eq("is_deleted", false);

  if (adminsError) throw adminsError;
  const recipients = (admins || []).filter((admin) => admin.email);
  if (!recipients.length) return;

  for (const request of pending) {
    const { data: claim, error: claimError } = await supabase.rpc(
      "claim_investor_funding_alert",
      { p_request_id: request.id }
    );
    if (claimError) throw claimError;
    if (!claim?.claimed) continue;

    try {
      const { data: sentRows, error: sentRowsError } = await supabase
        .from("email_notifications")
        .select("recipient_email")
        .eq("application_id", claim.application_id)
        .eq("notification_type", "INVESTOR_FUNDING_REQUIRED")
        .eq("status", "SENT");
      if (sentRowsError) throw sentRowsError;
      const alreadySent = new Set((sentRows || []).map((row) => row.recipient_email));
      const unsentRecipients = recipients.filter((admin) => !alreadySent.has(admin.email));
      const results = await Promise.allSettled(
        unsentRecipients.map((admin) =>
          sendLoanEmail({
            notificationType: "INVESTOR_FUNDING_REQUIRED",
            recipientEmail: admin.email,
            recipientName: admin.full_name || "Administrator",
            applicationId: claim.application_id,
            applicationNumber: claim.application_number,
            clientName: claim.customer_name,
            amountRequested: claim.loan_amount,
            termMonths: claim.term_months,
            availableBankBalance: claim.available_bank_balance,
            fundingShortfall: claim.funding_shortfall,
            interestRateMonthly: claim.interest_rate_monthly,
            estimatedInterest: claim.estimated_interest,
            estimatedTotalLiability: claim.estimated_total_liability,
          })
        )
      );
      const failures = results.filter((result) => result.status === "rejected");
      if (failures.length) {
        throw new Error(failures.map((failure) => failure.reason?.message || "Email failed").join("; "));
      }
      const { error: completeError } = await supabase.rpc("complete_investor_funding_alert", {
        p_request_id: request.id,
        p_success: true,
        p_error: null,
      });
      if (completeError) throw completeError;
    } catch (error) {
      await supabase.rpc("complete_investor_funding_alert", {
        p_request_id: request.id,
        p_success: false,
        p_error: error?.message || "Email failed",
      });
      throw error;
    }
  }
}
