import type { TransactionHandle } from "./types";

const MAX_PENDING_TRANSACTIONS = 50;
const ACTIONS = ["create_market", "place_bet", "settle_market", "claim", "claim_refund"] as const;
export type TransactionAction = typeof ACTIONS[number];
export type TransactionStage = "PREPARING" | "AWAITING_WALLET" | "SUBMITTING" | "SUBMITTED" | "WAITING_FOR_DECISION" | "DECIDED" | "WAITING_FOR_FINALIZATION" | "FINALIZED_SUCCESS" | "FINALIZED_ERROR" | "PRE_SUBMISSION_ERROR" | "TRACKING_ERROR";
export interface TrackedTransaction { txId: string; action: TransactionHandle["action"]; marketId?: number; timestamp: number; stage: TransactionStage; message?: string; }

function record(value: unknown): Record<string, unknown> | undefined { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }

function stage(value: unknown): TransactionStage | undefined {
  if (typeof value !== "string") return undefined;
  if (["SUBMITTED", "WAITING_FOR_DECISION", "DECIDED", "WAITING_FOR_FINALIZATION", "TRACKING_ERROR"].includes(value)) return value as TransactionStage;
  if (["PREPARING", "AWAITING_WALLET", "SUBMITTING", "FINALIZED_SUCCESS", "FINALIZED_ERROR"].includes(value)) return "WAITING_FOR_FINALIZATION";
  if (value === "PROCESSING") return "WAITING_FOR_DECISION";
  if (value === "FINALIZING" || value === "FINALIZED") return "WAITING_FOR_FINALIZATION";
  if (value === "FAILED") return "TRACKING_ERROR";
  return undefined;
}

export function parseTrackedTransaction(value: unknown): TrackedTransaction | undefined {
  const item = record(value);
  if (!item || typeof item.txId !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(item.txId)) return undefined;
  if (typeof item.action !== "string" || !(ACTIONS as readonly string[]).includes(item.action)) return undefined;
  if (!Number.isSafeInteger(item.timestamp) || (item.timestamp as number) <= 0) return undefined;
  const normalizedStage = stage(item.stage);
  if (!normalizedStage) return undefined;
  if (item.marketId !== undefined && (!Number.isSafeInteger(item.marketId) || (item.marketId as number) < 1)) return undefined;
  if (item.message !== undefined && (typeof item.message !== "string" || item.message.length > 500)) return undefined;
  return { txId: item.txId, action: item.action as TransactionAction, ...(item.marketId !== undefined ? { marketId: item.marketId as number } : {}), timestamp: item.timestamp as number, stage: normalizedStage, ...(item.message !== undefined ? { message: item.message as string } : {}) };
}

let pendingTransactions: TrackedTransaction[] = [];

export function readPendingTransactions(): TrackedTransaction[] {
  return pendingTransactions.map((item) => ({ ...item }));
}

export function savePendingTransactions(items: TrackedTransaction[]) {
  const entries = Array.isArray(items) ? items : [];
  pendingTransactions = entries.slice(-MAX_PENDING_TRANSACTIONS).map(parseTrackedTransaction).filter((item): item is TrackedTransaction => Boolean(item));
}
export function updatePendingTransaction(txId: string, patch: Partial<TrackedTransaction>) { savePendingTransactions(readPendingTransactions().map((item) => item.txId === txId ? { ...item, ...patch } : item)); }
export function isTransactionActiveStage(value: TransactionStage | undefined) { return value !== undefined && !["FINALIZED_SUCCESS", "FINALIZED_ERROR", "PRE_SUBMISSION_ERROR"].includes(value); }
