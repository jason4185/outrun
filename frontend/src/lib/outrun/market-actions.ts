import type { ContractState, UserPosition } from "./types";

export type MarketPositionAction = "connect_wallet" | "claim_refund" | "refund_claimed" | "no_refund_position" | "claim_winnings" | "winnings_claimed" | "no_position" | "none";

export function getMarketPositionAction(state: ContractState, connected: boolean, position: UserPosition | null): MarketPositionAction {
  if (!connected) return "connect_wallet";
  if (state === "INCONCLUSIVE") {
    if (position?.refunded) return "refund_claimed";
    if (position?.refundAvailable) return "claim_refund";
    return "no_refund_position";
  }
  if (state === "SETTLED") {
    if (position?.claimAvailable) return "claim_winnings";
    if (position?.claimed) return "winnings_claimed";
    return position ? "none" : "no_position";
  }
  return "none";
}
