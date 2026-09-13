import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { http } from "wagmi";
import { OUTRUN_CONFIG } from "./config";

export const wagmiConfig = getDefaultConfig({
  appName: "OUTRUN",
  appDescription: "One-hour relative performance prediction markets.",
  appUrl: "http://localhost:4174",
  projectId: "outrun-injected-wallet",
  wallets: [{ groupName: "Browser wallet", wallets: [injectedWallet] }],
  chains: [OUTRUN_CONFIG.chain],
  transports: { [OUTRUN_CONFIG.chainId]: http(OUTRUN_CONFIG.rpcUrl) },
  ssr: false,
});
