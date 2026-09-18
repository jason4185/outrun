import { assertSettlementEligible, assertWalletConsistency, makeKitWriteRequest } from "./transaction-kit";
import { OUTRUN_CONFIG } from "./config";
import { normalizeOutrunError } from "./errors";
import { STUDIO_DEV_CHAIN_HEX, type OutrunInjectedProvider } from "./wallet";
import type { Market, OutrunDataProvider } from "./types";
// @ts-ignore Bun provides this test module; it is intentionally not a production dependency.
import { test } from "bun:test";

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

const market = (overrides: Partial<Market> = {}): Market => ({
  id: 7, category: "US_INDICES", assets: ["SPY", "QQQ", "IWM"], symbols: [], symbolsBySource: { BYBIT: [], GATE: [], BITGET: [] }, start: 1_800_000_000, end: 1_800_003_600, state: "OPEN", status: "READY_TO_SETTLE", totalPool: 0n, pools: [], winner: null, performance: [], bettingOpen: false, settlementAvailable: true, settlementDeadline: 1_800_018_000, winningPool: 0n, claimedPool: 0n, refundedPool: 0n, remainingPool: 0n, ...overrides,
});

test("RC2 write requests preserve contract methods, args, and payable bet value", () => {
  const requests = [
    makeKitWriteRequest("create_market", "create_market", ["US_INDICES", 1_800_000_000n]),
    makeKitWriteRequest("place_bet", "place_bet", [7n, "SPY"], 7, 1_000_000_000_000_000_000n),
    makeKitWriteRequest("settle_market", "settle_market", [7n], 7),
    makeKitWriteRequest("claim", "claim", [7n], 7),
    makeKitWriteRequest("claim_refund", "claim_refund", [7n], 7),
  ];
  assert(requests.every((request) => request.tx.kind === "write" && request.tx.address === OUTRUN_CONFIG.address), "all writes must target the canonical contract");
  assert(requests[1].userValue === 1_000_000_000_000_000_000n, "place_bet must carry exactly the wager value");
  assert(requests[2].userValue === undefined, "settle_market must not carry wager value");
  assert(requests[2].tx.kind === "write" && requests[2].tx.method === "settle_market" && requests[2].tx.args?.[0] === 7n, "settle_market request changed");
});

test("settlement eligibility rejects stale or resolved market state before signing", async () => {
  const provider = { getMarket: async () => market({ settlementAvailable: false, end: Math.floor(Date.now() / 1000) + 60 }) } as unknown as OutrunDataProvider;
  let rejected = false;
  try { await assertSettlementEligible(provider, 7); } catch (error) { rejected = String(error).includes("after the 1-hour window"); }
  assert(rejected, "not-expired settlement should be rejected before wallet approval");

  const settled = { getMarket: async () => market({ state: "SETTLED", settlementAvailable: false }) } as unknown as OutrunDataProvider;
  rejected = false;
  try { await assertSettlementEligible(settled, 7); } catch (error) { rejected = String(error).includes("already been settled"); }
  assert(rejected, "settled market should be rejected before wallet approval");
});

test("RC2 submission keeps the connected account and provider network authoritative", async () => {
  const address = "0x1111111111111111111111111111111111111111";
  const provider = { request: async ({ method }: { method: string }) => method === "eth_accounts" ? [address] : STUDIO_DEV_CHAIN_HEX } as OutrunInjectedProvider;
  await assertWalletConsistency(provider, address);
  let rejected = false;
  try { await assertWalletConsistency(provider, "0x2222222222222222222222222222222222222222"); } catch { rejected = true; }
  assert(rejected, "a changed account must block approval");
});

test("fee-estimation errors retain a distinct reviewer-facing classification", () => {
  const error = normalizeOutrunError(new Error("fee policy unavailable"), "fee-estimation");
  assert(error.code === "FEE_ESTIMATION_FAILED", "fee estimation should not fall through to generic rejection");
});
