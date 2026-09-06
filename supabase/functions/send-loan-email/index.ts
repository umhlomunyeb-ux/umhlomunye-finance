import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type NotificationType =
  | "PENDING_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "AGREEMENT";

type EmailRequest = {
  notificationType: NotificationType;

  applicationId?: string;
  loanId?: string;

  recipientEmail: string;
  recipientName?: string;

  applicationNumber?: string;
  loanNumber?: string;

  clientName?: string;

  amountRequested?: number;
  approvedAmount?: number;

  rejectionReason?: string;

  /**
   * Optional.
   * If supplied, this will be used instead of generating
   * a new agreement token.
   */
  agreementUrl?: string;

  /**
   * Optional agreement version.
   */
  agreementVersion?: string;

  /**
   * Optional expiry in days.
   * Defaults to 7 days.
   */
  agreementExpiryDays?: number;
};

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatCurrency(value: unknown): string {
  const amount = Number(value ?? 0);

  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    minimumFractionDigits: 2,
  }).format(amount);
}

/**
 * Generate a cryptographically secure random token.
 */
function generateSecureToken(): string {
  const bytes = new Uint8Array(32);

  crypto.getRandomValues(bytes);

  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * SHA-256 hash of the raw agreement token.
 *
 * Only the hash is stored in the database.
 * The raw token is only placed in the client's email URL.
 */
async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);

  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    data
  );

  const hashArray = Array.from(
    new Uint8Array(hashBuffer)
  );

  return hashArray
    .map((byte) =>
      byte.toString(16).padStart(2, "0")
    )
    .join("");
}

/**
 * Creates a private agreement URL and stores only the
 * SHA-256 token hash in Supabase.
 */
async function createAgreementLink(
  supabaseAdmin: ReturnType<typeof createClient>,
  data: EmailRequest
): Promise<{
  agreementUrl: string;
  tokenId: string;
}> {
  if (!data.loanId) {
    throw new Error(
      "loanId is required when creating a loan agreement link."
    );
  }

  const appBaseUrl =
    Deno.env.get("APP_BASE_URL") ||
    Deno.env.get("PUBLIC_APP_URL");

  if (!appBaseUrl) {
    throw new Error(
      "APP_BASE_URL is not configured."
    );
  }

  const cleanBaseUrl = appBaseUrl.replace(
    /\/+$/,
    ""
  );

  const rawToken = generateSecureToken();

  const tokenHash = await hashToken(rawToken);

  const expiryDays =
    Number(data.agreementExpiryDays ?? 7);

  const expiresAt = new Date(
    Date.now() +
      expiryDays *
        24 *
        60 *
        60 *
        1000
  ).toISOString();

  const agreementVersion =
    data.agreementVersion ||
    "1.0";

  /**
   * Remove any previous unused agreement tokens
   * for this loan.
   *
   * This prevents multiple active links from being
   * accidentally generated for the same loan.
   */
  await supabaseAdmin
    .from("loan_agreement_tokens")
    .update({
      expires_at: new Date().toISOString(),
    })
    .eq("loan_id", data.loanId)
    .is("used_at", null);

  const { data: tokenRecord, error } =
    await supabaseAdmin
      .from("loan_agreement_tokens")
      .insert({
        loan_id: data.loanId,
        application_id:
          data.applicationId || null,
        token_hash: tokenHash,
        expires_at: expiresAt,
      })
      .select("id")
      .single();

  if (error) {
    console.error(
      "Agreement token insert error:",
      error
    );

    throw new Error(
      `Could not create agreement token: ${error.message}`
    );
  }

  /**
   * The raw token is NEVER stored in Supabase.
   */
  const agreementUrl =
    `${cleanBaseUrl}/loan-agreement/${rawToken}`;

  /**
   * Store agreement version on the loan.
   *
   * We intentionally do not mark agreement_sent_at yet.
   * That only happens after Brevo successfully accepts
   * the email.
   */
  const { error: loanUpdateError } =
    await supabaseAdmin
      .from("loans")
      .update({
        agreement_version:
          agreementVersion,
      })
      .eq("id", data.loanId);

  if (loanUpdateError) {
    console.error(
      "Loan agreement version update error:",
      loanUpdateError
    );
  }

  return {
    agreementUrl,
    tokenId: tokenRecord.id,
  };
}

function buildEmailContent(
  data: EmailRequest
) {
  const clientName = escapeHtml(
    data.clientName ||
      data.recipientName ||
      "Client"
  );

  const applicationNumber = escapeHtml(
    data.applicationNumber || ""
  );

  const loanNumber = escapeHtml(
    data.loanNumber || ""
  );

  const agreementUrl = escapeHtml(
    data.agreementUrl || ""
  );

  let subject = "";
  let title = "";
  let body = "";

  if (
    data.notificationType ===
    "PENDING_REVIEW"
  ) {
    subject =
      `New Loan Application Pending Review – ${applicationNumber}`;

    title = "New Loan Application";

    body = `
      <p>Hello Administrator,</p>

      <p>
        A new loan application has been submitted and is
        <strong>pending review</strong>.
      </p>

      <table style="border-collapse:collapse;width:100%;margin:20px 0;">
        <tr>
          <td style="padding:8px;border:1px solid #ddd;">
            <strong>Application Number</strong>
          </td>
          <td style="padding:8px;border:1px solid #ddd;">
            ${applicationNumber}
          </td>
        </tr>

        <tr>
          <td style="padding:8px;border:1px solid #ddd;">
            <strong>Applicant</strong>
          </td>
          <td style="padding:8px;border:1px solid #ddd;">
            ${clientName}
          </td>
        </tr>

        <tr>
          <td style="padding:8px;border:1px solid #ddd;">
            <strong>Amount Requested</strong>
          </td>
          <td style="padding:8px;border:1px solid #ddd;">
            ${formatCurrency(
              data.amountRequested
            )}
          </td>
        </tr>
      </table>

      <p>
        Please log in to Umhlomunye Finance to review the application.
      </p>
    `;
  }

  if (
    data.notificationType ===
    "APPROVED"
  ) {
    subject =
      `Loan Application Approved – ${loanNumber}`;

    title = "Loan Application Approved";

    body = `
      <p>Dear ${clientName},</p>

      <p>
        We are pleased to inform you that your loan application
        has been <strong>approved</strong>.
      </p>

      <table style="border-collapse:collapse;width:100%;margin:20px 0;">
        <tr>
          <td style="padding:8px;border:1px solid #ddd;">
            <strong>Application Number</strong>
          </td>
          <td style="padding:8px;border:1px solid #ddd;">
            ${applicationNumber}
          </td>
        </tr>

        <tr>
          <td style="padding:8px;border:1px solid #ddd;">
            <strong>Loan Number</strong>
          </td>
          <td style="padding:8px;border:1px solid #ddd;">
            ${loanNumber}
          </td>
        </tr>

        <tr>
          <td style="padding:8px;border:1px solid #ddd;">
            <strong>Approved Amount</strong>
          </td>
          <td style="padding:8px;border:1px solid #ddd;">
            ${formatCurrency(
              data.approvedAmount
            )}
          </td>
        </tr>
      </table>

      <p>
        Your loan agreement is ready for review and acceptance.
      </p>

      <p>
        Please review the agreement carefully before accepting it.
      </p>

      <p style="text-align:center;margin:30px 0;">
        <a
          href="${agreementUrl}"
          style="
            display:inline-block;
            padding:14px 24px;
            background:#0b1f3a;
            color:#ffffff;
            text-decoration:none;
            border-radius:6px;
            font-weight:bold;
          "
        >
          Review &amp; Accept Loan Agreement
        </a>
      </p>

      <p>
        If you did not apply for this loan, please contact
        Umhlomunye Finance immediately.
      </p>

      <p style="font-size:13px;color:#777;">
        This private agreement link expires after the specified
        validity period.
      </p>
    `;
  }

  if (
    data.notificationType ===
    "AGREEMENT"
  ) {
    subject =
      `Loan Agreement Ready – ${loanNumber}`;

    title = "Loan Agreement Ready";

    body = `
      <p>Dear ${clientName},</p>

      <p>
        Your loan agreement is ready for your review.
      </p>

      <p>
        Please click the button below to review the agreement
        and accept it electronically.
      </p>

      <p style="text-align:center;margin:30px 0;">
        <a
          href="${agreementUrl}"
          style="
            display:inline-block;
            padding:14px 24px;
            background:#0b1f3a;
            color:#ffffff;
            text-decoration:none;
            border-radius:6px;
            font-weight:bold;
          "
        >
          Review &amp; Accept Loan Agreement
        </a>
      </p>

      <p>
        Loan Number:
        <strong>${loanNumber}</strong>
      </p>

      <p style="font-size:13px;color:#777;">
        This private agreement link expires after the specified
        validity period.
      </p>
    `;
  }

  if (
    data.notificationType ===
    "REJECTED"
  ) {
    subject =
      `Loan Application Update – ${applicationNumber}`;

    title = "Loan Application Update";

    body = `
      <p>Dear ${clientName},</p>

      <p>
        We regret to inform you that your loan application
        has not been approved.
      </p>

      <table style="border-collapse:collapse;width:100%;margin:20px 0;">
        <tr>
          <td style="padding:8px;border:1px solid #ddd;">
            <strong>Application Number</strong>
          </td>
          <td style="padding:8px;border:1px solid #ddd;">
            ${applicationNumber}
          </td>
        </tr>

        <tr>
          <td style="padding:8px;border:1px solid #ddd;">
            <strong>Reason</strong>
          </td>
          <td style="padding:8px;border:1px solid #ddd;">
            ${escapeHtml(
              data.rejectionReason ||
                "Not provided"
            )}
          </td>
        </tr>
      </table>

      <p>
        Thank you for considering Umhlomunye Finance.
      </p>
    `;
  }

  return {
    subject,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>${escapeHtml(title)}</title>
      </head>

      <body
        style="
          margin:0;
          padding:0;
          background:#f4f6f8;
          font-family:Arial,Helvetica,sans-serif;
          color:#222;
        "
      >

        <div style="max-width:650px;margin:30px auto;background:#ffffff;">

          <div
            style="
              background:#0b1f3a;
              padding:25px;
              color:#ffffff;
              text-align:center;
            "
          >
            <h1 style="margin:0;">
              Umhlomunye Finance
            </h1>

            <p style="margin:8px 0 0;">
              Loan Management
            </p>
          </div>

          <div style="padding:30px;">

            <h2 style="color:#0b1f3a;">
              ${escapeHtml(title)}
            </h2>

            ${body}

            <hr
              style="
                border:0;
                border-top:1px solid #eee;
                margin:30px 0;
              "
            >

            <p
              style="
                font-size:12px;
                color:#777;
              "
            >
              This is an automated message from
              Umhlomunye Finance.
              Please do not reply to this email.
            </p>

          </div>

        </div>

      </body>
      </html>
    `,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  try {
    const body: EmailRequest =
      await req.json();

    if (!body.notificationType) {
      throw new Error(
        "notificationType is required."
      );
    }

    if (!body.recipientEmail) {
      throw new Error(
        "recipientEmail is required."
      );
    }

    /**
     * Approved and Agreement emails need a loan.
     */
    if (
      (
        body.notificationType ===
          "APPROVED" ||
        body.notificationType ===
          "AGREEMENT"
      ) &&
      !body.loanId
    ) {
      throw new Error(
        "loanId is required for approved/agreement emails."
      );
    }

    const brevoApiKey =
      Deno.env.get(
        "BREVO_API_KEY"
      );

    const senderEmail =
      Deno.env.get(
        "BREVO_SENDER_EMAIL"
      );

    const senderName =
      Deno.env.get(
        "BREVO_SENDER_NAME"
      ) ||
      "Umhlomunye Finance";

    if (!brevoApiKey) {
      throw new Error(
        "BREVO_API_KEY is not configured."
      );
    }

    if (!senderEmail) {
      throw new Error(
        "BREVO_SENDER_EMAIL is not configured."
      );
    }

    const supabaseUrl =
      Deno.env.get(
        "SUPABASE_URL"
      );

    const supabaseSecretKey =
      Deno.env.get(
        "SUPABASE_SECRET_KEY"
      ) ||
      Deno.env.get(
        "SUPABASE_SERVICE_ROLE_KEY"
      );

    if (
      !supabaseUrl ||
      !supabaseSecretKey
    ) {
      throw new Error(
        "Supabase server credentials are not configured."
      );
    }

    const supabaseAdmin =
      createClient(
        supabaseUrl,
        supabaseSecretKey
      );

    /**
     * For APPROVED and AGREEMENT emails,
     * generate a secure private agreement link.
     */
    if (
      body.notificationType ===
        "APPROVED" ||
      body.notificationType ===
        "AGREEMENT"
    ) {
      if (!body.agreementUrl) {
        const agreement =
          await createAgreementLink(
            supabaseAdmin,
            body
          );

        body.agreementUrl =
          agreement.agreementUrl;
      }
    }

    const email =
      buildEmailContent(body);

    /**
     * Log notification.
     */
    const {
      data: notification,
      error: insertError,
    } =
      await supabaseAdmin
        .from(
          "email_notifications"
        )
        .insert({
          application_id:
            body.applicationId ||
            null,

          loan_id:
            body.loanId ||
            null,

          recipient_email:
            body.recipientEmail,

          recipient_name:
            body.recipientName ||
            null,

          notification_type:
            body.notificationType,

          subject:
            email.subject,

          status:
            "PENDING",
        })
        .select()
        .single();

    if (insertError) {
      console.error(
        "Notification log insert error:",
        insertError
      );
    }

    /**
     * Send through Brevo.
     */
    const brevoResponse =
      await fetch(
        "https://api.brevo.com/v3/smtp/email",
        {
          method: "POST",

          headers: {
            accept:
              "application/json",

            "api-key":
              brevoApiKey,

            "content-type":
              "application/json",
          },

          body: JSON.stringify({
            sender: {
              name: senderName,
              email: senderEmail,
            },

            to: [
              {
                email:
                  body.recipientEmail,

                name:
                  body.recipientName ||
                  body.clientName ||
                  undefined,
              },
            ],

            subject:
              email.subject,

            htmlContent:
              email.html,
          }),
        }
      );

    const responseText =
      await brevoResponse.text();

    /**
     * Brevo failed.
     */
    if (!brevoResponse.ok) {
      let errorMessage =
        responseText;

      try {
        const parsed =
          JSON.parse(
            responseText
          );

        errorMessage =
          parsed.message ||
          parsed.code ||
          responseText;
      } catch {
        // Keep raw response.
      }

      if (notification?.id) {
        await supabaseAdmin
          .from(
            "email_notifications"
          )
          .update({
            status: "FAILED",
            error_message:
              errorMessage,
          })
          .eq(
            "id",
            notification.id
          );
      }

      throw new Error(
        `Brevo email failed: ${errorMessage}`
      );
    }

    let brevoResult: {
      messageId?: string;
    } = {};

    try {
      brevoResult =
        JSON.parse(
          responseText
        );
    } catch {
      // Ignore JSON parsing failure.
    }

    /**
     * Email successfully accepted by Brevo.
     */
    if (notification?.id) {
      await supabaseAdmin
        .from(
          "email_notifications"
        )
        .update({
          status: "SENT",

          brevo_message_id:
            brevoResult.messageId ||
            null,

          sent_at:
            new Date().toISOString(),
        })
        .eq(
          "id",
          notification.id
        );
    }

    /**
     * Only mark the agreement as sent AFTER
     * Brevo successfully accepted the email.
     */
    if (
      body.loanId &&
      (
        body.notificationType ===
          "APPROVED" ||
        body.notificationType ===
          "AGREEMENT"
      )
    ) {
      const {
        error: agreementSentError,
      } =
        await supabaseAdmin
          .from("loans")
          .update({
            agreement_sent_at:
              new Date().toISOString(),
          })
          .eq(
            "id",
            body.loanId
          );

      if (agreementSentError) {
        console.error(
          "Could not update agreement_sent_at:",
          agreementSentError
        );
      }
    }

    return new Response(
      JSON.stringify({
        success: true,

        messageId:
          brevoResult.messageId ||
          null,

        /**
         * This is useful to the application
         * for logging/debugging, but the raw
         * token is never stored in the database.
         */
        agreementUrl:
          body.agreementUrl ||
          null,
      }),
      {
        status: 200,

        headers: {
          ...corsHeaders,

          "Content-Type":
            "application/json",
        },
      }
    );
  } catch (error) {
    console.error(
      "send-loan-email error:",
      error
    );

    return new Response(
      JSON.stringify({
        success: false,

        error:
          error instanceof Error
            ? error.message
            : "Unknown error",
      }),
      {
        status: 500,

        headers: {
          ...corsHeaders,

          "Content-Type":
            "application/json",
        },
      }
    );
  }
});