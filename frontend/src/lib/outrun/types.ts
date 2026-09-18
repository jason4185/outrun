export const CATEGORIES = ["US_INDICES", "ASIA_INDICES", "SECTOR_INDICES"] as const;
export type Category = (typeof CATEGORIES)[number];

export const ASSETS = {
  US_INDICES: ["SPY", "QQQ", "IWM"],
  ASIA_INDICES: ["EWJ", "EWY", "EWT"],
  SECTOR_INDICES: ["SMH", "XBI", "XLE"],
} as const;
export type Asset = (typeof ASSETS)[Category][number];

export type ContractState = "OPEN" | "SETTLEMENT_PENDING" | "SETTLED" | "INCONCLUSIVE";
export type MarketStatus = "OPEN" | "LIVE" | "SETTLEMENT_PENDING" | "READY_TO_SETTLE" | "RESOLVED" | "INCONCLUSIVE";
export type SourceName = "BYBIT" | "GATE" | "BITGET";
export const SOURCES = ["BYBIT", "GATE", "BITGET"] as const;

export interface AssetPool { asset: Asset; pool: bigint; share: number; returnPct?: number; }
export interface PerformancePoint { timestamp: number; values: Record<Asset, number>; rawValues?: Partial<Record<Asset, number>>; }
export interface SourceResult { source: SourceName; winner: Asset | null; status: "VALID" | "TIE" | "UNAVAILABLE"; returns?: Partial<Record<Asset, number>>; }
export interface SourceEvidence extends SourceResult { category: Category; marketStart: number; marketEnd: number; interval: string; }

export interface Market {
  id: number;
  category: Category;
  assets: Asset[];
  symbols: string[];
  symbolsBySource: Record<SourceName, string[]>;
  start: number;
  end: number;
  state: ContractState;
  status: MarketStatus;
  totalPool: bigint;
  pools: AssetPool[];
  winner: Asset | null;
  consensus?: number;
  sourceResults?: SourceResult[];
  performance: PerformancePoint[];
  bettingOpen: boolean;
  settlementAvailable: boolean;
  settlementDeadline: number;
  winningPool: bigint;
  claimedPool: bigint;
  refundedPool: bigint;
  remainingPool: bigint;
}

export interface UserPosition {
  marketId: number;
  category: Category;
  asset: Asset;
  stake: bigint;
  marketState: ContractState;
  canTopUp: boolean;
  positionWon: boolean;
  positionLost: boolean;
  claimable: bigint;
  claimAvailable: boolean;
  refundAvailable: boolean;
  claimed: boolean;
  refunded: boolean;
}

export interface BettingState { category: Category; totalMarketPool: bigint; outcomeStakes: Record<Asset, bigint>; bettorAsset: Asset | null; bettorStake: bigint; claimed: boolean; refunded: boolean; winningPool: bigint; claimedPool: bigint; claimedWinningStake: bigint; refundedPool: bigint; }

export interface ActivityItem { id: bigint; wallet: string; marketId: number; type: string; category: Category; asset: Asset; amount: bigint; timestamp: number; }

export type NotificationType = "BET_CONFIRMED" | "TOP_UP_CONFIRMED" | "MARKET_STARTED" | "MARKET_ENDED" | "MARKET_RESOLVED_WIN" | "MARKET_RESOLVED_LOSS" | "MARKET_INCONCLUSIVE" | "CLAIM_SUCCESS" | "REFUND_SUCCESS" | "MARKET_CREATED" | "SETTLEMENT_PENDING";
export interface NotificationRecord { id: string; type: NotificationType; title: string; description: string; timestamp: number; unread: boolean; marketId?: number; category?: Category; asset?: Asset; amount?: bigint; }

export interface ContractConfig {
  protocol: string;
  categories: Category[];
  categoryAssets: Record<Category, Asset[]>;
  durationSeconds: bigint;
  minimumBet: bigint;
  maximumBetPerWalletPerMarket: bigint;
  feeBps: bigint;
  sources: SourceName[];
  consensusThreshold: bigint;
  timezone: string;
  settlementRetryWindowSeconds: bigint;
  maxPageSize: bigint;
}

export interface TransactionHandle { txId: string; action: "create_market" | "place_bet" | "settle_market" | "claim" | "claim_refund"; marketId?: number; }

export interface OutrunDataProvider {
  getConfig(): Promise<ContractConfig>;
  getCategories(): Promise<Category[]>;
  getCategoryAssets(category: Category): Promise<Asset[]>;
  getMarkets(offset?: number, limit?: number): Promise<Market[]>;
  getOpenMarkets(offset?: number, limit?: number): Promise<Market[]>;
  getMarketCount(): Promise<number>;
  getMarket(marketId: number): Promise<Market | null>;
  getMarketByCategoryStart(category: Category, marketStart: number): Promise<Market>;
  getBettingState(marketId: number, wallet: string): Promise<BettingState>;
  getMyMarketCount(wallet: string): Promise<number>;
  getPosition(marketId: number, wallet: string): Promise<UserPosition | null>;
  getPositions(wallet: string, offset?: number, limit?: number): Promise<UserPosition[]>;
  getClaimablePositions(wallet: string, offset?: number, limit?: number): Promise<UserPosition[]>;
  getActivityCount(wallet: string): Promise<number>;
  getActivity(wallet: string, offset?: number, limit?: number): Promise<ActivityItem[]>;
  getSourceEvidence(marketId: number, source: SourceName): Promise<SourceEvidence | null>;
}

export const CATEGORY_LABEL: Record<Category, string> = { US_INDICES: "US Indices", ASIA_INDICES: "Asia Indices", SECTOR_INDICES: "Sector Indices" };
export const ASSET_NAMES: Record<Asset, string> = { SPY: "S&P 500 ETF", QQQ: "Nasdaq-100 ETF", IWM: "Russell 2000 ETF", EWJ: "Japan ETF", EWY: "South Korea ETF", EWT: "Taiwan ETF", SMH: "Semiconductor ETF", XBI: "Biotech ETF", XLE: "Energy ETF" };
export const ASSET_COLORS: Record<Asset, string> = { SPY: "#4F8CFF", QQQ: "#A978FF", IWM: "#FF9B52", EWJ: "#4F8CFF", EWY: "#A978FF", EWT: "#FF9B52", SMH: "#4F8CFF", XBI: "#A978FF", XLE: "#FF9B52" };
export const SOURCE_LABEL: Record<SourceName, string> = { BYBIT: "Bybit", GATE: "Gate", BITGET: "Bitget" };
