import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({
        error: "Method not allowed"
      }), {
        status: 405,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const formData = await req.formData();
    const agreementId = formData.get("agreement_id");
    const signingToken = formData.get("signing_token");
    const pdf = formData.get("pdf");
    if (typeof agreementId !== "string" || typeof signingToken !== "string" || !(pdf instanceof File)) {
      return new Response(JSON.stringify({
        error: "agreement_id, signing_token and pdf are required."
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    if (pdf.type !== "application/pdf") {
      return new Response(JSON.stringify({
        error: "Only PDF documents are allowed."
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const secretKeysRaw = Deno.env.get("SUPABASE_SECRET_KEYS");
    if (!supabaseUrl) {
      throw new Error("SUPABASE_URL is missing.");
    }
    if (!secretKeysRaw) {
      throw new Error("SUPABASE_SECRET_KEYS is missing.");
    }
    const secretKeys = JSON.parse(secretKeysRaw);
    const secretKey = secretKeys["default"];
    if (!secretKey) {
      throw new Error("Default Supabase secret key is missing.");
    }
    const supabase = createClient(supabaseUrl, secretKey);
    /*
     * Verify the agreement using BOTH:
     * - agreement ID
     * - signing token
     *
     * This prevents a caller from supplying an arbitrary agreement ID.
     */ const { data: agreement, error: agreementError } = await supabase.from("loan_agreements").select(`
          id,
          loan_id,
          customer_id,
          agreement_number,
          status,
          signing_token
        `).eq("id", agreementId).eq("signing_token", signingToken).single();
    if (agreementError || !agreement) {
      console.error("Agreement lookup failed:", agreementError);
      return new Response(JSON.stringify({
        error: agreementError?.message || "Agreement not found or signing token is invalid.",
        details: agreementError
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    /*
     * The customer MUST have accepted the agreement first.
     */ if (agreement.status !== "Signed") {
      return new Response(JSON.stringify({
        error: "The agreement has not been accepted by the customer."
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    /*
     * Generate the storage path on the server.
     *
     * The browser is NOT allowed to choose where the document
     * gets stored.
     */ const safeAgreementNumber = agreement.agreement_number.replace(/[^a-zA-Z0-9_-]/g, "_");
    const documentPath = `agreements/${agreement.customer_id}/` + `${agreement.loan_id}/` + `${safeAgreementNumber}-signed.pdf`;
    /*
     * Upload the official signed PDF to the private bucket.
     */ const pdfBytes = new Uint8Array(await pdf.arrayBuffer());
    const { error: uploadError } = await supabase.storage.from("loan-documents").upload(documentPath, pdfBytes, {
      contentType: "application/pdf",
      upsert: true
    });
    if (uploadError) {
      console.error("Storage upload failed:", uploadError);
      return new Response(JSON.stringify({
        error: "The signed agreement could not be stored."
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    /*
     * Create/update the document database record.
     */ const { data: documentId, error: documentError } = await supabase.rpc("create_signed_agreement_document", {
      p_agreement_id: agreementId,
      p_document_path: documentPath
    });
    if (documentError) {
      console.error("Document record creation failed:", documentError);
      return new Response(JSON.stringify({
        error: "The PDF was uploaded but the document record could not be created."
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    /*
     * Email the signed agreement immediately after the official
     * signed PDF has been stored. The PDF is attached directly so
     * the customer receives the signed document, not just a link.
     */
    let emailSent = false;
    let emailError = null;

    try {
      const brevoApiKey =
        Deno.env.get("BREVO_API_KEY");

      const senderEmail =
        Deno.env.get("BREVO_SENDER_EMAIL");

      const senderName =
        Deno.env.get("BREVO_SENDER_NAME") ||
        "Umhlomunye Finance";

      if (!brevoApiKey || !senderEmail) {
        throw new Error(
          "Email sender configuration is not available."
        );
      }

      const { data: customer, error: customerError } =
        await supabase
          .from("customers")
          .select("first_name, last_name, email")
          .eq("id", agreement.customer_id)
          .single();

      if (customerError) {
        throw customerError;
      }

      const recipientEmail =
        String(customer?.email || "").trim();

      const recipientName =
        `${customer?.first_name || ""} ${customer?.last_name || ""}`.trim() ||
        "Customer";

      if (!recipientEmail) {
        throw new Error(
          "The customer does not have an email address."
        );
      }

      const { data: loan } =
        await supabase
          .from("loans")
          .select("loan_number")
          .eq("id", agreement.loan_id)
          .maybeSingle();

      const loanNumber =
        loan?.loan_number || agreement.loan_id;

      const binary = Array.from(pdfBytes, (byte) =>
        String.fromCharCode(byte)
      ).join("");

      const attachmentContent =
        btoa(binary);

      const subject =
        `Signed Loan Agreement - ${loanNumber}`;

      const html = `
        <!DOCTYPE html>
        <html>
        <body style="font-family:Arial,Helvetica,sans-serif;color:#222;">
          <div style="max-width:650px;margin:30px auto;background:#fff;">
            <div style="background:#0b1f3a;padding:25px;color:#fff;text-align:center;">
              <h1 style="margin:0;">Umhlomunye Finance</h1>
              <p style="margin:8px 0 0;">Loan Management</p>
            </div>
            <div style="padding:30px;">
              <h2 style="color:#0b1f3a;">Signed Loan Agreement</h2>
              <p>Dear ${recipientName},</p>
              <p>Your loan agreement has been successfully signed and is now attached to this email.</p>
              <p>
                <strong>Loan Number:</strong>
                ${loanNumber}
              </p>
              <p>
                Please keep the attached signed agreement for your records.
              </p>
              <hr style="border:0;border-top:1px solid #eee;margin:30px 0;">
              <p style="font-size:12px;color:#777;">
                This is an automated message from Umhlomunye Finance.
              </p>
            </div>
          </div>
        </body>
        </html>
      `;

      const {
        data: notification,
        error: notificationInsertError,
      } = await supabase
        .from("email_notifications")
        .insert({
          application_id: null,
          loan_id: agreement.loan_id,
          recipient_email: recipientEmail,
          recipient_name: recipientName,
          notification_type: "SIGNED_AGREEMENT",
          subject,
          status: "PENDING",
        })
        .select("id")
        .maybeSingle();

      if (notificationInsertError) {
        console.error(
          "SIGNED AGREEMENT NOTIFICATION LOG ERROR:",
          notificationInsertError
        );
      }

      const brevoResponse =
        await fetch(
          "https://api.brevo.com/v3/smtp/email",
          {
            method: "POST",
            headers: {
              accept: "application/json",
              "api-key": brevoApiKey,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              sender: {
                name: senderName,
                email: senderEmail,
              },
              to: [
                {
                  email: recipientEmail,
                  name: recipientName,
                },
              ],
              subject,
              htmlContent: html,
              attachment: [
                {
                  content: attachmentContent,
                  name:
                    `${agreement.agreement_number || "signed-loan-agreement"}-signed.pdf`,
                },
              ],
            }),
          }
        );

      const responseText =
        await brevoResponse.text();

      if (!brevoResponse.ok) {
        throw new Error(
          `Brevo email failed: ${responseText}`
        );
      }

      let brevoResult = {};

      try {
        brevoResult =
          JSON.parse(responseText);
      } catch {
        // Ignore JSON parsing failure.
      }

      if (notification?.id) {
        await supabase
          .from("email_notifications")
          .update({
            status: "SENT",
            brevo_message_id:
              brevoResult.messageId || null,
            sent_at:
              new Date().toISOString(),
          })
          .eq(
            "id",
            notification.id
          );
      }

      emailSent = true;
    } catch (error) {
      emailError =
        error instanceof Error
          ? error.message
          : "Unknown email error.";

      console.error(
        "SIGNED AGREEMENT EMAIL ERROR:",
        error
      );
    }

    return new Response(JSON.stringify({
      success: true,
      agreement_id: agreementId,
      document_id: documentId,
      document_path: documentPath,
      email_sent: emailSent,
      email_error: emailError
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("Unexpected error:", error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Unexpected server error."
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
