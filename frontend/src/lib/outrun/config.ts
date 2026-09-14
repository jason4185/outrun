import { isAddress, type Address } from "viem";
import { studioDevnet } from "genlayer-js/chains";

const deployedAddress = "0x5e04EA0ded5902Bf9115c7aa2Ef424E1b9E1d5c8";
const configuredAddress = import.meta.env.VITE_OUTRUN_CONTRACT_ADDRESS?.trim() || deployedAddress;

if (!isAddress(configuredAddress)) {
  throw new Error("Invalid VITE_OUTRUN_CONTRACT_ADDRESS");
}
if (studioDevnet.id !== 61997 || studioDevnet.rpcUrls.default.http[0] !== "https://studio-dev.genlayer.com/api") {
  throw new Error("Studio Devnet configuration is not the OUTRUN target network");
}

export const OUTRUN_CONFIG = {
  address: configuredAddress as Address,
  chain: studioDevnet,
  chainId: 61997,
  rpcUrl: "https://studio-dev.genlayer.com/api",
  explorerUrl: "https://explorer-studio-dev.genlayer.com",
} as const;
