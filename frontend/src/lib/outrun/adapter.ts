import { createClient, isSuccessful } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";
import { TransactionHashVariant, type CalldataEncodable, type GenLayerClient, type Hash } from "genlayer-js/types";
import type { Account, Address } from "viem";
import { ASSETS, CATEGORIES, SOURCES, type ActivityItem, type Asset, type BettingState, type Category, type ContractConfig, type ContractState, type Market, type OutrunDataProvider, type SourceEvidence, type SourceName, type SourceResult, type TransactionHandle, type UserPosition } from "./types";
import { OUTRUN_CONFIG } from "./config";

type ClientConfig = NonNullable<Parameters<typeof createClient>[0]>;
export type GenLayerWalletProvider = NonNullable<ClientConfig["provider"]>;
type ReadClient = GenLayerClient<typeof studioDevnet>;

export const readClient = createClient({ chain: OUTRUN_CONFIG.chain });
export type WalletGenLayerClient = ReadClient;

function readAccount(address?: string): Account | undefined {
  return address ? ({ address: address as Address } as Account) : undefined;
}

function asBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  throw new Error("Unexpected numeric value from OUTRUN contract");
}

function asNumber(value: unknown): number { return Number(asBigInt(value)); }
function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }
function asArray(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function asString(value: unknown): string { return typeof value === "string" ? value : String(value ?? ""); }

function categoryOf(value: unknown): Category {
  const category = asString(value);
  if ((CATEGORIES as readonly string[]).includes(category)) return category as Category;
  throw new Error("OUTRUN returned an unknown category");
}

function assetOf(value: unknown, category: Category): Asset {
  const asset = asString(value);
  if ((ASSETS[category] as readonly string[]).includes(asset)) return asset as Asset;
  throw new Error("OUTRUN returned an unknown asset");
}

function sourceOf(value: unknown): SourceName {
  const source = asString(value);
  if ((SOURCES as readonly string[]).includes(source)) return source as SourceName;
  throw new Error("OUTRUN returned an unknown settlement source");
}

function shareOf(pool: bigint, total: bigint) {
  return total === 0n ? 0 : Number(pool * 10_000n / total) / 100;
}

function marketStatus(state: ContractState, bettingOpen: boolean, end: number): Market["status"] {
  if (state === "SETTLED") return "RESOLVED";
  if (state === "INCONCLUSIVE") return "INCONCLUSIVE";
  if (state === "SETTLEMENT_PENDING") return "SETTLEMENT_PENDING";
  if (bettingOpen) return "OPEN";
  return Math.floor(Date.now() / 1000) < end ? "LIVE" : "READY_TO_SETTLE";
}

function normalizeMarket(value: unknown): Market {
  const raw = asRecord(value);
  const category = categoryOf(raw.category);
  const assets = ASSETS[category].map((asset) => asset as Asset);
  const totalPool = asBigInt(raw.total_pool);
  const outcomePools = asRecord(raw.outcome_pools);
  const pools = assets.map((asset) => {
    const pool = asBigInt(outcomePools[asset] ?? 0);
    return { asset, pool, share: shareOf(pool, totalPool) };
  });
  const state = asString(raw.state) as ContractState;
  const start = asNumber(raw.market_start);
  const end = asNumber(raw.market_end);
  const winnerValue = asString(raw.winner);
  const winner = winnerValue ? assetOf(winnerValue, category) : null;
  const symbolsBySource = {} as Record<SourceName, string[]>;
  for (const source of SOURCES) symbolsBySource[source] = asArray(asRecord(raw.symbols_by_source)[source]).map(asString);
  return {
    id: asNumber(raw.id), category, assets, symbols: asArray(raw.symbols).map(asString), symbolsBySource,
    start, end, state, status: marketStatus(state, Boolean(raw.betting_open), end), totalPool, pools, winner,
    performance: [], bettingOpen: Boolean(raw.betting_open), settlementAvailable: Boolean(raw.settlement_available),
    settlementDeadline: asNumber(raw.settlement_deadline), winningPool: asBigInt(raw.winning_pool),
    claimedPool: asBigInt(raw.claimed_pool), refundedPool: asBigInt(raw.refunded_pool), remainingPool: asBigInt(raw.remaining_pool),
  };
}

function normalizePosition(value: unknown): UserPosition | null {
  const raw = asRecord(value);
  if (!Boolean(raw.has_position)) return null;
  const category = categoryOf(raw.category);
  return {
    marketId: asNumber(raw.market_id), category, asset: assetOf(raw.selected_asset, category), stake: asBigInt(raw.total_stake),
    marketState: asString(raw.market_state) as ContractState, canTopUp: Boolean(raw.can_top_up), positionWon: Boolean(raw.position_won),
    positionLost: Boolean(raw.position_lost), claimable: asBigInt(raw.claimable_amount), claimAvailable: Boolean(raw.claim_available),
    refundAvailable: Boolean(raw.refund_available), claimed: Boolean(raw.already_claimed), refunded: Boolean(raw.refunded),
  };
}

function normalizeActivity(value: unknown): ActivityItem {
  const raw = asRecord(value);
  const category = categoryOf(raw.category);
  return { id: asBigInt(raw.id), wallet: asString(raw.wallet), marketId: asNumber(raw.market_id), type: asString(raw.type), category, asset: assetOf(raw.asset, category), amount: asBigInt(raw.amount), timestamp: asNumber(raw.timestamp) };
}

function normalizeBettingState(value: unknown): BettingState {
  const raw = asRecord(value);
  const category = categoryOf(raw.category);
  const outcomeStakes = {} as Record<Asset, bigint>;
  const rawStakes = asRecord(raw.outcome_stakes);
  for (const asset of ASSETS[category]) outcomeStakes[asset] = asBigInt(rawStakes[asset] ?? 0);
  const bettorAssetValue = asString(raw.bettor_asset);
  return { category, totalMarketPool: asBigInt(raw.total_market_pool), outcomeStakes, bettorAsset: bettorAssetValue ? assetOf(bettorAssetValue, category) : null, bettorStake: asBigInt(raw.bettor_stake), claimed: Boolean(raw.claimed), refunded: Boolean(raw.refunded), winningPool: asBigInt(raw.winning_pool), claimedPool: asBigInt(raw.claimed_pool), claimedWinningStake: asBigInt(raw.claimed_winning_stake), refundedPool: asBigInt(raw.refunded_pool) };
}

async function read<T>(client: ReadClient, functionName: string, args: CalldataEncodable[] = [], account?: string): Promise<T> {
  return await client.readContract({ address: OUTRUN_CONFIG.address, functionName, args, account: readAccount(account), transactionHashVariant: TransactionHashVariant.LATEST_FINAL }) as T;
}

async function write(client: WalletGenLayerClient | undefined, action: TransactionHandle["action"], functionName: string, args: CalldataEncodable[], value?: bigint, marketId?: number): Promise<TransactionHandle> {
  if (!client) throw new Error("Connect an injected wallet on Studio Dev before submitting a transaction.");
  const feeEstimate = await client.estimateTransactionFeesForWrite({ address: OUTRUN_CONFIG.address, functionName, args, ...(value !== undefined ? { value } : {}) });
  const txId = await client.writeContract({ address: OUTRUN_CONFIG.address, functionName, args, ...(value !== undefined ? { value } : {}), fees: { distribution: feeEstimate.distribution, messageAllocations: feeEstimate.messageAllocations, feeValue: feeEstimate.feeValue } });
  return { txId: String(txId), action, marketId };
}

export function createOutrunProvider(walletClient?: WalletGenLayerClient): OutrunDataProvider {
  return {
    async getConfig() {
      const raw = asRecord(await read(readClient, "get_config"));
      const categoryAssets = {} as Record<Category, Asset[]>;
      for (const category of CATEGORIES) categoryAssets[category] = asArray(asRecord(raw.category_assets)[category]).map((asset) => assetOf(asset, category));
      return { protocol: asString(raw.protocol), categories: asArray(raw.categories).map(categoryOf), categoryAssets, durationSeconds: asBigInt(raw.duration_seconds), minimumBet: asBigInt(raw.minimum_bet), maximumBetPerWalletPerMarket: asBigInt(raw.maximum_bet_per_wallet_per_market), feeBps: asBigInt(raw.fee_bps), sources: asArray(raw.sources).map(sourceOf), consensusThreshold: asBigInt(raw.consensus_threshold), timezone: asString(raw.timezone), settlementRetryWindowSeconds: asBigInt(raw.settlement_retry_window_seconds), maxPageSize: asBigInt(raw.max_page_size) };
    },
    async getCategories() { return asArray(await read(readClient, "categories")).map(categoryOf); },
    async getCategoryAssets(category) { return asArray(await read(readClient, "category_assets", [category])).map((asset) => assetOf(asset, category)); },
    async getMarkets(offset = 0, limit = 50) { return asArray(await read(readClient, "get_markets", [BigInt(offset), BigInt(limit)])).map(normalizeMarket); },
    async getOpenMarkets(offset = 0, limit = 50) { return asArray(await read(readClient, "get_open_markets", [BigInt(offset), BigInt(limit)])).map(normalizeMarket); },
    async getMarketCount() { return asNumber(await read(readClient, "get_market_count")); },
    async getMarket(marketId) { return normalizeMarket(await read(readClient, "get_market", [BigInt(marketId)])); },
    async getMarketByCategoryStart(category, marketStart) { return normalizeMarket(await read(readClient, "get_market_by_category_start", [category, BigInt(marketStart)])); },
    async getBettingState(marketId, wallet) { return normalizeBettingState(await read(readClient, "get_betting_state", [BigInt(marketId)], wallet)); },
    async getMyMarketCount(wallet) { return asNumber(await read(readClient, "get_my_market_count", [], wallet)); },
    async getPosition(marketId, wallet) { return normalizePosition(await read(readClient, "get_my_position", [BigInt(marketId)], wallet)); },
    async getPositions(wallet, offset = 0, limit = 50) { return asArray(await read(readClient, "get_my_positions", [BigInt(offset), BigInt(limit)], wallet)).map(normalizePosition).filter((position): position is UserPosition => position !== null); },
    async getClaimablePositions(wallet, offset = 0, limit = 50) { return asArray(await read(readClient, "get_my_claimable_markets", [BigInt(offset), BigInt(limit)], wallet)).map(normalizePosition).filter((position): position is UserPosition => position !== null); },
    async getActivityCount(wallet) { return asNumber(await read(readClient, "get_my_activity_count", [], wallet)); },
    async getActivity(wallet, offset = 0, limit = 50) { return asArray(await read(readClient, "get_my_activity", [BigInt(offset), BigInt(limit)], wallet)).map(normalizeActivity); },
    async getSourceEvidence(marketId, source) {
      try {
        const raw = asRecord(await read(readClient, "get_source_evidence", [BigInt(marketId), source]));
        const category = categoryOf(raw.category);
        const winnerName = asString(raw.source_winner);
        return { source, category, marketStart: asNumber(raw.market_start), marketEnd: asNumber(raw.market_end), interval: asString(raw.interval), winner: winnerName ? assetOf(winnerName, category) : null, status: asString(raw.source_status) as SourceResult["status"] };
      } catch (error) {
        if (String(error).toLowerCase().includes("evidence unavailable")) return null;
        throw error;
      }
    },
    createMarket: (category, marketStart) => write(walletClient, "create_market", "create_market", [category, BigInt(marketStart)]),
    placeBet: (marketId, asset, amount) => write(walletClient, "place_bet", "place_bet", [BigInt(marketId), asset], amount, marketId),
    settleMarket: (marketId) => write(walletClient, "settle_market", "settle_market", [BigInt(marketId)], undefined, marketId),
    claim: (marketId) => write(walletClient, "claim", "claim", [BigInt(marketId)], undefined, marketId),
    claimRefund: (marketId) => write(walletClient, "claim_refund", "claim_refund", [BigInt(marketId)], undefined, marketId),
  };
}

export function createWalletClient(address: Address, provider: GenLayerWalletProvider): WalletGenLayerClient {
  return createClient({ chain: OUTRUN_CONFIG.chain, account: address, provider });
}

export function transactionSucceeded(receipt: unknown): boolean { return isSuccessful(receipt as Parameters<typeof isSuccessful>[0]); }
export type GenLayerTransactionHash = Hash;
