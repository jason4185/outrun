import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, useBalance, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { useLocation } from "react-router-dom";
import type { Hash } from "genlayer-js/types";
import { createOutrunProvider, createWalletClient, readClient, transactionSucceeded, type GenLayerWalletProvider, type WalletGenLayerClient } from "../lib/outrun/adapter";
import { OUTRUN_CONFIG } from "../lib/outrun/config";
import { normalizeOutrunError } from "../lib/outrun/errors";
import { outrunQueryKeys } from "../lib/outrun/query-keys";
import type { ActivityItem, Asset, Category, ContractConfig, Market, OutrunDataProvider, TransactionHandle, UserPosition } from "../lib/outrun/types";
import { isTransactionActiveStage, readPendingTransactions, savePendingTransactions, updatePendingTransaction, type TrackedTransaction, type TransactionStage } from "../lib/outrun/transactions";

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
function executionFailureText(transaction: unknown) {
  if (!transaction || typeof transaction !== "object") return "Transaction execution failed";
  const value = transaction as Record<string, unknown>;
  for (const key of ["error", "reason", "txExecutionResultName", "resultName"]) if (typeof value[key] === "string" && value[key]) return value[key] as string;
  return "Transaction execution failed";
}
function actionLabel(action: TransactionHandle["action"]) { return action === "place_bet" ? "Bet" : action === "create_market" ? "Market creation" : action === "settle_market" ? "Settlement" : action === "claim" ? "Claim" : "Refund"; }

export function OutrunProvider({ children }: { children: ReactNode }) {
  const { address, chainId, isConnected, connector } = useAccount();
  const { connect, connectors, isPending: walletPending, error: connectError } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const [walletClient, setWalletClient] = useState<WalletGenLayerClient>();
  const [tracked, setTracked] = useState<TrackedTransaction | null>(() => readPendingTransactions()[0] ?? null);
  const [writeBusy, setWriteBusy] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const writeBusyRef = useRef(false);
  const trackedIds = useRef(new Set<string>());
  const resumeTimers = useRef(new Map<string, number>());
  const previousAddress = useRef<string | undefined>(undefined);
  const connected = Boolean(isConnected && address);
  const walletAddress = address ?? "";
  const wrongNetwork = connected && chainId !== OUTRUN_CONFIG.chainId;
  const isMarketsRoute = pathname === "/markets";
  const isPortfolioRoute = pathname === "/portfolio";
  const writeActive = writeBusy || isTransactionActiveStage(tracked?.stage);

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
    setWalletClient(undefined);
    if (!address || !connector || chainId !== OUTRUN_CONFIG.chainId) return () => { active = false; };
    void connector.getProvider().then((provider) => {
      if (active) setWalletClient(createWalletClient(address, provider as GenLayerWalletProvider));
    }).catch(() => { if (active) setWalletClient(undefined); });
    return () => { active = false; };
  }, [address, chainId, connector]);

  const provider = useMemo(() => createOutrunProvider(walletClient), [walletClient]);
  const configQuery = useQuery({ queryKey: outrunQueryKeys.config(OUTRUN_CONFIG.chainId, OUTRUN_CONFIG.address), queryFn: () => provider.getConfig(), staleTime: 300_000, refetchInterval: false, refetchOnWindowFocus: false });
  const marketsQuery = useQuery({ queryKey: outrunQueryKeys.markets(OUTRUN_CONFIG.chainId, OUTRUN_CONFIG.address, 0, 50), queryFn: () => provider.getMarkets(0, 50), enabled: isMarketsRoute || isPortfolioRoute, staleTime: 10_000, refetchInterval: writeActive ? false : 15_000, refetchIntervalInBackground: false, refetchOnWindowFocus: !writeActive });
  const userEnabled = connected && !wrongNetwork;
  const positionsQuery = useQuery({ queryKey: outrunQueryKeys.positions(OUTRUN_CONFIG.chainId, OUTRUN_CONFIG.address, walletAddress, 0, 50), queryFn: () => provider.getPositions(walletAddress, 0, 50), enabled: userEnabled && isPortfolioRoute && !writeActive, staleTime: 10_000, refetchInterval: writeActive ? false : 15_000, refetchIntervalInBackground: false, refetchOnWindowFocus: !writeActive });
  const claimableQuery = useQuery({ queryKey: outrunQueryKeys.claimable(OUTRUN_CONFIG.chainId, OUTRUN_CONFIG.address, walletAddress, 0, 50), queryFn: () => provider.getClaimablePositions(walletAddress, 0, 50), enabled: userEnabled && isPortfolioRoute && !writeActive, staleTime: 10_000, refetchInterval: writeActive ? false : 15_000, refetchIntervalInBackground: false, refetchOnWindowFocus: !writeActive });
  const activityQuery = useQuery({ queryKey: outrunQueryKeys.activity(OUTRUN_CONFIG.chainId, OUTRUN_CONFIG.address, walletAddress, 0, 50), queryFn: () => provider.getActivity(walletAddress, 0, 50), enabled: userEnabled && (isPortfolioRoute || notificationsOpen) && !writeActive, staleTime: 60_000, refetchInterval: false, refetchIntervalInBackground: false, refetchOnWindowFocus: !writeActive });
  const myMarketCountQuery = useQuery({ queryKey: outrunQueryKeys.myMarketCount(OUTRUN_CONFIG.chainId, OUTRUN_CONFIG.address, walletAddress), queryFn: () => provider.getMyMarketCount(walletAddress), enabled: userEnabled && isPortfolioRoute && !writeActive, staleTime: 15_000, refetchInterval: writeActive ? false : 15_000, refetchIntervalInBackground: false, refetchOnWindowFocus: !writeActive });
  const activityCountQuery = useQuery({ queryKey: outrunQueryKeys.activityCount(OUTRUN_CONFIG.chainId, OUTRUN_CONFIG.address, walletAddress), queryFn: () => provider.getActivityCount(walletAddress), enabled: userEnabled && !writeActive, staleTime: 60_000, refetchInterval: writeActive ? false : 60_000, refetchIntervalInBackground: false, refetchOnWindowFocus: !writeActive });
  const balanceQuery = useBalance({ address, chainId: OUTRUN_CONFIG.chainId, query: { enabled: userEnabled, staleTime: 60_000, refetchInterval: writeActive ? false : 60_000, refetchIntervalInBackground: false, refetchOnWindowFocus: !writeActive } });
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

  const resumeTransaction = useCallback(async (item: TrackedTransaction): Promise<{ status: "finalized" | "failed" | "tracking"; message?: string }> => {
    if (trackedIds.current.has(item.txId)) return { status: "tracking" };
    trackedIds.current.add(item.txId);
    const existingTimer = resumeTimers.current.get(item.txId);
    if (existingTimer !== undefined) { window.clearTimeout(existingTimer); resumeTimers.current.delete(item.txId); }
    setTracked({ ...item, stage: "WAITING_FOR_DECISION", message: `${actionLabel(item.action)} transaction is processing.` });
    updatePendingTransaction(item.txId, { stage: "WAITING_FOR_DECISION" });
    try {
      await readClient.waitForDecision({ hash: item.txId as Hash, interval: 5_000, retries: 100 });
      setTracked({ ...item, stage: "DECIDED", message: `${actionLabel(item.action)} decision received. Finalizing…` });
      updatePendingTransaction(item.txId, { stage: "DECIDED" });
      setTracked({ ...item, stage: "WAITING_FOR_FINALIZATION", message: `${actionLabel(item.action)} decision received. Finalizing…` });
      updatePendingTransaction(item.txId, { stage: "WAITING_FOR_FINALIZATION" });
      const finalized = await readClient.waitForFinalization({ hash: item.txId as Hash, interval: 5_000, retries: 100 });
      const verified = await readClient.getTransaction({ hash: item.txId as Hash });
      if (!transactionSucceeded(verified)) {
        const failure = normalizeOutrunError(new Error(executionFailureText(verified)), "finalized-error");
        setTracked({ ...item, stage: "FINALIZED_ERROR", message: failure.message });
        savePendingTransactions(readPendingTransactions().filter((pending) => pending.txId !== item.txId));
        resumeTimers.current.delete(item.txId);
        return { status: "failed", message: failure.message };
      }
      setTracked({ ...item, stage: "FINALIZED_SUCCESS", message: `${actionLabel(item.action)} finalized successfully.` });
      savePendingTransactions(readPendingTransactions().filter((pending) => pending.txId !== item.txId));
      resumeTimers.current.delete(item.txId);
      await queryClient.invalidateQueries({ queryKey: ["outrun"] });
      void balanceQuery.refetch().catch(() => undefined);
      return { status: "finalized" };
    } catch (error) {
      const friendly = normalizeOutrunError(error, "post-submit", true);
      setTracked({ ...item, stage: "TRACKING_ERROR", message: `${friendly.message} Do not resubmit; tracking ${item.txId.slice(0, 10)}…` });
      updatePendingTransaction(item.txId, { stage: "TRACKING_ERROR", message: friendly.message });
      if (!resumeTimers.current.has(item.txId)) {
        const timer = window.setTimeout(() => { resumeTimers.current.delete(item.txId); void resumeTransaction(item); }, 5_000);
        resumeTimers.current.set(item.txId, timer);
      }
      return { status: "tracking" };
    } finally { trackedIds.current.delete(item.txId); }
  }, [balanceQuery.refetch, queryClient]);

  useEffect(() => {
    for (const item of readPendingTransactions()) void resumeTransaction(item);
  }, [resumeTransaction]);

  const trackWrite = useCallback(async (startWrite: () => Promise<TransactionHandle>): Promise<TransactionHandle> => {
    if (!connected) throw new Error("Connect your injected wallet before submitting.");
    if (wrongNetwork) throw new Error("Switch to Studio Dev before submitting.");
    if (writeBusyRef.current || readPendingTransactions().length > 0) throw new Error("An OUTRUN transaction is already being tracked. Please wait before submitting another action.");
    writeBusyRef.current = true;
    setWriteBusy(true);
    let submitted = false;
    let finalizedFailure: string | undefined;
    try {
      const handle = await startWrite();
      submitted = true;
      const initial: TrackedTransaction = { txId: handle.txId, action: handle.action, marketId: handle.marketId, timestamp: Date.now(), stage: "SUBMITTED" };
      savePendingTransactions([...readPendingTransactions().filter((item) => item.txId !== handle.txId), initial]);
      setTracked(initial);
      const result = await resumeTransaction(initial);
      if (result.status === "tracking") throw new Error("Transaction status check is still processing.");
      if (result.status === "failed") { finalizedFailure = result.message ?? "The transaction was finalized but could not be completed."; throw new Error(finalizedFailure); }
      return handle;
    } catch (error) {
      if (finalizedFailure) throw new Error(finalizedFailure);
      const friendly = normalizeOutrunError(error, submitted ? "post-submit" : "write", submitted);
      throw new Error(friendly.message);
    } finally {
      writeBusyRef.current = false;
      setWriteBusy(false);
    }
  }, [connected, resumeTransaction, wrongNetwork]);

  const connectWallet = () => { const injected = connectors[0]; if (injected) connect({ connector: injected }); };
  const switchToStudio = async () => { if (switchChainAsync) await switchChainAsync({ chainId: OUTRUN_CONFIG.chainId }); };
  const disconnectWallet = async () => { await disconnectAsync(); setWalletClient(undefined); };
  const getPosition = (marketId: number) => positionsQuery.data?.find((position) => position.marketId === marketId) ?? null;
  const requireWallet = () => { if (!walletClient) throw new Error("Wallet provider is not ready. Reconnect your injected wallet."); };
  const placeBet = (marketId: number, asset: Asset, amount: bigint) => { requireWallet(); return trackWrite(() => provider.placeBet(marketId, asset, amount)); };
  const claim = (marketId: number) => { requireWallet(); return trackWrite(() => provider.claim(marketId)); };
  const claimRefund = (marketId: number) => { requireWallet(); return trackWrite(() => provider.claimRefund(marketId)); };
  const settleMarket = (marketId: number) => { requireWallet(); return trackWrite(() => provider.settleMarket(marketId)); };
  const createMarket = (category: Category, start: number) => { requireWallet(); return trackWrite(() => provider.createMarket(category, start)); };

  const value = useMemo<OutrunContextValue>(() => ({
    provider, config: configQuery.data, configLoading: configQuery.isLoading, markets: marketsQuery.data ?? [], marketsLoading: marketsQuery.isLoading, marketsError: marketsQuery.error ? asError(marketsQuery.error) : null, refetchMarkets: marketsQuery.refetch, rpcError: configQuery.error ? asError(configQuery.error) : marketsQuery.error ? asError(marketsQuery.error) : null, retryRpc,
    positions: positionsQuery.data ?? [], positionsLoading: positionsQuery.isLoading, positionsError: positionsQuery.error ? asError(positionsQuery.error) : null, claimablePositions: claimableQuery.data ?? [], myMarketCount: myMarketCountQuery.data, activities: activityQuery.data ?? [], activityCount: activityCountQuery.data, activityLoading: activityQuery.isLoading, notificationsOpen, setNotificationsOpen,
    connected, walletAddress, balance: balanceQuery.data?.value, wrongNetwork, walletPending, walletError: connectError ? asError(connectError) : undefined, writeBusy, connectWallet, switchToStudio, disconnectWallet, getPosition, placeBet, claim, claimRefund, settleMarket, createMarket, transaction: tracked, dismissTransaction: () => setTracked((current) => current && (current.stage === "FINALIZED_SUCCESS" || current.stage === "FINALIZED_ERROR") ? null : current),
  }), [activityCountQuery.data, activityQuery.data, activityQuery.isLoading, balanceQuery.data?.value, claimableQuery.data, configQuery.data, configQuery.error, configQuery.isLoading, connectError, connected, createMarket, getPosition, marketsQuery.data, marketsQuery.error, marketsQuery.isLoading, marketsQuery.refetch, myMarketCountQuery.data, notificationsOpen, placeBet, positionsQuery.data, positionsQuery.error, positionsQuery.isLoading, provider, retryRpc, setNotificationsOpen, settleMarket, tracked, walletAddress, walletPending, wrongNetwork, writeBusy]);

  return <OutrunContext.Provider value={value}>{children}</OutrunContext.Provider>;
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
