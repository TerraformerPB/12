import {
  AdMob,
  AdmobConsentStatus,
  RewardAdPluginEvents,
  type AdMobRewardItem,
} from '@capacitor-community/admob';
import { ADMOB_REWARDED_AD_UNIT_ID, ADMOB_USE_TEST_ADS } from '../data/config';
import type { RewardedAdProvider } from './Ads';

/**
 * AdMob-backed rewarded ads for the native (Capacitor) build.
 * Selected in Game.init when running on a device; the web build keeps
 * using DevRewardedAdProvider. Ad unit ids live in `data/config.ts`.
 */
export class AdmobRewardedAdProvider implements RewardedAdProvider {
  private initialized = false;
  private ready = false;

  /** Initialize the SDK and preload the first rewarded ad. */
  async init(): Promise<void> {
    if (this.initialized) return;
    await AdMob.initialize({ initializeForTesting: ADMOB_USE_TEST_ADS });
    await this.requestConsent();
    AdMob.addListener(RewardAdPluginEvents.Loaded, () => {
      this.ready = true;
    });
    AdMob.addListener(RewardAdPluginEvents.FailedToLoad, () => {
      this.ready = false;
    });
    this.initialized = true;
    await this.prepare();
  }

  /**
   * EU consent (Google UMP): required for the Play Store. Shows the consent
   * form only when the SDK reports it is required (non-EU users see nothing).
   * Fully guarded — a consent error must never stop the game from loading.
   */
  private async requestConsent(): Promise<void> {
    try {
      const info = await AdMob.requestConsentInfo();
      if (info.isConsentFormAvailable && info.status === AdmobConsentStatus.REQUIRED) {
        await AdMob.showConsentForm();
      }
    } catch (err) {
      console.warn('AdMob-Einwilligung konnte nicht eingeholt werden:', err);
    }
  }

  private async prepare(): Promise<void> {
    this.ready = false;
    try {
      await AdMob.prepareRewardVideoAd({
        adId: ADMOB_REWARDED_AD_UNIT_ID,
        isTesting: ADMOB_USE_TEST_ADS,
      });
    } catch (err) {
      console.warn('Rewarded Ad konnte nicht geladen werden:', err);
    }
  }

  isAvailable(): boolean {
    return this.ready;
  }

  async show(): Promise<boolean> {
    if (!this.ready) return false;
    try {
      const reward: AdMobRewardItem = await AdMob.showRewardVideoAd();
      return reward.amount >= 0; // any completed reward counts
    } catch (err) {
      console.warn('Rewarded Ad fehlgeschlagen:', err);
      return false;
    } finally {
      // Preload the next one for the following run.
      void this.prepare();
    }
  }
}
