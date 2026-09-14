import { createOutrunProvider, type WalletGenLayerClient } from "./adapter";
import { OUTRUN_CONFIG } from "./config";
// @ts-ignore Bun provides this test module; it is intentionally not a production dependency.
import { test } from "bun:test";

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

test("OUTRUN writes use one provider-backed contract path", async () => {
  const estimated: Record<string, unknown>[] = [];
  const submitted: Record<string, unknown>[] = [];
  const client = {
    estimateTransactionFeesForWrite: async (request: Record<string, unknown>) => { estimated.push(request); return { distribution: [], messageAllocations: [], feeValue: 1n }; },
    writeContract: async (request: Record<string, unknown>) => { submitted.push(request); return `0x${"1".repeat(64)}`; },
  } as unknown as WalletGenLayerClient;
  const provider = createOutrunProvider(client);
  await provider.createMarket("US_INDICES", 1_800_000_000);
  await provider.placeBet(7, "SPY", 1_000_000_000_000_000_000n);
  await provider.settleMarket(7);
  await provider.claim(7);
  await provider.claimRefund(7);
  assert(estimated.length === 5 && submitted.length === 5, "each write should estimate once and submit once");
  for (const request of [...estimated, ...submitted]) assert(request.address === OUTRUN_CONFIG.address, "all writes must use the canonical contract address");
  const createArgs = submitted[0].args as unknown[];
  const betArgs = submitted[1].args as unknown[];
  assert(createArgs[0] === "US_INDICES" && createArgs[1] === 1_800_000_000n, "create_market arguments changed");
  assert(betArgs[0] === 7n && betArgs[1] === "SPY", "place_bet arguments changed");
  assert(submitted[1].value === 1_000_000_000_000_000_000n, "place_bet stake must remain call value");
  assert((submitted[2].args as unknown[])[0] === 7n, "settle_market arguments changed");
  assert((submitted[3].args as unknown[])[0] === 7n, "claim arguments changed");
  assert((submitted[4].args as unknown[])[0] === 7n, "claim_refund arguments changed");
});
