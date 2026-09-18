import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import type { Address } from "viem";
import type { TrackedStatus } from "@genlayer/transaction-kit";
import { createOutrunProvider, readClient } from "../lib/outrun/adapter";
import { OUTRUN_CONFIG } from "../lib/outrun/config";
import { normalizeOutrunError } from "../lib/outrun/errors";
import { outrunQueryKeys } from "../lib/outrun/query-keys";
import type { ActivityItem, Asset, Category, ContractConfig, Market, OutrunDataProvider, TransactionHandle, UserPosition } from "../lib/outrun/types";
import { isTransactionActiveStage, type TrackedTransaction, type TransactionStage } from "../lib/outrun/transactions";
import { assertSettlementEligible, makeKitWriteRequest, OutrunTransactionPanel, type KitErrorPhase, type KitWriteRequest } from "../lib/outrun/transaction-kit";
import { getInjectedProvider, getWalletAddress, getWalletChainId, requestWallet, STUDIO_DEV_CHAIN_HEX, switchToStudioDevnet, watchWallet, type OutrunInjectedProvider } from "../lib/outrun/wallet";

export type { TrackedTransaction, TransactionStage } from "../lib/outrun/transactions";
export { isTransactionActiveStage } from "../lib/outrun/transactions";

interface OutrunContextValue {
  provider: OutrunDataProvider;
  config: ContractConfig | undefined;
  configLoading: boolean;
  markets: Market[];
  marketsLoading: boolean;
  marketsError: Error | null;
  refetchMarkets: () => Promise<unknown>;
  rpcError: Error | null;
  retryRpc: () => Promise<void>;
  positions: UserPosition[];
  positionsLoading: boolean;
  positionsError: Error | null;
  claimablePositions: UserPosition[];
  myMarketCount: number | undefined;
  activities: ActivityItem[];
  activityCount: number | undefined;
  activityLoading: boolean;
  notificationsOpen: boolean;
  setNotificationsOpen: (open: boolean) => void;
  connected: boolean;
  walletAddress: string;
  balance?: bigint;
  wrongNetwork: boolean;
  walletPending: boolean;
  writeBusy: boolean;
  walletError?: Error;
  connectWallet: () => void;
  switchToStudio: () => Promise<void>;
  disconnectWallet: () => Promise<void>;
  getPosition: (marketId: number) => UserPosition | null;
  placeBet: (marketId: number, asset: Asset, amount: bigint) => Promise<TransactionHandle>;
  claim: (marketId: number) => Promise<TransactionHandle>;
  claimRefund: (marketId: number) => Promise<TransactionHandle>;
  settleMarket: (marketId: number) => Promise<TransactionHandle>;
  createMarket: (category: Category, start: number) => Promise<TransactionHandle>;
  transaction: TrackedTransaction | null;
  dismissTransaction: () => void;
}

const OutrunContext = createContext<OutrunContextValue | null>(null);

function asError(error: unknown) { return error instanceof Error ? error : new Error(String(error)); }
function actionLabel(action: TransactionHandle["action"]) { return action === "place_bet" ? "Bet" : action === "create_market" ? "Market creation" : action === "settle_market" ? "Settlement" : action === "claim" ? "Claim" : "Refund"; }

interface KitFailure { error: unknown; submitted: boolean; phase?: KitErrorPhase; finalized?: boolean; }

export function OutrunProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const [address, setAddress] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [walletPending, setWalletPending] = useState(false);
  const [walletError, setWalletError] = useState<Error>();
  const [injected, setInjected] = useState<OutrunInjectedProvider | undefined>(() => getInjectedProvider());
  const [tracked, setTracked] = useState<TrackedTransaction | null>(null);
  const [kitRequest, setKitRequest] = useState<KitWriteRequest | null>(null);
  const [writeBusy, setWriteBusy] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const writeBusyRef = useRef(false);
  const kitRequestRef = useRef<{ request: KitWriteRequest; resolve: (handle: TransactionHandle) => void; reject: (error: unknown) => void } | null>(null);
  const previousAddress = useRef<string | undefined>(undefined);
  const manualDisconnect = useRef(false);
  const connected = Boolean(address);
  const walletAddress = address ?? "";
  const wrongNetwork = connected && chainId !== STUDIO_DEV_CHAIN_HEX;
  const isMarketsRoute = pathname === "/markets";
  const isPortfolioRoute = pathname === "/portfolio";
  const writeActive = writeBusy || Boolean(kitRequest) || isTransactionActiveStage(tracked?.stage);

  useEffect(() => {
    try {
      window.localStorage.removeItem("outrun.pending-transactions.v1");
      window.localStorage.removeItem("outrun.read-notifications.v1");
    } catch {
      // Legacy cleanup is best effort and must not affect application startup.
    }
  }, []);

  useEffect(() => {
    let active = true;
    const sync = async () => {
      if (!injected) return;
      try {
        const [nextAddress, nextChain] = await Promise.all([getWalletAddress(injected), getWalletChainId(injected)]);
        if (active && !manualDisconnect.current) { setAddress(nextAddress); setChainId(nextChain); setWalletError(undefined); }
      } catch (error) { if (active) setWalletError(asError(error)); }
    };
    void sync();
    const unwatch = watchWallet(injected, (nextAddress) => { manualDisconnect.current = false; setAddress(nextAddress); if (!nextAddress) setChainId(null); setWalletError(undefined); }, (nextChain) => { setChainId(nextChain); setWalletError(undefined); });
    return () => { active = false; unwatch(); };
  }, [injected]);

  const provider = useMemo(() => createOutrunProvider(), []);
  const configQuery = useQuery({ queryKey: outrunQueryKeys.config(OUTRUN_CONFIG.chainId, OUTRUN_CONFIG.address), queryFn: () => provider.getConfig(), staleTime: 300_000, refetchInterval: false, refetchOnWindowFocus: false });
  const marketsQuery = useQuery({ queryKey: outrunQueryKeys.markets(OUTRUN_CONFIG.chainId, OUTRUN_CONFIG.address, 0, 50), queryFn: () => provider.getMarkets(0, 50), enabled: isMarketsRoute || isPortfolioRoute, staleTime: 10_000, refetchInterval: writeActive ? false : 15_000, refetchIntervalInBackground: false, refetchOnWindowFocus: !writeActive });
  const userEnabled = connected && !wrongNetwork;
  const positionsQuery = useQuery({ queryKey: outrunQueryKeys.positions(OUTRUN_CONFIG.chainId, OUTRUN_CONFIG.address, walletAddress, 0, 50), queryFn: () => provider.getPositions(walletAddress, 0, 50), enabled: userEnabled && isPortfolioRoute && !writeActive, staleTime: 10_000, refetchInterval: writeActive ? false : 15_000, refetchIntervalInBackground: false, refetchOnWindowFocus: !writeActive });
  const claimableQuery = useQuery({ queryKey: outrunQueryKeys.claimable(OUTRUN_CONFIG.chainId, OUTRUN_CONFIG.address, walletAddress, 0, 50), queryFn: () => provider.getClaimablePositions(walletAddress, 0, 50), enabled: userEnabled && isPortfolioRoute && !writeActive, staleTime: 10_000, refetchInterval: writeActive ? false : 15_000, refetchIntervalInBackground: false, refetchOnWindowFocus: !writeActive });
  const activityQuery = useQuery({ queryKey: outrunQueryKeys.activity(OUTRUN_CONFIG.chainId, OUTRUN_CONFIG.address, walletAddress, 0, 50), queryFn: () => provider.getActivity(walletAddress, 0, 50), enabled: userEnabled && (isPortfolioRoute || notificationsOpen) && !writeActive, staleTime: 60_000, refetchInterval: false, refetchIntervalInBackground: false, refetchOnWindowFocus: !writeActive });
  const myMarketCountQuery = useQuery({ queryKey: outrunQueryKeys.myMarketCount(OUTRUN_CONFIG.chainId, OUTRUN_CONFIG.address, walletAddress), queryFn: () => provider.getMyMarketCount(walletAddress), enabled: userEnabled && isPortfolioRoute && !writeActive, staleTime: 15_000, refetchInterval: writeActive ? false : 15_000, refetchIntervalInBackground: false, refetchOnWindowFocus: !writeActive });
  const activityCountQuery = useQuery({ queryKey: outrunQueryKeys.activityCount(OUTRUN_CONFIG.chainId, OUTRUN_CONFIG.address, walletAddress), queryFn: () => provider.getActivityCount(walletAddress), enabled: userEnabled && !writeActive, staleTime: 60_000, refetchInterval: writeActive ? false : 60_000, refetchIntervalInBackground: false, refetchOnWindowFocus: !writeActive });
  const balanceQuery = useQuery({ queryKey: ["outrun", "balance", OUTRUN_CONFIG.chainId, OUTRUN_CONFIG.address, walletAddress], queryFn: () => readClient.getBalance({ address: walletAddress as Address }), enabled: userEnabled, staleTime: 60_000, refetchInterval: writeActive ? false : 60_000, refetchIntervalInBackground: false, refetchOnWindowFocus: !writeActive });
  const retryRpc = useCallback(async () => { await Promise.all([configQuery.refetch(), marketsQuery.refetch()]); }, [configQuery.refetch, marketsQuery.refetch]);

  useEffect(() => {
    if (previousAddress.current && previousAddress.current !== walletAddress) {
      void queryClient.removeQueries({ queryKey: ["outrun", "portfolio"] });
      void queryClient.removeQueries({ queryKey: ["outrun", "claimable"] });
      void queryClient.removeQueries({ queryKey: ["outrun", "activity"] });
      void queryClient.removeQueries({ queryKey: ["outrun", "position"] });
      void queryClient.removeQueries({ queryKey: ["outrun", "betting-state"] });
      void queryClient.removeQueries({ queryKey: ["outrun", "my-market-count"] });
      void queryClient.removeQueries({ queryKey: ["outrun", "activity-count"] });
    }
    previousAddress.current = walletAddress || undefined;
  }, [queryClient, walletAddress]);

  const completeKitRequest = useCallback((status: TrackedStatus) => {
    const pending = kitRequestRef.current;
    if (!pending) return;
    kitRequestRef.current = null;
    setKitRequest(null);
    const txId = status.genlayerTxId ?? status.evmTxHash;
    if (!txId) {
      pending.reject({ error: new Error("Transaction completed without a GenLayer transaction hash."), submitted: true } satisfies KitFailure);
      return;
    }
    const success = status.successful !== false;
    const item: TrackedTransaction = {
      txId,
      action: pending.request.action,
      ...(pending.request.marketId !== undefined ? { marketId: pending.request.marketId } : {}),
      timestamp: Date.now(),
      stage: success ? "FINALIZED_SUCCESS" : "FINALIZED_ERROR",
      message: success ? `${actionLabel(pending.request.action)} finalized successfully.` : `${status.statusName ?? status.executionResultName ?? "Transaction execution failed"}`,
    };
    setTracked(item);
    if (!success) {
      pending.reject({ error: new Error(item.message), submitted: true, finalized: true } satisfies KitFailure);
      return;
    }
    pending.resolve({ txId, action: pending.request.action, marketId: pending.request.marketId });
    void queryClient.invalidateQueries({ queryKey: ["outrun"] });
    void balanceQuery.refetch().catch(() => undefined);
  }, [balanceQuery.refetch, queryClient]);

  const failKitRequest = useCallback((error: unknown, phase: KitErrorPhase) => {
    const pending = kitRequestRef.current;
    if (!pending) return;
    kitRequestRef.current = null;
    setKitRequest(null);
    pending.reject({ error, submitted: phase === "tracking", phase } satisfies KitFailure);
  }, []);

  const trackWrite = useCallback(async (request: KitWriteRequest): Promise<TransactionHandle> => {
    if (!connected) throw new Error("Connect your injected wallet before submitting.");
    if (wrongNetwork) throw new Error("Switch to Studio Dev before submitting.");
    if (!injected) throw new Error("Injected wallet provider is unavailable. Reconnect your wallet.");
    if (writeBusyRef.current || kitRequestRef.current) throw new Error("An OUTRUN transaction is already being tracked. Please wait before submitting another action.");
    const activeAddress = await getWalletAddress(injected);
    if (!activeAddress || activeAddress.toLowerCase() !== walletAddress.toLowerCase()) throw new Error("Wallet account unavailable. Reconnect your injected wallet.");
    if (await getWalletChainId(injected) !== STUDIO_DEV_CHAIN_HEX) throw new Error("Switch to Studio Dev before submitting.");
    writeBusyRef.current = true;
    setWriteBusy(true);
    try {
      return await new Promise<TransactionHandle>((resolve, reject) => {
        const ownedRequest = { ...request, account: walletAddress };
        kitRequestRef.current = { request: ownedRequest, resolve, reject };
        setKitRequest(ownedRequest);
      });
    } catch (error) {
      const failure = error && typeof error === "object" && "error" in error ? error as KitFailure : { error, submitted: false };
      const context = failure.finalized ? "finalized-error" : failure.submitted ? "post-submit" : failure.phase === "fee-estimation" ? "fee-estimation" : failure.phase === "submission" ? "submission" : "write";
      const friendly = normalizeOutrunError(failure.error, context, failure.submitted);
      throw new Error(friendly.message);
    } finally {
      writeBusyRef.current = false;
      setWriteBusy(false);
    }
  }, [connected, injected, walletAddress, wrongNetwork]);

  const connectWallet = useCallback(() => {
    manualDisconnect.current = false;
    setWalletPending(true);
    setWalletError(undefined);
    const activeProvider = injected ?? getInjectedProvider();
    if (!injected && activeProvider) setInjected(activeProvider);
    void requestWallet(activeProvider).then(async (nextAddress) => {
      const nextChain = await getWalletChainId(activeProvider);
      setAddress(nextAddress);
      setChainId(nextChain);
    }).catch((error) => setWalletError(asError(error))).finally(() => setWalletPending(false));
  }, [injected]);
  const switchToStudio = useCallback(async () => {
    setWalletPending(true);
    setWalletError(undefined);
    const activeProvider = injected ?? getInjectedProvider();
    if (!injected && activeProvider) setInjected(activeProvider);
    try { setChainId(await switchToStudioDevnet(activeProvider)); } catch (error) { setWalletError(asError(error)); } finally { setWalletPending(false); }
  }, [injected]);
  const disconnectWallet = useCallback(async () => { manualDisconnect.current = true; setAddress(null); setChainId(null); setWalletError(undefined); }, []);
  const getPosition = (marketId: number) => positionsQuery.data?.find((position) => position.marketId === marketId) ?? null;
  const requireWallet = () => { if (!connected) throw new Error("Connect your injected wallet before submitting."); if (wrongNetwork) throw new Error("Switch to Studio Dev before submitting."); if (!injected) throw new Error("Injected wallet provider is unavailable. Reconnect your wallet."); };
  const placeBet = (marketId: number, asset: Asset, amount: bigint) => { requireWallet(); return trackWrite(makeKitWriteRequest("place_bet", "place_bet", [BigInt(marketId), asset], marketId, amount)); };
  const claim = (marketId: number) => { requireWallet(); return trackWrite(makeKitWriteRequest("claim", "claim", [BigInt(marketId)], marketId)); };
  const claimRefund = (marketId: number) => { requireWallet(); return trackWrite(makeKitWriteRequest("claim_refund", "claim_refund", [BigInt(marketId)], marketId)); };
  const settleMarket = async (marketId: number) => { requireWallet(); await assertSettlementEligible(provider, marketId); return trackWrite(makeKitWriteRequest("settle_market", "settle_market", [BigInt(marketId)], marketId)); };
  const createMarket = (category: Category, start: number) => { requireWallet(); return trackWrite(makeKitWriteRequest("create_market", "create_market", [category, BigInt(start)])); };

  const value = useMemo<OutrunContextValue>(() => ({
    provider, config: configQuery.data, configLoading: configQuery.isLoading, markets: marketsQuery.data ?? [], marketsLoading: marketsQuery.isLoading, marketsError: marketsQuery.error ? asError(marketsQuery.error) : null, refetchMarkets: marketsQuery.refetch, rpcError: configQuery.error ? asError(configQuery.error) : marketsQuery.error ? asError(marketsQuery.error) : null, retryRpc,
    positions: positionsQuery.data ?? [], positionsLoading: positionsQuery.isLoading, positionsError: positionsQuery.error ? asError(positionsQuery.error) : null, claimablePositions: claimableQuery.data ?? [], myMarketCount: myMarketCountQuery.data, activities: activityQuery.data ?? [], activityCount: activityCountQuery.data, activityLoading: activityQuery.isLoading, notificationsOpen, setNotificationsOpen,
    connected, walletAddress, balance: balanceQuery.data, wrongNetwork, walletPending, walletError, writeBusy, connectWallet, switchToStudio, disconnectWallet, getPosition, placeBet, claim, claimRefund, settleMarket, createMarket, transaction: tracked, dismissTransaction: () => setTracked((current) => current && (current.stage === "FINALIZED_SUCCESS" || current.stage === "FINALIZED_ERROR") ? null : current),
  }), [activityCountQuery.data, activityQuery.data, activityQuery.isLoading, balanceQuery.data, claimableQuery.data, configQuery.data, configQuery.error, configQuery.isLoading, connected, createMarket, disconnectWallet, getPosition, marketsQuery.data, marketsQuery.error, marketsQuery.isLoading, marketsQuery.refetch, myMarketCountQuery.data, notificationsOpen, placeBet, positionsQuery.data, positionsQuery.error, positionsQuery.isLoading, provider, retryRpc, setNotificationsOpen, settleMarket, switchToStudio, tracked, walletAddress, walletError, walletPending, wrongNetwork, writeBusy]);

  return <OutrunContext.Provider value={value}>
    {children}
    {kitRequest && <div className="transaction-kit-backdrop" role="dialog" aria-modal="true" aria-label={`${actionLabel(kitRequest.action)} transaction`}>
      <div className="transaction-kit-dialog">
        <div className="transaction-kit-heading">
          <div><span className="panel-eyebrow">Wallet approval</span><h2>{actionLabel(kitRequest.action)}</h2></div>
          <span className="transaction-kit-network">Studio Next · 61997</span>
        </div>
        <OutrunTransactionPanel account={walletAddress || null} injected={injected} readProvider={provider} request={kitRequest} onDone={completeKitRequest} onError={failKitRequest} />
      </div>
    </div>}
  </OutrunContext.Provider>;
}

export function useOutrun() { const value = useContext(OutrunContext); if (!value) throw new Error("useOutrun must be used inside OutrunProvider"); return value; }

export function useOutrunMarket(marketId: number) {
  const { provider, transaction, writeBusy } = useOutrun();
  const writeActive = writeBusy || isTransactionActiveStage(transaction?.stage);
  return useQuery({ queryKey: outrunQueryKeys.market(OUTRUN_CONFIG.chainId, OUTRUN_CONFIG.address, marketId), queryFn: () => provider.getMarket(marketId), enabled: Number.isInteger(marketId) && marketId > 0, staleTime: 10_000, refetchInterval: (query) => { const market = query.state.data; return writeActive || (market && (market.state === "SETTLED" || market.state === "INCONCLUSIVE")) ? false : 15_000; }, refetchIntervalInBackground: false, refetchOnWindowFocus: !writeActive });
}

export function useOutrunPosition(marketId: number) {
  const { provider, walletAddress, connected, wrongNetwork, transaction, writeBusy } = useOutrun();
  const writeActive = writeBusy || isTransactionActiveStage(transaction?.stage);
  return useQuery({ queryKey: outrunQueryKeys.position(OUTRUN_CONFIG.chainId, OUTRUN_CONFIG.address, walletAddress, marketId), queryFn: () => provider.getPosition(marketId, walletAddress), enabled: connected && !wrongNetwork && Number.isInteger(marketId) && marketId > 0, staleTime: 10_000, refetchInterval: writeActive ? false : 15_000, refetchIntervalInBackground: false, refetchOnWindowFocus: !writeActive });
}

export function useOutrunBettingState(marketId: number) {
  const { provider, walletAddress, connected, wrongNetwork, transaction, writeBusy } = useOutrun();
  const writeActive = writeBusy || isTransactionActiveStage(transaction?.stage);
  return useQuery({ queryKey: outrunQueryKeys.bettingState(OUTRUN_CONFIG.chainId, OUTRUN_CONFIG.address, walletAddress, marketId), queryFn: () => provider.getBettingState(marketId, walletAddress), enabled: connected && !wrongNetwork && Number.isInteger(marketId) && marketId > 0, staleTime: 10_000, refetchInterval: writeActive ? false : 15_000, refetchIntervalInBackground: false, refetchOnWindowFocus: !writeActive });
}

export function useOutrunEvidence(marketId: number, relevant = true) {
  const { provider, transaction, writeBusy } = useOutrun();
  const writeActive = writeBusy || isTransactionActiveStage(transaction?.stage);
  return useQuery({ queryKey: outrunQueryKeys.evidence(OUTRUN_CONFIG.chainId, OUTRUN_CONFIG.address, marketId, "all"), queryFn: async () => Promise.all(((["BYBIT", "GATE", "BITGET"] as const)).map((source) => provider.getSourceEvidence(marketId, source))), enabled: relevant && Number.isInteger(marketId) && marketId > 0, staleTime: 30_000, refetchInterval: writeActive ? false : (query) => query.state.data?.some((item) => item?.status === "UNAVAILABLE") ? 30_000 : false, refetchIntervalInBackground: false, refetchOnWindowFocus: !writeActive });
}
