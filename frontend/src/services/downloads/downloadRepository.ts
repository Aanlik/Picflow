import type { DownloadRepository, DownloadTask } from "./types";
const DATABASE = "picflow-customer-downloads";
const LEASE_MS = 90_000;
function unavailable(): Error {
  return new Error("LOCAL_STORAGE_UNAVAILABLE");
}

function storageFailure(error: unknown): Error {
  const cause = error as { name?: string } | null | undefined;
  // Preserve already-classified failures (and download state-machine errors).
  if (cause && typeof (cause as Error).message === "string") {
    const message = (cause as Error).message;
    if (message.startsWith("LOCAL_STORAGE_") || message === "DOWNLOAD_LEASE_LOST")
      return cause as Error;
  }
  let code = "LOCAL_STORAGE_OPERATION_FAILED";
  switch (cause?.name) {
    case "QuotaExceededError":
      code = "LOCAL_STORAGE_QUOTA_EXCEEDED";
      break;
    case "TransactionInactiveError":
    case "InvalidStateError":
      code = "LOCAL_STORAGE_TRANSACTION_INACTIVE";
      break;
    case "AbortError":
      code = "LOCAL_STORAGE_TRANSACTION_ABORTED";
      break;
    case "SecurityError":
    case "NotAllowedError":
      code = "LOCAL_STORAGE_BLOCKED";
      break;
    case "UnknownError":
      // WebKit/Safari may report this when IndexedDB rejects a record even
      // though the transaction itself was accepted. Keep it distinct from
      // quota, abort, and permission failures so support can identify it.
      code = "LOCAL_STORAGE_UNKNOWN_ERROR";
      break;
  }
  const failure = new Error(code, { cause: error });
  if (cause?.name) failure.name = cause.name;
  return failure;
}

function storageCall<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    throw storageFailure(error);
  }
}

function storageDiagnostic(error: unknown, stage: string): Error {
  const classified = storageFailure(error);
  let cause: unknown = error;
  let name = "Error";
  while (cause && typeof cause === "object") {
    const current = cause as { name?: unknown; cause?: unknown };
    if (
      typeof current.name === "string" &&
      current.name !== "Error" &&
      !current.name.startsWith("LOCAL_STORAGE_")
    ) {
      name = current.name;
      break;
    }
    cause = current.cause;
  }
  const diagnostic = new Error(classified.message, { cause: error });
  diagnostic.name = classified.name;
  Object.assign(diagnostic, { storageDiagnostic: `${stage} · ${name}` });
  return diagnostic;
}

function transactionDone(
  tx: IDBTransaction,
  requestError: () => unknown = () => undefined,
): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    const fail = () => reject(storageFailure(requestError() || tx.error));
    tx.onerror = fail;
    tx.onabort = fail;
  });
}
function result<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(storageFailure(req.error));
  });
}

function observeRequest<T>(request: IDBRequest<T>, capture: (error: unknown) => void) {
  request.addEventListener("error", () => capture(request.error), { once: true });
  return request;
}

export class IndexedDownloadRepository implements DownloadRepository {
  private opening?: Promise<IDBDatabase>;
  private open(): Promise<IDBDatabase> {
    if (!this.opening)
      this.opening = new Promise<IDBDatabase>((resolve, reject) => {
        if (typeof indexedDB === "undefined") return reject(unavailable());
        let request: IDBOpenDBRequest;
        try {
          request = indexedDB.open(DATABASE, 1);
        } catch (error) {
          reject(storageFailure(error));
          return;
        }
        let blocked = false;
        request.onupgradeneeded = () => {
          try {
            const db = request.result;
            storageCall(() => db.createObjectStore("tasks", { keyPath: "id" }));
            const chunks = storageCall(() => db.createObjectStore("chunks", {
              keyPath: ["taskId", "offset"],
            }));
            storageCall(() => chunks.createIndex("taskId", "taskId"));
          } catch (error) {
            reject(storageFailure(error));
            try { request.transaction?.abort(); } catch { /* The upgrade may already be aborting. */ }
          }
        };
        request.onerror = () => reject(storageFailure(request.error));
        request.onblocked = () => {
          blocked = true;
          reject(new Error("LOCAL_STORAGE_BLOCKED"));
        };
        request.onsuccess = () => {
          const db = request.result;
          if (blocked) {
            db.close();
            return;
          }
          db.onversionchange = () => {
            db.close();
            this.opening = undefined;
          };
          resolve(db);
        };
      }).catch((error) => {
        this.opening = undefined;
        throw error;
      });
    return this.opening!;
  }
  async list() {
    const db = await this.open();
    const request = storageCall(() =>
      db.transaction("tasks").objectStore("tasks").getAll(),
    );
    return result<DownloadTask[]>(request);
  }
  async put(task: DownloadTask) {
    const db = await this.open();
    const tx = storageCall(() => db.transaction("tasks", "readwrite"));
    let requestError: unknown;
    let semanticError: Error | undefined;
    const done = transactionDone(tx, () => requestError);
    const store = storageCall(() => tx.objectStore("tasks"));
    const request = observeRequest(storageCall(() => store.get(task.id)), (error) => { requestError = error; });
    request.onsuccess = () => {
      const current = request.result as DownloadTask | undefined;
      if (
        (current?.leaseOwner && Number(current.leaseUntil) > Date.now()) ||
        (current && current.received > task.received)
      ) {
        semanticError = new Error("DOWNLOAD_LEASE_LOST");
        tx.abort();
        return;
      }
      try {
        observeRequest(store.put(task), (error) => { requestError = error; });
      } catch (error) {
        requestError = error;
        tx.abort();
      }
    };
    try {
      await done;
    } catch (error) {
      throw semanticError || error;
    }
  }
  async claim(id: string, owner: string) {
    const db = await this.open();
    const tx = storageCall(() => db.transaction("tasks", "readwrite"));
    let requestError: unknown;
    const done = transactionDone(tx, () => requestError);
    const store = storageCall(() => tx.objectStore("tasks"));
    let allowed = false;
    const request = observeRequest(storageCall(() => store.get(id)), (error) => { requestError = error; });
    request.onsuccess = () => {
      const task = request.result as DownloadTask | undefined;
      allowed = !!task && (
        !task.leaseOwner ||
        task.leaseOwner === owner ||
        Number(task.leaseUntil) < Date.now()
      );
      if (allowed) {
        try {
          observeRequest(store.put({
            ...task,
            leaseOwner: owner,
            leaseUntil: Date.now() + LEASE_MS,
          }), (error) => { requestError = error; });
        } catch (error) {
          requestError = error;
          tx.abort();
        }
      }
    };
    await done;
    return allowed;
  }
  async renew(id: string, owner: string) {
    const db = await this.open();
    const tx = storageCall(() => db.transaction("tasks", "readwrite"));
    let requestError: unknown;
    const done = transactionDone(tx, () => requestError);
    const store = storageCall(() => tx.objectStore("tasks"));
    let allowed = false;
    const request = observeRequest(storageCall(() => store.get(id)), (error) => { requestError = error; });
    request.onsuccess = () => {
      const task = request.result as DownloadTask | undefined;
      allowed = task?.leaseOwner === owner;
      if (allowed) {
        try {
          observeRequest(store.put({ ...task, leaseUntil: Date.now() + LEASE_MS }), (error) => { requestError = error; });
        } catch (error) {
          requestError = error;
          tx.abort();
        }
      }
    };
    await done;
    return allowed;
  }
  async append(task: DownloadTask, offset: number, blob: Blob, owner: string) {
    // Store binary blocks as ArrayBuffer. Safari/WebKit's IndexedDB may reject
    // Blob serialization with UnknownError even when the transaction is valid.
    // Convert before opening the transaction so no async work can make it idle.
    let data: ArrayBuffer | undefined;
    try {
      data = blob.size > 0 ? await blob.arrayBuffer() : undefined;
    } catch (error) {
      throw storageDiagnostic(error, "append.blob.arrayBuffer");
    }
    let db: IDBDatabase;
    try {
      db = await this.open();
    } catch (error) {
      throw storageDiagnostic(error, "append.database.open");
    }
    let tx: IDBTransaction;
    try {
      tx = storageCall(() => db.transaction(["tasks", "chunks"], "readwrite"));
    } catch (error) {
      throw storageDiagnostic(error, "append.transaction.create");
    }
    let requestError: unknown;
    let requestFailureStage: string | undefined;
    let synchronousRequestError: unknown;
    let semanticError: Error | undefined;
    const done = transactionDone(tx, () => requestError);
    let store: IDBObjectStore;
    try {
      store = storageCall(() => tx.objectStore("tasks"));
    } catch (error) {
      throw storageDiagnostic(error, "append.tasks.objectStore");
    }
    let request: IDBRequest;
    try {
      request = observeRequest(
        storageCall(() => store.get(task.id)),
        (error) => {
          requestError = error;
          requestFailureStage = "append.tasks.get";
        },
      );
    } catch (error) {
      throw storageDiagnostic(error, "append.tasks.get");
    }
    request.onsuccess = () => {
      const current = request.result as DownloadTask | undefined;
      if (current?.leaseOwner !== owner || current.received !== offset) {
        semanticError = new Error("DOWNLOAD_LEASE_LOST");
        tx.abort();
        return;
      }
      try {
        // An empty append after metadata initialization is only a task
        // checkpoint; it must not create an empty chunk.
        if (data) {
          try {
            const chunkRequest = tx.objectStore("chunks").put({ taskId: task.id, offset, data });
            observeRequest(chunkRequest, (error) => {
              requestError = error;
              requestFailureStage = "append.chunks.put";
            });
          } catch (error) {
            requestFailureStage = "append.chunks.put";
            throw error;
          }
        }
        try {
          const taskRequest = store.put({
            ...task,
            leaseOwner: owner,
            leaseUntil: Date.now() + LEASE_MS,
          });
          observeRequest(taskRequest, (error) => {
            requestError = error;
            requestFailureStage = "append.tasks.put";
          });
        } catch (error) {
          requestFailureStage = "append.tasks.put";
          throw error;
        }
      } catch (error) {
        requestError = error;
        synchronousRequestError = error;
        try {
          tx.abort();
        } catch {
          // Preserve the write error if Safari has already made the transaction inactive.
        }
      }
    };
    try {
      await done;
    } catch (error) {
      if (semanticError) throw semanticError;
      throw storageDiagnostic(error, requestFailureStage || "append.transaction.commit");
    }
    if (synchronousRequestError) {
      throw storageDiagnostic(
        synchronousRequestError,
        requestFailureStage || "append.request.callback",
      );
    }
  }
  async release(task: DownloadTask, owner: string) {
    const db = await this.open();
    const tx = storageCall(() => db.transaction("tasks", "readwrite"));
    let requestError: unknown;
    const done = transactionDone(tx, () => requestError);
    const store = storageCall(() => tx.objectStore("tasks"));
    const request = observeRequest(storageCall(() => store.get(task.id)), (error) => { requestError = error; });
    request.onsuccess = () => {
      const current = request.result as DownloadTask | undefined;
      if (current?.leaseOwner === owner) {
        try {
          observeRequest(store.put({
            ...task,
            leaseOwner: undefined,
            leaseUntil: undefined,
          }), (error) => { requestError = error; });
        } catch (error) {
          requestError = error;
          tx.abort();
        }
      }
    };
    await done;
  }
  async blob(task: DownloadTask) {
    const db = await this.open();
    const request = storageCall(() => db
        .transaction("chunks")
        .objectStore("chunks")
        .index("taskId")
        .getAll(task.id));
    const chunks = await result<{
      offset: number;
      data?: ArrayBuffer;
      blob?: Blob;
    }[]>(request);
    chunks.sort((a, b) => a.offset - b.offset);
    let offset = 0;
    for (const chunk of chunks) {
      if (chunk.offset !== offset) throw new Error("LOCAL_BLOCKS_MISSING");
      const size = chunk.data?.byteLength ?? chunk.blob?.size;
      if (size === undefined) throw new Error("LOCAL_BLOCKS_MISSING");
      offset += size;
    }
    if (offset !== task.total) throw new Error("LOCAL_BLOCKS_MISSING");
    return new Blob(
      chunks.map((chunk) => chunk.data ?? chunk.blob!),
      { type: task.contentType },
    );
  }
  async clearBlocks(id: string) {
    const db = await this.open();
    const tx = storageCall(() => db.transaction("chunks", "readwrite"));
    let operationError: unknown;
    const done = transactionDone(tx, () => operationError);
    const cursor = storageCall(() => tx
      .objectStore("chunks")
      .index("taskId")
      .openKeyCursor(IDBKeyRange.only(id)));
    cursor.onsuccess = () => {
      try {
        const item = cursor.result;
        if (item) {
          storageCall(() => tx.objectStore("chunks").delete(item.primaryKey));
          storageCall(() => item.continue());
        }
      } catch (error) {
        operationError = storageFailure(error);
        try { tx.abort(); } catch { /* The transaction may already be aborting. */ }
      }
    };
    await done;
  }
  async clear(id: string) {
    const db = await this.open();
    const tx = storageCall(() => db.transaction(["tasks", "chunks"], "readwrite"));
    let operationError: unknown;
    const done = transactionDone(tx, () => operationError);
    storageCall(() => tx.objectStore("tasks").delete(id));
    const index = storageCall(() => tx.objectStore("chunks").index("taskId"));
    const cursor = storageCall(() => index.openKeyCursor(IDBKeyRange.only(id)));
    cursor.onsuccess = () => {
      try {
        const item = cursor.result;
        if (item) {
          storageCall(() => tx.objectStore("chunks").delete(item.primaryKey));
          storageCall(() => item.continue());
        }
      } catch (error) {
        operationError = storageFailure(error);
        try { tx.abort(); } catch { /* The transaction may already be aborting. */ }
      }
    };
    await done;
  }
}
