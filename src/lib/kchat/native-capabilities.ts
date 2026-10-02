/** Compatibility adapter. Native Capacitor APIs live in src/utils/nativeCapabilities.ts. */

import {
  applyNativeChromeTheme,
  getStorage as readNativeStorage,
  hideNativeSplash,
  initAppListeners,
  initNativeChrome,
  nativePlatform as syncPlatform,
  parseDeepLink,
  removeStorage as deleteNativeStorage,
  setStorage as writeNativeStorage,
  triggerHaptic as haptic,
  type HapticKind,
  type NativePlatform,
} from "../../utils/nativeCapabilities.ts";

export type HapticStyle = HapticKind;
export type { NativePlatform };

export function triggerHaptic(style: HapticStyle = "light"): Promise<void> {
  haptic(style);
  return Promise.resolve();
}

export async function nativePlatform(): Promise<NativePlatform> {
  return syncPlatform();
}

export async function isNativePlatform(): Promise<boolean> {
  return syncPlatform() !== "web";
}

export async function isAndroid(): Promise<boolean> {
  return syncPlatform() === "android";
}

export async function isIOS(): Promise<boolean> {
  return syncPlatform() === "ios";
}

export async function setStatusBar(opts?: { dark?: boolean }): Promise<void> {
  await applyNativeChromeTheme(opts?.dark ?? true);
}

export async function hideSplashScreen(): Promise<void> {
  await hideNativeSplash();
}

export async function setStorage(key: string, value: unknown): Promise<void> {
  await writeNativeStorage(key, value);
}

export async function getStorage<T = unknown>(key: string): Promise<T | null> {
  const value = await readNativeStorage(key);
  return (value ?? null) as T | null;
}

export async function removeStorage(key: string): Promise<void> {
  await deleteNativeStorage(key);
}

export function parseNyxDeepLink(url: string): string | null {
  return parseDeepLink(url);
}

export function closeOpenOverlay(root: ParentNode | null = typeof document === "undefined" ? null : document): boolean {
  if (!root) return false;
  const open = root.querySelector<HTMLElement>(
    '.kc-lightbox, [data-nyx-overlay="media"], [role="dialog"][data-state="open"], [data-vaul-drawer][data-state="open"], [data-radix-dialog-content]',
  );
  return Boolean(open);
}

export async function initializeNativeCapabilities(opts: {
  onDeepLink: (path: string) => void;
  onBack?: () => boolean | void | Promise<boolean | void>;
  dark?: boolean;
}): Promise<() => void> {
  await initNativeChrome();
  return initAppListeners(opts.onDeepLink);
}
