// @ts-ignore Bun provides this test module; it is intentionally not a production dependency.
import { test } from "bun:test";
import { outrunQueryKeys, walletChanged, walletScopedQueryPrefixes } from "./query-keys";
import { isActivePosition, isClaimablePosition, isTerminalPosition, summarizePositions } from "./portfolio";
import type { UserPosition } from "./types";

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

function position(overrides: Partial<UserPosition>): UserPosition {
  return {
    marketId: 1,
    category: "US_INDICES",
    asset: "SPY",
    stake: 1n,
    marketState: "OPEN",
    canTopUp: false,
    positionWon: false,
    positionLost: false,
    claimable: 0n,
    claimAvailable: false,
    refundAvailable: false,
    claimed: false,
    refunded: false,
    ...overrides,
  };
}

test("contract-backed positions populate active, claimable, and history summaries", () => {
  const positions = [
    position({ marketId: 1, stake: 1n, marketState: "OPEN" }),
    position({ marketId: 2, stake: 2n, marketState: "INCONCLUSIVE", refundAvailable: true, claimable: 2n }),
    position({ marketId: 3, stake: 3n, marketState: "SETTLED", positionWon: true, claimAvailable: true, claimable: 4n }),
    position({ marketId: 4, stake: 4n, marketState: "SETTLED", positionLost: true }),
  ];
  const summary = summarizePositions(positions, 4);
  assert(summary.totalStaked === 10n, "total staked must sum returned contract stakes");
  assert(summary.claimable === 6n, "claimable must sum contract claimable_amount values");
  assert(summary.active === 1 && summary.settled === 3 && summary.marketCount === 4, "summary buckets must use contract position state");
  assert(isTerminalPosition(positions[1]) && isTerminalPosition(positions[2]) && isTerminalPosition(positions[3]), "terminal positions must appear in history");
  assert(isActivePosition(positions[0]), "OPEN positions must appear as active");
});

test("refund, winner, loser, and already-refunded states map to the correct actions", () => {
  const refund = position({ marketState: "INCONCLUSIVE", refundAvailable: true, claimable: 2n });
  const noPosition = position({ marketState: "INCONCLUSIVE" });
  const alreadyRefunded = position({ marketState: "INCONCLUSIVE", refunded: true });
  const winner = position({ marketState: "SETTLED", positionWon: true, claimAvailable: true, claimable: 3n });
  const loser = position({ marketState: "SETTLED", positionLost: true });
  assert(isClaimablePosition(refund) && refund.claimable === 2n, "inconclusive refund must use claimable_amount");
  assert(!isClaimablePosition(noPosition), "a wallet without a refundable position must have no refund action");
  assert(!isClaimablePosition(alreadyRefunded), "already refunded position must not remain claimable");
  assert(isClaimablePosition(winner), "settled winner must remain claimable until claimed");
  assert(!isClaimablePosition(loser), "settled loser must not have a claim action");
});

test("wallet-specific query keys isolate wallet A from wallet B", () => {
  const a = "0x1111111111111111111111111111111111111111";
  const b = "0x2222222222222222222222222222222222222222";
  assert(JSON.stringify(outrunQueryKeys.positions(61997, "0xcontract", a, 0, 50)) !== JSON.stringify(outrunQueryKeys.positions(61997, "0xcontract", b, 0, 50)), "portfolio query key must include wallet");
  assert(JSON.stringify(outrunQueryKeys.position(61997, "0xcontract", a, 3)) !== JSON.stringify(outrunQueryKeys.position(61997, "0xcontract", b, 3)), "position query key must include wallet");
  assert(JSON.stringify(outrunQueryKeys.bettingState(61997, "0xcontract", a, 3)) !== JSON.stringify(outrunQueryKeys.bettingState(61997, "0xcontract", b, 3)), "betting-state query key must include wallet");
});

test("account switch clears wallet-scoped A data before B refetches", () => {
  const a = "0x1111111111111111111111111111111111111111";
  const b = "0x2222222222222222222222222222222222222222";
  assert(walletChanged(a, b), "A to B must trigger wallet cache clearing");
  assert(walletChanged(a, ""), "disconnect must trigger wallet cache clearing");
  assert(!walletChanged(undefined, b), "initial connection has no prior wallet cache to clear");
  assert(walletScopedQueryPrefixes.includes("portfolio") && walletScopedQueryPrefixes.includes("claimable") && walletScopedQueryPrefixes.includes("activity"), "all wallet-specific portfolio scopes must be cleared");
});
