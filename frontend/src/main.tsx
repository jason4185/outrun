import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { retryAfterMilliseconds } from "./lib/outrun/errors";
import "./styles.css";

const retryDelays = [2_000, 5_000, 10_000];
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 3, retryDelay: (attempt, error) => retryAfterMilliseconds(error) ?? retryDelays[Math.min(attempt, retryDelays.length - 1)] + Math.floor(Math.random() * 300), refetchOnWindowFocus: true, refetchIntervalInBackground: false } } });

createRoot(document.getElementById("root")!).render(<StrictMode><QueryClientProvider client={queryClient}><App /></QueryClientProvider></StrictMode>);
