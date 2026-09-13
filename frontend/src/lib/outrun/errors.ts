export type OutrunErrorContext = "read" | "write" | "chart" | "post-submit" | "finalized-error";

export interface NormalizedOutrunError {
  code: string;
  title: string;
  message: string;
  retryable: boolean;
  submittedTransaction: boolean;
  rawCause: unknown;
}

function rawText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    for (const key of ["shortMessage", "details", "reason", "message"]) {
      if (typeof value[key] === "string") return value[key] as string;
    }
    try { return JSON.stringify(error); } catch { return ""; }
  }
  return "";
}

function normalized(code: string, title: string, message: string, retryable: boolean, submittedTransaction: boolean, rawCause: unknown): NormalizedOutrunError {
  return { code, title, message, retryable, submittedTransaction, rawCause };
}

export function retryAfterMilliseconds(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = error as Record<string, unknown>;
  const response = value.response && typeof value.response === "object" ? value.response as Record<string, unknown> : undefined;
  const headers = response?.headers && typeof response.headers === "object" ? response.headers as { get?: (name: string) => string | null } : value.headers && typeof value.headers === "object" ? value.headers as { get?: (name: string) => string | null } : undefined;
  const raw = headers?.get?.("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined;
}

export function normalizeOutrunError(error: unknown, context: OutrunErrorContext, submittedTransaction = false): NormalizedOutrunError {
  const raw = rawText(error);
  const lower = raw.toLowerCase();
  let result: NormalizedOutrunError;
  if (submittedTransaction && (lower.includes("rate limit") || lower.includes("429") || lower.includes("timeout") || lower.includes("network") || lower.includes("still processing") || lower.includes("status check"))) {
    result = normalized("TX_STATUS_UNCERTAIN", "Transaction submitted", "We're having trouble checking its status. OUTRUN will keep tracking the same transaction.", true, true, error);
  } else if (lower.includes("rate limit") || lower.includes("too many requests") || lower.includes("429")) {
    result = normalized("RATE_LIMIT", "Network is busy", "Studio Dev is receiving too many requests right now. Please wait a few seconds and try again.", true, false, error);
  } else if (lower.includes("user rejected") || lower.includes("user denied") || lower.includes("rejected the request") || lower.includes("denied transaction")) {
    result = normalized("USER_REJECTED", "Transaction cancelled", "You cancelled the wallet request.", false, false, error);
  } else if (lower.includes("wrong network") || lower.includes("chain") && lower.includes("61997")) {
    result = normalized("WRONG_NETWORK", "Wrong network", "Switch your wallet to Studio Dev to continue.", false, false, error);
  } else if (lower.includes("insufficient funds") || lower.includes("insufficient balance") || lower.includes("not enough gen")) {
    result = normalized("INSUFFICIENT_GEN", "Not enough GEN", "You don't have enough GEN for this transaction and its network fees.", false, false, error);
  } else if (lower.includes("minimum bet") || lower.includes("bet below")) {
    result = normalized("MINIMUM_BET", "Minimum stake", "Minimum stake is 1 GEN.", false, false, error);
  } else if (lower.includes("maximum cumulative") || lower.includes("maximum bet") || lower.includes("exceeds the maximum")) {
    result = normalized("MAXIMUM_BET", "Maximum stake reached", "Your maximum total stake for this market is 20 GEN.", false, false, error);
  } else if (lower.includes("betting") && (lower.includes("closed") || lower.includes("started"))) {
    result = normalized("BETTING_CLOSED", "Betting is closed", "Betting is closed for this market.", false, false, error);
  } else if (lower.includes("outcome already") || lower.includes("already selected") || lower.includes("one side")) {
    result = normalized("OUTCOME_LOCKED", "Pick is locked", "You already backed another asset in this market. You can only add to your original pick.", false, false, error);
  } else if (lower.includes("invalid market asset") || lower.includes("invalid asset") || lower.includes("asset not available")) {
    result = normalized("INVALID_ASSET", "Asset unavailable", "That asset is not available in this market.", false, false, error);
  } else if (lower.includes("market not found") || lower.includes("invalid market")) {
    result = normalized("MARKET_NOT_FOUND", "Market not found", "Market not found.", false, false, error);
  } else if (lower.includes("exact utc") || lower.includes("hour aligned") || lower.includes("alignment")) {
    result = normalized("INVALID_START_ALIGNMENT", "Invalid market time", "Market start must be on an exact UTC hour.", false, false, error);
  } else if (lower.includes("past") || lower.includes("future") || lower.includes("market start")) {
    result = normalized("INVALID_START", "Invalid market time", "Choose a future market time.", false, false, error);
  } else if (lower.includes("duplicate") || lower.includes("already exists") || lower.includes("already created")) {
    result = normalized("DUPLICATE_MARKET", "Market already exists", "A market for this category and time already exists.", false, false, error);
  } else if (lower.includes("invalid category") || lower.includes("unsupported category")) {
    result = normalized("INVALID_CATEGORY", "Unsupported category", "That market category is not supported.", false, false, error);
  } else if (lower.includes("market limit") || lower.includes("maximum market count") || lower.includes("maximum markets") || lower.includes("capacity")) {
    result = normalized("MARKET_CAPACITY", "Market limit reached", "OUTRUN has reached its current market limit.", false, false, error);
  } else if (lower.includes("market has not expired") || lower.includes("competition window") || lower.includes("settlement") && (lower.includes("not available") || lower.includes("not ready"))) {
    result = normalized("SETTLEMENT_UNAVAILABLE", "Settlement isn't available yet", "This market can only be settled after its competition window ends.", true, false, error);
  } else if (lower.includes("not a winning") || lower.includes("not eligible")) {
    result = normalized("NOT_WINNER", "Not eligible", "This position is not eligible for a winner payout.", false, false, error);
  } else if (lower.includes("payout already claimed") || lower.includes("already claimed")) {
    result = normalized("ALREADY_CLAIMED", "Already claimed", "This payout has already been claimed.", false, false, error);
  } else if (lower.includes("market is not settled") || lower.includes("not settled")) {
    result = normalized("NOT_SETTLED", "Not ready", "This market is not ready for winner claims yet.", false, false, error);
  } else if (lower.includes("no position") || lower.includes("no bettor stake") || lower.includes("does not have a position")) {
    result = normalized("NO_POSITION", "No position", "You don't have a position in this market.", false, false, error);
  } else if (lower.includes("market is not inconclusive") || lower.includes("not inconclusive")) {
    result = normalized("NOT_INCONCLUSIVE", "Refund unavailable", "Refunds are only available for inconclusive markets.", false, false, error);
  } else if (lower.includes("refund already") || lower.includes("already refunded")) {
    result = normalized("ALREADY_REFUNDED", "Already refunded", "This refund has already been claimed.", false, false, error);
  } else if (lower.includes("transaction was finalized but could not be completed") || lower.includes("finished_with_error")) {
    result = normalized("FINALIZED_ERROR", "Transaction failed", "The transaction was finalized but could not be completed.", false, false, error);
  } else if (context === "chart" || lower.includes("binance")) {
    result = normalized("CHART_UNAVAILABLE", "Live chart temporarily unavailable", "We couldn't load Binance market data. We'll retry shortly.", true, false, error);
  } else if (context === "read") {
    result = normalized("READ_UNAVAILABLE", "Unable to load OUTRUN data", "Studio Dev is temporarily unavailable. Please try again shortly.", true, false, error);
  } else if (context === "post-submit") {
    result = normalized("TX_STATUS_UNCERTAIN", "Transaction submitted", "We're having trouble checking its status. OUTRUN will keep tracking the same transaction.", true, true, error);
  } else if (context === "finalized-error") {
    result = normalized("FINALIZED_ERROR", "Transaction failed", "The transaction was finalized but could not be completed.", false, false, error);
  } else {
    result = normalized("WRITE_REJECTED", "Transaction rejected", "The transaction was rejected. Please review the market requirements and try again.", false, false, error);
  }
  if (import.meta.env.DEV) console.error("[OUTRUN]", { context, normalizedError: { code: result.code, title: result.title, message: result.message, retryable: result.retryable, submittedTransaction: result.submittedTransaction }, rawError: error });
  return result;
}
