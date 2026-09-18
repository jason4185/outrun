import { assertSettlementEligible, assertWalletConsistency, canStartKitWrite, isSuccessfulDecision, makeKitWriteRequest, refreshAuthoritativeOutrunState } from "./transaction-kit";
import type { TrackedStatus } from "@genlayer/transaction-kit";
import { createOutrunProvider, senderAccountForRead } from "./adapter";
import { OUTRUN_CONFIG } from "./config";
import { normalizeOutrunError } from "./errors";
import { getMarketPositionAction } from "./market-actions";
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
  assert(requests[4].action === "claim_refund" && requests[4].tx.kind === "write" && requests[4].tx.method === "claim_refund" && requests[4].tx.args?.length === 1 && requests[4].tx.args[0] === 7n && requests[4].userValue === undefined, "refund must submit only claim_refund(market_id)");
});

test("sender-aware adapter reads use the connected address as a JSON-RPC account", async () => {
  const wallet = "0xC8Ba5DA455b011863F2ECa76a6fa21E62Cc91B87";
  const calls: Array<{ functionName?: string; account?: { address?: string; type?: string } }> = [];
  const fakeClient = { readContract: async (options: { functionName?: string; account?: { address?: string; type?: string } }) => {
    calls.push(options);
    if (options.functionName === "get_my_market_count" || options.functionName === "get_my_activity_count") return 1n;
    if (options.functionName === "get_my_position") return { has_position: false };
    if (options.functionName === "get_betting_state") return { category: "US_INDICES", total_market_pool: 0, outcome_stakes: { SPY: 0, QQQ: 0, IWM: 0 }, bettor_asset: "", bettor_stake: 0, claimed: false, refunded: false, winning_pool: 0, claimed_pool: 0, claimed_winning_stake: 0, refunded_pool: 0 };
    return [];
  } };
  const provider = createOutrunProvider(fakeClient as never);
  await Promise.all([
    provider.getBettingState(1, wallet),
    provider.getMyMarketCount(wallet),
    provider.getPosition(1, wallet),
    provider.getPositions(wallet),
    provider.getClaimablePositions(wallet),
    provider.getActivityCount(wallet),
    provider.getActivity(wallet),
  ]);
  assert(calls.length === 7, "all sender-aware methods should call the contract");
  assert(calls.every((call) => call.account?.address === wallet && call.account.type === "json-rpc"), "every sender-aware read must carry the connected wallet address");
  assert(senderAccountForRead(wallet).address === wallet && senderAccountForRead(wallet).type === "json-rpc", "sender account must not create a different wallet");
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

const decidedStatus = (successful: boolean): TrackedStatus => ({ phase: "decided", successful, statusName: successful ? "ACCEPTED" : "ACCEPTED", executionResultName: successful ? "FINISHED_WITH_RETURN" : "FINISHED_WITH_ERROR", genlayerTxId: `0x${"1".repeat(64)}` });

test("accepted decision plus FINISHED_WITH_RETURN completes immediately", () => {
  assert(isSuccessfulDecision(decidedStatus(true)), "successful accepted decision should complete the write");
});

test("accepted decision with execution error is not success", () => {
  assert(!isSuccessfulDecision(decidedStatus(false)), "accepted execution error must fail the write");
});

test("rejected decision is not success", () => {
  const rejected: TrackedStatus = { phase: "decided", successful: false, statusName: "REJECTED", executionResultName: "FINISHED_WITH_ERROR" };
  assert(!isSuccessfulDecision(rejected), "rejected decision must fail the write");
});

test("successful decision does not require finalization", () => {
  const notFinalized: TrackedStatus = { ...decidedStatus(true), phase: "decided" };
  assert(isSuccessfulDecision(notFinalized), "finalization must not be a UI success prerequisite");
});

test("write guard prevents duplicate submission while state refetches", () => {
  assert(canStartKitWrite(false, false), "an idle write may start");
  assert(!canStartKitWrite(true, false), "writeBusy must block a duplicate");
  assert(!canStartKitWrite(false, true), "an active kit request must block a duplicate");
});

test("successful decision refreshes authoritative contract state and balance", () => {
  let invalidated = false;
  let balanceRefetched = false;
  refreshAuthoritativeOutrunState(async () => { invalidated = true; }, async () => { balanceRefetched = true; });
  assert(invalidated && balanceRefetched, "post-decision refetches must be scheduled");
});

test("market detail exposes only wallet-authorized refund and winnings actions", () => {
  const refund = { marketState: "INCONCLUSIVE", refundAvailable: true } as never;
  const refunded = { marketState: "INCONCLUSIVE", refundAvailable: false, refunded: true } as never;
  const winner = { marketState: "SETTLED", claimAvailable: true } as never;
  const loser = { marketState: "SETTLED", claimAvailable: false } as never;
  assert(getMarketPositionAction("INCONCLUSIVE", true, refund) === "claim_refund", "inconclusive refundable position should expose Claim Refund");
  assert(getMarketPositionAction("INCONCLUSIVE", true, null) === "no_refund_position", "inconclusive wallet without a position should not expose refund");
  assert(getMarketPositionAction("INCONCLUSIVE", true, refunded) === "refund_claimed", "refunded position should show Refund claimed");
  assert(getMarketPositionAction("SETTLED", true, winner) === "claim_winnings", "settled winner should expose Claim Winnings");
  assert(getMarketPositionAction("SETTLED", true, loser) === "none", "settled loser should not expose a claim");
  assert(getMarketPositionAction("INCONCLUSIVE", false, null) === "connect_wallet", "disconnected market detail should require a wallet");
});
