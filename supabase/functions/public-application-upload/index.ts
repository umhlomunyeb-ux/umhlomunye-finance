import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png"
]);
const ALLOWED_EXTENSIONS = new Set([
  "pdf",
  "jpg",
  "jpeg",
  "png"
]);
const ALLOWED_DOCUMENT_TYPES = new Set([
  "ID Document",
  "Bank Statement",
  "Payslip",
  "Proof of Residence",
  "Other"
]);
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
function getFileExtension(fileName) {
  const parts = fileName.toLowerCase().split(".");
  if (parts.length < 2) {
    return "";
  }
  return parts[parts.length - 1];
}
function sanitizeFileName(fileName) {
  return fileName.trim().replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_");
}
async function sha256Hex(file) {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest)).map((byte)=>byte.toString(16).padStart(2, "0")).join("");
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  if (req.method !== "POST") {
    return jsonResponse({
      error: "Method not allowed."
    }, 405);
  }
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    /*
     * Use the standard Supabase Edge Function
     * service-role key first.
     *
     * SUPABASE_SECRET_KEYS remains as a fallback
     * for environments where the existing custom
     * secret is still configured.
     */ const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEYS") ?? "";
    if (!supabaseUrl || !supabaseKey) {
      console.error("Supabase environment variables are not configured.");
      return jsonResponse({
        error: "The document upload service is not configured."
      }, 500);
    }
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });
    const formData = await req.formData();
    const applicationIdValue = formData.get("application_id");
    const uploadTokenValue = formData.get("upload_token");
    const documentTypeValue = formData.get("document_type");
    const fileValue = formData.get("file");
    const applicationId = typeof applicationIdValue === "string" ? applicationIdValue.trim() : "";
    const uploadToken = typeof uploadTokenValue === "string" ? uploadTokenValue.trim() : "";
    const documentType = typeof documentTypeValue === "string" ? documentTypeValue.trim() : "";
    if (!applicationId) {
      return jsonResponse({
        error: "Application ID is required."
      }, 400);
    }
    if (!uploadToken) {
      return jsonResponse({
        error: "Upload token is required."
      }, 400);
    }
    if (!documentType) {
      return jsonResponse({
        error: "Document type is required."
      }, 400);
    }
    if (!ALLOWED_DOCUMENT_TYPES.has(documentType)) {
      return jsonResponse({
        error: "The selected document type is not supported."
      }, 400);
    }
    if (!(fileValue instanceof File)) {
      return jsonResponse({
        error: "A document file is required."
      }, 400);
    }
    const file = fileValue;
    if (file.size <= 0) {
      return jsonResponse({
        error: "The document file is empty."
      }, 400);
    }
    if (file.size > MAX_FILE_SIZE) {
      return jsonResponse({
        error: "The document exceeds the maximum allowed size of 10 MB."
      }, 400);
    }
    const mimeType = file.type?.toLowerCase().trim() ?? "";
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return jsonResponse({
        error: "Only PDF, JPG, JPEG and PNG documents are allowed."
      }, 400);
    }
    const extension = getFileExtension(file.name);
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      return jsonResponse({
        error: "Only PDF, JPG, JPEG and PNG documents are allowed."
      }, 400);
    }
    /*
     * Authorize the upload using the application's
     * upload token.
     *
     * The RPC returns a TABLE, therefore Supabase
     * returns an array. Normalize the response before
     * checking the authorized value.
     */ const { data: authorization, error: authorizationError } = await supabase.rpc("authorize_loan_application_document_upload", {
      p_application_id: applicationId,
      p_upload_token: uploadToken,
      p_file_size_bytes: file.size
    });
    if (authorizationError) {
      console.error("Document upload authorization RPC failed:", authorizationError.message);
      return jsonResponse({
        error: "Unable to authorize document upload."
      }, 403);
    }
    const authorizationResult = Array.isArray(authorization) ? authorization[0] : authorization;
    if (!authorizationResult?.authorized) {
      return jsonResponse({
        error: "Upload is not authorized."
      }, 403);
    }
    /*
     * Generate a safe storage path.
     */ const cleanName = sanitizeFileName(file.name || "document");
    const uniquePart = `${crypto.randomUUID()}-${Date.now()}`;
    const storagePath = `public-applications/${applicationId}/${uniquePart}-${cleanName}`;
    /*
     * Upload the document to the private documents
     * bucket.
     */ const { error: storageError } = await supabase.storage.from("documents").upload(storagePath, file, {
      contentType: mimeType,
      upsert: false
    });
    if (storageError) {
      console.error("Document storage upload failed:", storageError.message);
      return jsonResponse({
        error: "The supporting document could not be stored."
      }, 500);
    }
    /*
     * Calculate the SHA-256 hash after the storage
     * upload succeeds.
     */ const fileHash = await sha256Hex(file);
    /*
     * Create the document database record.
     *
     * The RPC returns a TABLE, so normalize its
     * response in the same way as the authorization RPC.
     */ const { data: documentResult, error: documentError } = await supabase.rpc("create_public_application_document", {
      p_application_id: applicationId,
      p_document_name: file.name,
      p_document_path: storagePath,
      p_document_type: documentType,
      p_mime_type: mimeType,
      p_file_size_bytes: file.size,
      p_file_hash: fileHash
    });
    if (documentError) {
      console.error("Document database record creation failed:", documentError.message);
      /*
       * Remove the uploaded storage object if the
       * database record could not be created.
       */ const { error: cleanupError } = await supabase.storage.from("documents").remove([
        storagePath
      ]);
      if (cleanupError) {
        console.error("Document storage cleanup failed:", cleanupError.message);
      }
      return jsonResponse({
        error: "The supporting document could not be registered."
      }, 500);
    }
    const createdDocument = Array.isArray(documentResult) ? documentResult[0] : documentResult;
    const documentId = createdDocument?.document_id ?? createdDocument?.id ?? null;
    return jsonResponse({
      success: true,
      application_id: applicationId,
      document_id: documentId,
      document_name: file.name,
      document_path: storagePath
    }, 200);
  } catch (error) {
    console.error("Public application document upload failed:", error);
    return jsonResponse({
      error: error instanceof Error ? error.message : "The supporting document could not be uploaded."
    }, 500);
  }
});
