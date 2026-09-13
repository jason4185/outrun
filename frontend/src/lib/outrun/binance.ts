import type { Asset, Market, PerformancePoint } from "./types";

export const BINANCE_KLINES_URL = "https://fapi.binance.com/fapi/v1/klines";
export type ChartPhase = "PRE_MARKET" | "ACTIVE" | "COMPLETED";

interface Kline { timestamp: number; close: number; }

export function getChartPhase(market: Pick<Market, "start" | "end">, now = Math.floor(Date.now() / 1000)): ChartPhase {
  if (now < market.start) return "PRE_MARKET";
  if (now < market.end) return "ACTIVE";
  return "COMPLETED";
}

async function fetchKlines(asset: Asset, start: number, end: number, signal?: AbortSignal): Promise<Kline[]> {
  const params = new URLSearchParams({ symbol: `${asset}USDT`, interval: "1m", startTime: String(start * 1000), endTime: String(end * 1000), limit: "1000" });
  const response = await fetch(`${BINANCE_KLINES_URL}?${params}`, { signal });
  if (!response.ok) throw new Error(`Binance chart request failed (${response.status})`);
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error("Binance returned an invalid chart response");
  return payload.filter((row): row is unknown[] => Array.isArray(row) && row.length >= 6).map((row) => {
    const timestamp = Number(row[0]);
    const close = Number(row[4]);
    if (!Number.isFinite(timestamp) || !Number.isFinite(close) || close <= 0) throw new Error("Binance returned malformed chart data");
    return { timestamp: Math.floor(timestamp / 1000), close };
  }).filter((row) => row.timestamp >= start && row.timestamp < end);
}

export async function fetchBinancePerformance(market: Market, signal?: AbortSignal): Promise<PerformancePoint[]> {
  const now = Math.floor(Date.now() / 1000);
  const phase = getChartPhase(market, now);
  const end = phase === "PRE_MARKET" ? now : Math.min(now, market.end);
  const start = phase === "PRE_MARKET" ? Math.max(0, end - 3600) : market.start;
  if (end <= start) return [];
  const series = await Promise.all(market.assets.map(async (asset) => [asset, await fetchKlines(asset, start, end, signal)] as const));
  const byAsset = new Map(series);
  const timestamps = series[0][1].map((point) => point.timestamp).filter((timestamp) => series.every(([, points]) => points.some((point) => point.timestamp === timestamp)));
  const baselines = new Map<Asset, number>(series.map(([asset, points]) => [asset, points[0]?.close ?? 0]));
  return timestamps.map((timestamp) => {
    const values = {} as Record<Asset, number>;
    const rawValues = {} as Partial<Record<Asset, number>>;
    for (const asset of market.assets) {
      const point = byAsset.get(asset)?.find((candidate) => candidate.timestamp === timestamp);
      const baseline = baselines.get(asset) ?? 0;
      if (!point || baseline <= 0) throw new Error("Binance chart baseline is unavailable");
      rawValues[asset] = point.close;
      values[asset] = (point.close / baseline - 1) * 100;
    }
    return { timestamp, values, rawValues };
  });
}
