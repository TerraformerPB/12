/**
 * Rewarded-ads abstraction (phase 6 architecture).
 *
 * The game only ever talks to `RewardedAdProvider`. The store build swaps
 * `DevRewardedAdProvider` for an AdMob-backed implementation (Capacitor
 * plugin `@capacitor-community/admob`) without touching any call site:
 *
 *   game.ads = new AdmobRewardedAdProvider({ adUnitId: '...' });
 */
export interface RewardedAdProvider {
  /** Whether an ad could be shown right now. */
  isAvailable(): boolean;
  /**
   * Show a rewarded ad. Resolves true when the user earned the reward,
   * false when the ad was cancelled or failed to load.
   */
  show(): Promise<boolean>;
}

const DEV_AD_SECONDS = 3;

/**
 * Web/dev placeholder: a fullscreen overlay with a short countdown.
 * Lets the whole reward flow be played and tested without any ad SDK.
 */
export class DevRewardedAdProvider implements RewardedAdProvider {
  private uiRoot: HTMLElement;

  constructor(uiRoot: HTMLElement) {
    this.uiRoot = uiRoot;
  }

  isAvailable(): boolean {
    return true;
  }

  show(): Promise<boolean> {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'ad-overlay';
      const box = document.createElement('div');
      box.className = 'ad-box';
      const label = document.createElement('div');
      label.textContent = 'Werbung (Platzhalter)';
      const count = document.createElement('div');
      count.className = 'ad-count';
      box.append(label, count);
      overlay.appendChild(box);
      this.uiRoot.appendChild(overlay);

      let left = DEV_AD_SECONDS;
      count.textContent = String(left);
      const timer = window.setInterval(() => {
        left--;
        if (left > 0) {
          count.textContent = String(left);
          return;
        }
        window.clearInterval(timer);
        overlay.remove();
        resolve(true);
      }, 1000);
    });
  }
}
