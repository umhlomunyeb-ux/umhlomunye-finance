import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatCurrency(value) {
  const amount = Number(value ?? 0);

  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    minimumFractionDigits: 2,
  }).format(amount);
}

function buildEmailContent(data, frontendAppUrl) {
  const clientName = escapeHtml(
    data.clientName || data.recipientName || "Client"
  );

  const applicationNumber = escapeHtml(
    data.applicationNumber || ""
  );

  const loanNumber = escapeHtml(
    data.loanNumber || ""
  );

  let subject = "";
  let title = "";
  let body = "";

  if (data.notificationType === "PENDING_REVIEW") {
    subject = `New Loan Application Pending Review - ${applicationNumber}`;
    title = "New Loan Application";

    const reviewUrl =
      `${frontendAppUrl.replace(/\/+$/, "")}/applications/${encodeURIComponent(
        data.applicationId || ""
      )}`;

    body = `
      <p>Hello,</p>

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
            ${formatCurrency(data.amountRequested)}
          </td>
        </tr>
      </table>

      <p>
        Please use the button below to open the application directly.
      </p>

      <p style="text-align:center;margin:30px 0;">
        <a
          href="${escapeHtml(reviewUrl)}"
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
          Review Application
        </a>
      </p>

      <p style="font-size:12px;color:#777;">
        If the button does not work, log in to Umhlomunye Finance
        and open the Applications section.
      </p>
    `;
  }

  if (data.notificationType === "APPROVED") {
    subject = `Loan Application Approved - ${loanNumber}`;
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
            ${formatCurrency(data.approvedAmount)}
          </td>
        </tr>
      </table>

      <p>
        Your loan agreement is ready for review and acceptance.
      </p>

      <p>
        Please use the button below to review your agreement.
      </p>

      <p style="text-align:center;margin:30px 0;">
        <a
          href="${escapeHtml(data.agreementUrl)}"
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
          Review & Accept Loan Agreement
        </a>
      </p>

      <p>
        If you did not apply for this loan, please contact
        Umhlomunye Finance immediately.
      </p>
    `;
  }

  if (data.notificationType === "AGREEMENT") {
    subject = `Loan Agreement Ready - ${loanNumber}`;
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
          href="${escapeHtml(data.agreementUrl)}"
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
          Review & Accept Loan Agreement
        </a>
      </p>

      <p>
        Loan Number:
        <strong>${loanNumber}</strong>
      </p>
    `;
  }

  if (data.notificationType === "REJECTED") {
    subject = `Loan Application Update - ${applicationNumber}`;
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
              data.rejectionReason || "Not provided"
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

        <div
          style="
            max-width:650px;
            margin:30px auto;
            background:#ffffff;
          "
        >

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

            <p style="font-size:12px;color:#777;">
              This is an automated message from Umhlomunye Finance.
              Please do not reply to this email.
            </p>

          </div>

        </div>

      </body>
      </html>
    `,
  };
}

async function sendEmail(
  supabaseAdmin,
  brevoApiKey,
  senderEmail,
  senderName,
  recipientEmail,
  recipientName,
  data,
  frontendAppUrl
) {
  const email = buildEmailContent(
    {
      ...data,
      recipientEmail,
      recipientName: recipientName || undefined,
    },
    frontendAppUrl
  );

  const {
    data: notification,
    error: insertError,
  } = await supabaseAdmin
    .from("email_notifications")
    .insert({
      application_id: data.applicationId || null,
      loan_id: data.loanId || null,
      recipient_email: recipientEmail,
      recipient_name: recipientName || null,
      notification_type: data.notificationType,
      subject: email.subject,
      status: "PENDING",
    })
    .select()
    .single();

  if (insertError) {
    console.error(
      "Notification log insert error:",
      insertError
    );
  }

  const brevoResponse = await fetch(
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
            name: recipientName || undefined,
          },
        ],
        subject: email.subject,
        htmlContent: email.html,
      }),
    }
  );

  const responseText = await brevoResponse.text();

  if (!brevoResponse.ok) {
    let errorMessage = responseText;

    try {
      const parsed = JSON.parse(responseText);

      errorMessage =
        parsed.message ||
        parsed.code ||
        responseText;
    } catch {
      // Keep raw response.
    }

    if (notification?.id) {
      await supabaseAdmin
        .from("email_notifications")
        .update({
          status: "FAILED",
          error_message: errorMessage,
        })
        .eq("id", notification.id);
    }

    throw new Error(
      `Brevo email failed for ${recipientEmail}: ${errorMessage}`
    );
  }

  let brevoResult = {};

  try {
    brevoResult = JSON.parse(responseText);
  } catch {
    // Ignore JSON parsing failure.
  }

  if (notification?.id) {
    await supabaseAdmin
      .from("email_notifications")
      .update({
        status: "SENT",
        brevo_message_id:
          brevoResult.messageId || null,
        sent_at: new Date().toISOString(),
      })
      .eq("id", notification.id);
  }

  return brevoResult.messageId || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  try {
    const body = await req.json();

    if (!body.notificationType) {
      throw new Error("notificationType is required.");
    }

    const brevoApiKey =
      Deno.env.get("BREVO_API_KEY");

    const senderEmail =
      Deno.env.get("BREVO_SENDER_EMAIL");

    const senderName =
      Deno.env.get("BREVO_SENDER_NAME") ||
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
      Deno.env.get("SUPABASE_URL");

    const secretKeys = JSON.parse(
      Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"
    );

    const supabaseSecretKey =
      secretKeys["default"];

    if (!supabaseUrl || !supabaseSecretKey) {
      throw new Error(
        "Supabase server credentials are not configured."
      );
    }

    const frontendAppUrl =
      Deno.env.get("FRONTEND_APP_URL");

    if (!frontendAppUrl) {
      throw new Error(
        "FRONTEND_APP_URL is not configured."
      );
    }

    const supabaseAdmin = createClient(
      supabaseUrl,
      supabaseSecretKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    /*
     * PENDING_REVIEW:
     * Send the same notification to every active,
     * non-deleted registered user with an email address.
     */
    if (
      body.notificationType ===
      "PENDING_REVIEW"
    ) {
      const {
        data: users,
        error: usersError,
      } = await supabaseAdmin
        .from("users")
        .select("email, full_name")
        .eq("is_active", true)
        .eq("is_deleted", false)
        .not("email", "is", null);

      if (usersError) {
        throw new Error(
          `Unable to load notification recipients: ${usersError.message}`
        );
      }

      const recipients = (users || [])
        .map((user) => ({
          email: String(
            user.email || ""
          ).trim(),
          fullName:
            user.full_name || null,
        }))
        .filter(
          (user) =>
            user.email.length > 0
        );

      if (recipients.length === 0) {
        throw new Error(
          "No active registered users with email addresses were found."
        );
      }

      const results = [];

      for (const recipient of recipients) {
        try {
          const messageId =
            await sendEmail(
              supabaseAdmin,
              brevoApiKey,
              senderEmail,
              senderName,
              recipient.email,
              recipient.fullName,
              body,
              frontendAppUrl
            );

          results.push({
            email: recipient.email,
            success: true,
            messageId,
          });
        } catch (error) {
          results.push({
            email: recipient.email,
            success: false,
            error:
              error instanceof Error
                ? error.message
                : "Unknown error",
          });
        }
      }

      const failed = results.filter(
        (result) => !result.success
      );

      if (failed.length > 0) {
        console.error(
          "Some PENDING_REVIEW emails failed:",
          failed
        );
      }

      return new Response(
        JSON.stringify({
          success:
            failed.length === 0,
          recipients:
            results.length,
          sent: results.filter(
            (result) =>
              result.success
          ).length,
          failed:
            failed.length,
          results,
        }),
        {
          status:
            failed.length ===
            results.length
              ? 500
              : 200,
          headers: {
            ...corsHeaders,
            "Content-Type":
              "application/json",
          },
        }
      );
    }

    /*
     * All other notification types continue to use
     * the explicitly supplied recipient.
     */
    if (!body.recipientEmail) {
      throw new Error(
        "recipientEmail is required for this notification type."
      );
    }

    const messageId =
      await sendEmail(
        supabaseAdmin,
        brevoApiKey,
        senderEmail,
        senderName,
        body.recipientEmail,
        body.recipientName || null,
        body,
        frontendAppUrl
      );

    return new Response(
      JSON.stringify({
        success: true,
        messageId,
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