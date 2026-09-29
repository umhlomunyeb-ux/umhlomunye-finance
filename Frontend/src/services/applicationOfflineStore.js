/*
 * ============================================================
 * APPLICATION OFFLINE STORE
 * ============================================================
 *
 * IndexedDB persistence for the Applications module.
 *
 * Stores:
 *   - applications
 *   - application documents
 *   - synchronization queue
 *   - synchronization metadata
 *
 * This module contains NO Supabase calls.
 * Supabase/network work belongs in applicationService.js.
 * ============================================================
 */

const DB_NAME = "umhlomunye-finance-applications";
const DB_VERSION = 1;

const STORES = {
  APPLICATIONS: "applications",
  DOCUMENTS: "application_documents",
  QUEUE: "sync_queue",
  META: "sync_meta",
};

let databasePromise = null;

/* ============================================================
   DATABASE
============================================================ */

function openDatabase() {
  if (databasePromise) {
    return databasePromise;
  }

  databasePromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(
        new Error(
          "IndexedDB is not available on this device/browser."
        )
      );
      return;
    }

    const request = indexedDB.open(
      DB_NAME,
      DB_VERSION
    );

    request.onupgradeneeded = () => {
      const db = request.result;

      if (
        !db.objectStoreNames.contains(
          STORES.APPLICATIONS
        )
      ) {
        const store = db.createObjectStore(
          STORES.APPLICATIONS,
          {
            keyPath: "local_id",
          }
        );

        store.createIndex(
          "server_id",
          "server_id",
          {
            unique: false,
          }
        );

        store.createIndex(
          "status",
          "status",
          {
            unique: false,
          }
        );

        store.createIndex(
          "updated_at",
          "updated_at",
          {
            unique: false,
          }
        );

        store.createIndex(
          "sync_state",
          "sync_state",
          {
            unique: false,
          }
        );
      }

      if (
        !db.objectStoreNames.contains(
          STORES.DOCUMENTS
        )
      ) {
        const store = db.createObjectStore(
          STORES.DOCUMENTS,
          {
            keyPath: "local_id",
          }
        );

        store.createIndex(
          "application_local_id",
          "application_local_id",
          {
            unique: false,
          }
        );

        store.createIndex(
          "application_server_id",
          "application_server_id",
          {
            unique: false,
          }
        );

        store.createIndex(
          "sync_state",
          "sync_state",
          {
            unique: false,
          }
        );

        store.createIndex(
          "document_type",
          "document_type",
          {
            unique: false,
          }
        );
      }

      if (
        !db.objectStoreNames.contains(
          STORES.QUEUE
        )
      ) {
        const store = db.createObjectStore(
          STORES.QUEUE,
          {
            keyPath: "id",
          }
        );

        store.createIndex(
          "status",
          "status",
          {
            unique: false,
          }
        );

        store.createIndex(
          "created_at",
          "created_at",
          {
            unique: false,
          }
        );

        store.createIndex(
          "operation_type",
          "operation_type",
          {
            unique: false,
          }
        );

        store.createIndex(
          "application_local_id",
          "application_local_id",
          {
            unique: false,
          }
        );
      }

      if (
        !db.objectStoreNames.contains(
          STORES.META
        )
      ) {
        db.createObjectStore(
          STORES.META,
          {
            keyPath: "key",
          }
        );
      }
    };

    request.onsuccess = () => {
      const db = request.result;

      db.onversionchange = () => {
        db.close();
        databasePromise = null;
      };

      resolve(db);
    };

    request.onerror = () => {
      reject(
        request.error ||
          new Error(
            "Unable to open the application offline database."
          )
      );
    };
  });

  return databasePromise;
}

/* ============================================================
   GENERIC HELPERS
============================================================ */

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(
        request.error ||
          new Error(
            "IndexedDB request failed."
          )
      );
    };
  });
}

function transactionToPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => {
      resolve();
    };

    transaction.onerror = () => {
      reject(
        transaction.error ||
          new Error(
            "IndexedDB transaction failed."
          )
      );
    };

    transaction.onabort = () => {
      reject(
        transaction.error ||
          new Error(
            "IndexedDB transaction was aborted."
          )
      );
    };
  });
}

function generateId(prefix = "local") {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  return `${prefix}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2)}`;
}

/* ============================================================
   APPLICATIONS
============================================================ */

export async function saveApplication(
  application
) {
  if (!application) {
    throw new Error(
      "Application data is required."
    );
  }

  const db = await openDatabase();

  const record = {
    ...application,

    local_id:
      application.local_id ||
      application.id ||
      generateId("application"),

    server_id:
      application.server_id ||
      application.id ||
      null,

    updated_at:
      application.updated_at ||
      new Date().toISOString(),

    created_at:
      application.created_at ||
      new Date().toISOString(),
  };

  const transaction = db.transaction(
    STORES.APPLICATIONS,
    "readwrite"
  );

  transaction
    .objectStore(STORES.APPLICATIONS)
    .put(record);

  await transactionToPromise(
    transaction
  );

  return record;
}

export async function getApplication(
  localId
) {
  if (!localId) {
    return null;
  }

  const db = await openDatabase();

  const transaction = db.transaction(
    STORES.APPLICATIONS,
    "readonly"
  );

  return requestToPromise(
    transaction
      .objectStore(STORES.APPLICATIONS)
      .get(localId)
  );
}

export async function getAllApplications() {
  const db = await openDatabase();

  const transaction = db.transaction(
    STORES.APPLICATIONS,
    "readonly"
  );

  const request = transaction
    .objectStore(STORES.APPLICATIONS)
    .getAll();

  const rows =
    await requestToPromise(request);

  return (rows || []).sort(
    (a, b) =>
      new Date(
        b.updated_at ||
          b.created_at ||
          0
      ).getTime() -
      new Date(
        a.updated_at ||
          a.created_at ||
          0
      ).getTime()
  );
}

export async function deleteApplication(
  localId
) {
  if (!localId) {
    return;
  }

  const db = await openDatabase();

  const transaction = db.transaction(
    STORES.APPLICATIONS,
    "readwrite"
  );

  transaction
    .objectStore(STORES.APPLICATIONS)
    .delete(localId);

  await transactionToPromise(
    transaction
  );
}

export async function findApplicationByServerId(
  serverId
) {
  if (!serverId) {
    return null;
  }

  const db = await openDatabase();

  const transaction = db.transaction(
    STORES.APPLICATIONS,
    "readonly"
  );

  const index = transaction
    .objectStore(STORES.APPLICATIONS)
    .index("server_id");

  return requestToPromise(
    index.get(serverId)
  );
}

/* ============================================================
   DOCUMENTS
============================================================ */

export async function saveApplicationDocument(
  document
) {
  if (!document) {
    throw new Error(
      "Application document data is required."
    );
  }

  const db = await openDatabase();

  const record = {
    ...document,

    local_id:
      document.local_id ||
      generateId("document"),

    application_server_id:
      document.application_server_id ||
      null,

    sync_state:
      document.sync_state ||
      "PENDING",

    sync_error:
      document.sync_error ||
      null,

    created_at:
      document.created_at ||
      new Date().toISOString(),

    updated_at:
      new Date().toISOString(),
  };

  const transaction = db.transaction(
    STORES.DOCUMENTS,
    "readwrite"
  );

  transaction
    .objectStore(STORES.DOCUMENTS)
    .put(record);

  await transactionToPromise(
    transaction
  );

  return record;
}

/*
 * Update an existing locally stored application document.
 *
 * This is used by applicationService.js when:
 *   - the offline application receives its server ID;
 *   - the upload token becomes available;
 *   - a document upload starts;
 *   - a document upload succeeds;
 *   - a document upload fails and the error must be retained.
 *
 * The actual File object is preserved unless the caller
 * explicitly supplies another value.
 */
export async function updateApplicationDocument(
  localId,
  changes = {}
) {
  if (!localId) {
    return null;
  }

  const db = await openDatabase();

  const transaction = db.transaction(
    STORES.DOCUMENTS,
    "readwrite"
  );

  const store =
    transaction.objectStore(
      STORES.DOCUMENTS
    );

  const current =
    await requestToPromise(
      store.get(localId)
    );

  if (!current) {
    await transactionToPromise(
      transaction
    );

    return null;
  }

  const updated = {
    ...current,
    ...changes,

    local_id:
      current.local_id,

    updated_at:
      new Date().toISOString(),
  };

  store.put(updated);

  await transactionToPromise(
    transaction
  );

  return updated;
}

export async function getApplicationDocuments(
  applicationLocalId
) {
  if (!applicationLocalId) {
    return [];
  }

  const db = await openDatabase();

  const transaction = db.transaction(
    STORES.DOCUMENTS,
    "readonly"
  );

  const index = transaction
    .objectStore(STORES.DOCUMENTS)
    .index("application_local_id");

  const documents =
    await requestToPromise(
      index.getAll(
        applicationLocalId
      )
    );

  return (documents || []).sort(
    (a, b) =>
      new Date(
        b.created_at || 0
      ).getTime() -
      new Date(
        a.created_at || 0
      ).getTime()
  );
}

export async function getAllPendingDocuments() {
  const db = await openDatabase();

  const transaction = db.transaction(
    STORES.DOCUMENTS,
    "readonly"
  );

  const index = transaction
    .objectStore(STORES.DOCUMENTS)
    .index("sync_state");

  return requestToPromise(
    index.getAll("PENDING")
  );
}

export async function deleteApplicationDocument(
  localId
) {
  if (!localId) {
    return;
  }

  const db = await openDatabase();

  const transaction = db.transaction(
    STORES.DOCUMENTS,
    "readwrite"
  );

  transaction
    .objectStore(STORES.DOCUMENTS)
    .delete(localId);

  await transactionToPromise(
    transaction
  );
}

/* ============================================================
   SYNC QUEUE
============================================================ */

export async function enqueueOperation(
  operation
) {
  if (!operation) {
    throw new Error(
      "Synchronization operation is required."
    );
  }

  const db = await openDatabase();

  const record = {
    ...operation,

    id:
      operation.id ||
      generateId("sync"),

    status:
      operation.status ||
      "PENDING",

    attempts:
      Number(operation.attempts) || 0,

    created_at:
      operation.created_at ||
      new Date().toISOString(),

    updated_at:
      new Date().toISOString(),
  };

  const transaction = db.transaction(
    STORES.QUEUE,
    "readwrite"
  );

  transaction
    .objectStore(STORES.QUEUE)
    .put(record);

  await transactionToPromise(
    transaction
  );

  return record;
}

export async function getPendingOperations() {
  const db = await openDatabase();

  const transaction = db.transaction(
    STORES.QUEUE,
    "readonly"
  );

  const index = transaction
    .objectStore(STORES.QUEUE)
    .index("status");

  const rows =
    await requestToPromise(
      index.getAll("PENDING")
    );

  return (rows || []).sort(
    (a, b) =>
      new Date(
        a.created_at || 0
      ).getTime() -
      new Date(
        b.created_at || 0
      ).getTime()
  );
}

export async function getAllOperations() {
  const db = await openDatabase();

  const transaction = db.transaction(
    STORES.QUEUE,
    "readonly"
  );

  const rows =
    await requestToPromise(
      transaction
        .objectStore(STORES.QUEUE)
        .getAll()
    );

  return (rows || []).sort(
    (a, b) =>
      new Date(
        a.created_at || 0
      ).getTime() -
      new Date(
        b.created_at || 0
      ).getTime()
  );
}

export async function updateOperation(
  operationId,
  changes
) {
  if (!operationId) {
    return null;
  }

  const db = await openDatabase();

  const transaction = db.transaction(
    STORES.QUEUE,
    "readwrite"
  );

  const store =
    transaction.objectStore(
      STORES.QUEUE
    );

  const current =
    await requestToPromise(
      store.get(operationId)
    );

  if (!current) {
    await transactionToPromise(
      transaction
    );

    return null;
  }

  const updated = {
    ...current,
    ...changes,
    updated_at:
      new Date().toISOString(),
  };

  store.put(updated);

  await transactionToPromise(
    transaction
  );

  return updated;
}

export async function removeOperation(
  operationId
) {
  if (!operationId) {
    return;
  }

  const db = await openDatabase();

  const transaction = db.transaction(
    STORES.QUEUE,
    "readwrite"
  );

  transaction
    .objectStore(STORES.QUEUE)
    .delete(operationId);

  await transactionToPromise(
    transaction
  );
}

export async function countPendingOperations() {
  const operations =
    await getPendingOperations();

  return operations.length;
}

/* ============================================================
   SYNCHRONIZATION META
============================================================ */

export async function setSyncMeta(
  key,
  value
) {
  const db = await openDatabase();

  const transaction = db.transaction(
    STORES.META,
    "readwrite"
  );

  transaction
    .objectStore(STORES.META)
    .put({
      key,
      value,
      updated_at:
        new Date().toISOString(),
    });

  await transactionToPromise(
    transaction
  );

  return value;
}

export async function getSyncMeta(
  key
) {
  if (!key) {
    return null;
  }

  const db = await openDatabase();

  const transaction = db.transaction(
    STORES.META,
    "readonly"
  );

  const record =
    await requestToPromise(
      transaction
        .objectStore(STORES.META)
        .get(key)
    );

  return record?.value ?? null;
}

/* ============================================================
   CLEAR APPLICATION CACHE
============================================================ */

export async function clearApplicationOfflineData() {
  const db = await openDatabase();

  const transaction = db.transaction(
    [
      STORES.APPLICATIONS,
      STORES.DOCUMENTS,
      STORES.QUEUE,
      STORES.META,
    ],
    "readwrite"
  );

  transaction
    .objectStore(STORES.APPLICATIONS)
    .clear();

  transaction
    .objectStore(STORES.DOCUMENTS)
    .clear();

  transaction
    .objectStore(STORES.QUEUE)
    .clear();

  transaction
    .objectStore(STORES.META)
    .clear();

  await transactionToPromise(
    transaction
  );
}

/* ============================================================
   EXPORT
============================================================ */

export const applicationOfflineStore = {
  saveApplication,
  getApplication,
  getAllApplications,
  deleteApplication,
  findApplicationByServerId,

  saveApplicationDocument,
  updateApplicationDocument,
  getApplicationDocuments,
  getAllPendingDocuments,
  deleteApplicationDocument,

  enqueueOperation,
  getPendingOperations,
  getAllOperations,
  updateOperation,
  removeOperation,
  countPendingOperations,

  setSyncMeta,
  getSyncMeta,

  clearApplicationOfflineData,
};

export default applicationOfflineStore;