import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Clock3, Info } from "lucide-react";
import { useParams } from "react-router-dom";
import { useOutrunEvidence, useOutrunMarket, useOutrunPosition } from "../app/context";
import { AssetBadge, CategoryBadge, EmptyState, ErrorState, FinalRanking, InfoStrip, LoadingState, PageContainer, PerformanceChart, PoolComposition, PredictionPanel, SectionBack, SourceConsensus, StatusBadge, formatDate, formatGen, formatPercent, formatWindow, getLeader, marketQuestion } from "../components/outrun/components";
import { fetchBinancePerformance, getChartPhase } from "../lib/outrun/binance";
import { outrunQueryKeys } from "../lib/outrun/query-keys";

export function MarketDetailPage() {
  const { id } = useParams();
  const marketId = Number(id);
  const marketQuery = useOutrunMarket(marketId);
  const positionQuery = useOutrunPosition(marketId);
  const [section, setSection] = useState<"performance" | "pool">("performance");
  const market = marketQuery.data;
  const evidenceQuery = useOutrunEvidence(marketId, Boolean(market && (market.settlementAvailable || market.state === "SETTLEMENT_PENDING" || market.state === "SETTLED" || market.state === "INCONCLUSIVE")));
  const phase = market ? getChartPhase(market) : "PRE_MARKET";
  const chartQuery = useQuery({
    queryKey: market ? outrunQueryKeys.chart(market.id, market.assets.join(","), market.start, market.end) : ["binance-chart", "unavailable", marketId],
    queryFn: ({ signal }) => fetchBinancePerformance(market!, signal),
    enabled: Boolean(market),
    staleTime: phase === "COMPLETED" ? Infinity : 10_000,
    refetchInterval: phase === "COMPLETED" ? false : 15_000,
    refetchIntervalInBackground: false,
  });

  if (!Number.isInteger(marketId) || marketId < 1) return <PageContainer narrow><EmptyState title="Market unavailable" copy="Enter a valid OUTRUN market ID." action={<SectionBack />} /></PageContainer>;
  if (marketQuery.isLoading) return <PageContainer narrow><SectionBack /><LoadingState /></PageContainer>;
  if (marketQuery.isError || !market) return <PageContainer narrow><ErrorState copy="Studio Dev could not return this market." onRetry={() => void marketQuery.refetch()} /><SectionBack /></PageContainer>;

  const chartMarket = { ...market, performance: chartQuery.data ?? [] };
  const leader = getLeader(chartMarket);
  const chartTitle = phase === "PRE_MARKET" ? "Recent Performance" : phase === "ACTIVE" ? "Live Performance" : "Market Performance";
  const chartSubtitle = phase === "PRE_MARKET" ? "Live Binance performance before the market opens" : phase === "ACTIVE" ? "Relative return since market open" : "Informational Binance performance for the market window";
  return <PageContainer>
    <SectionBack />
    <section className="detail-top"><div><div className="detail-kicker"><CategoryBadge category={market.category} /><span>·</span><span>OUTRUN</span><span>·</span><span>1 Hour</span></div><h1 className="detail-title">{marketQuestion(market.category)}</h1><div className="detail-timing"><span><CalendarDays />{formatDate(market.start)}</span><span><Clock3 />{formatWindow(market.start, market.end)}</span>{market.status === "LIVE" && leader && <span style={{ color: "var(--lime)" }}>Leader {leader[0]} {formatPercent(leader[1])}</span>}</div></div><div className="detail-status"><StatusBadge status={market.status} /><div className="pool-total"><label>Total pool</label><strong>{formatGen(market.totalPool)}</strong></div></div></section>
    <div className="detail-layout"><div className="left-stack">
      <section className="surface detail-card"><div className="card-heading"><div><h2>{section === "performance" ? chartTitle : "Pool Composition"}</h2><p>{section === "performance" ? chartSubtitle : "How GEN is distributed across the three competitors"}</p></div><div className="segmented"><button className={`segment${section === "performance" ? " active" : ""}`} type="button" onClick={() => setSection("performance")}>{chartTitle}</button><button className={`segment${section === "pool" ? " active" : ""}`} type="button" onClick={() => setSection("pool")}>Pool Composition</button></div></div>{section === "performance" ? chartQuery.isError ? <div className="chart-unavailable"><strong>Live chart temporarily unavailable</strong><span>We couldn't load Binance market data. We'll retry shortly.</span></div> : <><PerformanceChart market={chartMarket} /><InfoStrip><strong>{phase === "PRE_MARKET" ? "Pre-market data is informational only." : phase === "ACTIVE" ? "Live performance is informational only." : "Market performance is informational only."}</strong> {phase === "PRE_MARKET" ? `Market performance resets at ${formatWindow(market.start, market.start).split(" →")[0]} UTC.` : "Settlement uses Binance, Gate and Bitget with 2-of-3 source consensus."}</InfoStrip></> : <PoolComposition market={market} />}</section>
      {market.status === "RESOLVED" && <FinalRanking market={chartMarket} />}
      {market.status === "RESOLVED" && <section className="surface detail-card"><div className="card-heading"><div><h2>Settlement consensus</h2><p>Independent source results for the finalized market.</p></div><Info size={17} className="secondary" /></div><SourceConsensus market={market} evidence={evidenceQuery.data} /></section>}
      {market.status === "INCONCLUSIVE" && <section className="surface detail-card"><div className="card-heading"><div><h2>Settlement outcome</h2><p>Original stakes are refundable under the contract.</p></div><Info size={17} className="secondary" /></div><SourceConsensus market={market} evidence={evidenceQuery.data} /></section>}
      {market.status !== "RESOLVED" && market.status !== "INCONCLUSIVE" && <section className="surface detail-card"><div className="card-heading"><div><h2>Settlement Sources</h2><p>Three independent sources evaluate the exact 1-hour window.</p></div><Info size={17} className="secondary" /></div><SourceConsensus market={market} evidence={evidenceQuery.data} /><p className="disclaimer">The settlement allowance can extend up to 4 hours after the competition window. It is a settlement retry allowance, not a four-hour market.</p></section>}
    </div><aside><PredictionPanel market={market} position={positionQuery.data ?? null} /></aside></div>
  </PageContainer>;
}
