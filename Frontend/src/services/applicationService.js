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

const MASKED_ID_NUMBER = "*************";

async function scrubReadableIdsFromOfflineStorage() {
  const applications = await getAllApplications();
  for (const application of applications || []) {
    const storedId = String(application?.id_number || "");
    if (storedId && storedId !== MASKED_ID_NUMBER) {
      const unsynced = !getServerApplicationId(application);
      await saveApplication({
        ...application,
        id_number: MASKED_ID_NUMBER,
        ...(unsynced
          ? {
              sync_state: "FAILED",
              sync_error: "The stored ID number was removed for privacy. Please resubmit this application while connected.",
              offline_pending_sync: false,
            }
          : {}),
      });
    }
  }

  const operations = await getPendingOperations();
  for (const operation of operations || []) {
    if (
      operation.operation_type === OPERATION_TYPES.SUBMIT_APPLICATION &&
      operation.payload?.id_number &&
      operation.payload.id_number !== MASKED_ID_NUMBER
    ) {
      await updateOperation(operation.id, {
        status: "FAILED",
        error: "The stored ID number was removed from the offline queue for privacy. Please resubmit while connected.",
        payload: {
          ...operation.payload,
          id_number: MASKED_ID_NUMBER,
        },
      });
    }
  }
}

const idScrubPromise = scrubReadableIdsFromOfflineStorage().catch((error) => {
  console.error("Unable to sanitize older offline application records:", error);
});

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
   SOUTH AFRICAN PHONE NORMALIZATION
============================================================ */

function normalizeSouthAfricanPhone(value) {
  const raw = String(value ?? "").trim();
  const digits = raw.replace(/\\D/g, "");

  // Convert international South African format (+27...) to local format (0...).
  if (digits.startsWith("27") && digits.length === 11) {
    return `0${digits.slice(2)}`;
  }

  // Already in local 10-digit format.
  if (digits.length === 10 && digits.startsWith("0")) {
    return digits;
  }

  // Return the cleaned value so the existing validator reports invalid numbers.
  return digits;
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

  const cellphone = normalizeSouthAfricanPhone(applicationData.cellphone);
  const email = String(applicationData.email || "").trim();
  const physicalAddress = String(applicationData.physical_address || "").trim();
  const workAddress = String(applicationData.work_address || "").trim();
  const workTelephone = normalizeSouthAfricanPhone(applicationData.work_telephone);

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

  if (!/^0\d{9}$/.test(cellphone)) {
    throw new Error("A valid 10-digit cellphone number starting with 0 is required.");
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("A valid email address is required.");
  }
  if (!physicalAddress) throw new Error("Physical address is required.");
  if (!workAddress) throw new Error("Work address is required.");
  if (!/^0\d{9}$/.test(workTelephone)) throw new Error("A valid 10-digit work telephone number is required.");

  const requiredExpenseCategories = [
    "Grocery", "Housing", "Clothing", "Transportation",
    "Existing Loan Repayments", "Other Expenses",
  ];
  const submittedExpenses = Array.isArray(applicationData.monthly_expenses) ? applicationData.monthly_expenses : [];
  for (const category of requiredExpenseCategories) {
    const expense = submittedExpenses.find((item) => item.category === category);
    if (!expense || expense.monthly_amount === "" || !Number.isFinite(Number(expense.monthly_amount)) || Number(expense.monthly_amount) < 0) {
      throw new Error(`A valid monthly amount is required for ${category} (enter R0 if none).`);
    }
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
    amount < 100 ||
    amount > 6000
  ) {
    throw new Error(
      "Loan amount must be between R100 and R6,000."
    );
  }

  const term = Number(applicationData.selected_term_months ?? 1);
  if (![1, 2].includes(term) || (amount < 5000 && term !== 1)) {
    throw new Error("The selected repayment term is not available for this loan amount.");
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
    work_address,
    work_telephone,
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
    selected_term_months,
  } = applicationData;

  const { data: response, error } = await supabase.functions.invoke(
    "public-customer-otp",
    {
      body: {
        action: "submit_application",
        idNumber: id_number,
        verificationToken: applicationData.verificationToken || null,
        applicationData: {
          first_name,
          last_name,
          cellphone,
          email,
          physical_address,
          work_address,
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
          selected_term_months,
        },
      },
    }
  );
  const submittedResult = response?.result;
  const submittedData = extractRpcResult(submittedResult);

  if (error) {
    throw error;
  }

  const submitted = submittedData;
  if (submitted?.application_id && submitted?.upload_token) {
    const { error: workTelephoneError } = await supabase.rpc("save_public_application_work_telephone", {
      p_application_id: submitted.application_id,
      p_upload_token: submitted.upload_token,
      p_work_telephone: work_telephone,
    });
    if (workTelephoneError) {
      throw new Error(`Application was created but work telephone could not be saved: ${workTelephoneError.message}`);
    }
  }

  const expenses = Array.isArray(applicationData.monthly_expenses)
    ? applicationData.monthly_expenses
    : [];

  if (submitted?.application_id && submitted?.upload_token) {
    const { data: expenseResult, error: expenseError } = await supabase.rpc(
      "save_public_application_expenses",
      {
        p_application_id: submitted.application_id,
        p_upload_token: submitted.upload_token,
        p_expenses: expenses,
      }
    );

    if (expenseError) {
      throw new Error(
        `Application was created but monthly expenses could not be saved: ${expenseError.message}`
      );
    }

    submitted.affordability_assessment = expenseResult?.assessment || null;
    submitted.funding_assessment = expenseResult?.funding || null;
  }

  return submitted;
}

/* ============================================================
   ADD APPLICATION
============================================================ */

export async function addLoanApplication(
  applicationData
) {
  const normalizedApplicationData = {
    ...applicationData,
    cellphone: normalizeSouthAfricanPhone(applicationData.cellphone),
    work_telephone: normalizeSouthAfricanPhone(applicationData.work_telephone),
  };

  validateApplication(normalizedApplicationData);

  if (!isBrowserOnline()) {
    throw new Error(
      "An internet connection is required to securely check the ID number and submit this application. No ID number will be saved on this device while offline."
    );
  }

  const localId =
    applicationData.local_id ||
    generateLocalId();

  const localApplication =
    normaliseApplication(
      {
        ...applicationData,

        // Never persist a readable ID number in the browser's offline database.
        id_number: "*************",

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
   * Connectivity is required for the secure ID check and submission.
   * The readable ID is never copied into IndexedDB or the sync queue.
   */
  if (!isBrowserOnline()) {
    throw new Error(
      "The connection was lost before secure submission. Reconnect and submit again; the ID number was not saved offline."
    );
  }

  /*
   * Try the server immediately.
   */
  try {
    const serverApplication =
      await submitApplicationToServer(
        normalizedApplicationData
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
      await saveApplication({
        ...localApplication,
        sync_state: "FAILED",
        sync_error: "Secure submission was interrupted. Reconnect and submit again.",
        offline_pending_sync: false,
        updated_at: new Date().toISOString(),
      });

      throw new Error(
        "The connection was lost before secure submission completed. The ID number was not saved offline; reconnect and submit again."
      );
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