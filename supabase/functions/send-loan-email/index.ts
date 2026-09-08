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
  | "AGREEMENT"
  | "DOCUMENT";

type EmailAttachment = {
  name: string;
  content: string;
  contentType?: string;
};

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

  agreementUrl?: string;
  agreementVersion?: string;
  agreementExpiryDays?: number;

  documentType?: string;
  documentName?: string;

  attachment?: EmailAttachment;
};


/* =========================================================
   HELPERS
========================================================= */

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


function formatCurrency(value: unknown) {
  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    return "R 0.00";
  }

  return `R ${amount.toFixed(2)}`;
}


function generateSecureToken(length = 64) {
  const characters =
    "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

  const bytes =
    crypto.getRandomValues(
      new Uint8Array(length)
    );

  let token = "";

  for (let i = 0; i < bytes.length; i++) {
    token +=
      characters[
        bytes[i] % characters.length
      ];
  }

  return token;
}


async function hashToken(token: string) {
  const encoder =
    new TextEncoder();

  const data =
    encoder.encode(token);

  const hashBuffer =
    await crypto.subtle.digest(
      "SHA-256",
      data
    );

  return Array.from(
    new Uint8Array(hashBuffer)
  )
    .map((byte) =>
      byte
        .toString(16)
        .padStart(2, "0")
    )
    .join("");
}


/* =========================================================
   AGREEMENT LINK
========================================================= */

async function createAgreementLink(
  supabase: ReturnType<typeof createClient>,
  loanId: string,
  agreementVersion?: string,
  expiryDays = 7,
  appBaseUrl?: string
) {
  const {
    data: loan,
    error: loanError,
  } = await supabase
    .from("loans")
    .select(`
      id,
      loan_number,
      customer_id
    `)
    .eq("id", loanId)
    .single();

  if (loanError) {
    throw loanError;
  }

  if (!loan) {
    throw new Error(
      "Loan could not be found."
    );
  }

  const token =
    generateSecureToken(64);

  const tokenHash =
    await hashToken(token);

  const expiresAt =
    new Date(
      Date.now() +
        expiryDays *
          24 *
          60 *
          60 *
          1000
    ).toISOString();

  const {
    data: existingAgreement,
    error: agreementLookupError,
  } = await supabase
    .from("loan_agreements")
    .select(`
      id,
      loan_id,
      agreement_number,
      agreement_version
    `)
    .eq("loan_id", loanId)
    .order("created_at", {
      ascending: false,
    })
    .limit(1)
    .maybeSingle();

  if (agreementLookupError) {
    throw agreementLookupError;
  }

  if (!existingAgreement) {
    throw new Error(
      "Loan agreement could not be found."
    );
  }

  const {
    data: insertedToken,
    error: tokenError,
  } = await supabase
    .from("loan_agreement_tokens")
    .insert({
      loan_id: loanId,
      agreement_id:
        existingAgreement.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
      used_at: null,
    })
    .select("id")
    .single();

  if (tokenError) {
    throw tokenError;
  }

  const baseUrl =
    appBaseUrl ||
    Deno.env.get("APP_BASE_URL") ||
    Deno.env.get("PUBLIC_APP_URL");

  if (!baseUrl) {
    throw new Error(
      "APP_BASE_URL is not configured."
    );
  }

  const agreementUrl =
    `${baseUrl.replace(/\/$/, "")}` +
    `/agreement/${token}`;

  return {
    agreementUrl,
    tokenId: insertedToken?.id || null,
    expiresAt,
    agreementId:
      existingAgreement.id,
    agreementNumber:
      existingAgreement.agreement_number,
    agreementVersion:
      agreementVersion ||
      existingAgreement.agreement_version ||
      null,
  };
}


/* =========================================================
   EMAIL CONTENT
========================================================= */

function buildEmailContent(
  body: EmailRequest,
  agreementUrl?: string
) {
  const clientName =
    escapeHtml(
      body.clientName ||
        body.recipientName ||
        "Customer"
    );

  const loanNumber =
    escapeHtml(
      body.loanNumber ||
        ""
    );

  const applicationNumber =
    escapeHtml(
      body.applicationNumber ||
        ""
    );


  /* -------------------------------------------------------
     PENDING REVIEW
  ------------------------------------------------------- */

  if (
    body.notificationType ===
    "PENDING_REVIEW"
  ) {
    return {
      subject:
        `Loan Application Pending Review` +
        (
          body.applicationNumber
            ? ` – ${body.applicationNumber}`
            : ""
        ),

      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;">
          <h2>Loan Application Pending Review</h2>

          <p>A new loan application requires review.</p>

          ${
            applicationNumber
              ? `<p><strong>Application Number:</strong> ${applicationNumber}</p>`
              : ""
          }

          ${
            body.clientName
              ? `<p><strong>Client:</strong> ${clientName}</p>`
              : ""
          }

          ${
            body.amountRequested !== undefined
              ? `<p><strong>Amount Requested:</strong> ${formatCurrency(
                  body.amountRequested
                )}</p>`
              : ""
          }

          <p>Please log into the Umhlomunye Finance system to review the application.</p>

          <p>
            Kind regards,<br>
            <strong>Umhlomunye Finance</strong><br>
            <em>Our dreams, Our hope</em>
          </p>
        </div>
      `,
    };
  }


  /* -------------------------------------------------------
     APPROVED
  ------------------------------------------------------- */

  if (
    body.notificationType ===
    "APPROVED"
  ) {
    return {
      subject:
        `Loan Application Approved` +
        (
          body.loanNumber
            ? ` – ${body.loanNumber}`
            : ""
        ),

      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;">
          <h2>Loan Application Approved</h2>

          <p>Dear ${clientName},</p>

          <p>
            We are pleased to inform you that your loan application
            has been approved.
          </p>

          ${
            body.loanNumber
              ? `<p><strong>Loan Number:</strong> ${loanNumber}</p>`
              : ""
          }

          ${
            body.approvedAmount !== undefined
              ? `<p><strong>Approved Amount:</strong> ${formatCurrency(
                  body.approvedAmount
                )}</p>`
              : ""
          }

          ${
            agreementUrl
              ? `
                <p>
                  Your loan agreement is ready for review and acceptance.
                </p>

                <p>
                  <a
                    href="${escapeHtml(agreementUrl)}"
                    style="
                      display:inline-block;
                      padding:12px 20px;
                      background:#1f3a5f;
                      color:#ffffff;
                      text-decoration:none;
                      border-radius:5px;
                    "
                  >
                    Review Loan Agreement
                  </a>
                </p>
              `
              : ""
          }

          <p>
            Kind regards,<br>
            <strong>Umhlomunye Finance</strong><br>
            <em>Our dreams, Our hope</em>
          </p>
        </div>
      `,
    };
  }


  /* -------------------------------------------------------
     REJECTED
  ------------------------------------------------------- */

  if (
    body.notificationType ===
    "REJECTED"
  ) {
    return {
      subject:
        `Loan Application Update` +
        (
          body.applicationNumber
            ? ` – ${body.applicationNumber}`
            : ""
        ),

      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;">
          <h2>Loan Application Update</h2>

          <p>Dear ${clientName},</p>

          <p>
            We regret to inform you that your loan application
            was not approved at this time.
          </p>

          ${
            body.applicationNumber
              ? `<p><strong>Application Number:</strong> ${applicationNumber}</p>`
              : ""
          }

          ${
            body.rejectionReason
              ? `
                <p>
                  <strong>Reason:</strong>
                  ${escapeHtml(body.rejectionReason)}
                </p>
              `
              : ""
          }

          <p>
            Kind regards,<br>
            <strong>Umhlomunye Finance</strong><br>
            <em>Our dreams, Our hope</em>
          </p>
        </div>
      `,
    };
  }


  /* -------------------------------------------------------
     AGREEMENT
  ------------------------------------------------------- */

  if (
    body.notificationType ===
    "AGREEMENT"
  ) {
    return {
      subject:
        `Loan Agreement Ready` +
        (
          body.loanNumber
            ? ` – ${body.loanNumber}`
            : ""
        ),

      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;">
          <h2>Loan Agreement Ready</h2>

          <p>Dear ${clientName},</p>

          <p>
            Your Umhlomunye Finance loan agreement is ready
            for review and acceptance.
          </p>

          ${
            body.loanNumber
              ? `<p><strong>Loan Number:</strong> ${loanNumber}</p>`
              : ""
          }

          ${
            agreementUrl
              ? `
                <p>
                  <a
                    href="${escapeHtml(agreementUrl)}"
                    style="
                      display:inline-block;
                      padding:12px 20px;
                      background:#1f3a5f;
                      color:#ffffff;
                      text-decoration:none;
                      border-radius:5px;
                    "
                  >
                    Review and Accept Agreement
                  </a>
                </p>
              `
              : ""
          }

          <p>
            Kind regards,<br>
            <strong>Umhlomunye Finance</strong><br>
            <em>Our dreams, Our hope</em>
          </p>
        </div>
      `,
    };
  }


  /* -------------------------------------------------------
     DOCUMENT
  ------------------------------------------------------- */

  if (
    body.notificationType ===
    "DOCUMENT"
  ) {
    const documentType =
      escapeHtml(
        body.documentType ||
          "Loan Document"
      );

    const documentName =
      escapeHtml(
        body.documentName ||
          "Loan Document"
      );

    return {
      subject:
        `${body.documentType || "Loan Document"}` +
        (
          body.loanNumber
            ? ` – ${body.loanNumber}`
            : ""
        ),

      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;">
          <h2>${documentType}</h2>

          <p>Dear ${clientName},</p>

          <p>
            Please find attached your
            <strong>${documentType}</strong>
            for your Umhlomunye Finance loan.
          </p>

          ${
            body.loanNumber
              ? `<p><strong>Loan Number:</strong> ${loanNumber}</p>`
              : ""
          }

          <p>
            <strong>Document:</strong>
            ${documentName}
          </p>

          <p>
            Please retain this document for your records.
          </p>

          <p>
            Kind regards,<br>
            <strong>Umhlomunye Finance</strong><br>
            <em>Our dreams, Our hope</em>
          </p>
        </div>
      `,
    };
  }


  throw new Error(
    "Unsupported notification type."
  );
}


/* =========================================================
   SERVER
========================================================= */

Deno.serve(
  async (req) => {
    if (
      req.method ===
      "OPTIONS"
    ) {
      return new Response(
        "ok",
        {
          headers:
            corsHeaders,
        }
      );
    }

    try {
      if (
        req.method !==
        "POST"
      ) {
        return new Response(
          JSON.stringify({
            success: false,
            error:
              "Method not allowed.",
          }),
          {
            status: 405,
            headers: {
              ...corsHeaders,
              "Content-Type":
                "application/json",
            },
          }
        );
      }


      /* ---------------------------------------------------
         REQUEST
      --------------------------------------------------- */

      const body =
        (await req.json()) as EmailRequest;


      if (
        !body.notificationType
      ) {
        throw new Error(
          "notificationType is required."
        );
      }


      if (
        !body.recipientEmail
      ) {
        throw new Error(
          "recipientEmail is required."
        );
      }


      /* ---------------------------------------------------
         DOCUMENT VALIDATION
      --------------------------------------------------- */

      if (
        body.notificationType ===
        "DOCUMENT"
      ) {
        if (
          !body.attachment
        ) {
          throw new Error(
            "A PDF attachment is required."
          );
        }

        if (
          !body.attachment.name
        ) {
          throw new Error(
            "Attachment filename is required."
          );
        }

        if (
          !body.attachment.content
        ) {
          throw new Error(
            "Attachment content is required."
          );
        }

        if (
          !body.documentType
        ) {
          throw new Error(
            "documentType is required."
          );
        }
      }


      /* ---------------------------------------------------
         ENVIRONMENT
      --------------------------------------------------- */

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

      const appBaseUrl =
        Deno.env.get(
          "APP_BASE_URL"
        ) ||
        Deno.env.get(
          "PUBLIC_APP_URL"
        );


      if (
        !brevoApiKey
      ) {
        throw new Error(
          "BREVO_API_KEY is not configured."
        );
      }

      if (
        !senderEmail
      ) {
        throw new Error(
          "BREVO_SENDER_EMAIL is not configured."
        );
      }

      if (
        !supabaseUrl
      ) {
        throw new Error(
          "SUPABASE_URL is not configured."
        );
      }

      if (
        !supabaseSecretKey
      ) {
        throw new Error(
          "Supabase service role key is not configured."
        );
      }


      /* ---------------------------------------------------
         SUPABASE
      --------------------------------------------------- */

      const supabase =
        createClient(
          supabaseUrl,
          supabaseSecretKey
        );


      /* ---------------------------------------------------
         AGREEMENT LINK
      --------------------------------------------------- */

      let agreementUrl =
        body.agreementUrl;

      let agreementInfo:
        | {
            agreementUrl: string;
            tokenId: string | null;
            expiresAt: string;
            agreementId: string;
            agreementNumber:
              | string
              | null;
            agreementVersion:
              | string
              | null;
          }
        | null = null;


      if (
        (
          body.notificationType ===
            "APPROVED" ||
          body.notificationType ===
            "AGREEMENT"
        ) &&
        body.loanId &&
        !agreementUrl
      ) {
        agreementInfo =
          await createAgreementLink(
            supabase,
            body.loanId,
            body.agreementVersion,
            body.agreementExpiryDays ||
              7,
            appBaseUrl
          );

        agreementUrl =
          agreementInfo.agreementUrl;
      }


      /* ---------------------------------------------------
         EMAIL CONTENT
      --------------------------------------------------- */

      const emailContent =
        buildEmailContent(
          body,
          agreementUrl
        );


      /* ---------------------------------------------------
         LOG EMAIL
      --------------------------------------------------- */

      let notificationId:
        | string
        | null = null;

      try {
        const {
          data:
            notification,
          error:
            notificationError,
        } = await supabase
          .from(
            "email_notifications"
          )
          .insert({
            notification_type:
              body.notificationType,

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
              body.clientName ||
              null,

            subject:
              emailContent.subject,

            status:
              "PENDING",
          })
          .select("id")
          .single();

        if (
          notificationError
        ) {
          console.warn(
            "EMAIL LOG INSERT WARNING:",
            notificationError
          );
        } else {
          notificationId =
            notification?.id ||
            null;
        }
      } catch (
        notificationInsertError
      ) {
        console.warn(
          "EMAIL LOG INSERT WARNING:",
          notificationInsertError
        );
      }


      /* ---------------------------------------------------
         BREVO PAYLOAD
      --------------------------------------------------- */

      const brevoPayload: Record<
        string,
        unknown
      > = {
        sender: {
          email:
            senderEmail,
          name:
            senderName,
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
          emailContent.subject,

        htmlContent:
          emailContent.html,
      };


      /* ---------------------------------------------------
         ATTACHMENT
      --------------------------------------------------- */

      if (
        body.notificationType ===
        "DOCUMENT"
      ) {
        brevoPayload.attachment = [
          {
            name:
              body.attachment!.name,

            content:
              body.attachment!.content,
          },
        ];
      }


      /* ---------------------------------------------------
         SEND THROUGH BREVO
      --------------------------------------------------- */

      const brevoResponse =
        await fetch(
          "https://api.brevo.com/v3/smtp/email",
          {
            method: "POST",

            headers: {
              "accept":
                "application/json",

              "api-key":
                brevoApiKey,

              "content-type":
                "application/json",
            },

            body:
              JSON.stringify(
                brevoPayload
              ),
          }
        );


      const brevoText =
        await brevoResponse.text();

      let brevoResult:
        | Record<string, unknown>
        | null = null;

      try {
        brevoResult =
          brevoText
            ? JSON.parse(
                brevoText
              )
            : null;
      } catch {
        brevoResult = null;
      }


      /* ---------------------------------------------------
         BREVO FAILURE
      --------------------------------------------------- */

      if (
        !brevoResponse.ok
      ) {
        if (
          notificationId
        ) {
          await supabase
            .from(
              "email_notifications"
            )
            .update({
              status:
                "FAILED",

              error_message:
                brevoText ||
                `Brevo returned ${brevoResponse.status}`,
            })
            .eq(
              "id",
              notificationId
            );
        }

        throw new Error(
          brevoText ||
            `Brevo email failed with status ${brevoResponse.status}.`
        );
      }


      /* ---------------------------------------------------
         MESSAGE ID
      --------------------------------------------------- */

      const messageId =
        String(
          brevoResult?.messageId ||
            brevoResult?.message_id ||
            ""
        );


      /* ---------------------------------------------------
         UPDATE EMAIL LOG
      --------------------------------------------------- */

      if (
        notificationId
      ) {
        await supabase
          .from(
            "email_notifications"
          )
          .update({
            status:
              "SENT",

            brevo_message_id:
              messageId ||
              null,

            sent_at:
              new Date().toISOString(),

            error_message:
              null,
          })
          .eq(
            "id",
            notificationId
          );
      }


      /* ---------------------------------------------------
         AGREEMENT SENT DATE
      --------------------------------------------------- */

      if (
        (
          body.notificationType ===
            "APPROVED" ||
          body.notificationType ===
            "AGREEMENT"
        ) &&
        body.loanId
      ) {
        try {
          await supabase
            .from(
              "loan_agreements"
            )
            .update({
              sent_at:
                new Date().toISOString(),
            })
            .eq(
              "loan_id",
              body.loanId
            );
        } catch (
          agreementUpdateError
        ) {
          console.warn(
            "AGREEMENT SENT DATE WARNING:",
            agreementUpdateError
          );
        }
      }


      /* ---------------------------------------------------
         RESPONSE
      --------------------------------------------------- */

      return new Response(
        JSON.stringify({
          success: true,

          messageId:
            messageId ||
            null,

          notificationId,

          agreementUrl:
            agreementUrl ||
            null,

          agreementExpiresAt:
            agreementInfo?.expiresAt ||
            null,

          agreementId:
            agreementInfo?.agreementId ||
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
        "SEND LOAN EMAIL ERROR:",
        error
      );

      return new Response(
        JSON.stringify({
          success: false,

          error:
            error instanceof Error
              ? error.message
              : "Unable to send email.",
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
  }
);