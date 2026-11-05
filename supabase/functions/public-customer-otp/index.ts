import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function maskEmail(email: string) {
  const [name, domain] = email.split("@");
  if (!domain) return "***";
  return `${name.slice(0, 1)}${"*".repeat(Math.max(2, name.length - 1))}@${domain}`;
}
function normalizeId(value: unknown) {
  return String(value ?? "").replace(/\D/g, "").slice(0, 13);
}
function randomDigits() {
  return String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
}
function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ success: false, error: "Method not allowed." }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY") ?? "";
    const brevoKey = Deno.env.get("BREVO_API_KEY") ?? "";
    const senderEmail = Deno.env.get("BREVO_SENDER_EMAIL") ?? "";
    const senderName = Deno.env.get("BREVO_SENDER_NAME") ?? "Umhlomunye Finance";
    if (!url || !serviceKey) throw new Error("Server configuration is incomplete.");
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const body = await req.json();
    const action = String(body.action ?? "");
    const idNumber = normalizeId(body.idNumber);
    if (idNumber.length !== 13) return reply({ success: false, error: "Enter a valid 13-digit South African ID number." }, 400);

    const fingerprint = await sha256(`${serviceKey}:customer-id:${idNumber}`);

    if (action === "start") {
      const { data: lookupRows, error: lookupError } = await admin.rpc("lookup_public_customer_by_id_number", { p_id_number: idNumber });
      if (lookupError) throw lookupError;
      const matched = Array.isArray(lookupRows) ? lookupRows[0] : lookupRows;
      let customerId: string | null = null;
      let applicationId: string | null = null;
      let email = "";
      if (matched?.customer_id) {
        const { data: customer, error } = await admin.from("customers")
          .select("id,email").eq("id", matched.customer_id).maybeSingle();
        if (error) throw error;
        if (!customer) return reply({ success: true, existingCustomer: false });
        customerId = customer.id;
        email = String(customer.email ?? "").trim().toLowerCase();
      } else {
        const { data: resumableRows, error: resumableError } = await admin.rpc("lookup_public_resumable_application_email", { p_id_number: idNumber });
        if (resumableError) throw resumableError;
        const resumable = Array.isArray(resumableRows) ? resumableRows[0] : resumableRows;
        if (!resumable?.application_id) return reply({ success: true, existingCustomer: false });
        applicationId = resumable.application_id;
        email = String(resumable.email ?? "").trim().toLowerCase();
      }
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return reply({ success: false, existingCustomer: true, emailMissing: true, error: "This customer record has no valid registered email address. Please contact Umhlomunye Finance to update your email address before continuing." }, 409);
      }
      if (!brevoKey || !senderEmail) throw new Error("Email OTP is not configured on the server.");
      const { data: recent, error: recentError } = await admin.from("public_customer_otp_challenges")
        .select("id,send_count,last_sent_at,created_at").eq("id_fingerprint", fingerprint)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (recentError) throw recentError;
      if (recent?.last_sent_at && Date.now() - new Date(recent.last_sent_at).getTime() < 60000) {
        return reply({ success: false, error: "Please wait 60 seconds before requesting another code." }, 429);
      }
      const { count, error: countError } = await admin.from("public_customer_otp_challenges")
        .select("id", { count: "exact", head: true }).eq("id_fingerprint", fingerprint)
        .gte("created_at", new Date(Date.now() - 86400000).toISOString());
      if (countError) throw countError;
      if ((count ?? 0) >= 5) return reply({ success: false, error: "The daily OTP request limit has been reached. Please contact Umhlomunye Finance." }, 429);

      const otp = randomDigits();
      const otpHash = await sha256(`${serviceKey}:otp:${fingerprint}:${otp}`);
      const { error: insertError } = await admin.from("public_customer_otp_challenges").insert({
        customer_id: customerId, application_id: applicationId, id_fingerprint: fingerprint, otp_hash: otpHash,
        expires_at: new Date(Date.now() + 5 * 60000).toISOString(),
        attempts: 0, send_count: (recent?.send_count ?? 0) + 1, last_sent_at: new Date().toISOString(),
      });
      if (insertError) throw insertError;

      const emailResponse = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": brevoKey, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          sender: { name: senderName, email: senderEmail },
          to: [{ email }],
          subject: "Your Umhlomunye Finance verification code",
          htmlContent: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto"><h2>Verify your identity</h2><p>Your Umhlomunye Finance verification code is:</p><p style="font-size:30px;font-weight:bold;letter-spacing:8px">${otp}</p><p>This code expires in 5 minutes. Do not share it with anyone.</p><p>If you did not request this code, please ignore this email.</p></div>`,
        }),
      });
      if (!emailResponse.ok) {
        const details = await emailResponse.text();
        console.error("Brevo OTP delivery failed", details);
        return reply({ success: false, error: "The verification email could not be sent. Please try again later." }, 502);
      }
      return reply({ success: true, existingCustomer: Boolean(customerId), priorApplicant: Boolean(applicationId), otpRequired: true, maskedEmail: maskEmail(email) });
    }

    if (action === "verify") {
      const otp = String(body.otp ?? "").replace(/\D/g, "");
      if (!/^\d{6}$/.test(otp)) return reply({ success: false, error: "Enter the six-digit code." }, 400);
      const { data: challenge, error } = await admin.from("public_customer_otp_challenges")
        .select("*").eq("id_fingerprint", fingerprint).is("verified_at", null)
        .gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      if (!challenge) return reply({ success: false, error: "The code has expired. Request a new code." }, 401);
      if (challenge.attempts >= 5) return reply({ success: false, error: "Too many incorrect attempts. Request a new code." }, 429);
      const candidate = await sha256(`${serviceKey}:otp:${fingerprint}:${otp}`);
      if (candidate !== challenge.otp_hash) {
        await admin.from("public_customer_otp_challenges").update({ attempts: challenge.attempts + 1 })
          .eq("id", challenge.id);
        return reply({ success: false, error: `Incorrect code. ${4 - challenge.attempts} attempt(s) remaining.` }, 401);
      }
      const proof = randomToken();
      const proofHash = await sha256(`${serviceKey}:proof:${proof}`);
      const { error: updateError } = await admin.from("public_customer_otp_challenges").update({
        verified_at: new Date().toISOString(), verification_token_hash: proofHash,
        expires_at: new Date(Date.now() + 30 * 60000).toISOString(), otp_hash: "CONSUMED",
      }).eq("id", challenge.id);
      if (updateError) throw updateError;
      return reply({ success: true, verified: true, verificationToken: proof, expiresInSeconds: 1800 });
    }

    const proof = String(body.verificationToken ?? "");
    let verified: { id: string; customer_id: string | null; application_id?: string | null } | null = null;
    if (action === "submit_application") {
      const { data: lookupRows, error: lookupError } = await admin.rpc("lookup_public_customer_by_id_number", { p_id_number: idNumber });
      if (lookupError) throw lookupError;
      const matched = Array.isArray(lookupRows) ? lookupRows[0] : lookupRows;
      let requiredCustomerId: string | null = matched?.customer_id ?? null;
      let requiredApplicationId: string | null = null;
      if (!requiredCustomerId) {
        const { data: resumableRows, error: resumableError } = await admin.rpc("lookup_public_resumable_application_email", { p_id_number: idNumber });
        if (resumableError) throw resumableError;
        const resumable = Array.isArray(resumableRows) ? resumableRows[0] : resumableRows;
        requiredApplicationId = resumable?.application_id ?? null;
      }
      if (requiredCustomerId || requiredApplicationId) {
        if (proof.length < 40) return reply({ success: false, error: "Verify your identity by email before submitting this application." }, 401);
        const tokenHash = await sha256(`${serviceKey}:proof:${proof}`);
        const { data: proofRow, error: proofError } = await admin.from("public_customer_otp_challenges")
          .select("id,customer_id,application_id").eq("id_fingerprint", fingerprint).eq("verification_token_hash", tokenHash)
          .not("verified_at", "is", null).gt("expires_at", new Date().toISOString())
          .order("verified_at", { ascending: false }).limit(1).maybeSingle();
        if (proofError) throw proofError;
        if (!proofRow || (requiredCustomerId && proofRow.customer_id !== requiredCustomerId) || (requiredApplicationId && proofRow.application_id !== requiredApplicationId)) {
          return reply({ success: false, error: "Identity verification is required for this existing record." }, 401);
        }
        verified = proofRow;
      }
    } else {
      if (proof.length < 40) return reply({ success: false, error: "Identity verification is required." }, 401);
      const tokenHash = await sha256(`${serviceKey}:proof:${proof}`);
      const { data: proofRow, error: proofError } = await admin.from("public_customer_otp_challenges")
        .select("id,customer_id,application_id").eq("id_fingerprint", fingerprint).eq("verification_token_hash", tokenHash)
        .not("verified_at", "is", null).gt("expires_at", new Date().toISOString())
        .order("verified_at", { ascending: false }).limit(1).maybeSingle();
      if (proofError) throw proofError;
      if (!proofRow) return reply({ success: false, error: "Your verification has expired. Please verify your ID again." }, 401);
      verified = proofRow;
    }

    if (action === "submit_application") {
      const application = body.applicationData ?? {};
      const { data: submission, error: submissionError } = await admin.rpc("submit_loan_application", {
        p_id_number: idNumber,
        p_first_name: application.first_name ?? "",
        p_last_name: application.last_name ?? "",
        p_cellphone: application.cellphone ?? "",
        p_email: application.email ?? null,
        p_physical_address: application.physical_address ?? null,
        p_employer: application.employer ?? null,
        p_monthly_income: application.monthly_income ?? null,
        p_other_income: application.other_income ?? null,
        p_bank_name: application.bank_name ?? "",
        p_account_number: application.account_number ?? "",
        p_amount_requested: application.amount_requested,
        p_loan_purpose: application.loan_purpose ?? null,
        p_preferred_payment_date: application.preferred_payment_date ?? null,
        p_collection_preference: application.collection_preference ?? null,
        p_notes: application.notes ?? null,
        p_employment_status: application.employment_status ?? null,
        p_selected_term_months: application.selected_term_months ?? 1,
        p_work_address: application.work_address ?? "",
      });
      if (submissionError) throw submissionError;
      const result = Array.isArray(submission) ? submission[0] : submission;
      return reply({ success: true, result });
    }

    if (action === "options") {
      if (!verified.customer_id) {
        const { data: resume, error: resumeError } = await admin.rpc("resume_public_loan_application_by_id_number", { p_id_number: idNumber });
        if (resumeError) throw resumeError;
        if (!resume) return reply({ success: false, error: "The quotation is no longer available. Please start a new application." }, 404);
        return reply({ success: true, priorApplicant: true, customer: null, topUpEligibility: null, resumeApplication: resume });
      }
      const { data: customer, error: customerError } = await admin.from("customers")
        .select("id,customer_number,first_name,last_name,cellphone,email,physical_address,employer,monthly_income,credit_limit,is_blacklisted")
        .eq("id", verified.customer_id).maybeSingle();
      if (customerError) throw customerError;
      if (!customer || customer.is_blacklisted) return reply({ success: false, blacklisted: !!customer?.is_blacklisted, error: customer?.is_blacklisted ? "This customer account is blacklisted. Please contact Umhlomunye Finance." : "Customer record not found." }, 403);
      const [{ data: eligibility, error: eligibilityError }, { data: resume, error: resumeError }] = await Promise.all([
        admin.rpc("get_public_top_up_eligibility", { p_id_number: idNumber }),
        admin.rpc("resume_public_loan_application_by_id_number", { p_id_number: idNumber }),
      ]);
      if (eligibilityError) throw eligibilityError;
      if (resumeError) console.warn("Resume lookup:", resumeError.message);
      return reply({ success: true, customer, topUpEligibility: eligibility ?? null, resumeApplication: resume ?? null });
    }

    if (action === "cancel_resume") {
      if (!verified || (!verified.customer_id && !verified.application_id) || (verified.application_id && verified.application_id !== String(body.applicationId ?? ""))) {
        return reply({ success: false, error: "The quotation could not be verified for cancellation." }, 403);
      }
      const { data, error } = await admin.rpc("cancel_unfinished_public_application", {
        p_application_id: body.applicationId,
        p_id_number: idNumber,
      });
      if (error) throw error;
      return reply({ success: true, result: data });
    }

    if (action === "top_up") {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) return reply({ success: false, error: "Enter a valid top-up amount." }, 400);
      const { data, error } = await admin.rpc("submit_public_loan_top_up", { p_id_number: idNumber, p_amount: amount });
      if (error) throw error;
      return reply({ success: true, result: data });
    }

    if (action === "credit_limit_request") {
      const requested = Number(body.requestedCreditLimit);
      const reason = String(body.reason ?? "").trim();
      const base64 = String(body.payslipBase64 ?? "");
      const mime = String(body.payslipMimeType ?? "").toLowerCase();
      const ext = mime === "application/pdf" ? "pdf" : mime === "image/jpeg" ? "jpg" : mime === "image/png" ? "png" : "";
      if (!Number.isFinite(requested) || requested <= 0) return reply({ success: false, error: "Enter a valid requested credit limit." }, 400);
      if (reason.length < 10 || reason.length > 2000) return reply({ success: false, error: "Please provide a reason of at least 10 characters." }, 400);
      if (!ext || !base64 || base64.length > 14_000_000) return reply({ success: false, error: "Upload your latest payslip as a PDF, JPG or PNG (maximum 10 MB)." }, 400);
      const { data: customer, error: customerError } = await admin.from("customers").select("credit_limit").eq("id", verified.customer_id).single();
      if (customerError) throw customerError;
      const currentLimit = Number(customer.credit_limit ?? 0);
      if (requested <= currentLimit) return reply({ success: false, error: "The requested limit must be higher than your current credit limit." }, 400);
      if (requested > 6000) return reply({ success: false, error: "The maximum credit limit is R6,000." }, 400);
      const raw = atob(base64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      if (bytes.byteLength === 0 || bytes.byteLength > 10 * 1024 * 1024) return reply({ success: false, error: "Payslip file exceeds 10 MB." }, 400);
      const path = `credit-limit-requests/${verified.customer_id}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await admin.storage.from("documents").upload(path, bytes, { contentType: mime, upsert: false });
      if (uploadError) throw uploadError;
      const { data: request, error: requestError } = await admin.from("credit_limit_increase_requests").insert({
        customer_id: verified.customer_id, current_credit_limit: customer.credit_limit ?? 0,
        requested_credit_limit: requested, reason, payslip_storage_path: path, status: "PENDING",
      }).select("id,status,created_at").single();
      if (requestError) {
        await admin.storage.from("documents").remove([path]);
        throw requestError;
      }
      return reply({ success: true, request });
    }

    return reply({ success: false, error: "Unsupported action." }, 400);
  } catch (error) {
    console.error("public-customer-otp:", error);
    return reply({ success: false, error: error instanceof Error ? error.message : "Request failed." }, 500);
  }
});