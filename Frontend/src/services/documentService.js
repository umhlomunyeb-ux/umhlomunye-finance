import { supabase } from "../lib/supabase";
import { getSystemSettings } from "./settingsService";

const DOCUMENT_BUCKET = "documents";

/**
 * ============================================================
 * DOCUMENT CATEGORIES
 * ============================================================
 */

export const DOCUMENT_CATEGORIES = {
  CUSTOMER: "CUSTOMER",
  LOAN: "LOAN",
  COMPANY: "COMPANY",
  BORROWING: "BORROWING",
  DEBT_REPAYMENT: "DEBT_REPAYMENT",
  FINANCIAL_RECORD: "FINANCIAL_RECORD",
  OTHER: "OTHER",
};

export const DOCUMENT_SOURCES = {
  CUSTOMER_UPLOAD: "CUSTOMER_UPLOAD",
  STAFF_UPLOAD: "STAFF_UPLOAD",
  SYSTEM_GENERATED: "SYSTEM_GENERATED",
  IMPORTED: "IMPORTED",
};

export const DOCUMENT_VERIFICATION_STATUSES = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  PASSED: "PASSED",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
  HIGH_RISK: "HIGH_RISK",
  VERIFIED: "VERIFIED",
  REJECTED: "REJECTED",
};

export const DOCUMENT_RETENTION_POLICIES = {
  PERMANENT: "PERMANENT",
  SIX_MONTHS: "SIX_MONTHS",
  THREE_YEARS_AFTER_LOAN_TERMINATION:
    "THREE_YEARS_AFTER_LOAN_TERMINATION",
  UNTIL_RESOLVED: "UNTIL_RESOLVED",
  NONE: "NONE",
};

export const DOCUMENT_RETENTION_STATUSES = {
  ACTIVE: "ACTIVE",
  EXPIRING_SOON: "EXPIRING_SOON",
  EXPIRED: "EXPIRED",
  ARCHIVED: "ARCHIVED",
};

export const DOCUMENT_TYPES = {
  ID_DOCUMENT: "ID_DOCUMENT",
  BANK_STATEMENT: "BANK_STATEMENT",
  PAYSLIP: "PAYSLIP",
  PROOF_OF_RESIDENCE: "PROOF_OF_RESIDENCE",
  LOAN_AGREEMENT: "LOAN_AGREEMENT",
  LOAN_STATEMENT: "LOAN_STATEMENT",
  PAID_UP_LETTER: "PAID_UP_LETTER",
  APPLICATION_DOCUMENT: "APPLICATION_DOCUMENT",
  BORROWING_AGREEMENT: "BORROWING_AGREEMENT",
  DEBT_REPAYMENT_PROOF: "DEBT_REPAYMENT_PROOF",
  FINANCIAL_RECORD: "FINANCIAL_RECORD",
  COMPANY_DOCUMENT: "COMPANY_DOCUMENT",
  OTHER: "OTHER",
};

/**
 * ============================================================
 * DOCUMENT HISTORY ACTIONS
 * ============================================================
 */

export const DOCUMENT_HISTORY_ACTIONS = {
  CREATED: "CREATED",
  UPDATED: "UPDATED",
  REPLACED: "REPLACED",
  ARCHIVED: "ARCHIVED",
  RESTORED: "RESTORED",
  DELETED: "DELETED",
};

/**
 * ============================================================
 * HELPERS
 * ============================================================
 */

function clean(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }

  return value;
}

function normalizeEnum(value) {
  if (value === undefined || value === null) {
    return null;
  }

  return String(value).trim().toUpperCase() || null;
}

function resolveDocumentCategory({
  documentCategory,
  customerId,
  loanId,
  borrowingId,
  debtRepaymentId,
}) {
  const category = normalizeEnum(documentCategory);

  if (!category) {
    throw new Error("Document category is required.");
  }

  if (!Object.values(DOCUMENT_CATEGORIES).includes(category)) {
    throw new Error(
      `Invalid document category: ${documentCategory}`
    );
  }

  if (
    category === DOCUMENT_CATEGORIES.CUSTOMER &&
    !customerId
  ) {
    throw new Error(
      "Customer documents must be linked to a customer."
    );
  }

  if (
    category === DOCUMENT_CATEGORIES.LOAN &&
    !loanId
  ) {
    throw new Error(
      "Loan documents must be linked to a loan."
    );
  }

  if (
    category === DOCUMENT_CATEGORIES.BORROWING &&
    !borrowingId
  ) {
    throw new Error(
      "Borrowing documents must be linked to a borrowing record."
    );
  }

  if (
    category === DOCUMENT_CATEGORIES.DEBT_REPAYMENT &&
    !debtRepaymentId
  ) {
    throw new Error(
      "Debt repayment documents must be linked to a debt repayment record."
    );
  }

  return category;
}

function resolveDocumentType(documentType) {
  const type = normalizeEnum(documentType);

  if (!type) {
    throw new Error("Document type is required.");
  }

  if (!Object.values(DOCUMENT_TYPES).includes(type)) {
    throw new Error(
      `Invalid document type: ${documentType}`
    );
  }

  return type;
}

function resolveSourceType(sourceType) {
  const source = normalizeEnum(sourceType);

  if (!source) {
    return DOCUMENT_SOURCES.STAFF_UPLOAD;
  }

  if (!Object.values(DOCUMENT_SOURCES).includes(source)) {
    throw new Error(
      `Invalid document source type: ${sourceType}`
    );
  }

  return source;
}

function resolveRetentionMetadata({
  documentType,
  documentCategory,
  retentionPolicy,
  retentionUntil,
}) {
  const resolvedPolicy =
    normalizeEnum(retentionPolicy) ||
    getDefaultRetentionPolicy(
      documentType,
      documentCategory
    );

  if (
    !Object.values(DOCUMENT_RETENTION_POLICIES).includes(
      resolvedPolicy
    )
  ) {
    throw new Error(
      `Invalid retention policy: ${resolvedPolicy}`
    );
  }

  if (retentionUntil) {
    return {
      retentionPolicy: resolvedPolicy,
      retentionUntil,
    };
  }

  if (
    resolvedPolicy ===
    DOCUMENT_RETENTION_POLICIES.SIX_MONTHS
  ) {
    return {
      retentionPolicy: resolvedPolicy,
      retentionUntil:
        calculateSixMonthRetentionDate(),
    };
  }

  if (
    resolvedPolicy ===
    DOCUMENT_RETENTION_POLICIES
      .THREE_YEARS_AFTER_LOAN_TERMINATION
  ) {
    return {
      retentionPolicy: resolvedPolicy,
      retentionUntil: null,
    };
  }

  return {
    retentionPolicy: resolvedPolicy,
    retentionUntil: null,
  };
}

function getFileExtension(file) {
  if (!file?.name) {
    return "bin";
  }

  const parts = file.name.split(".");

  if (parts.length < 2) {
    return "bin";
  }

  return (
    parts
      .pop()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "") || "bin"
  );
}

function sanitizeFileName(name) {
  return String(name || "document")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_");
}

function generateStorageFileName(file) {
  const extension = getFileExtension(file);

  const originalName = sanitizeFileName(
    file?.name || "document"
  );

  return `${crypto.randomUUID()}-${originalName}.${extension}`;
}

function getDocumentFolder({
  category,
  customerIdNumber,
  loanNumber,
  applicationNumber,
  companyName,
  borrowingId,
  debtRepaymentId,
}) {
  switch (category) {
    case DOCUMENT_CATEGORIES.CUSTOMER:
      return `customers/${sanitizeFileName(
        customerIdNumber || "unknown"
      )}`;

    case DOCUMENT_CATEGORIES.LOAN:
      return `loans/${sanitizeFileName(
        loanNumber || "unknown"
      )}`;

    case DOCUMENT_CATEGORIES.COMPANY:
      return `company/${sanitizeFileName(
        companyName || "unknown"
      )}`;

    case DOCUMENT_CATEGORIES.BORROWING:
      return `borrowings/${sanitizeFileName(
        borrowingId || "unknown"
      )}`;

    case DOCUMENT_CATEGORIES.DEBT_REPAYMENT:
      return `debt-repayments/${sanitizeFileName(
        debtRepaymentId || "unknown"
      )}`;

    case DOCUMENT_CATEGORIES.FINANCIAL_RECORD:
      return "financial-records";

    default:
      return `other/${sanitizeFileName(
        applicationNumber ||
          customerIdNumber ||
          "documents"
      )}`;
  }
}

function normalizeDocument(document) {
  if (!document) {
    return null;
  }

  return {
    ...document,

    verification_status:
      document.verification_status ||
      DOCUMENT_VERIFICATION_STATUSES.PENDING,

    retention_status:
      document.retention_status ||
      DOCUMENT_RETENTION_STATUSES.ACTIVE,

    is_archived:
      document.is_archived === true,

    version_number:
      document.version_number !== null &&
      document.version_number !== undefined
        ? Number(document.version_number)
        : 1,

    file_size_bytes:
      document.file_size_bytes !== null &&
      document.file_size_bytes !== undefined
        ? Number(document.file_size_bytes)
        : null,
  };
}

async function getCurrentUserId() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw error;
  }

  if (!user) {
    throw new Error(
      "You must be logged in to manage documents."
    );
  }

  return user.id;
}

/**
 * ============================================================
 * DOCUMENT HISTORY
 * ============================================================
 *
 * All audit entries are written through the controlled
 * record_document_history() SECURITY DEFINER RPC.
 *
 * document_history intentionally does not contain
 * document_group_id or version_number.
 */

async function recordDocumentHistory({
  documentId = null,
  action,
  previousDocumentId = null,
  newDocumentId = null,
  documentSnapshot = null,
  previousSnapshot = null,
  notes = null,
}) {
  if (!Object.values(DOCUMENT_HISTORY_ACTIONS).includes(action)) {
    throw new Error(
      `Invalid document history action: ${action}`
    );
  }

  const { data, error } =
    await supabase.rpc(
      "record_document_history",
      {
        p_document_id:
          documentId || null,

        p_action:
          action,

        p_previous_document_id:
          previousDocumentId || null,

        p_new_document_id:
          newDocumentId || null,

        p_document_snapshot:
          documentSnapshot || null,

        p_previous_snapshot:
          previousSnapshot || null,

        p_notes:
          notes || null,
      }
    );

  if (error) {
    console.error(
      "recordDocumentHistory:",
      error
    );

    throw error;
  }

  return data;
}

/**
 * ============================================================
 * FILE HASH
 * ============================================================
 */

async function calculateFileHash(file) {
  if (!file) {
    return null;
  }

  if (
    typeof crypto === "undefined" ||
    !crypto.subtle
  ) {
    return null;
  }

  const buffer =
    await file.arrayBuffer();

  const hashBuffer =
    await crypto.subtle.digest(
      "SHA-256",
      buffer
    );

  const hashArray =
    Array.from(
      new Uint8Array(hashBuffer)
    );

  return hashArray
    .map((byte) =>
      byte
        .toString(16)
        .padStart(2, "0")
    )
    .join("");
}

/**
 * ============================================================
 * STORAGE
 * ============================================================
 */

async function uploadDocumentFile({
  file,
  category,
  customerIdNumber,
  loanNumber,
  applicationNumber,
  companyName,
  borrowingId,
  debtRepaymentId,
}) {
  if (!file) {
    throw new Error(
      "Please select a document to upload."
    );
  }

  const folder =
    getDocumentFolder({
      category,
      customerIdNumber,
      loanNumber,
      applicationNumber,
      companyName,
      borrowingId,
      debtRepaymentId,
    });

  const fileName =
    generateStorageFileName(file);

  const storagePath =
    `${folder}/${fileName}`;

  const { error } =
    await supabase.storage
      .from(DOCUMENT_BUCKET)
      .upload(
        storagePath,
        file,
        {
          cacheControl: "3600",
          upsert: false,
          contentType:
            file.type ||
            "application/octet-stream",
        }
      );

  if (error) {
    console.error(
      "uploadDocumentFile:",
      error
    );

    throw error;
  }

  return {
    bucket: DOCUMENT_BUCKET,
    path: storagePath,
  };
}

async function removeDocumentFile(path) {
  if (!path) {
    return;
  }

  const { error } =
    await supabase.storage
      .from(DOCUMENT_BUCKET)
      .remove([path]);

  if (error) {
    console.warn(
      "Unable to remove document file:",
      error
    );
  }
}

/**
 * ============================================================
 * DUPLICATE DETECTION
 * ============================================================
 */

async function findDuplicateByHash({
  fileHash,
  documentType,
  customerId = null,
  loanId = null,
  applicationId = null,
  borrowingId = null,
  debtRepaymentId = null,
  agreementId = null,
}) {
  if (!fileHash) {
    return null;
  }

  let query =
    supabase
      .from("documents")
      .select("*")
      .eq(
        "file_hash_sha256",
        fileHash
      )
      .eq(
        "document_type",
        documentType
      )
      .eq(
        "is_archived",
        false
      )
      .is(
        "deleted_at",
        null
      )
      .limit(1);

  if (customerId) {
    query = query.eq(
      "customer_id",
      customerId
    );
  } else if (loanId) {
    query = query.eq(
      "loan_id",
      loanId
    );
  } else if (applicationId) {
    query = query.eq(
      "application_id",
      applicationId
    );
  } else if (borrowingId) {
    query = query.eq(
      "borrowing_id",
      borrowingId
    );
  } else if (debtRepaymentId) {
    query = query.eq(
      "debt_repayment_id",
      debtRepaymentId
    );
  } else if (agreementId) {
    query = query.eq(
      "agreement_id",
      agreementId
    );
  }

  const {
    data,
    error,
  } = await query.maybeSingle();

  if (error) {
    throw error;
  }

  return normalizeDocument(data);
}

/**
 * ============================================================
 * DOCUMENT CREATION
 * ============================================================
 */

export async function uploadDocument({
  file,
  documentType,
  documentCategory,
  documentName,
  customerId = null,
  loanId = null,
  applicationId = null,
  borrowingId = null,
  debtRepaymentId = null,
  agreementId = null,
  customerIdNumber = null,
  loanNumber = null,
  applicationNumber = null,
  companyName = null,
  sourceType =
    DOCUMENT_SOURCES.STAFF_UPLOAD,
  retentionPolicy = null,
  retentionUntil = null,
  financialPeriodType = null,
  financialPeriodStart = null,
  financialPeriodEnd = null,
}) {
  const createdBy =
    await getCurrentUserId();

  if (!file) {
    throw new Error(
      "Please select a document."
    );
  }

  const normalizedDocumentType =
    resolveDocumentType(
      documentType
    );

  const normalizedDocumentCategory =
    resolveDocumentCategory({
      documentCategory,
      customerId,
      loanId,
      borrowingId,
      debtRepaymentId,
    });

  const normalizedSourceType =
    resolveSourceType(
      sourceType
    );

  const retention =
    resolveRetentionMetadata({
      documentType:
        normalizedDocumentType,
      documentCategory:
        normalizedDocumentCategory,
      retentionPolicy,
      retentionUntil,
    });

  const fileHash =
    await calculateFileHash(file);

  const duplicate =
    await findDuplicateByHash({
      fileHash,
      documentType:
        normalizedDocumentType,
      customerId,
      loanId,
      applicationId,
      borrowingId,
      debtRepaymentId,
      agreementId,
    });

  if (duplicate) {
    throw new Error(
      `This document has already been uploaded as "${duplicate.document_name}".`
    );
  }

  let storageFile = null;

  try {
    storageFile =
      await uploadDocumentFile({
        file,
        category:
          normalizedDocumentCategory,
        customerIdNumber,
        loanNumber,
        applicationNumber,
        companyName,
        borrowingId,
        debtRepaymentId,
      });

    const payload = {
      customer_id:
        customerId || null,

      loan_id:
        loanId || null,

      application_id:
        applicationId || null,

      agreement_id:
        agreementId || null,

      document_type:
        normalizedDocumentType,

      document_category:
        normalizedDocumentCategory,

      document_name:
        clean(documentName) ||
        clean(file.name) ||
        "Uploaded Document",

      document_path:
        storageFile.path,

      created_by:
        createdBy,

      company_name_snapshot:
        clean(companyName),

      customer_id_number_snapshot:
        clean(customerIdNumber),

      loan_number_snapshot:
        clean(loanNumber),

      borrowing_id:
        borrowingId || null,

      debt_repayment_id:
        debtRepaymentId || null,

      mime_type:
        file.type ||
        "application/octet-stream",

      file_size_bytes:
        Number(file.size || 0),

      file_hash_sha256:
        fileHash,

      source_type:
        normalizedSourceType,

      retention_policy:
        retention.retentionPolicy,

      retention_until:
        retention.retentionUntil,

      financial_period_type:
        clean(financialPeriodType),

      financial_period_start:
        financialPeriodStart || null,

      financial_period_end:
        financialPeriodEnd || null,

      verification_status:
        DOCUMENT_VERIFICATION_STATUSES.PENDING,

      retention_status:
        DOCUMENT_RETENTION_STATUSES.ACTIVE,

      is_archived:
        false,

      document_group_id:
        crypto.randomUUID(),

      version_number:
        1,
    };

    const {
      data,
      error,
    } =
      await supabase
        .from("documents")
        .insert(payload)
        .select("*")
        .single();

    if (error) {
      await removeDocumentFile(
        storageFile.path
      );

      throw error;
    }

    const normalized =
      normalizeDocument(data);

    try {
      await recordDocumentHistory({
        documentId:
          data.id,

        action:
          DOCUMENT_HISTORY_ACTIONS.CREATED,

        documentSnapshot:
          normalized,

        notes:
          "Document created.",
      });
    } catch (historyError) {
      console.error(
        "uploadDocument history:",
        historyError
      );

      /**
       * The document itself was successfully created.
       * Do not remove it merely because audit logging failed.
       */
    }

    return normalized;
  } catch (error) {
    if (storageFile?.path) {
      await removeDocumentFile(
        storageFile.path
      );
    }

    throw error;
  }
}

/**
 * ============================================================
 * DATABASE-ONLY DOCUMENT CREATION
 * ============================================================
 */

export async function createDocument(
  documentData
) {
  const createdBy =
    await getCurrentUserId();

  const payload = {
    ...documentData,

    created_by:
      createdBy,

    verification_status:
      documentData.verification_status ||
      DOCUMENT_VERIFICATION_STATUSES.PENDING,

    retention_status:
      documentData.retention_status ||
      DOCUMENT_RETENTION_STATUSES.ACTIVE,

    is_archived:
      documentData.is_archived === true,

    document_group_id:
      documentData.document_group_id ||
      crypto.randomUUID(),

    version_number:
      documentData.version_number ||
      1,
  };

  const {
    data,
    error,
  } =
    await supabase
      .from("documents")
      .insert(payload)
      .select("*")
      .single();

  if (error) {
    console.error(
      "createDocument:",
      error
    );

    throw error;
  }

  const normalized =
    normalizeDocument(data);

  try {
    await recordDocumentHistory({
      documentId:
        data.id,

      action:
        DOCUMENT_HISTORY_ACTIONS.CREATED,

      documentSnapshot:
        normalized,

      notes:
        "Document created.",
    });
  } catch (historyError) {
    console.error(
      "createDocument history:",
      historyError
    );
  }

  return normalized;
}

/**
 * ============================================================
 * DOCUMENT RETRIEVAL
 * ============================================================
 */

export async function getDocuments({
  category = null,
  documentType = null,
  customerId = null,
  loanId = null,
  applicationId = null,
  borrowingId = null,
  debtRepaymentId = null,
  verificationStatus = null,
  retentionStatus = null,
  includeArchived = false,
  includeDeleted = false,
  search = "",
} = {}) {
  let query =
    supabase
      .from("documents")
      .select("*")
      .order(
        "created_at",
        {
          ascending: false,
        }
      );

  if (category) {
    query = query.eq(
      "document_category",
      category
    );
  }

  if (documentType) {
    query = query.eq(
      "document_type",
      documentType
    );
  }

  if (customerId) {
    query = query.eq(
      "customer_id",
      customerId
    );
  }

  if (loanId) {
    query = query.eq(
      "loan_id",
      loanId
    );
  }

  if (applicationId) {
    query = query.eq(
      "application_id",
      applicationId
    );
  }

  if (borrowingId) {
    query = query.eq(
      "borrowing_id",
      borrowingId
    );
  }

  if (debtRepaymentId) {
    query = query.eq(
      "debt_repayment_id",
      debtRepaymentId
    );
  }

  if (verificationStatus) {
    query = query.eq(
      "verification_status",
      verificationStatus
    );
  }

  if (retentionStatus) {
    query = query.eq(
      "retention_status",
      retentionStatus
    );
  }

  if (!includeArchived) {
    query = query.eq(
      "is_archived",
      false
    );
  }

  if (!includeDeleted) {
    query = query.is(
      "deleted_at",
      null
    );
  }

  const searchValue =
    clean(search);

  if (searchValue) {
    const escaped =
      searchValue
        .replace(
          /\\/g,
          "\\\\"
        )
        .replace(
          /%/g,
          "\\%"
        )
        .replace(
          /_/g,
          "\\_"
        );

    query = query.or(
      [
        `document_name.ilike.%${escaped}%`,
        `document_type.ilike.%${escaped}%`,
        `customer_id_number_snapshot.ilike.%${escaped}%`,
        `loan_number_snapshot.ilike.%${escaped}%`,
        `company_name_snapshot.ilike.%${escaped}%`,
      ].join(",")
    );
  }

  const {
    data,
    error,
  } = await query;

  if (error) {
    console.error(
      "getDocuments:",
      error
    );

    throw error;
  }

  return (
    data || []
  ).map(normalizeDocument);
}

export async function getDocumentById(
  documentId
) {
  if (!documentId) {
    throw new Error(
      "Document ID is required."
    );
  }

  const {
    data,
    error,
  } =
    await supabase
      .from("documents")
      .select("*")
      .eq("id", documentId)
      .maybeSingle();

  if (error) {
    console.error(
      "getDocumentById:",
      error
    );

    throw error;
  }

  return normalizeDocument(data);
}

/**
 * ============================================================
 * DOCUMENT HISTORY RETRIEVAL
 * ============================================================
 */

export async function getDocumentHistory(
  documentId
) {
  if (!documentId) {
    throw new Error(
      "Document ID is required."
    );
  }

  const document =
    await getDocumentById(
      documentId
    );

  if (!document) {
    throw new Error(
      "Document was not found."
    );
  }

  /**
   * History table does not contain document_group_id.
   *
   * Therefore retrieve all versions in the group and then
   * retrieve their history entries.
   */
  let documentIds = [
    document.id,
  ];

  if (document.document_group_id) {
    const {
      data: versions,
      error: versionError,
    } =
      await supabase
        .from("documents")
        .select("id")
        .eq(
          "document_group_id",
          document.document_group_id
        );

    if (versionError) {
      throw versionError;
    }

    documentIds =
      (versions || [])
        .map(
          (item) => item.id
        )
        .filter(Boolean);
  }

  const {
    data,
    error,
  } =
    await supabase
      .from("document_history")
      .select("*")
      .in(
        "document_id",
        documentIds
      )
      .order(
        "performed_at",
        {
          ascending: false,
        }
      );

  if (error) {
    console.error(
      "getDocumentHistory:",
      error
    );

    throw error;
  }

  return data || [];
}

/**
 * Get all versions belonging to a document group.
 */

export async function getDocumentVersions(
  documentGroupId
) {
  if (!documentGroupId) {
    throw new Error(
      "Document group ID is required."
    );
  }

  const {
    data,
    error,
  } =
    await supabase
      .from("documents")
      .select("*")
      .eq(
        "document_group_id",
        documentGroupId
      )
      .order(
        "version_number",
        {
          ascending: false,
        }
      );

  if (error) {
    console.error(
      "getDocumentVersions:",
      error
    );

    throw error;
  }

  return (
    data || []
  ).map(normalizeDocument);
}

/**
 * ============================================================
 * CUSTOMER DOCUMENTS
 * ============================================================
 */

export async function getCustomerDocuments(
  customerId
) {
  if (!customerId) {
    return [];
  }

  return getDocuments({
    customerId,
  });
}

export async function getReusableCustomerDocuments(
  customerId
) {
  if (!customerId) {
    return [];
  }

  const documents =
    await getDocuments({
      customerId,
      includeArchived:
        false,
    });

  const today =
    new Date();

  return documents.filter(
    (document) => {
      if (
        document.is_archived
      ) {
        return false;
      }

      if (
        document.retention_policy ===
        DOCUMENT_RETENTION_POLICIES.PERMANENT
      ) {
        return true;
      }

      if (
        !document.retention_until
      ) {
        return true;
      }

      const expiry =
        new Date(
          `${document.retention_until}T23:59:59`
        );

      return expiry >= today;
    }
  );
}

/**
 * ============================================================
 * LOAN DOCUMENTS
 * ============================================================
 */

export async function getLoanDocuments(
  loanId
) {
  if (!loanId) {
    return [];
  }

  return getDocuments({
    loanId,
  });
}

/**
 * ============================================================
 * APPLICATION DOCUMENTS
 * ============================================================
 */

export async function getApplicationDocuments(
  applicationId
) {
  if (!applicationId) {
    return [];
  }

  return getDocuments({
    applicationId,
  });
}

/**
 * ============================================================
 * BORROWING DOCUMENTS
 * ============================================================
 */

export async function getBorrowingDocuments(
  borrowingId
) {
  if (!borrowingId) {
    return [];
  }

  return getDocuments({
    borrowingId,
    category:
      DOCUMENT_CATEGORIES.BORROWING,
  });
}

/**
 * ============================================================
 * DEBT REPAYMENT DOCUMENTS
 * ============================================================
 */

export async function getDebtRepaymentDocuments(
  debtRepaymentId
) {
  if (!debtRepaymentId) {
    return [];
  }

  return getDocuments({
    debtRepaymentId,
    category:
      DOCUMENT_CATEGORIES.DEBT_REPAYMENT,
  });
}

/**
 * ============================================================
 * COMPANY DOCUMENTS
 * ============================================================
 */

export async function getCompanyDocuments() {
  return getDocuments({
    category:
      DOCUMENT_CATEGORIES.COMPANY,
  });
}

/**
 * ============================================================
 * FINANCIAL RECORDS
 * ============================================================
 */

export async function getFinancialRecords({
  financialPeriodType = null,
} = {}) {
  return getDocuments({
    category:
      DOCUMENT_CATEGORIES.FINANCIAL_RECORD,
    includeArchived:
      true,
    search:
      financialPeriodType || "",
  });
}

/**
 * ============================================================
 * STORAGE / DOWNLOAD
 * ============================================================
 */

export async function getDocumentDownloadUrl(
  document,
  expiresIn = 3600
) {
  if (!document?.document_path) {
    throw new Error(
      "This document does not have a stored file."
    );
  }

  const {
    data,
    error,
  } =
    await supabase.storage
      .from(DOCUMENT_BUCKET)
      .createSignedUrl(
        document.document_path,
        expiresIn
      );

  if (error) {
    console.error(
      "getDocumentDownloadUrl:",
      error
    );

    throw error;
  }

  return (
    data?.signedUrl ||
    null
  );
}

export async function openDocument(
  document
) {
  const url =
    await getDocumentDownloadUrl(
      document
    );

  if (!url) {
    throw new Error(
      "Unable to generate document URL."
    );
  }

  window.open(
    url,
    "_blank",
    "noopener,noreferrer"
  );

  return url;
}

/**
 * ============================================================
 * DOCUMENT UPDATE
 * ============================================================
 */

export async function updateDocument(
  documentId,
  updates
) {
  if (!documentId) {
    throw new Error(
      "Document ID is required."
    );
  }

  if (
    !updates ||
    typeof updates !== "object"
  ) {
    throw new Error(
      "Document updates are required."
    );
  }

  const document =
    await getDocumentById(
      documentId
    );

  if (!document) {
    throw new Error(
      "Document was not found."
    );
  }

  if (document.deleted_at) {
    throw new Error(
      "Deleted documents cannot be updated."
    );
  }

  const safeUpdates = {
    ...updates,
  };

  /**
   * Lifecycle-controlled fields cannot be modified
   * through generic metadata updates.
   */
  delete safeUpdates.id;
  delete safeUpdates.created_at;
  delete safeUpdates.created_by;
  delete safeUpdates.document_group_id;
  delete safeUpdates.version_number;
  delete safeUpdates.replacement_of_document_id;
  delete safeUpdates.replaced_by_document_id;
  delete safeUpdates.deleted_at;
  delete safeUpdates.deleted_by;

  const {
    data,
    error,
  } =
    await supabase
      .from("documents")
      .update(safeUpdates)
      .eq("id", documentId)
      .select("*")
      .single();

  if (error) {
    console.error(
      "updateDocument:",
      error
    );

    throw error;
  }

  const updatedDocument =
    normalizeDocument(data);

  try {
    await recordDocumentHistory({
      documentId:
        documentId,

      action:
        DOCUMENT_HISTORY_ACTIONS.UPDATED,

      documentSnapshot:
        updatedDocument,

      previousSnapshot:
        document,

      notes:
        "Document metadata updated.",
    });
  } catch (historyError) {
    console.error(
      "updateDocument history:",
      historyError
    );
  }

  return updatedDocument;
}

/**
 * ============================================================
 * DOCUMENT REPLACEMENT
 * ============================================================
 */

export async function replaceDocument({
  documentId,
  file,
  documentName = null,
  retentionPolicy = null,
  retentionUntil = null,
}) {
  if (!documentId) {
    throw new Error(
      "Document ID is required."
    );
  }

  if (!file) {
    throw new Error(
      "Please select the replacement document."
    );
  }

  const currentDocument =
    await getDocumentById(
      documentId
    );

  if (!currentDocument) {
    throw new Error(
      "Document was not found."
    );
  }

  if (currentDocument.deleted_at) {
    throw new Error(
      "Deleted documents cannot be replaced."
    );
  }

  const userId =
    await getCurrentUserId();

  const fileHash =
    await calculateFileHash(file);

  const duplicate =
    await findDuplicateByHash({
      fileHash,
      documentType:
        currentDocument.document_type,
      customerId:
        currentDocument.customer_id,
      loanId:
        currentDocument.loan_id,
      applicationId:
        currentDocument.application_id,
      borrowingId:
        currentDocument.borrowing_id,
      debtRepaymentId:
        currentDocument.debt_repayment_id,
      agreementId:
        currentDocument.agreement_id,
    });

  if (
    duplicate &&
    duplicate.id !== currentDocument.id
  ) {
    throw new Error(
      `This replacement file already exists as "${duplicate.document_name}".`
    );
  }

  const retention =
    resolveRetentionMetadata({
      documentType:
        currentDocument.document_type,

      documentCategory:
        currentDocument.document_category,

      retentionPolicy:
        retentionPolicy ||
        currentDocument.retention_policy,

      retentionUntil:
        retentionUntil ||
        currentDocument.retention_until,
    });

  /**
   * Statement records have an existing unique index.
   *
   * Archive the previous record first so the new version can
   * be inserted without violating that index.
   */
  const {
    data: archivedOld,
    error: archiveError,
  } =
    await supabase
      .from("documents")
      .update({
        is_archived:
          true,

        archived_at:
          new Date().toISOString(),

        archived_by:
          userId,

        retention_status:
          DOCUMENT_RETENTION_STATUSES.ARCHIVED,
      })
      .eq(
        "id",
        currentDocument.id
      )
      .select("*")
      .single();

  if (archiveError) {
    console.error(
      "replaceDocument archive:",
      archiveError
    );

    throw archiveError;
  }

  let storageFile = null;

  try {
    storageFile =
      await uploadDocumentFile({
        file,

        category:
          currentDocument.document_category,

        customerIdNumber:
          currentDocument.customer_id_number_snapshot,

        loanNumber:
          currentDocument.loan_number_snapshot,

        applicationNumber:
          currentDocument.application_id,

        companyName:
          currentDocument.company_name_snapshot,

        borrowingId:
          currentDocument.borrowing_id,

        debtRepaymentId:
          currentDocument.debt_repayment_id,
      });

    const nextVersion =
      Number(
        currentDocument.version_number ||
          1
      ) + 1;

    const payload = {
      customer_id:
        currentDocument.customer_id,

      loan_id:
        currentDocument.loan_id,

      agreement_id:
        currentDocument.agreement_id,

      application_id:
        currentDocument.application_id,

      borrowing_id:
        currentDocument.borrowing_id,

      debt_repayment_id:
        currentDocument.debt_repayment_id,

      document_type:
        currentDocument.document_type,

      document_category:
        currentDocument.document_category,

      document_name:
        clean(documentName) ||
        clean(file.name) ||
        currentDocument.document_name,

      document_path:
        storageFile.path,

      created_by:
        userId,

      company_name_snapshot:
        currentDocument.company_name_snapshot,

      customer_id_number_snapshot:
        currentDocument.customer_id_number_snapshot,

      loan_number_snapshot:
        currentDocument.loan_number_snapshot,

      mime_type:
        file.type ||
        "application/octet-stream",

      file_size_bytes:
        Number(file.size || 0),

      file_hash_sha256:
        fileHash,

      source_type:
        currentDocument.source_type,

      retention_policy:
        retention.retentionPolicy,

      retention_until:
        retention.retentionUntil,

      financial_period_type:
        currentDocument.financial_period_type,

      financial_period_start:
        currentDocument.financial_period_start,

      financial_period_end:
        currentDocument.financial_period_end,

      verification_status:
        DOCUMENT_VERIFICATION_STATUSES.PENDING,

      retention_status:
        DOCUMENT_RETENTION_STATUSES.ACTIVE,

      is_archived:
        false,

      document_group_id:
        currentDocument.document_group_id,

      version_number:
        nextVersion,

      replacement_of_document_id:
        currentDocument.id,
    };

    const {
      data: newDocument,
      error,
    } =
      await supabase
        .from("documents")
        .insert(payload)
        .select("*")
        .single();

    if (error) {
      await removeDocumentFile(
        storageFile.path
      );

      /**
       * Restore previous version if creation of the
       * replacement failed.
       */
      await supabase
        .from("documents")
        .update({
          is_archived:
            archivedOld.is_archived,

          archived_at:
            archivedOld.archived_at,

          archived_by:
            archivedOld.archived_by,

          retention_status:
            archivedOld.retention_status,
        })
        .eq(
          "id",
          currentDocument.id
        );

      throw error;
    }

    /**
     * Link old version to new version.
     */
    const {
      data: linkedOld,
      error: linkError,
    } =
      await supabase
        .from("documents")
        .update({
          replaced_by_document_id:
            newDocument.id,
        })
        .eq(
          "id",
          currentDocument.id
        )
        .select("*")
        .single();

    if (linkError) {
      console.error(
        "replaceDocument link:",
        linkError
      );

      throw linkError;
    }

    /**
     * Explicit replacement audit record.
     */
    try {
      await recordDocumentHistory({
        documentId:
          currentDocument.id,

        action:
          DOCUMENT_HISTORY_ACTIONS.REPLACED,

        previousDocumentId:
          currentDocument.id,

        newDocumentId:
          newDocument.id,

        documentSnapshot:
          normalizeDocument(
            newDocument
          ),

        previousSnapshot:
          normalizeDocument(
            currentDocument
          ),

        notes:
          `Document replaced. Version ${currentDocument.version_number || 1} replaced by version ${nextVersion}.`,
      });
    } catch (historyError) {
      console.error(
        "replaceDocument history:",
        historyError
      );
    }

    return {
      previousDocument:
        normalizeDocument(
          linkedOld
        ),

      newDocument:
        normalizeDocument(
          newDocument
        ),
    };
  } catch (error) {
    if (storageFile?.path) {
      await removeDocumentFile(
        storageFile.path
      );
    }

    throw error;
  }
}

/**
 * ============================================================
 * DOCUMENT ARCHIVING
 * ============================================================
 */

export async function archiveDocument(
  documentId,
  notes = null
) {
  const userId =
    await getCurrentUserId();

  if (!documentId) {
    throw new Error(
      "Document ID is required."
    );
  }

  const document =
    await getDocumentById(
      documentId
    );

  if (!document) {
    throw new Error(
      "Document was not found."
    );
  }

  if (document.deleted_at) {
    throw new Error(
      "Deleted documents cannot be archived."
    );
  }

  if (document.is_archived) {
    return document;
  }

  const {
    data,
    error,
  } =
    await supabase
      .from("documents")
      .update({
        is_archived:
          true,

        archived_at:
          new Date().toISOString(),

        archived_by:
          userId,

        retention_status:
          DOCUMENT_RETENTION_STATUSES.ARCHIVED,
      })
      .eq(
        "id",
        documentId
      )
      .select("*")
      .single();

  if (error) {
    console.error(
      "archiveDocument:",
      error
    );

    throw error;
  }

  const archivedDocument =
    normalizeDocument(data);

  try {
    await recordDocumentHistory({
      documentId:
        documentId,

      action:
        DOCUMENT_HISTORY_ACTIONS.ARCHIVED,

      documentSnapshot:
        archivedDocument,

      previousSnapshot:
        document,

      notes:
        notes ||
        "Document archived.",
    });
  } catch (historyError) {
    console.error(
      "archiveDocument history:",
      historyError
    );
  }

  return archivedDocument;
}

/**
 * ============================================================
 * DOCUMENT RESTORE
 * ============================================================
 */

export async function restoreDocument(
  documentId
) {
  const userId =
    await getCurrentUserId();

  if (!documentId) {
    throw new Error(
      "Document ID is required."
    );
  }

  const document =
    await getDocumentById(
      documentId
    );

  if (!document) {
    throw new Error(
      "Document was not found."
    );
  }

  if (document.deleted_at) {
    throw new Error(
      "Deleted documents cannot be restored."
    );
  }

  if (!document.is_archived) {
    return document;
  }

  /**
   * Do not restore an old replacement while a newer active
   * version exists.
   */
  if (
    document.replaced_by_document_id
  ) {
    const newerDocument =
      await getDocumentById(
        document.replaced_by_document_id
      );

    if (
      newerDocument &&
      !newerDocument.is_archived &&
      !newerDocument.deleted_at
    ) {
      throw new Error(
        "This document has been replaced by a newer version. Restore the latest version instead."
      );
    }
  }

  const {
    data,
    error,
  } =
    await supabase
      .from("documents")
      .update({
        is_archived:
          false,

        archived_at:
          null,

        archived_by:
          null,

        retention_status:
          DOCUMENT_RETENTION_STATUSES.ACTIVE,
      })
      .eq(
        "id",
        documentId
      )
      .select("*")
      .single();

  if (error) {
    console.error(
      "restoreDocument:",
      error
    );

    throw error;
  }

  const restoredDocument =
    normalizeDocument(data);

  try {
    await recordDocumentHistory({
      documentId:
        documentId,

      action:
        DOCUMENT_HISTORY_ACTIONS.RESTORED,

      documentSnapshot:
        restoredDocument,

      previousSnapshot:
        document,

      notes:
        "Document restored.",
    });
  } catch (historyError) {
    console.error(
      "restoreDocument history:",
      historyError
    );
  }

  return restoredDocument;
}

/**
 * ============================================================
 * DOCUMENT DELETION
 * ============================================================
 *
 * Deletion is allowed only when:
 *
 * - document is not permanent
 * - document is expired OR archived
 *
 * A complete snapshot is written to the audit history BEFORE
 * the document row is deleted.
 *
 * The document file is removed only after the audit entry has
 * successfully been created.
 */

export async function deleteDocument(
  documentId
) {
  const userId =
    await getCurrentUserId();

  if (!documentId) {
    throw new Error(
      "Document ID is required."
    );
  }

  const document =
    await getDocumentById(
      documentId
    );

  if (!document) {
    throw new Error(
      "Document was not found."
    );
  }

  if (
    document.retention_policy ===
    DOCUMENT_RETENTION_POLICIES.PERMANENT
  ) {
    throw new Error(
      "Permanent documents cannot be deleted."
    );
  }

  if (
    document.retention_status !==
      DOCUMENT_RETENTION_STATUSES.EXPIRED &&
    !document.is_archived
  ) {
    throw new Error(
      "This document is still within its retention period."
    );
  }

  /**
   * Write the deletion audit entry while the document still
   * exists so the foreign key can be satisfied.
   */
  try {
    await recordDocumentHistory({
      documentId:
        documentId,

      action:
        DOCUMENT_HISTORY_ACTIONS.DELETED,

      documentSnapshot:
        document,

      notes:
        "Document deleted.",
    });
  } catch (historyError) {
    console.error(
      "deleteDocument history:",
      historyError
    );

    throw new Error(
      "The document deletion audit record could not be created. The document was not deleted."
    );
  }

  /**
   * Remove storage first.
   *
   * If storage deletion fails, the database document and
   * audit record remain intact.
   */
  if (document.document_path) {
    const {
      error: storageError,
    } =
      await supabase.storage
        .from(DOCUMENT_BUCKET)
        .remove([
          document.document_path,
        ]);

    if (storageError) {
      console.error(
        "deleteDocument storage:",
        storageError
      );

      throw new Error(
        "The document file could not be removed from storage. The document record was not deleted."
      );
    }
  }

  /**
   * Delete database row.
   *
   * document_history.document_id is ON DELETE SET NULL,
   * therefore the audit record survives.
   */
  const {
    error,
  } =
    await supabase
      .from("documents")
      .delete()
      .eq(
        "id",
        documentId
      );

  if (error) {
    console.error(
      "deleteDocument:",
      error
    );

    throw error;
  }

  return {
    success:
      true,

    documentId,

    deletedBy:
      userId,

    documentName:
      document.document_name,
  };
}

/**
 * ============================================================
 * VERIFICATION
 * ============================================================
 */

export async function getDocumentVerification(
  documentId
) {
  if (!documentId) {
    throw new Error(
      "Document ID is required."
    );
  }

  const {
    data,
    error,
  } =
    await supabase
      .from(
        "document_verifications"
      )
      .select("*")
      .eq(
        "document_id",
        documentId
      )
      .order(
        "created_at",
        {
          ascending: false,
        }
      )
      .limit(1)
      .maybeSingle();

  if (error) {
    console.error(
      "getDocumentVerification:",
      error
    );

    throw error;
  }

  return data || null;
}

export async function getDocumentVerificationFlags(
  documentId
) {
  if (!documentId) {
    throw new Error(
      "Document ID is required."
    );
  }

  const {
    data,
    error,
  } =
    await supabase
      .from(
        "document_verification_flags"
      )
      .select("*")
      .eq(
        "document_id",
        documentId
      )
      .order(
        "created_at",
        {
          ascending: false,
        }
      );

  if (error) {
    console.error(
      "getDocumentVerificationFlags:",
      error
    );

    throw error;
  }

  return data || [];
}

export async function getDocumentCrossReferences(
  documentId
) {
  if (!documentId) {
    throw new Error(
      "Document ID is required."
    );
  }

  const {
    data,
    error,
  } =
    await supabase
      .from(
        "document_cross_references"
      )
      .select("*")
      .eq(
        "document_id",
        documentId
      )
      .order(
        "created_at",
        {
          ascending: false,
        }
      );

  if (error) {
    console.error(
      "getDocumentCrossReferences:",
      error
    );

    throw error;
  }

  return data || [];
}

/**
 * ============================================================
 * ADMIN VERIFICATION ACTIONS
 * ============================================================
 */

export async function createDocumentVerification({
  documentId,
  verificationStatus,
  riskScore = null,
  verificationMethod = null,
  verificationSummary = null,
  extractedData = null,
  comparisonData = null,
}) {
  const payload = {
    document_id:
      documentId,

    verification_status:
      verificationStatus ||
      DOCUMENT_VERIFICATION_STATUSES.PROCESSING,

    risk_score:
      riskScore !== null
        ? Number(riskScore)
        : null,

    verification_method:
      verificationMethod ||
      null,

    verification_summary:
      verificationSummary ||
      null,

    extracted_data:
      extractedData ||
      null,

    comparison_data:
      comparisonData ||
      null,

    processed_at:
      verificationStatus &&
      verificationStatus !==
        DOCUMENT_VERIFICATION_STATUSES.PENDING
        ? new Date().toISOString()
        : null,

    created_at:
      new Date().toISOString(),

    updated_at:
      new Date().toISOString(),
  };

  const {
    data,
    error,
  } =
    await supabase
      .from(
        "document_verifications"
      )
      .insert(payload)
      .select("*")
      .single();

  if (error) {
    console.error(
      "createDocumentVerification:",
      error
    );

    throw error;
  }

  await updateDocument(
    documentId,
    {
      verification_status:
        verificationStatus ||
        DOCUMENT_VERIFICATION_STATUSES.PROCESSING,
    }
  );

  return data;
}

export async function reviewDocumentVerification({
  verificationId,
  documentId,
  reviewerDecision,
  reviewerNotes = "",
}) {
  const userId =
    await getCurrentUserId();

  if (!verificationId) {
    throw new Error(
      "Verification ID is required."
    );
  }

  if (!documentId) {
    throw new Error(
      "Document ID is required."
    );
  }

  if (!reviewerDecision) {
    throw new Error(
      "Reviewer decision is required."
    );
  }

  const now =
    new Date().toISOString();

  const {
    data,
    error,
  } =
    await supabase
      .from(
        "document_verifications"
      )
      .update({
        reviewed_by:
          userId,

        reviewed_at:
          now,

        reviewer_decision:
          reviewerDecision,

        reviewer_notes:
          reviewerNotes ||
          null,

        updated_at:
          now,
      })
      .eq(
        "id",
        verificationId
      )
      .select("*")
      .single();

  if (error) {
    console.error(
      "reviewDocumentVerification:",
      error
    );

    throw error;
  }

  let documentStatus =
    DOCUMENT_VERIFICATION_STATUSES.REVIEW_REQUIRED;

  const normalizedDecision =
    String(
      reviewerDecision
    )
      .trim()
      .toUpperCase();

  if (
    normalizedDecision ===
      "APPROVE" ||
    normalizedDecision ===
      "VERIFIED" ||
    normalizedDecision ===
      "PASS"
  ) {
    documentStatus =
      DOCUMENT_VERIFICATION_STATUSES.VERIFIED;
  }

  if (
    normalizedDecision ===
      "REJECT" ||
    normalizedDecision ===
      "REJECTED"
  ) {
    documentStatus =
      DOCUMENT_VERIFICATION_STATUSES.REJECTED;
  }

  await updateDocument(
    documentId,
    {
      verification_status:
        documentStatus,
    }
  );

  return data;
}

/**
 * ============================================================
 * VERIFICATION FLAGS
 * ============================================================
 */

export async function createDocumentVerificationFlag({
  documentId,
  verificationId = null,
  flagCode,
  severity = "MEDIUM",
  fieldName = null,
  expectedValue = null,
  actualValue = null,
  sourceDocumentId = null,
  sourceRecordType = null,
  sourceRecordId = null,
  description = null,
}) {
  const payload = {
    document_id:
      documentId,

    verification_id:
      verificationId,

    flag_code:
      flagCode,

    severity,

    field_name:
      fieldName,

    expected_value:
      expectedValue !== undefined
        ? expectedValue
        : null,

    actual_value:
      actualValue !== undefined
        ? actualValue
        : null,

    source_document_id:
      sourceDocumentId ||
      null,

    source_record_type:
      sourceRecordType ||
      null,

    source_record_id:
      sourceRecordId ||
      null,

    description:
      description ||
      null,

    flag_status:
      "OPEN",
  };

  const {
    data,
    error,
  } =
    await supabase
      .from(
        "document_verification_flags"
      )
      .insert(payload)
      .select("*")
      .single();

  if (error) {
    console.error(
      "createDocumentVerificationFlag:",
      error
    );

    throw error;
  }

  return data;
}

export async function resolveDocumentVerificationFlag({
  flagId,
  resolutionNotes = "",
}) {
  const userId =
    await getCurrentUserId();

  if (!flagId) {
    throw new Error(
      "Flag ID is required."
    );
  }

  const {
    data,
    error,
  } =
    await supabase
      .from(
        "document_verification_flags"
      )
      .update({
        flag_status:
          "RESOLVED",

        resolved_by:
          userId,

        resolved_at:
          new Date().toISOString(),

        resolution_notes:
          resolutionNotes ||
          null,
      })
      .eq(
        "id",
        flagId
      )
      .select("*")
      .single();

  if (error) {
    console.error(
      "resolveDocumentVerificationFlag:",
      error
    );

    throw error;
  }

  return data;
}

/**
 * ============================================================
 * CROSS REFERENCES
 * ============================================================
 */

export async function createDocumentCrossReference({
  documentId,
  comparedDocumentId = null,
  sourceRecordType = null,
  sourceRecordId = null,
  fieldName,
  expectedValue = null,
  observedValue = null,
  matchResult,
  confidence = null,
  notes = null,
}) {
  const payload = {
    document_id:
      documentId,

    compared_document_id:
      comparedDocumentId ||
      null,

    source_record_type:
      sourceRecordType ||
      null,

    source_record_id:
      sourceRecordId ||
      null,

    field_name:
      fieldName,

    expected_value:
      expectedValue !== undefined
        ? expectedValue
        : null,

    observed_value:
      observedValue !== undefined
        ? observedValue
        : null,

    match_result:
      matchResult,

    confidence:
      confidence !== null
        ? Number(confidence)
        : null,

    notes:
      notes ||
      null,
  };

  const {
    data,
    error,
  } =
    await supabase
      .from(
        "document_cross_references"
      )
      .insert(payload)
      .select("*")
      .single();

  if (error) {
    console.error(
      "createDocumentCrossReference:",
      error
    );

    throw error;
  }

  return data;
}

/**
 * ============================================================
 * RETENTION
 * ============================================================
 */

export async function markExpiredDocumentsForReview() {
  const {
    data,
    error,
  } =
    await supabase.rpc(
      "mark_expired_documents_for_review"
    );

  if (error) {
    console.error(
      "markExpiredDocumentsForReview:",
      error
    );

    throw error;
  }

  return data;
}

export async function getRetentionDocuments({
  status = null,
} = {}) {
  return getDocuments({
    retentionStatus:
      status,

    includeArchived:
      true,
  });
}

/**
 * ============================================================
 * DOCUMENT TYPE / RETENTION HELPERS
 * ============================================================
 */

export function getDefaultRetentionPolicy(
  documentType,
  documentCategory
) {
  const type =
    String(
      documentType || ""
    ).toUpperCase();

  const category =
    String(
      documentCategory || ""
    ).toUpperCase();

  if (
    type ===
    DOCUMENT_TYPES.ID_DOCUMENT
  ) {
    return DOCUMENT_RETENTION_POLICIES.PERMANENT;
  }

  if (
    type ===
      DOCUMENT_TYPES.BANK_STATEMENT ||
    type ===
      DOCUMENT_TYPES.PAYSLIP ||
    type ===
      DOCUMENT_TYPES.PROOF_OF_RESIDENCE
  ) {
    return DOCUMENT_RETENTION_POLICIES.SIX_MONTHS;
  }

  if (
    category ===
    DOCUMENT_CATEGORIES.LOAN
  ) {
    return (
      DOCUMENT_RETENTION_POLICIES
        .THREE_YEARS_AFTER_LOAN_TERMINATION
    );
  }

  return DOCUMENT_RETENTION_POLICIES.NONE;
}

export function calculateSixMonthRetentionDate(
  createdDate = new Date()
) {
  const date =
    new Date(
      createdDate
    );

  date.setMonth(
    date.getMonth() + 6
  );

  return date
    .toISOString()
    .slice(0, 10);
}

export function calculateThreeYearRetentionDate(
  loanTerminationDate
) {
  if (!loanTerminationDate) {
    return null;
  }

  const date =
    new Date(
      `${loanTerminationDate}T00:00:00`
    );

  date.setFullYear(
    date.getFullYear() + 3
  );

  return date
    .toISOString()
    .slice(0, 10);
}

/**
 * ============================================================
 * DOCUMENT REUSE
 * ============================================================
 */

export async function getLatestReusableCustomerDocument(
  customerId,
  documentType
) {
  if (
    !customerId ||
    !documentType
  ) {
    return null;
  }

  const documentTypeMap = {
    [DOCUMENT_TYPES.BANK_STATEMENT]:
      "Bank Statement",

    [DOCUMENT_TYPES.PAYSLIP]:
      "Payslip",

    [DOCUMENT_TYPES.PROOF_OF_RESIDENCE]:
      "Proof of Residence",

    [DOCUMENT_TYPES.ID_DOCUMENT]:
      "ID Document",
  };

  const databaseDocumentType =
    documentTypeMap[
      documentType
    ] ||
    documentType;

  const {
    data,
    error,
  } =
    await supabase.rpc(
      "get_valid_customer_document",
      {
        p_customer_id:
          customerId,

        p_document_type:
          databaseDocumentType,
      }
    );

  if (error) {
    console.error(
      "getLatestReusableCustomerDocument:",
      error
    );

    throw error;
  }

  return data?.[0] || null;
}

/**
 * ============================================================
 * COMPANY SETTINGS
 * ============================================================
 */

export async function getCompanyDocumentContext() {
  const settings =
    await getSystemSettings();

  return {
    companyName:
      settings?.company_name ||
      "Umhlomunye Finance",

    companyAddress:
      settings?.company_address ||
      "",

    companyLogoUrl:
      settings?.company_logo_url ||
      "",

    financialYearEnd:
      settings?.financial_year_end ||
      null,
  };
}

/**
 * ============================================================
 * DOCUMENT COUNTS
 * ============================================================
 */

export async function getDocumentCounts() {
  const categories =
    Object.values(
      DOCUMENT_CATEGORIES
    );

  const counts = {};

  await Promise.all(
    categories.map(
      async (category) => {
        const {
          count,
          error,
        } =
          await supabase
            .from("documents")
            .select(
              "id",
              {
                count:
                  "exact",
                head:
                  true,
              }
            )
            .eq(
              "document_category",
              category
            )
            .eq(
              "is_archived",
              false
            )
            .is(
              "deleted_at",
              null
            );

        if (error) {
          throw error;
        }

        counts[category] =
          count || 0;
      }
    )
  );

  return counts;
}

export async function getVerificationCounts() {
  const statuses =
    Object.values(
      DOCUMENT_VERIFICATION_STATUSES
    );

  const counts = {};

  await Promise.all(
    statuses.map(
      async (status) => {
        const {
          count,
          error,
        } =
          await supabase
            .from("documents")
            .select(
              "id",
              {
                count:
                  "exact",
                head:
                  true,
              }
            )
            .eq(
              "verification_status",
              status
            )
            .eq(
              "is_archived",
              false
            )
            .is(
              "deleted_at",
              null
            );

        if (error) {
          throw error;
        }

        counts[status] =
          count || 0;
      }
    )
  );

  return counts;
}

/**
 * ============================================================
 * EXPORTS
 * ============================================================
 */

export default {
  uploadDocument,
  createDocument,

  getDocuments,
  getDocumentById,
  getDocumentHistory,
  getDocumentVersions,

  getCustomerDocuments,
  getReusableCustomerDocuments,
  getLatestReusableCustomerDocument,

  getLoanDocuments,
  getApplicationDocuments,
  getBorrowingDocuments,
  getDebtRepaymentDocuments,
  getCompanyDocuments,
  getFinancialRecords,

  getDocumentDownloadUrl,
  openDocument,

  updateDocument,
  replaceDocument,
  archiveDocument,
  restoreDocument,
  deleteDocument,

  getDocumentVerification,
  getDocumentVerificationFlags,
  getDocumentCrossReferences,

  createDocumentVerification,
  reviewDocumentVerification,

  createDocumentVerificationFlag,
  resolveDocumentVerificationFlag,

  createDocumentCrossReference,

  markExpiredDocumentsForReview,
  getRetentionDocuments,

  getDefaultRetentionPolicy,
  calculateSixMonthRetentionDate,
  calculateThreeYearRetentionDate,

  getCompanyDocumentContext,

  getDocumentCounts,
  getVerificationCounts,
};
