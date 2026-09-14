import { readStoredStringList } from "./storage";
import { parseTrackedTransaction, readPendingTransactions, savePendingTransactions, type TrackedTransaction } from "./transactions";

type TestStorage = Storage & { raw: string | null };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function createStorage(initial: string | null): TestStorage {
  let raw = initial;
  return {
    get raw() { return raw; },
    get length() { return raw === null ? 0 : 1; },
    clear() { raw = null; },
    getItem() { return raw; },
    key() { return null; },
    removeItem() { raw = null; },
    setItem(_key, value) { raw = value; },
  } as TestStorage;
}

const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

function installStorage(initial: string | null): TestStorage {
  const storage = createStorage(initial);
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage, sessionStorage: storage },
  });
  return storage;
}

function restoreWindow() {
  if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
  else Reflect.deleteProperty(globalThis, "window");
}

const validTxId = `0x${"a".repeat(64)}`;
const validTransaction: TrackedTransaction = {
  txId: validTxId,
  action: "place_bet",
  timestamp: 1_700_000_000_000,
  stage: "SUBMITTED",
  marketId: 1,
};

function testTransactionStorage() {
  for (const raw of ["{", "undefined", "null", "{}", "hello", "123", "true"]) {
    const storage = installStorage(raw);
    assert(readPendingTransactions().length === 0, `invalid transaction JSON was accepted: ${raw}`);
    assert(storage.raw === null, `invalid transaction JSON was not removed: ${raw}`);
  }

  const emptyStorage = installStorage("[]");
  assert(readPendingTransactions().length === 0, "empty transaction list failed");
  assert(emptyStorage.raw === "[]", "empty transaction list was not normalized");

  for (const raw of [
    JSON.stringify([{}]),
    JSON.stringify([{ txId: validTxId }]),
    JSON.stringify([{ hash: validTxId, method: "place_bet", status: "SUBMITTED", createdAt: 1_700_000_000_000 }]),
    JSON.stringify([{ ...validTransaction, timestamp: { type: "bigint", value: "1" } }]),
  ]) {
    const storage = installStorage(raw);
    assert(readPendingTransactions().length === 0, "malformed transaction entry was accepted");
    assert(storage.raw === "[]", "malformed transaction entry was not discarded");
  }

  const normalizedStorage = installStorage(JSON.stringify([{ ...validTransaction, stage: "PROCESSING" }]));
  const normalized = readPendingTransactions();
  assert(normalized.length === 1 && normalized[0].stage === "WAITING_FOR_DECISION", "legacy stage was not normalized");
  assert(normalizedStorage.raw?.includes("WAITING_FOR_DECISION") === true, "normalized transaction was not persisted");

  const validStorage = installStorage(JSON.stringify([validTransaction]));
  const restored = readPendingTransactions();
  assert(restored.length === 1 && restored[0].txId === validTxId && restored[0].marketId === 1, "valid transaction was not restored");
  assert(parseTrackedTransaction({ ...validTransaction, timestamp: 1n }) === undefined, "BigInt timestamp was accepted");
  savePendingTransactions([{ ...validTransaction, timestamp: 1n } as unknown as typeof validTransaction]);
  assert(validStorage.raw === "[]", "BigInt-incompatible transaction was persisted");
  savePendingTransactions(123 as unknown as typeof validTransaction[]);
  assert(validStorage.raw === "[]", "non-array transaction state caused a write failure");

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { get localStorage(): Storage { throw new Error("storage access denied"); } },
  });
  assert(readPendingTransactions().length === 0, "storage access failure escaped the reader");
}

function testNotificationStorage() {
  for (const raw of ["{", "undefined", "null", "{}", "hello", "123", "true", JSON.stringify([{}]), JSON.stringify(["ok", 123])]) {
    const storage = installStorage(raw);
    assert(readStoredStringList("outrun.read-notifications.v1", 100).length === 0, `malformed notification state was accepted: ${raw}`);
    assert(storage.raw === null, `malformed notification state was not removed: ${raw}`);
  }

  const validStorage = installStorage(JSON.stringify(["notification-a", "notification-a", "notification-b"]));
  const readIds = readStoredStringList("outrun.read-notifications.v1", 100);
  assert(readIds.join(",") === "notification-a,notification-b", "valid notification state was not normalized");
  assert(validStorage.raw === JSON.stringify(["notification-a", "notification-b"]), "normalized notification state was not persisted");
}

try {
  testTransactionStorage();
  testNotificationStorage();
  console.log("OUTRUN storage hardening tests passed");
} finally {
  restoreWindow();
}
