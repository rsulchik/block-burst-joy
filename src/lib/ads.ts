import { Capacitor } from "@capacitor/core";
import { AdMob } from "@capacitor-community/admob";

const testInterstitialId = "ca-app-pub-3940256099942544/1033173712";
const configuredInterstitialId = import.meta.env["VITE_ADMOB_INTERSTITIAL_ID"]?.trim();
const interstitialId = configuredInterstitialId || testInterstitialId;
const isTesting = !configuredInterstitialId || import.meta.env["VITE_ADMOB_IS_TESTING"] === "true";

let initialized = false;
let initializePromise: Promise<boolean> | null = null;
let prepared = false;
let preparePromise: Promise<boolean> | null = null;

export async function initializeAds(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  if (initialized) return true;
  if (!initializePromise) {
    initializePromise = (async () => {
      try {
        await AdMob.initialize({
          ...(isTesting ? { initializeForTesting: true } : {}),
        });
        initialized = true;
        return true;
      } catch (error) {
        console.warn("AdMob initialization failed", error);
        return false;
      } finally {
        initializePromise = null;
      }
    })();
  }
  return initializePromise;
}
export async function prepareStartAd(): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || prepared) return prepared;
  if (preparePromise) return preparePromise;
  preparePromise = (async () => {
    try {
      if (!(await initializeAds())) return false;
      await AdMob.prepareInterstitial({ adId: interstitialId, isTesting });
      prepared = true;
      return true;
    } catch (error) {
      console.warn("AdMob interstitial preparation failed", error);
      return false;
    } finally {
      preparePromise = null;
    }
  })();
  return preparePromise;
}

export async function showStartAd(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  if (!prepared) {
    await Promise.race([
      prepareStartAd(),
      new Promise<void>((resolve) => window.setTimeout(resolve, 700)),
    ]);
  }
  if (!prepared) return;
  try {
    await AdMob.showInterstitial({ adId: interstitialId });
  } catch (error) {
    console.warn("AdMob interstitial display failed", error);
  } finally {
    prepared = false;
    void prepareStartAd();
  }
}
