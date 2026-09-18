import { useMemo, useState } from "react";
import { BriefcaseBusiness, Wallet, WalletCards } from "lucide-react";
import { useOutrun } from "../app/context";
import { EmptyState, ErrorState, LoadingState, PageContainer, PositionCard, formatGen } from "../components/outrun/components";
import { isActivePosition, isClaimablePosition, isTerminalPosition, summarizePositions } from "../lib/outrun/portfolio";

type PortfolioTab = "active" | "claimable" | "history";

export function PortfolioPage() {
  const { connected, connectWallet, markets, positions, positionsLoading, positionsError, claimablePositions, myMarketCount, claim, claimRefund } = useOutrun();
  const [tab, setTab] = useState<PortfolioTab>("active");
  const marketById = useMemo(() => new Map(markets.map((market) => [market.id, market])), [markets]);
  const rows = useMemo(() => positions.map((position) => ({ position, market: marketById.get(position.marketId) })).filter((row): row is { position: typeof positions[number]; market: typeof markets[number] } => Boolean(row.market)), [marketById, markets, positions]);
  const active = rows.filter(({ position }) => isActivePosition(position));
  const claimableIds = useMemo(() => new Set(claimablePositions.map((position) => position.marketId)), [claimablePositions]);
  const claimable = rows.filter(({ position }) => claimableIds.has(position.marketId) || isClaimablePosition(position));
  const history = rows.filter(({ position }) => isTerminalPosition(position));
  const visible = tab === "active" ? active : tab === "claimable" ? claimable : history;
  const summary = summarizePositions(positions, myMarketCount ?? positions.length);

  if (!connected) return <PageContainer narrow><div className="eyebrow"><BriefcaseBusiness /> Portfolio</div><h1 style={{ marginTop: 12 }}>Your OUTRUN positions</h1><EmptyState icon={Wallet} title="Connect your wallet" copy="Your wallet is your identity in OUTRUN. Connect it to view picks, stakes, and claims." action={<button className="button primary-btn" type="button" onClick={connectWallet}>Connect Wallet</button>} /></PageContainer>;
  if (positionsLoading) return <PageContainer><div className="eyebrow"><BriefcaseBusiness /> Portfolio</div><h1 style={{ marginTop: 12 }}>Your OUTRUN positions</h1><div style={{ marginTop: 24 }}><LoadingState /></div></PageContainer>;
  if (positionsError) return <PageContainer><div className="eyebrow"><BriefcaseBusiness /> Portfolio</div><h1 style={{ marginTop: 12 }}>Your OUTRUN positions</h1><div style={{ marginTop: 24 }}><ErrorState copy="Studio Dev could not return this wallet's positions." /></div></PageContainer>;

  return <PageContainer><div className="eyebrow"><BriefcaseBusiness /> Portfolio</div><h1 style={{ marginTop: 12 }}>Your OUTRUN positions</h1><p className="lede">Track the assets you backed, active windows, and anything ready to claim.</p><div className="stats-grid"><div className="surface stat-card"><div className="stat-label">Total staked</div><div className="stat-value">{formatGen(summary.totalStaked)}</div><div className="stat-sub">Across {summary.marketCount} markets</div></div><div className="surface stat-card"><div className="stat-label">Claimable</div><div className="stat-value" style={{ color: "var(--lime)" }}>{formatGen(summary.claimable)}</div><div className="stat-sub">Available after resolution</div></div><div className="surface stat-card"><div className="stat-label">Active positions</div><div className="stat-value">{summary.active}</div><div className="stat-sub">Selection locked</div></div><div className="surface stat-card"><div className="stat-label">Settled positions</div><div className="stat-value">{summary.settled}</div><div className="stat-sub">Resolved or inconclusive</div></div></div><div className="portfolio-tabs" role="tablist">{([['active', 'Active'], ['claimable', 'Claimable'], ['history', 'History']] as const).map(([value, label]) => <button key={value} className={`portfolio-tab${tab === value ? " active" : ""}`} type="button" onClick={() => setTab(value)}>{label}{value === "claimable" && claimable.length ? ` · ${claimable.length}` : ""}</button>)}</div>{visible.length ? <div className="position-grid">{visible.map(({ position, market }) => <PositionCard key={market.id} position={position} market={market} onClaim={claim} onRefund={claimRefund} />)}</div> : <div style={{ marginTop: 18 }}><EmptyState icon={WalletCards} title={tab === "active" ? "No active positions" : tab === "claimable" ? "No claimable positions" : "No position history"} copy={tab === "active" ? "Back an upcoming market and your locked selection will appear here." : "There is nothing waiting for you right now."} /></div>}</PageContainer>;
}
