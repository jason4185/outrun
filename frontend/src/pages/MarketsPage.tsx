import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { EmptyState, ErrorState, LoadingState, MarketCard, PageContainer } from "../components/outrun/components";
import { useOutrun } from "../app/context";
import { CATEGORY_LABEL, type Category, type MarketStatus } from "../lib/outrun/types";
import { BarChart3, Plus } from "lucide-react";

const STATUS_FILTERS: { value: "ALL" | MarketStatus; label: string }[] = [
  { value: "ALL", label: "All statuses" }, { value: "OPEN", label: "Open" }, { value: "LIVE", label: "Live" }, { value: "READY_TO_SETTLE", label: "Ready to Settle" }, { value: "RESOLVED", label: "Resolved" }, { value: "INCONCLUSIVE", label: "Inconclusive" },
];

export function MarketsPage() {
  const { config, markets, marketsLoading, marketsError, refetchMarkets } = useOutrun();
  const [params, setParams] = useSearchParams();
  const [category, setCategory] = useState<"ALL" | Category>("ALL");
  const status = (params.get("status") as "ALL" | MarketStatus | null) ?? "ALL";
  const query = params.get("q") ?? "";
  const filtered = useMemo(() => markets.filter((market) => {
    const categoryMatch = category === "ALL" || market.category === category;
    const statusMatch = status === "ALL" || market.status === status;
    const needle = query.trim().toLowerCase();
    const searchMatch = !needle || [marketQuestionText(market.category), CATEGORY_LABEL[market.category], ...market.assets].join(" ").toLowerCase().includes(needle);
    return categoryMatch && statusMatch && searchMatch;
  }), [markets, category, status, query]);
  const setStatus = (value: string) => { const next = new URLSearchParams(params); if (value === "ALL") next.delete("status"); else next.set("status", value); setParams(next); };
  return <PageContainer>
    <section className="page-heading"><div><div className="eyebrow"><BarChart3 /> OUTRUN markets</div><h1>Markets</h1><p className="lede">Pick which asset will post the highest return over the next 1-hour window.</p></div><Link className="button primary-btn" to="/create"><Plus size={15} /> Create Market</Link></section>
    <div className="filters"><div className="tab-list" role="tablist" aria-label="Market categories"><button className={`tab${category === "ALL" ? " active" : ""}`} type="button" onClick={() => setCategory("ALL")}>All</button>{(config?.categories ?? []).map((item) => <button className={`tab${category === item ? " active" : ""}`} type="button" key={item} onClick={() => setCategory(item)}>{CATEGORY_LABEL[item]}</button>)}</div><select aria-label="Filter market status" className="filter-select" value={status} onChange={(event) => setStatus(event.target.value)}>{STATUS_FILTERS.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></div>
    {query && <p className="muted" style={{ marginTop: 17, fontSize: 11 }}>Showing markets matching “{query}”.</p>}
    {marketsLoading ? <div className="market-grid"><LoadingState /><LoadingState /><LoadingState /></div> : marketsError ? <div style={{ marginTop: 24 }}><ErrorState onRetry={() => void refetchMarkets()} copy="Studio Dev could not return the current market list." /></div> : filtered.length ? <div className="market-grid">{filtered.map((market) => <MarketCard key={market.id} market={market} />)}</div> : <div style={{ marginTop: 24 }}><EmptyState icon={BarChart3} title={query || category !== "ALL" || status !== "ALL" ? "No markets found" : "No markets yet"} copy={query || category !== "ALL" || status !== "ALL" ? "Try another category, status, or search term." : "No OUTRUN markets have been created on Studio Dev yet."} action={<Link className="button primary-btn" to="/create">Create Market</Link>} /></div>}
  </PageContainer>;
}

function marketQuestionText(category: Category) { return category === "US_INDICES" ? "Which U.S. index will outrun the rest?" : category === "ASIA_INDICES" ? "Which Asian market will outrun the rest?" : "Which sector will outrun the rest?"; }
