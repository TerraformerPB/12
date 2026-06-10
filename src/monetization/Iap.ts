/**
 * In-app-purchase abstraction (phase 6 architecture).
 *
 * Nothing in the game sells anything yet; this interface is the agreed
 * surface for the store build (Capacitor plugin, e.g. RevenueCat or
 * `@capacitor-community/in-app-purchases`). Entitlements are checked via
 * `owns()` so game code never touches store SDKs directly.
 */
export interface IapProduct {
  id: string;
  title: string;
  /** Localized price string straight from the store. */
  price: string;
}

export interface IapProvider {
  listProducts(): Promise<IapProduct[]>;
  purchase(productId: string): Promise<boolean>;
  /** Whether the player owns a non-consumable entitlement. */
  owns(productId: string): boolean;
  restorePurchases(): Promise<void>;
}

/** Dev stub: no products, owns nothing. */
export class DevIapProvider implements IapProvider {
  async listProducts(): Promise<IapProduct[]> {
    return [];
  }

  async purchase(): Promise<boolean> {
    return false;
  }

  owns(): boolean {
    return false;
  }

  async restorePurchases(): Promise<void> {
    // nothing to restore in the dev build
  }
}
