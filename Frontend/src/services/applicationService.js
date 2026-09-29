import { supabase } from "../lib/supabase";

import {
  saveApplication,
  getApplication,
  getAllApplications,
  findApplicationByServerId,

  saveApplicationDocument,
  updateApplicationDocument,
  getApplicationDocuments,

  enqueueOperation,
  getPendingOperations,
  updateOperation,
  removeOperation,
  countPendingOperations,

  setSyncMeta,
  getSyncMeta,
} from "./applicationOfflineStore";

/* ============================================================
   CONSTANTS
============================================================ */

const OPERATION_TYPES = {
  SUBMIT_APPLICATION:
    "SUBMIT_APPLICATION",

  UPLOAD_DOCUMENT:
    "UPLOAD_APPLICATION_DOCUMENT",

  APPROVE_APPLICATION:
    "APPROVE_APPLICATION",

  REJECT_APPLICATION:
    "REJECT_APPLICATION",

  UPDATE_APPLICATION_STATUS:
    "UPDATE_APPLICATION_STATUS",
};

const MAX_QUEUE_ATTEMPTS = 10;

let synchronizationRunning = false;

/* ============================================================
   HELPERS
============================================================ */

function isBrowserOnline() {
  if (
    typeof navigator === "undefined"
  ) {
    return true;
  }

  return navigator.onLine !== false;
}

function isNetworkError(error) {
  const message = String(
    error?.message || ""
  ).toLowerCase();

  return (
    !isBrowserOnline() ||
    message.includes("network") ||
    message.includes("fetch") ||
    message.includes("failed to fetch") ||
    message.includes("connection") ||
    message.includes("offline") ||
    message.includes("timeout") ||
    error?.name === "TypeError"
  );
}

function generateLocalId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `application_${crypto.randomUUID()}`;
  }

  return `application_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2)}`;
}

function normaliseApplication(
  application,
  localId = null
) {
  if (!application) {
    return null;
  }

  return {
    ...application,

    local_id:
      application.local_id ||
      localId ||
      application.id ||
      generateLocalId(),

    server_id:
      application.server_id ||
      application.id ||
      null,

    sync_state:
      application.sync_state ||
      "SYNCED",

    sync_error:
      application.sync_error ||
      null,

    updated_at:
      application.updated_at ||
      new Date().toISOString(),
  };
}

function extractRpcResult(data) {
  if (Array.isArray(data)) {
    return data[0] || null;
  }

  return data || null;
}

function getServerApplicationId(
  application
) {
  return (
    application?.server_id ||
    application?.id ||
    application?.application_id ||
    null
  );
}

/*
 * These errors describe a synchronization dependency rather
 * than an actual failed operation. They must remain PENDING
 * without consuming another queue attempt.
 */
function isSynchronizationDependencyError(
  error
) {
  const message = String(
    error?.message || ""
  ).toLowerCase();

  return (
    message.includes(
      "has not received a server id yet"
    ) ||
    message.includes(
      "server id yet"
    ) ||
    message.includes(
      "upload token is not available yet"
    ) ||
    message.includes(
      "upload token is not available"
    ) ||
    message.includes(
      "associated document could not be found"
    ) ||
    message.includes(
      "offline document file is missing"
    )
  );
}

/*
 * Resolve an application whether the supplied ID is the
 * local IndexedDB ID or the server application ID.
 */
async function resolveLocalApplication(
  applicationId
) {
  if (!applicationId) {
    return null;
  }

  const direct =
    await getApplication(
      applicationId
    );

  if (direct) {
    return direct;
  }

  return findApplicationByServerId(
    applicationId
  );
}

/*
 * Resolve a locally stored document from its local document ID.
 *
 * applicationOfflineStore currently exposes
 * getApplicationDocuments(), so we deliberately resolve the
 * document through its application rather than requiring a
 * separate getApplicationDocument() API.
 */
async function getStoredApplicationDocument(
  applicationLocalId,
  documentLocalId
) {
  if (
    !applicationLocalId ||
    !documentLocalId
  ) {
    return null;
  }

  const documents =
    await getApplicationDocuments(
      applicationLocalId
    );

  return (
    documents?.find(
      (document) =>
        document.local_id ===
        documentLocalId
    ) || null
  );
}

/* ============================================================
   VALIDATION
============================================================ */

function validateApplication(
  applicationData
) {
  if (!applicationData) {
    throw new Error(
      "Application information is required."
    );
  }

  const idNumber =
    String(
      applicationData.id_number || ""
    ).trim();

  if (!/^\d{13}$/.test(idNumber)) {
    throw new Error(
      "ID number must contain exactly 13 digits."
    );
  }

  const firstName =
    String(
      applicationData.first_name || ""
    ).trim();

  const lastName =
    String(
      applicationData.last_name || ""
    ).trim();

  const cellphone =
    String(
      applicationData.cellphone || ""
    ).trim();

  const bankName =
    String(
      applicationData.bank_name || ""
    ).trim();

  const accountNumber =
    String(
      applicationData.account_number || ""
    ).trim();

  if (!firstName) {
    throw new Error(
      "First name is required."
    );
  }

  if (!lastName) {
    throw new Error(
      "Last name is required."
    );
  }

  if (!cellphone) {
    throw new Error(
      "Cellphone number is required."
    );
  }

  if (!bankName) {
    throw new Error(
      "Bank name is required."
    );
  }

  if (!accountNumber) {
    throw new Error(
      "Bank account number is required."
    );
  }

  const amount = Number(
    applicationData.amount_requested
  );

  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    throw new Error(
      "Loan amount must be greater than zero."
    );
  }
}

/* ============================================================
   SUPABASE SUBMISSION
============================================================ */

async function submitApplicationToServer(
  applicationData
) {
  const {
    first_name,
    last_name,
    cellphone,
    email,
    physical_address,
    id_number,
    employer,
    employment_status,
    monthly_income,
    other_income,
    bank_name,
    account_number,
    amount_requested,
    loan_purpose,
    preferred_payment_date,
    collection_preference,
    notes,
  } = applicationData;

  const {
    data,
    error,
  } = await supabase.rpc(
    "submit_loan_application",
    {
      p_first_name:
        first_name,

      p_last_name:
        last_name,

      p_cellphone:
        cellphone,

      p_email:
        email ?? null,

      p_physical_address:
        physical_address ?? null,

      p_employer:
        employer ?? null,

      p_employment_status:
        employment_status ?? null,

      p_monthly_income:
        monthly_income ?? null,

      p_other_income:
        other_income ?? null,

      p_bank_name:
        bank_name,

      p_account_number:
        account_number,

      p_amount_requested:
        amount_requested,

      p_loan_purpose:
        loan_purpose ?? null,

      p_preferred_payment_date:
        preferred_payment_date ??
        null,

      p_collection_preference:
        collection_preference ??
        null,

      p_notes:
        notes ?? null,

      p_id_number:
        id_number,
    }
  );

  if (error) {
    throw error;
  }

  return extractRpcResult(data);
}

/* ============================================================
   ADD APPLICATION
============================================================ */

export async function addLoanApplication(
  applicationData
) {
  validateApplication(
    applicationData
  );

  const localId =
    applicationData.local_id ||
    generateLocalId();

  const localApplication =
    normaliseApplication(
      {
        ...applicationData,

        local_id:
          localId,

        server_id:
          null,

        id:
          null,

        status:
          applicationData.status ||
          "PENDING",

        sync_state:
          "PENDING",

        sync_error:
          null,

        offline_pending_sync:
          true,

        created_at:
          applicationData.created_at ||
          new Date().toISOString(),

        updated_at:
          new Date().toISOString(),
      },
      localId
    );

  /*
   * Always persist the application locally first.
   */
  await saveApplication(
    localApplication
  );

  /*
   * No internet:
   * leave the application in IndexedDB and
   * queue the server submission.
   */
  if (!isBrowserOnline()) {
    await enqueueOperation({
      operation_type:
        OPERATION_TYPES.SUBMIT_APPLICATION,

      application_local_id:
        localId,

      payload:
        applicationData,

      status:
        "PENDING",
    });

    return {
      ...localApplication,

      offline:
        true,

      pending_sync:
        true,
    };
  }

  /*
   * Try the server immediately.
   */
  try {
    const serverApplication =
      await submitApplicationToServer(
        applicationData
      );

    const serverId =
      getServerApplicationId(
        serverApplication
      );

    if (!serverId) {
      throw new Error(
        "The application was submitted, but the server did not return an application ID."
      );
    }

    const synced =
      normaliseApplication(
        {
          ...localApplication,

          ...serverApplication,

          local_id:
            localId,

          server_id:
            serverId,

          sync_state:
            "SYNCED",

          sync_error:
            null,

          offline_pending_sync:
            false,

          updated_at:
            new Date().toISOString(),
        },
        localId
      );

    await saveApplication(
      synced
    );

    /*
     * If documents were captured before the application
     * received its server ID, prepare them for upload now.
     *
     * The upload token is taken only from the server response.
     */
    await preparePendingDocumentsForApplication(
      localId,
      serverId,
      serverApplication?.upload_token ||
        null
    );

    return synced;
  } catch (error) {
    if (isNetworkError(error)) {
      await enqueueOperation({
        operation_type:
          OPERATION_TYPES.SUBMIT_APPLICATION,

        application_local_id:
          localId,

        payload:
          applicationData,

        status:
          "PENDING",
      });

      await saveApplication({
        ...localApplication,

        sync_state:
          "PENDING",

        sync_error:
          "Waiting for an internet connection.",

        offline_pending_sync:
          true,

        updated_at:
          new Date().toISOString(),
      });

      return {
        ...localApplication,

        offline:
          true,

        pending_sync:
          true,
      };
    }

    throw error;
  }
}

/* ============================================================
   OFFLINE DOCUMENT STORAGE
============================================================ */

export async function saveApplicationDocumentOffline({
  applicationLocalId,
  applicationServerId = null,
  uploadToken = null,
  documentType,
  file,
}) {
  if (!applicationLocalId) {
    throw new Error(
      "Application ID is required."
    );
  }

  if (!documentType) {
    throw new Error(
      "Document type is required."
    );
  }

  if (!file) {
    throw new Error(
      "A document file is required."
    );
  }

  const document =
    await saveApplicationDocument({
      application_local_id:
        applicationLocalId,

      application_server_id:
        applicationServerId,

      upload_token:
        uploadToken,

      document_type:
        documentType,

      document_name:
        file.name,

      mime_type:
        file.type || null,

      file_size_bytes:
        file.size || 0,

      file,

      sync_state:
        "PENDING",

      sync_error:
        null,
    });

  /*
   * If the application already has a server ID and
   * upload token, queue the document immediately.
   *
   * Otherwise it remains in IndexedDB until the
   * application submission supplies those values.
   */
  if (
    applicationServerId &&
    uploadToken
  ) {
    await enqueueOperation({
      operation_type:
        OPERATION_TYPES.UPLOAD_DOCUMENT,

      application_local_id:
        applicationLocalId,

      application_server_id:
        applicationServerId,

      document_local_id:
        document.local_id,

      status:
        "PENDING",
    });
  }

  return document;
}

/* ============================================================
   PREPARE DOCUMENTS AFTER APPLICATION SYNC
============================================================ */

async function preparePendingDocumentsForApplication(
  applicationLocalId,
  applicationServerId,
  uploadToken
) {
  if (
    !applicationLocalId ||
    !applicationServerId
  ) {
    return;
  }

  const documents =
    await getApplicationDocuments(
      applicationLocalId
    );

  if (!documents?.length) {
    return;
  }

  /*
   * If the server did not return a token, retain the
   * documents locally. We never manufacture one.
   */
  if (!uploadToken) {
    for (
      const document
      of documents
    ) {
      if (
        document.sync_state !==
        "SYNCED"
      ) {
        await updateApplicationDocument(
          document.local_id,
          {
            application_server_id:
              applicationServerId,

            sync_state:
              "PENDING",

            sync_error:
              "Waiting for the application upload token.",
          }
        );
      }
    }

    return;
  }

  for (
    const document
    of documents
  ) {
    if (
      document.sync_state ===
      "SYNCED"
    ) {
      continue;
    }

    const updated =
      await updateApplicationDocument(
        document.local_id,
        {
          application_server_id:
            applicationServerId,

          upload_token:
            uploadToken,

          sync_state:
            "PENDING",

          sync_error:
            null,
        }
      );

    if (!updated) {
      continue;
    }

    /*
     * Queue only the document reference.
     *
     * The actual File remains in IndexedDB and is retrieved
     * when the queue operation is processed.
     */
    await enqueueOperation({
      operation_type:
        OPERATION_TYPES.UPLOAD_DOCUMENT,

      application_local_id:
        applicationLocalId,

      application_server_id:
        applicationServerId,

      document_local_id:
        document.local_id,

      status:
        "PENDING",
    });
  }
}

/* ============================================================
   PUBLIC DOCUMENT UPLOAD
============================================================ */

export async function uploadPublicApplicationDocument({
  applicationId,
  uploadToken,
  documentType,
  file,
}) {
  if (!applicationId) {
    throw new Error(
      "Application ID is required."
    );
  }

  if (!documentType) {
    throw new Error(
      "Document type is required."
    );
  }

  if (!file) {
    throw new Error(
      "A document file is required."
    );
  }

  if (!uploadToken) {
    throw new Error(
      "An application upload token is required before the document can be uploaded."
    );
  }

  if (!isBrowserOnline()) {
    throw new Error(
      "There is no internet connection. The document has been retained locally and will be uploaded when synchronization is available."
    );
  }

  const formData =
    new FormData();

  formData.append(
    "application_id",
    applicationId
  );

  formData.append(
    "upload_token",
    uploadToken
  );

  formData.append(
    "document_type",
    documentType
  );

  formData.append(
    "file",
    file
  );

  const {
    data,
    error,
  } =
    await supabase.functions.invoke(
      "public-application-upload",
      {
        body:
          formData,
      }
    );

  /*
   * Supabase FunctionsHttpError contains the actual
   * Edge Function response in error.context.
   *
   * Preserve that response so synchronization does not
   * hide the real server-side reason for a 4xx/5xx error.
   */
  if (error) {
    let serverMessage = null;

    try {
      if (
        error.context &&
        typeof error.context.json ===
          "function"
      ) {
        const responseBody =
          await error.context.json();

        serverMessage =
          responseBody?.error ||
          responseBody?.message ||
          null;
      }
    } catch {
      /*
       * If the response body cannot be read,
       * retain the original Supabase error.
       */
    }

    throw new Error(
      serverMessage ||
        error.message ||
        "The supporting document upload failed."
    );
  }

  if (!data?.success) {
    throw new Error(
      data?.error ||
        "The supporting document could not be uploaded."
    );
  }

  return data;
}

/* ============================================================
   APPLICATION DOCUMENTS
============================================================ */

export async function getLoanApplicationDocuments(
  applicationId
) {
  if (!applicationId) {
    return [];
  }

  /*
   * First try treating the supplied value as a local ID.
   */
  let localApplication =
    await getApplication(
      applicationId
    );

  /*
   * If that failed, treat it as a server application ID.
   */
  if (!localApplication) {
    localApplication =
      await findApplicationByServerId(
        applicationId
      );
  }

  let local = [];

  if (
    localApplication?.local_id
  ) {
    local =
      await getApplicationDocuments(
        localApplication.local_id
      );
  }

  if (!isBrowserOnline()) {
    return local;
  }

  const serverApplicationId =
    getServerApplicationId(
      localApplication
    ) ||
    applicationId;

  const {
    data,
    error,
  } = await supabase
    .from("documents")
    .select("*")
    .eq(
      "loan_application_id",
      serverApplicationId
    )
    .order(
      "created_at",
      {
        ascending:
          false,
      }
    );

  if (error) {
    return local;
  }

  return [
    ...(data || []),
    ...local,
  ];
}

/* ============================================================
   GET APPLICATIONS
============================================================ */

export async function getLoanApplications() {
  if (!isBrowserOnline()) {
    return getAllApplications();
  }

  try {
    const {
      data,
      error,
    } = await supabase
      .from(
        "loan_applications"
      )
      .select("*")
      .order(
        "created_at",
        {
          ascending:
            false,
        }
      );

    if (error) {
      throw error;
    }

    const serverApplications =
      data || [];

    const localApplications =
      await getAllApplications();

    const byServerId =
      new Map();

    for (
      const application
      of serverApplications
    ) {
      byServerId.set(
        application.id,
        normaliseApplication(
          application
        )
      );
    }

    for (
      const local
      of localApplications
    ) {
      if (
        local.server_id &&
        byServerId.has(
          local.server_id
        )
      ) {
        const server =
          byServerId.get(
            local.server_id
          );

        byServerId.set(
          local.server_id,
          {
            ...server,

            local_id:
              local.local_id,

            sync_state:
              local.sync_state ||
              "SYNCED",

            sync_error:
              local.sync_error ||
              null,

            offline_pending_sync:
              local.offline_pending_sync ||
              false,
          }
        );
      } else if (
        local.sync_state ===
        "PENDING"
      ) {
        byServerId.set(
          local.local_id,
          local
        );
      }
    }

    const merged =
      Array.from(
        byServerId.values()
      ).sort(
        (a, b) =>
          new Date(
            b.created_at ||
              b.updated_at ||
              0
          ).getTime() -
          new Date(
            a.created_at ||
              a.updated_at ||
              0
          ).getTime()
      );

    for (
      const application
      of merged
    ) {
      await saveApplication(
        application
      );
    }

    return merged;
  } catch (error) {
    if (
      isNetworkError(
        error
      )
    ) {
      return getAllApplications();
    }

    throw error;
  }
}

/* ============================================================
   GET SINGLE APPLICATION
============================================================ */

export async function getLoanApplication(
  id
) {
  if (!id) {
    throw new Error(
      "Application ID is required."
    );
  }

  const local =
    await getApplication(
      id
    );

  if (!isBrowserOnline()) {
    if (local) {
      return local;
    }

    const cached =
      await findApplicationByServerId(
        id
      );

    if (cached) {
      return cached;
    }

    throw new Error(
      "This application is not available offline."
    );
  }

  try {
    const {
      data,
      error,
    } =
      await supabase
        .from(
          "loan_applications"
        )
        .select("*")
        .eq(
          "id",
          id
        )
        .single();

    if (error) {
      throw error;
    }

    const saved =
      normaliseApplication(
        {
          ...data,

          server_id:
            data.id,

          sync_state:
            "SYNCED",

          sync_error:
            null,

          offline_pending_sync:
            false,
        }
      );

    await saveApplication(
      saved
    );

    return saved;
  } catch (error) {
    if (
      isNetworkError(
        error
      )
    ) {
      if (local) {
        return local;
      }

      const cached =
        await findApplicationByServerId(
          id
        );

      if (cached) {
        return cached;
      }
    }

    throw error;
  }
}

/* ============================================================
   APPROVE APPLICATION
============================================================ */

export async function approveLoanApplication(
  applicationId,
  approvedBy
) {
  if (!applicationId) {
    throw new Error(
      "Application ID is required."
    );
  }

  if (!approvedBy) {
    throw new Error(
      "Approving user ID is required."
    );
  }

  /*
   * An application captured completely offline does not yet
   * have a server ID. It cannot be approved until submission
   * synchronization has created the server application.
   */
  const local =
    await resolveLocalApplication(
      applicationId
    );

  const serverId =
    getServerApplicationId(
      local
    ) ||
    applicationId;

  if (
    !isBrowserOnline()
  ) {
    if (!local?.server_id) {
      throw new Error(
        "This application must synchronize with the server before it can be approved."
      );
    }

    await saveApplication({
      ...local,

      sync_state:
        "PENDING",

      sync_error:
        "Approval is waiting for an internet connection.",

      offline_pending_sync:
        true,

      updated_at:
        new Date().toISOString(),
    });

    await enqueueOperation({
      operation_type:
        OPERATION_TYPES.APPROVE_APPLICATION,

      application_id:
        serverId,

      approved_by:
        approvedBy,

      status:
        "PENDING",
    });

    return {
      queued:
        true,

      pending_sync:
        true,

      application_id:
        serverId,
    };
  }

  try {
    const {
      data,
      error,
    } =
      await supabase.rpc(
        "approve_loan_application",
        {
          p_application_id:
            serverId,

          p_approved_by:
            approvedBy,
        }
      );

    if (error) {
      throw error;
    }

    const result =
      extractRpcResult(
        data
      );

    const cached =
      await findApplicationByServerId(
        serverId
      );

    if (cached) {
      await saveApplication({
        ...cached,

        ...result,

        server_id:
          serverId,

        status:
          "APPROVED",

        sync_state:
          "SYNCED",

        sync_error:
          null,

        offline_pending_sync:
          false,

        updated_at:
          new Date().toISOString(),
      });
    }

    return result;
  } catch (error) {
    if (
      isNetworkError(
        error
      )
    ) {
      const cached =
        await findApplicationByServerId(
          serverId
        );

      if (cached) {
        await saveApplication({
          ...cached,

          sync_state:
            "PENDING",

          sync_error:
            "Approval is waiting for an internet connection.",

          offline_pending_sync:
            true,

          updated_at:
            new Date().toISOString(),
        });
      }

      await enqueueOperation({
        operation_type:
          OPERATION_TYPES.APPROVE_APPLICATION,

        application_id:
          serverId,

        approved_by:
          approvedBy,

        status:
          "PENDING",
      });

      return {
        queued:
          true,

        pending_sync:
          true,

        application_id:
          serverId,
      };
    }

    throw error;
  }
}

/* ============================================================
   REJECT APPLICATION
============================================================ */

export async function rejectLoanApplication(
  applicationId,
  rejectedBy,
  rejectionReason
) {
  if (!applicationId) {
    throw new Error(
      "Application ID is required."
    );
  }

  if (!rejectedBy) {
    throw new Error(
      "Rejecting user ID is required."
    );
  }

  if (!rejectionReason?.trim()) {
    throw new Error(
      "A rejection reason is required."
    );
  }

  const local =
    await resolveLocalApplication(
      applicationId
    );

  const serverId =
    getServerApplicationId(
      local
    ) ||
    applicationId;

  if (
    !isBrowserOnline()
  ) {
    if (!local?.server_id) {
      throw new Error(
        "This application must synchronize with the server before it can be rejected."
      );
    }

    await saveApplication({
      ...local,

      sync_state:
        "PENDING",

      sync_error:
        "Rejection is waiting for an internet connection.",

      offline_pending_sync:
        true,

      updated_at:
        new Date().toISOString(),
    });

    await enqueueOperation({
      operation_type:
        OPERATION_TYPES.REJECT_APPLICATION,

      application_id:
        serverId,

      rejected_by:
        rejectedBy,

      rejection_reason:
        rejectionReason.trim(),

      status:
        "PENDING",
    });

    return {
      queued:
        true,

      pending_sync:
        true,

      application_id:
        serverId,
    };
  }

  try {
    const {
      data,
      error,
    } =
      await supabase.rpc(
        "reject_loan_application",
        {
          p_application_id:
            serverId,

          p_rejected_by:
            rejectedBy,

          p_rejection_reason:
            rejectionReason.trim(),
        }
      );

    if (error) {
      throw error;
    }

    const result =
      extractRpcResult(
        data
      );

    const cached =
      await findApplicationByServerId(
        serverId
      );

    if (cached) {
      await saveApplication({
        ...cached,

        ...result,

        server_id:
          serverId,

        status:
          "REJECTED",

        rejection_reason:
          rejectionReason.trim(),

        sync_state:
          "SYNCED",

        sync_error:
          null,

        offline_pending_sync:
          false,

        updated_at:
          new Date().toISOString(),
      });
    }

    return result;
  } catch (error) {
    if (
      isNetworkError(
        error
      )
    ) {
      const cached =
        await findApplicationByServerId(
          serverId
        );

      if (cached) {
        await saveApplication({
          ...cached,

          sync_state:
            "PENDING",

          sync_error:
            "Rejection is waiting for an internet connection.",

          offline_pending_sync:
            true,

          updated_at:
            new Date().toISOString(),
        });
      }

      await enqueueOperation({
        operation_type:
          OPERATION_TYPES.REJECT_APPLICATION,

        application_id:
          serverId,

        rejected_by:
          rejectedBy,

        rejection_reason:
          rejectionReason.trim(),

        status:
          "PENDING",
      });

      return {
        queued:
          true,

        pending_sync:
          true,

        application_id:
          serverId,
      };
    }

    throw error;
  }
}

/* ============================================================
   STATUS UPDATE
============================================================ */

export async function updateLoanApplicationStatus(
  id,
  status,
  rejectionReason = null
) {
  if (
    status === "APPROVED" ||
    status === "REJECTED"
  ) {
    throw new Error(
      "Approved and rejected applications must use the corresponding server approval or rejection operation."
    );
  }

  if (!id) {
    throw new Error(
      "Application ID is required."
    );
  }

  const local =
    await resolveLocalApplication(
      id
    );

  const serverId =
    getServerApplicationId(
      local
    ) ||
    id;

  if (!isBrowserOnline()) {
    if (!local?.server_id) {
      throw new Error(
        "This application must synchronize with the server before its status can be changed."
      );
    }

    await saveApplication({
      ...local,

      status,

      rejection_reason:
        rejectionReason,

      sync_state:
        "PENDING",

      sync_error:
        "Status change is waiting for an internet connection.",

      offline_pending_sync:
        true,

      updated_at:
        new Date().toISOString(),
    });

    await enqueueOperation({
      operation_type:
        OPERATION_TYPES.UPDATE_APPLICATION_STATUS,

      application_id:
        serverId,

      status_value:
        status,

      rejection_reason:
        rejectionReason,

      status:
        "PENDING",
    });

    return {
      queued:
        true,

      pending_sync:
        true,

      application_id:
        serverId,
    };
  }

  try {
    const {
      data,
      error,
    } =
      await supabase
        .from(
          "loan_applications"
        )
        .update({
          status,

          rejection_reason:
            rejectionReason,
        })
        .eq(
          "id",
          serverId
        )
        .select()
        .single();

    if (error) {
      throw error;
    }

    const saved =
      normaliseApplication(
        {
          ...data,

          server_id:
            data.id,

          sync_state:
            "SYNCED",

          sync_error:
            null,

          offline_pending_sync:
            false,
        }
      );

    await saveApplication(
      saved
    );

    return saved;
  } catch (error) {
    if (
      isNetworkError(
        error
      )
    ) {
      if (local) {
        await saveApplication({
          ...local,

          status,

          rejection_reason:
            rejectionReason,

          sync_state:
            "PENDING",

          sync_error:
            "Status change is waiting for an internet connection.",

          offline_pending_sync:
            true,

          updated_at:
            new Date().toISOString(),
        });
      }

      await enqueueOperation({
        operation_type:
          OPERATION_TYPES.UPDATE_APPLICATION_STATUS,

        application_id:
          serverId,

        status_value:
          status,

        rejection_reason:
          rejectionReason,

        status:
          "PENDING",
      });

      return {
        queued:
          true,

        pending_sync:
          true,

        application_id:
          serverId,
      };
    }

    throw error;
  }
}

/* ============================================================
   DELETE
============================================================ */

export async function deleteLoanApplication(
  id
) {
  if (!id) {
    throw new Error(
      "Application ID is required."
    );
  }

  if (!isBrowserOnline()) {
    throw new Error(
      "Applications cannot be deleted while offline."
    );
  }

  const {
    error,
  } =
    await supabase
      .from(
        "loan_applications"
      )
      .delete()
      .eq(
        "id",
        id
      );

  if (error) {
    throw error;
  }
}

/* ============================================================
   SYNC SUBMISSION
============================================================ */

async function synchronizeSubmission(
  operation
) {
  const payload =
    operation.payload;

  const result =
    await submitApplicationToServer(
      payload
    );

  const serverId =
    getServerApplicationId(
      result
    );

  if (!serverId) {
    throw new Error(
      "The server did not return an application ID."
    );
  }

  const local =
    operation.application_local_id
      ? await getApplication(
          operation.application_local_id
        )
      : null;

  const uploadToken =
    result?.upload_token ||
    null;

  const synced =
    normaliseApplication(
      {
        ...(local || {}),
        ...result,

        local_id:
          operation.application_local_id,

        server_id:
          serverId,

        upload_token:
          uploadToken,

        sync_state:
          "SYNCED",

        sync_error:
          null,

        offline_pending_sync:
          false,

        updated_at:
          new Date().toISOString(),
      },
      operation.application_local_id
    );

  await saveApplication(
    synced
  );

  /*
   * The submit RPC response is the authoritative source
   * for the public application upload token.
   *
   * This also prepares every document captured while the
   * application was offline.
   */
  await preparePendingDocumentsForApplication(
    operation.application_local_id,
    serverId,
    uploadToken
  );

  return synced;
}

/* ============================================================
   SYNC APPROVAL
============================================================ */

async function synchronizeApproval(
  operation
) {
  const {
    data,
    error,
  } =
    await supabase.rpc(
      "approve_loan_application",
      {
        p_application_id:
          operation.application_id,

        p_approved_by:
          operation.approved_by,
      }
    );

  if (error) {
    throw error;
  }

  const result =
    extractRpcResult(
      data
    );

  const local =
    await findApplicationByServerId(
      operation.application_id
    );

  if (local) {
    await saveApplication({
      ...local,

      ...result,

      server_id:
        operation.application_id,

      status:
        "APPROVED",

      sync_state:
        "SYNCED",

      sync_error:
        null,

      offline_pending_sync:
        false,

      updated_at:
        new Date().toISOString(),
    });
  }

  return result;
}

/* ============================================================
   SYNC REJECTION
============================================================ */

async function synchronizeRejection(
  operation
) {
  const {
    data,
    error,
  } =
    await supabase.rpc(
      "reject_loan_application",
      {
        p_application_id:
          operation.application_id,

        p_rejected_by:
          operation.rejected_by,

        p_rejection_reason:
          operation.rejection_reason,
      }
    );

  if (error) {
    throw error;
  }

  const result =
    extractRpcResult(
      data
    );

  const local =
    await findApplicationByServerId(
      operation.application_id
    );

  if (local) {
    await saveApplication({
      ...local,

      ...result,

      server_id:
        operation.application_id,

      status:
        "REJECTED",

      rejection_reason:
        operation.rejection_reason,

      sync_state:
        "SYNCED",

      sync_error:
        null,

      offline_pending_sync:
        false,

      updated_at:
        new Date().toISOString(),
    });
  }

  return result;
}

/* ============================================================
   SYNC STATUS UPDATE
============================================================ */

async function synchronizeStatusUpdate(
  operation
) {
  const {
    data,
    error,
  } =
    await supabase
      .from(
        "loan_applications"
      )
      .update({
        status:
          operation.status_value,

        rejection_reason:
          operation.rejection_reason ||
          null,
      })
      .eq(
        "id",
        operation.application_id
      )
      .select()
      .single();

  if (error) {
    throw error;
  }

  const saved =
    normaliseApplication(
      {
        ...data,

        server_id:
          data.id,

        sync_state:
          "SYNCED",

        sync_error:
          null,

        offline_pending_sync:
          false,
      }
    );

  await saveApplication(
    saved
  );

  return saved;
}

/* ============================================================
   SYNC DOCUMENT
============================================================ */

async function synchronizeDocument(
  operation
) {
  const applicationLocalId =
    operation.application_local_id ||
    null;

  /*
   * The queue stores the document local ID.
   * Retrieve the actual document, including its File,
   * from IndexedDB.
   */
  let document =
    await getStoredApplicationDocument(
      applicationLocalId,
      operation.document_local_id
    );

  /*
   * Backward compatibility for any queue entry created
   * by the previous implementation that still contains
   * a complete document payload.
   */
  if (!document) {
    document =
      operation.document ||
      null;
  }

  if (!document) {
    throw new Error(
      "The associated document could not be found."
    );
  }

  if (!document.file) {
    throw new Error(
      "The offline document file is missing."
    );
  }

  /*
   * Resolve the application from IndexedDB so the latest
   * server ID and upload token are used.
   */
  const application =
    await resolveLocalApplication(
      applicationLocalId ||
        operation.application_server_id
    );

  const applicationServerId =
    document.application_server_id ||
    operation.application_server_id ||
    getServerApplicationId(
      application
    );

  if (!applicationServerId) {
    throw new Error(
      "The application has not received a server ID yet."
    );
  }

  const uploadToken =
    document.upload_token ||
    application?.upload_token ||
    operation.upload_token ||
    null;

  if (!uploadToken) {
    throw new Error(
      "The server upload token is not available for this document yet."
    );
  }

  /*
   * Keep the locally stored document synchronized with the
   * authoritative server application ID/token before upload.
   */
  if (
    document.local_id
  ) {
    await updateApplicationDocument(
      document.local_id,
      {
        application_server_id:
          applicationServerId,

        upload_token:
          uploadToken,

        sync_state:
          "PENDING",

        sync_error:
          null,
      }
    );
  }

  const result =
    await uploadPublicApplicationDocument({
      applicationId:
        applicationServerId,

      uploadToken:
        uploadToken,

      documentType:
        document.document_type,

      file:
        document.file,
    });

  /*
   * Only mark the local document as synchronized after
   * the Edge Function confirms successful registration.
   */
  if (
    document.local_id
  ) {
    await updateApplicationDocument(
      document.local_id,
      {
        application_server_id:
          applicationServerId,

        upload_token:
          uploadToken,

        sync_state:
          "SYNCED",

        sync_error:
          null,

        offline_pending_sync:
          false,

        server_document_id:
          result?.document_id ||
          null,

        document_path:
          result?.document_path ||
          null,
      }
    );
  }

  return result;
}

/* ============================================================
   PROCESS ONE OPERATION
============================================================ */

async function processOperation(
  operation
) {
  switch (
    operation.operation_type
  ) {
    case OPERATION_TYPES.SUBMIT_APPLICATION:
      return synchronizeSubmission(
        operation
      );

    case OPERATION_TYPES.APPROVE_APPLICATION:
      return synchronizeApproval(
        operation
      );

    case OPERATION_TYPES.REJECT_APPLICATION:
      return synchronizeRejection(
        operation
      );

    case OPERATION_TYPES.UPDATE_APPLICATION_STATUS:
      return synchronizeStatusUpdate(
        operation
      );

    case OPERATION_TYPES.UPLOAD_DOCUMENT:
      return synchronizeDocument(
        operation
      );

    default:
      throw new Error(
        `Unknown application synchronization operation: ${operation.operation_type}`
      );
  }
}

/* ============================================================
   SYNCHRONIZE
============================================================ */

export async function syncPendingApplicationOperations() {
  if (
    synchronizationRunning
  ) {
    return {
      running:
        true,

      synchronized:
        0,

      failed:
        0,

      remaining:
        await countPendingOperations(),
    };
  }

  if (!isBrowserOnline()) {
    return {
      offline:
        true,

      synchronized:
        0,

      failed:
        0,

      remaining:
        await countPendingOperations(),
    };
  }

  synchronizationRunning =
    true;

  let synchronized =
    0;

  let failed =
    0;

  try {
    await setSyncMeta(
      "sync_status",
      "SYNCING"
    );

    const operations =
      await getPendingOperations();

    /*
     * Operations are processed in creation order.
     *
     * This is important because an offline application
     * submission must create the server application before
     * its document upload operations can succeed.
     */
    for (
      const operation
      of operations
    ) {
      if (!isBrowserOnline()) {
        break;
      }

      const attempts =
        Number(
          operation.attempts
        ) || 0;

      if (
        attempts >=
        MAX_QUEUE_ATTEMPTS
      ) {
        await updateOperation(
          operation.id,
          {
            status:
              "FAILED",

            error:
              "Maximum synchronization attempts reached.",
          }
        );

        failed += 1;

        continue;
      }

      /*
       * We increment the attempt while processing.
       *
       * If the operation turns out to be waiting for a
       * dependency, the original attempt count is restored
       * below so dependency waits do not consume attempts.
       */
      await updateOperation(
        operation.id,
        {
          status:
            "PROCESSING",

          attempts:
            attempts + 1,

          error:
            null,
        }
      );

      try {
        await processOperation(
          operation
        );

        await removeOperation(
          operation.id
        );

        synchronized += 1;
      } catch (error) {
        const network =
          isNetworkError(
            error
          );

        const dependency =
          isSynchronizationDependencyError(
            error
          );

        if (dependency) {
          /*
           * Dependency errors are not failures.
           *
           * Keep the operation pending and restore the
           * previous attempt count.
           */
          await updateOperation(
            operation.id,
            {
              status:
                "PENDING",

              attempts:
                attempts,

              error:
                error?.message ||
                "Waiting for a synchronization dependency.",
            }
          );

          continue;
        }

        await updateOperation(
          operation.id,
          {
            status:
              network
                ? "PENDING"
                : attempts + 1 >=
                  MAX_QUEUE_ATTEMPTS
                ? "FAILED"
                : "PENDING",

            error:
              error?.message ||
              "Synchronization failed.",
          }
        );

        failed += 1;

        if (network) {
          break;
        }
      }
    }

    const remaining =
      await countPendingOperations();

    await setSyncMeta(
      "last_sync_at",
      new Date().toISOString()
    );

    await setSyncMeta(
      "sync_status",
      remaining > 0
        ? "PENDING"
        : "SYNCED"
    );

    return {
      synchronized,

      failed,

      remaining,
    };
  } finally {
    synchronizationRunning =
      false;
  }
}

/* ============================================================
   MANUAL SYNC
============================================================ */

export async function syncApplicationsNow() {
  if (!isBrowserOnline()) {
    throw new Error(
      "There is no internet connection."
    );
  }

  return syncPendingApplicationOperations();
}

/* ============================================================
   QUEUE INFORMATION
============================================================ */

export async function getPendingApplicationSyncCount() {
  return countPendingOperations();
}

export async function getPendingApplicationSyncQueue() {
  return getPendingOperations();
}

export function isApplicationServiceOnline() {
  return isBrowserOnline();
}

export async function getApplicationSyncStatus() {
  const count =
    await countPendingOperations();

  const status =
    await getSyncMeta(
      "sync_status"
    );

  const lastSync =
    await getSyncMeta(
      "last_sync_at"
    );

  return {
    online:
      isBrowserOnline(),

    pending:
      count,

    status:
      status ||
      (count > 0
        ? "PENDING"
        : "SYNCED"),

    last_sync_at:
      lastSync,
  };
}

/* ============================================================
   AUTOMATIC SYNCHRONIZATION
============================================================ */

let listenersRegistered =
  false;

function registerSynchronizationListeners() {
  if (
    listenersRegistered ||
    typeof window ===
      "undefined"
  ) {
    return;
  }

  listenersRegistered =
    true;

  window.addEventListener(
    "online",
    () => {
      syncPendingApplicationOperations().catch(
        (error) => {
          console.error(
            "Automatic application synchronization failed:",
            error
          );
        }
      );
    }
  );

  window.addEventListener(
    "visibilitychange",
    () => {
      if (
        document.visibilityState ===
        "visible"
      ) {
        syncPendingApplicationOperations().catch(
          (error) => {
            console.error(
              "Application synchronization failed:",
              error
            );
          }
        );
      }
    }
  );

  window.addEventListener(
    "focus",
    () => {
      syncPendingApplicationOperations().catch(
        (error) => {
          console.error(
            "Application synchronization failed:",
            error
          );
        }
      );
    }
  );

  if (isBrowserOnline()) {
    syncPendingApplicationOperations().catch(
      (error) => {
        console.error(
          "Initial application synchronization failed:",
          error
        );
      }
    );
  }
}

registerSynchronizationListeners();

/* ============================================================
   DEFAULT EXPORT
============================================================ */

const applicationService = {
  addLoanApplication,

  saveApplicationDocumentOffline,
  uploadPublicApplicationDocument,

  getLoanApplicationDocuments,

  getLoanApplications,
  getLoanApplication,

  approveLoanApplication,
  rejectLoanApplication,

  updateLoanApplicationStatus,
  deleteLoanApplication,

  syncPendingApplicationOperations,
  syncApplicationsNow,

  getPendingApplicationSyncCount,
  getPendingApplicationSyncQueue,
  getApplicationSyncStatus,

  isApplicationServiceOnline,
};

export default applicationService;