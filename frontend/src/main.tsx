import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@rainbow-me/rainbowkit/styles.css";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import App from "./App";
import { wagmiConfig } from "./lib/outrun/wallet";
import { retryAfterMilliseconds } from "./lib/outrun/errors";
import "./styles.css";

const retryDelays = [2_000, 5_000, 10_000];
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 3, retryDelay: (attempt, error) => retryAfterMilliseconds(error) ?? retryDelays[Math.min(attempt, retryDelays.length - 1)] + Math.floor(Math.random() * 300), refetchOnWindowFocus: true, refetchIntervalInBackground: false } } });

createRoot(document.getElementById("root")!).render(<StrictMode><WagmiProvider config={wagmiConfig} reconnectOnMount><QueryClientProvider client={queryClient}><RainbowKitProvider initialChain={wagmiConfig.chains[0]} theme={darkTheme({ accentColor: "#B8FF3D", accentColorForeground: "#070A0F", borderRadius: "small", fontStack: "system" })}><App /></RainbowKitProvider></QueryClientProvider></WagmiProvider></StrictMode>);
