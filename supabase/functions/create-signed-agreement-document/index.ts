import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  try {
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({
          error: "Method not allowed",
        }),
        {
          status: 405,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    const formData = await req.formData();

    const agreementId = formData.get("agreement_id");
    const signingToken = formData.get("signing_token");
    const pdf = formData.get("pdf");

    if (
      typeof agreementId !== "string" ||
      typeof signingToken !== "string" ||
      !(pdf instanceof File)
    ) {
      return new Response(
        JSON.stringify({
          error:
            "agreement_id, signing_token and pdf are required.",
        }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (pdf.type !== "application/pdf") {
      return new Response(
        JSON.stringify({
          error: "Only PDF documents are allowed.",
        }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
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

const supabase = createClient(
  supabaseUrl,
  secretKey
);

    /*
     * Verify the agreement using BOTH:
     * - agreement ID
     * - signing token
     *
     * This prevents a caller from supplying an arbitrary agreement ID.
     */
    const { data: agreement, error: agreementError } =
      await supabase
        .from("loan_agreements")
        .select(`
          id,
          loan_id,
          customer_id,
          agreement_number,
          status,
          signing_token
        `)
        .eq("id", agreementId)
        .eq("signing_token", signingToken)
        .single();

if (agreementError || !agreement) {
  console.error(
    "Agreement lookup failed:",
    agreementError
  );

  return new Response(
    JSON.stringify({
      error:
        agreementError?.message ||
        "Agreement not found or signing token is invalid.",
      details: agreementError,
    }),
    {
      status: 404,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    }
  );
}

    /*
     * The customer MUST have accepted the agreement first.
     */
    if (agreement.status !== "Signed") {
      return new Response(
        JSON.stringify({
          error:
            "The agreement has not been accepted by the customer.",
        }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    /*
     * Generate the storage path on the server.
     *
     * The browser is NOT allowed to choose where the document
     * gets stored.
     */
    const safeAgreementNumber =
      agreement.agreement_number.replace(
        /[^a-zA-Z0-9_-]/g,
        "_"
      );

    const documentPath =
      `agreements/${agreement.customer_id}/` +
      `${agreement.loan_id}/` +
      `${safeAgreementNumber}-signed.pdf`;

    /*
     * Upload the official signed PDF to the private bucket.
     */
    const pdfBytes = new Uint8Array(
      await pdf.arrayBuffer()
    );

    const { error: uploadError } =
      await supabase.storage
        .from("loan-documents")
        .upload(
          documentPath,
          pdfBytes,
          {
            contentType: "application/pdf",
            upsert: true,
          }
        );

    if (uploadError) {
      console.error(
        "Storage upload failed:",
        uploadError
      );

      return new Response(
        JSON.stringify({
          error:
            "The signed agreement could not be stored.",
        }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    /*
     * Create/update the document database record.
     */
    const { data: documentId, error: documentError } =
      await supabase.rpc(
        "create_signed_agreement_document",
        {
          p_agreement_id: agreementId,
          p_document_path: documentPath,
        }
      );

    if (documentError) {
      console.error(
        "Document record creation failed:",
        documentError
      );

      return new Response(
        JSON.stringify({
          error:
            "The PDF was uploaded but the document record could not be created.",
        }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        agreement_id: agreementId,
        document_id: documentId,
        document_path: documentPath,
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );

  } catch (error) {
    console.error(
      "Unexpected error:",
      error
    );

    return new Response(
      JSON.stringify({
        error:
          error instanceof Error
            ? error.message
            : "Unexpected server error.",
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});