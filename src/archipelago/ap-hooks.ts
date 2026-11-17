/**
 * Dependency-free hooks used by core modules (game data, modifier types) to reach the Archipelago manager.
 * Core modules are part of large import cycles, so they must not import `archipelago.ts` directly:
 * the manager registers its callbacks here when it is created.
 */

export interface ApSessionState {
  seedName: string;
  slotName: string;
  runBonusDelivered: number[];
}

export interface ApHooks {
  getSessionState(): ApSessionState | undefined;
  restoreSessionState(state: ApSessionState | undefined): void;
  /** Extra shop entries (typed loosely to keep this module dependency-free) */
  getShopOptions(waveIndex: number, baseCost: number): any[];
  /** Label to display instead of the price when a shop entry was already bought, or null */
  getSoldLabel(modifierType: any): string | null;
}

export const apHooks: ApHooks = {
  getSessionState: () => undefined,
  restoreSessionState: () => {},
  getShopOptions: () => [],
  getSoldLabel: () => null
};
