import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    const { applicationId, uploadToken } = await req.json();
    if (!applicationId || !uploadToken || typeof uploadToken !== "string") {
      return new Response(JSON.stringify({ success: false, error: "Application ID and security token are required." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    const serviceKey = secretKeys.default;
    const frontendUrl = Deno.env.get("FRONTEND_APP_URL");
    if (!supabaseUrl || !serviceKey || !frontendUrl) throw new Error("Server configuration is incomplete.");

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: finalized, error: finalizeError } = await admin.rpc(
      "finalize_accepted_public_loan_offer",
      { p_application_id: applicationId, p_upload_token: uploadToken },
    );
    if (finalizeError) throw finalizeError;
    if (!finalized?.success || !finalized?.signing_token) throw new Error("Loan agreement finalization did not return a signing token.");

    const { data: application, error: appError } = await admin
      .from("loan_applications")
      .select("application_number,first_name,last_name,email,amount_requested")
      .eq("id", applicationId)
      .single();
    if (appError) throw appError;

    const signingUrl = `${frontendUrl.replace(/\\/+$/, "")}/sign-agreement/${finalized.signing_token}`;
    let emailSent = false;
    let emailError: string | null = null;

    if (application.email) {
      const emailResponse = await fetch(`${supabaseUrl}/functions/v1/send-loan-email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          notificationType: "AGREEMENT",
          applicationId,
          loanId: finalized.loan_id,
          recipientEmail: application.email,
          recipientName: [application.first_name, application.last_name].filter(Boolean).join(" "),
          applicationNumber: application.application_number,
          loanNumber: finalized.loan_number,
          clientName: [application.first_name, application.last_name].filter(Boolean).join(" "),
          approvedAmount: finalized.principal_amount,
          agreementUrl: signingUrl,
        }),
      });
      emailSent = emailResponse.ok;
      if (!emailSent) emailError = await emailResponse.text();
    }

    return new Response(JSON.stringify({
      success: true,
      loanNumber: finalized.loan_number,
      agreementNumber: finalized.agreement_number,
      signingUrl,
      emailSent,
      emailError,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("finalize-public-loan-offer:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : "Unable to finalize the accepted loan offer.",
    }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
