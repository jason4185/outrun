import { getWalletAddress, isWalletAddress, requestWallet, STUDIO_DEV_CHAIN_HEX, switchToStudioDevnet, watchWallet, type OutrunInjectedProvider } from "./wallet";
// @ts-ignore Bun provides this test module; it is intentionally not a production dependency.
import { test } from "bun:test";

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function provider(request: (method: string, params?: unknown) => unknown): OutrunInjectedProvider & { emit: (event: string, value: unknown) => void; calls: string[] } {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const calls: string[] = [];
  return {
    calls,
    request: async ({ method, params }) => { calls.push(method); return request(method, params); },
    on: (event, handler) => { listeners.set(event, handler); },
    removeListener: (event) => { listeners.delete(event); },
    emit: (event, value) => listeners.get(event)?.(value),
  };
}

const addressA = "0x1111111111111111111111111111111111111111";
const addressB = "0x2222222222222222222222222222222222222222";

test("OUTRUN direct wallet lifecycle", async () => {
  assert(await getWalletAddress(undefined) === null, "missing provider should leave the wallet disconnected");
  const authorized = provider((method) => method === "eth_accounts" ? [addressA] : method === "eth_chainId" ? STUDIO_DEV_CHAIN_HEX : null);
  assert(await getWalletAddress(authorized) === addressA, "eth_accounts should restore the authorized address");
  assert(isWalletAddress(addressA), "valid EVM address should be accepted");
  assert(!isWalletAddress("undefined"), "invalid address should be rejected");

  const requested = provider((method) => method === "eth_requestAccounts" ? [addressB] : null);
  assert(await requestWallet(requested) === addressB, "explicit connect should use eth_requestAccounts");
  let invalidAccountCaught = false;
  try { await requestWallet(provider((method) => method === "eth_requestAccounts" ? ["undefined"] : null)); } catch { invalidAccountCaught = true; }
  assert(invalidAccountCaught, "invalid wallet account should be rejected");
  let changedAddress: string | null | undefined;
  let changedChain = "";
  const stop = watchWallet(authorized, (value) => { changedAddress = value; }, (value) => { changedChain = value; });
  authorized.emit("accountsChanged", [addressB]);
  authorized.emit("chainChanged", "0x1");
  assert(changedAddress === addressB && changedChain === "0x1", "wallet events should update account and chain");
  authorized.emit("accountsChanged", []);
  assert(changedAddress === null, "empty accountsChanged should disconnect the wallet");
  stop();

  let chain = "0x1";
  let added = false;
  const switcher = provider((method) => {
    if (method === "eth_chainId") return chain;
    if (method === "wallet_switchEthereumChain") { if (!added) throw { code: 4902 }; chain = STUDIO_DEV_CHAIN_HEX; return null; }
    if (method === "wallet_addEthereumChain") { added = true; return null; }
    return null;
  });
  assert(await switchToStudioDevnet(switcher) === STUDIO_DEV_CHAIN_HEX, "4902 should add and switch to Studio Dev");
  assert(switcher.calls.filter((method) => method === "wallet_switchEthereumChain").length === 2, "network switch should be verified after adding");
  const rejected = provider((method) => { if (method === "eth_chainId") return "0x1"; if (method === "wallet_switchEthereumChain") throw { code: 4001 }; return null; });
  let rejectionCaught = false;
  try { await switchToStudioDevnet(rejected); } catch (error) { rejectionCaught = Boolean(error && typeof error === "object" && "code" in error && (error as { code: number }).code === 4001); }
  assert(rejectionCaught, "user network-switch rejection should remain a cancellation");
});
