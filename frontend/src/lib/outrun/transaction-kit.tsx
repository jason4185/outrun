import { useMemo, useRef } from "react";
import { createTransactionKit, type SubmitInput, type TrackedStatus, type TransactionKit } from "@genlayer/transaction-kit";
import { GenLayerTransactionPanel } from "@genlayer/transaction-kit-react";
import { OUTRUN_CONFIG } from "./config";
import { getWalletAddress, getWalletChainId, STUDIO_DEV_CHAIN_HEX, type OutrunInjectedProvider } from "./wallet";
import type { Market, OutrunDataProvider, TransactionHandle } from "./types";

export interface KitWriteRequest {
  action: TransactionHandle["action"];
  tx: SubmitInput;
  marketId?: number;
  userValue?: bigint;
  account?: string;
}

export function makeKitWriteRequest(action: TransactionHandle["action"], method: string, args: unknown[], marketId?: number, userValue?: bigint): KitWriteRequest {
  return { action, marketId, userValue, tx: { kind: "write", address: OUTRUN_CONFIG.address, method, args } };
}

export type KitErrorPhase = "fee-estimation" | "submission" | "tracking";

/**
 * RC2 populates `successful` with genlayer-js' isSuccessful result once a
 * transaction reaches a decided state. That helper already requires an
 * accepted decision and FINISHED_WITH_RETURN, so UI success must not depend
 * on display strings or finalization.
 */
export function isSuccessfulDecision(status: Pick<TrackedStatus, "successful">): boolean {
  return status.successful === true;
}

export function canStartKitWrite(writeBusy: boolean, requestActive: boolean): boolean {
  return !writeBusy && !requestActive;
}

export function refreshAuthoritativeOutrunState(
  invalidate: () => Promise<unknown>,
  refetchBalance: () => Promise<unknown>,
): void {
  void invalidate().catch(() => undefined);
  void refetchBalance().catch(() => undefined);
}

export async function assertSettlementEligible(provider: OutrunDataProvider, marketId: number): Promise<Market> {
  const market = await provider.getMarket(marketId);
  if (!market) throw new Error("Market not found.");
  if (market.state === "SETTLED") throw new Error("This market has already been settled.");
  if (market.state === "INCONCLUSIVE") throw new Error("This market has already resolved as inconclusive.");
  if (market.state !== "OPEN" && market.state !== "SETTLEMENT_PENDING") throw new Error("This market is not available for settlement.");
  if (!market.settlementAvailable) {
    if (Math.floor(Date.now() / 1000) < market.end) throw new Error("This market can be settled after the 1-hour window ends.");
    throw new Error("Settlement is not currently available for this market.");
  }
  return market;
}

export async function assertWalletConsistency(provider: OutrunInjectedProvider, account: string): Promise<void> {
  const activeAddress = await getWalletAddress(provider);
  if (!activeAddress || activeAddress.toLowerCase() !== account.toLowerCase()) {
    throw new Error("The connected wallet account changed. Reconnect the same wallet before approving.");
  }
  if (await getWalletChainId(provider) !== STUDIO_DEV_CHAIN_HEX) {
    throw new Error("Switch your wallet to Studio Dev (chain 61997) before approving.");
  }
}

function useOutrunTransactionKit(
  account: string | null,
  injected: OutrunInjectedProvider | undefined,
  readProvider: OutrunDataProvider,
  onError: (error: unknown, phase: KitErrorPhase) => void,
): TransactionKit | null {
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const readProviderRef = useRef(readProvider);
  readProviderRef.current = readProvider;

  const baseKit = useMemo(() => {
    if (!account || !injected) return null;
    return createTransactionKit({
      chain: OUTRUN_CONFIG.chain,
      provider: injected,
      account: account as `0x${string}`,
    });
  }, [account, injected]);

  return useMemo(() => {
    if (!baseKit || !account || !injected) return null;
    const kit: TransactionKit = {
      ...baseKit,
      estimate: async (input, tx) => {
        try {
          return await baseKit.estimate(input, tx);
        } catch (error) {
          onErrorRef.current(error, "fee-estimation");
          throw error;
        }
      },
      submit: async (quote, tx) => {
        try {
          await assertWalletConsistency(injected, account);
          if (tx.kind === "write" && tx.method === "settle_market") {
            const marketId = Number(tx.args?.[0]);
            if (!Number.isSafeInteger(marketId) || marketId < 1) throw new Error("Invalid settlement market ID.");
            await assertSettlementEligible(readProviderRef.current, marketId);
          }
          return await baseKit.submit(quote, tx);
        } catch (error) {
          onErrorRef.current(error, "submission");
          throw error;
        }
      },
      track: async (txId, onUpdate, options) => {
        try {
          return await baseKit.track(txId, onUpdate, options);
        } catch (error) {
          onErrorRef.current(error, "tracking");
          throw error;
        }
      },
    };
    return kit;
  }, [account, baseKit, injected]);
}

export function OutrunTransactionPanel({
  account,
  injected,
  readProvider,
  request,
  onDone,
  onError,
}: {
  account: string | null;
  injected?: OutrunInjectedProvider;
  readProvider: OutrunDataProvider;
  request: KitWriteRequest;
  onDone: (status: TrackedStatus) => void | Promise<void>;
  onError: (error: unknown, phase: KitErrorPhase) => void;
}) {
  const submissionAccount = request.account ?? account;
  const kit = useOutrunTransactionKit(submissionAccount, injected, readProvider, onError);
  const doneRef = useRef(false);
  if (!kit) return <div className="gltk-root transaction-kit-unavailable">Reconnect the same injected wallet to continue.</div>;
  return <GenLayerTransactionPanel kit={kit} tx={request.tx} userValue={request.userValue} network="Studio Next · chain 61997" theme="dark" trackUntil="decided" onDone={(status) => { if (doneRef.current) return; doneRef.current = true; queueMicrotask(() => { void onDone(status); }); }} />;
}
