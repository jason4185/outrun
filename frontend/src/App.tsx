import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { OutrunProvider } from "./app/context";
import { AppHeader, RpcHealthBanner, TransactionBanner } from "./components/outrun/components";
import { CreateMarketPage } from "./pages/CreateMarketPage";
import { HowItWorksPage } from "./pages/HowItWorksPage";
import { MarketDetailPage } from "./pages/MarketDetailPage";
import { MarketsPage } from "./pages/MarketsPage";
import { PortfolioPage } from "./pages/PortfolioPage";

function AppShell() {
  return <div className="app"><AppHeader /><RpcHealthBanner /><TransactionBanner /><Outlet /></div>;
}

function NotFound() {
  return <div className="not-found"><div><h1>404</h1><p className="secondary" style={{ marginTop: 11 }}>This market lane does not exist.</p><a className="button primary-btn" style={{ marginTop: 18 }} href="/markets">Back to markets</a></div></div>;
}

export default function App() {
  return <BrowserRouter><OutrunProvider><Routes><Route element={<AppShell />}><Route path="/" element={<Navigate to="/markets" replace />} /><Route path="/markets" element={<MarketsPage />} /><Route path="/market/:id" element={<MarketDetailPage />} /><Route path="/portfolio" element={<PortfolioPage />} /><Route path="/create" element={<CreateMarketPage />} /><Route path="/how-it-works" element={<HowItWorksPage />} /><Route path="*" element={<NotFound />} /></Route></Routes></OutrunProvider></BrowserRouter>;
}
