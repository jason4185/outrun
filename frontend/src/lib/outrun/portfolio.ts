import type { UserPosition } from "./types";

export function isActivePosition(position: UserPosition): boolean {
  return position.marketState === "OPEN" || position.marketState === "SETTLEMENT_PENDING";
}

export function isTerminalPosition(position: UserPosition): boolean {
  return position.marketState === "SETTLED" || position.marketState === "INCONCLUSIVE";
}

export function isClaimablePosition(position: UserPosition): boolean {
  return position.claimAvailable || position.refundAvailable;
}

export function summarizePositions(positions: UserPosition[], marketCount = positions.length) {
  return {
    totalStaked: positions.reduce((sum, position) => sum + position.stake, 0n),
    claimable: positions.reduce((sum, position) => sum + (isClaimablePosition(position) ? position.claimable : 0n), 0n),
    active: positions.filter(isActivePosition).length,
    settled: positions.filter(isTerminalPosition).length,
    marketCount,
  };
}
