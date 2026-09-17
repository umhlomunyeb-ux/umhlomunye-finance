import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);

const ALLOWED_EXTENSIONS = new Set([
  "pdf",
  "jpg",
  "jpeg",
  "png",
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024;

function jsonResponse(
  body: Record<string, unknown>,
  status = 200
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function safeFileName(name: string) {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 150);
}

function getExtension(name: string) {
  const parts = name.toLowerCase().split(".");
  return parts.length > 1
    ? parts[parts.length - 1]
    : "";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return jsonResponse(
      {
        error: "Method not allowed.",
      },
      405
    );
  }

  try {
    const formData = await req.formData();

    const applicationId = formData.get("application_id");
    const uploadToken = formData.get("upload_token");
    const documentType = formData.get("document_type");
    const file = formData.get("file");

    if (
      typeof applicationId !== "string" ||
      typeof uploadToken !== "string" ||
      typeof documentType !== "string" ||
      !(file instanceof File)
    ) {
      return jsonResponse(
        {
          error:
            "application_id, upload_token, document_type and file are required.",
        },
        400
      );
    }

    if (
      documentType !== "ID Document" &&
      documentType !== "Bank Statement" &&
      documentType !== "Payslip" &&
      documentType !== "Proof of Residence" &&
      documentType !== "Other"
    ) {
      return jsonResponse(
        {
          error: "Invalid document type.",
        },
        400
      );
    }

    if (file.size <= 0) {
      return jsonResponse(
        {
          error: "The uploaded file is empty.",
        },
        400
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return jsonResponse(
        {
          error: "Each document must be 10 MB or smaller.",
        },
        400
      );
    }

    const extension = getExtension(file.name);

    if (
      !ALLOWED_TYPES.has(file.type) ||
      !ALLOWED_EXTENSIONS.has(extension)
    ) {
      return jsonResponse(
        {
          error:
            "Only PDF, JPG and PNG documents are allowed.",
        },
        400
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const secretKeysRaw =
      Deno.env.get("SUPABASE_SECRET_KEYS");

    if (!supabaseUrl) {
      throw new Error("SUPABASE_URL is missing.");
    }

    if (!secretKeysRaw) {
      throw new Error(
        "SUPABASE_SECRET_KEYS is missing."
      );
    }

    const secretKeys = JSON.parse(secretKeysRaw);
    const secretKey = secretKeys["default"];

    if (!secretKey) {
      throw new Error(
        "Default Supabase secret key is missing."
      );
    }

    const supabase = createClient(
      supabaseUrl,
      secretKey
    );

    /*
     * Validate the upload token and enforce:
     * - application still PENDING
     * - token not expired
     * - maximum file count
     * - maximum file size
     */
    const { data: authorization, error: authorizationError } =
      await supabase.rpc(
        "authorize_loan_application_document_upload",
        {
          p_application_id: applicationId,
          p_upload_token: uploadToken,
          p_file_size_bytes: file.size,
        }
      );

    if (authorizationError) {
      console.error(
        "Upload authorization failed:",
        authorizationError
      );

      return jsonResponse(
        {
          error:
            "The document upload could not be authorized.",
        },
        403
      );
    }

    const authorizationRow =
      Array.isArray(authorization)
        ? authorization[0]
        : authorization;

    if (
      !authorizationRow ||
      authorizationRow.authorized !== true
    ) {
      return jsonResponse(
        {
          error:
            "The upload link is invalid, expired, or the upload limit has been reached.",
        },
        403
      );
    }

    /*
     * Generate the Storage path on the server.
     *
     * The applicant cannot choose the bucket path.
     */
    const cleanName = safeFileName(file.name);

    const uniquePart =
      `${crypto.randomUUID()}-${Date.now()}`;

    const documentPath =
      `public-applications/${applicationId}/` +
      `${uniquePart}-${cleanName}`;

    const fileBytes = new Uint8Array(
      await file.arrayBuffer()
    );

    /*
     * Upload to the PRIVATE documents bucket.
     */
    const { error: uploadError } =
      await supabase.storage
        .from("documents")
        .upload(
          documentPath,
          fileBytes,
          {
            contentType: file.type,
            upsert: false,
          }
        );

    if (uploadError) {
      console.error(
        "Document storage upload failed:",
        uploadError
      );

      return jsonResponse(
        {
          error:
            "The document could not be uploaded.",
        },
        500
      );
    }

    /*
     * Calculate SHA-256 for duplicate/document integrity tracking.
     */
    const hashBuffer = await crypto.subtle.digest(
      "SHA-256",
      fileBytes
    );

    const hashArray = Array.from(
      new Uint8Array(hashBuffer)
    );

    const hashHex = hashArray
      .map((byte) =>
        byte.toString(16).padStart(2, "0")
      )
      .join("");

    /*
     * Create the document database record through
     * the protected SECURITY DEFINER RPC.
     */
    const { data: documentId, error: documentError } =
      await supabase.rpc(
        "create_public_application_document",
        {
          p_application_id: applicationId,
          p_document_name: file.name,
          p_document_path: documentPath,
          p_document_type: documentType,
          p_mime_type: file.type,
          p_file_size_bytes: file.size,
          p_file_hash_sha256: hashHex,
        }
      );

    if (documentError) {
      console.error(
        "Document database record creation failed:",
        documentError
      );

      /*
       * Prevent an orphaned Storage object if the
       * database record cannot be created.
       */
      await supabase.storage
        .from("documents")
        .remove([documentPath]);

      return jsonResponse(
        {
          error:
            "The document was uploaded but could not be registered.",
        },
        500
      );
    }

    return jsonResponse({
      success: true,
      application_id: applicationId,
      document_id: documentId,
      document_name: file.name,
      document_path: documentPath,
    });
  } catch (error) {
    console.error(
      "Public application upload error:",
      error
    );

    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected server error.",
      },
      500
    );
  }
});