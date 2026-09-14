import { isAddress, type Address } from "viem";
import { studioDevnet } from "genlayer-js/chains";
import { OUTRUN_CONFIG } from "./config";

export interface OutrunInjectedProvider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
  isRabby?: boolean;
  isMetaMask?: boolean;
  providers?: OutrunInjectedProvider[];
}

declare global {
  interface Window { ethereum?: OutrunInjectedProvider; }
}

export const STUDIO_DEV_CHAIN_ID = studioDevnet.id;
export const STUDIO_DEV_CHAIN_HEX = `0x${STUDIO_DEV_CHAIN_ID.toString(16)}`;

export function getInjectedProvider(): OutrunInjectedProvider | undefined {
  if (typeof window === "undefined" || !window.ethereum) return undefined;
  const injected = window.ethereum;
  if (injected.providers?.length) return injected.providers.find((candidate) => candidate.isRabby) ?? injected.providers[0];
  return injected;
}

export function isWalletAddress(value: unknown): value is Address { return typeof value === "string" && isAddress(value); }

export async function getWalletAddress(active = getInjectedProvider()): Promise<Address | null> {
  if (!active || typeof active.request !== "function") return null;
  const accounts = await active.request({ method: "eth_accounts" });
  const address = Array.isArray(accounts) ? accounts[0] : undefined;
  return isWalletAddress(address) ? address : null;
}

export async function getWalletChainId(active = getInjectedProvider()): Promise<string | null> {
  if (!active || typeof active.request !== "function") return null;
  return String(await active.request({ method: "eth_chainId" })).toLowerCase();
}

export async function requestWallet(active = getInjectedProvider()): Promise<Address> {
  if (!active || typeof active.request !== "function") throw new Error("No injected EVM wallet was found. Install a browser wallet before connecting.");
  const accounts = await active.request({ method: "eth_requestAccounts" });
  const address = Array.isArray(accounts) ? accounts[0] : undefined;
  if (!isWalletAddress(address)) throw new Error("The wallet did not return a valid account.");
  return address;
}

export function watchWallet(
  active: OutrunInjectedProvider | undefined,
  onAccountsChanged: (address: Address | null) => void,
  onChainChanged: (chainId: string) => void,
): () => void {
  if (!active?.on) return () => undefined;
  const accountsHandler = (...args: unknown[]) => {
    const accounts = Array.isArray(args[0]) ? args[0] : [];
    onAccountsChanged(isWalletAddress(accounts[0]) ? accounts[0] : null);
  };
  const chainHandler = (...args: unknown[]) => onChainChanged(String(args[0] ?? "").toLowerCase());
  active.on("accountsChanged", accountsHandler);
  active.on("chainChanged", chainHandler);
  return () => {
    active.removeListener?.("accountsChanged", accountsHandler);
    active.removeListener?.("chainChanged", chainHandler);
  };
}

function providerError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
  return "The wallet could not switch networks.";
}

export async function switchToStudioDevnet(active = getInjectedProvider()): Promise<string> {
  if (!active || typeof active.request !== "function") throw new Error("Injected wallet provider is unavailable.");
  const current = await getWalletChainId(active);
  if (current === STUDIO_DEV_CHAIN_HEX) return current;
  try {
    await active.request({ method: "wallet_switchEthereumChain", params: [{ chainId: STUDIO_DEV_CHAIN_HEX }] });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? Number((error as { code: unknown }).code) : 0;
    if (code !== 4902) throw code === 4001 ? error : new Error(`Switch your wallet to Studio Dev (chain ${STUDIO_DEV_CHAIN_ID}). ${providerError(error)}`);
    await active.request({ method: "wallet_addEthereumChain", params: [{ chainId: STUDIO_DEV_CHAIN_HEX, chainName: studioDevnet.name, nativeCurrency: studioDevnet.nativeCurrency, rpcUrls: [OUTRUN_CONFIG.rpcUrl] }] });
    await active.request({ method: "wallet_switchEthereumChain", params: [{ chainId: STUDIO_DEV_CHAIN_HEX }] });
  }
  const verified = await getWalletChainId(active);
  if (verified !== STUDIO_DEV_CHAIN_HEX) throw new Error(`Wallet remains on the wrong network. Studio Dev chain ${STUDIO_DEV_CHAIN_ID} is required.`);
  return verified;
}
