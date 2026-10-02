import { App } from "@capacitor/app";
import { AppLauncher } from "@capacitor/app-launcher";
import { Browser } from "@capacitor/browser";
import { Camera, MediaType, MediaTypeSelection } from "@capacitor/camera";
import { Clipboard } from "@capacitor/clipboard";
import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { Device } from "@capacitor/device";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Geolocation } from "@capacitor/geolocation";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { Keyboard } from "@capacitor/keyboard";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Network } from "@capacitor/network";
import { Preferences } from "@capacitor/preferences";
import { PushNotifications } from "@capacitor/push-notifications";
import { ScreenOrientation } from "@capacitor/screen-orientation";
import { Share } from "@capacitor/share";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";
import { TextZoom } from "@capacitor/text-zoom";
import { Toast } from "@capacitor/toast";

export const NYX_DARK_CHROME = "#07090f";
export const NYX_LIGHT_CHROME = "#f3f5f0";
export const STATUS_BAR_BACKGROUND = NYX_DARK_CHROME;

export type NativePlatform = "web" | "android" | "ios";
export type HapticKind = "light" | "medium" | "heavy" | "success" | "warning" | "error";
export type NetworkKind = "unknown" | "none" | "wifi" | "cellular";
export type NyxPermission = "camera" | "photos" | "microphone" | "location" | "notifications";
export type PermissionState = "prompt" | "granted" | "denied" | "limited" | "restricted";

export type SharePayload = {
  title?: string;
  text?: string;
  url?: string;
  dialogTitle?: string;
};

export type PickedMedia = {
  kind: "image" | "video" | "gif";
  dataUrl: string;
  fileName?: string;
};

export type DeviceSnapshot = {
  platform: NativePlatform;
  osVersion: string;
  model: string;
  manufacturer: string;
  appVersion: string;
  build: string;
  webViewVersion: string;
  isVirtual: boolean;
  language: string;
};

type NyxNativeBridge = {
  setSecure(opts: { key: string; value: string }): Promise<void>;
  getSecure(opts: { key: string }): Promise<{ value: string | null }>;
  removeSecure(opts: { key: string }): Promise<void>;
  setSecureFlag(opts: { on: boolean }): Promise<void>;
  openAppSettings(): Promise<void>;
  setBadge(opts: { count: number }): Promise<void>;
  consumeShare(): Promise<{ text?: string | null; url?: string | null; mime?: string | null } | null>;
  biometricAvailable(): Promise<{ available: boolean; kind?: string }>;
  authenticate(opts: { reason: string }): Promise<{ ok: boolean }>;
  captureHighResPhoto(opts: {
    facing: string;
    flash: string;
    zoom?: number;
    quality?: number;
  }): Promise<{
    uri?: string;
    webPath?: string;
    width?: number;
    height?: number;
    bytes?: number;
    mime?: string;
    lens?: string;
    facing?: string;
  }>;
  savePublicAudio(opts: { filename: string; mime: string; data: string }): Promise<{ uri: string; bytes: number; filename: string }>;
};

const NyxNative = registerPlugin<NyxNativeBridge>("NyxNative");
const HAPTICS_PREF = "nyx-haptics-on";
const LOCK_HASH_KEY = "nyx-lock-pin-hash";
const LOCK_ON_KEY = "nyx-lock-enabled";
const LOCK_TIMEOUT_KEY = "nyx-lock-timeout-ms";
const LOCK_METHOD_KEY = "nyx-lock-method";
const LOCK_FAIL_KEY = "nyx-lock-fails";
const SECURE_PREFIX = "nyx-secure:";
const ROUTE_ALIASES: Record<string, string> = {
	profile: "/u",
	user: "/u",
	post: "/p",
	chat: "/inbox",
	message: "/inbox",
	dm: "/inbox",
	video: "/watch",
	highlight: "/hl",
	list: "/lists",
	live: "/live",
	space: "/live",
	call: "/call",
	invite: "/friends"
};
const ALLOWED_DEEP_PATHS: RegExp[] = [
	/^\/$/,
	/^\/watch(?:\/|$)/,
	/^\/inbox(?:\/|$)/,
	/^\/me(?:\/|$)/,
	/^\/u\/[^/]+$/,
	/^\/p\/[^/]+$/,
	/^\/status\/[^/]+$/,
	/^\/story\/[^/]+$/,
	/^\/kai(?:\/|$)/,
	/^\/coins(?:\/|$)/,
	/^\/discover(?:\/|$)/,
	/^\/create(?:\/|$)/,
	/^\/alerts(?:\/|$)/,
	/^\/live(?:\/|$)/,
	/^\/capture(?:\/|$)/,
	/^\/plus(?:\/|$)/,
	/^\/settings(?:\/|$)/,
	/^\/friends(?:\/|$)/,
	/^\/communities(?:\/|$)/,
	/^\/tag\/[^/]+$/,
	/^\/flash\/[^/]+$/,
	/^\/stickers(?:\/|$)/,
	/^\/studio(?:\/|$)/,
	/^\/saved(?:\/|$)/,
	/^\/memories(?:\/|$)/,
	/^\/map(?:\/|$)/,
	/^\/events(?:\/|$)/,
	/^\/challenges(?:\/|$)/,
	/^\/superomni(?:\/|$)/,
	/^\/onboarding(?:\/|$)/,
	/^\/lists(?:\/|$)/,
	/^\/hl\/[^/]+$/,
	/^\/call\/[^/]+$/,
	/^\/card(?:\/|$)/
];
const PERMISSION_WHY: Record<NyxPermission, string> = {
	camera: "NYX uses the camera for photos, Watch videos, stories, and calls.",
	photos: "NYX reads the library you pick so you can post photos and videos.",
	microphone: "NYX uses the microphone for voice notes, live rooms, and calls.",
	location: "NYX uses a rough location ping for Atlas so friends can find you when Ghost is off.",
	notifications: "NYX notifies you about messages, calls, and activity on your posts."
};
let chromeReady = false;
let listenersReady = false;
let listenerHandles: PluginListenerHandle[] = [];
let hapticsOn = true;
let lastBackgroundAt = 0;
let lastPushToken: { token: string; platform: NativePlatform } | null = null;
function onNative() {
	if (typeof window === "undefined") return false;
	try {
		return Capacitor.isNativePlatform();
	} catch {
		return false;
	}
}
export function isNativePlatform(): boolean {
	return onNative();
}
export function nativePlatform(): NativePlatform {
	if (!onNative()) return "web";
	try {
		const p = Capacitor.getPlatform();
		if (p === "ios") return "ios";
		if (p === "android") return "android";
	} catch {}
	return "web";
}

/** Save a finished audio file into the system Downloads folder (Android MediaStore). */
export function savePublicAudio(opts: { filename: string; mime: string; data: string }): Promise<{ uri: string; bytes: number; filename: string }> {
	return NyxNative.savePublicAudio(opts);
}
export function permissionWhy(kind: NyxPermission): string {
	return PERMISSION_WHY[kind];
}
export function triggerHaptic(kind: HapticKind = "light"): void {
	if (!onNative() || !hapticsOn) return;
	(async () => {
		try {
			if (kind === "success") await Haptics.notification({ type: NotificationType.Success });
			else if (kind === "warning") await Haptics.notification({ type: NotificationType.Warning });
			else if (kind === "error") await Haptics.notification({ type: NotificationType.Error });
			else {
				const style = kind === "heavy" ? ImpactStyle.Heavy : kind === "medium" ? ImpactStyle.Medium : ImpactStyle.Light;
				await Haptics.impact({ style });
			}
		} catch {}
	})();
}
export async function setHapticsEnabled(on: boolean): Promise<void> {
	hapticsOn = on;
	await setStorage(HAPTICS_PREF, on);
}
export async function hapticsEnabled(): Promise<boolean> {
	const stored = await getStorage(HAPTICS_PREF);
	if (typeof stored === "boolean") hapticsOn = stored;
	return hapticsOn;
}
export async function hideNativeSplash() {
	if (!onNative()) return;
	try {
		await SplashScreen.hide({ fadeOutDuration: 220 });
	} catch {
		try {
			await SplashScreen.hide();
		} catch {}
	}
}
export async function applyNativeChromeTheme(dark = true) {
	if (!onNative()) return;
	try {
		await StatusBar.setStyle({ style: dark ? Style.Light : Style.Dark });
	} catch {}
	try {
		await StatusBar.setBackgroundColor({ color: dark ? NYX_DARK_CHROME : NYX_LIGHT_CHROME });
	} catch {}
}
export async function setStatusBarHidden(hidden: boolean): Promise<void> {
	if (!onNative()) return;
	try {
		await StatusBar.setOverlaysWebView({ overlay: true });
		if (hidden) await StatusBar.hide();
		else await StatusBar.show();
	} catch {}
}
export async function initNativeChrome() {
	if (typeof document !== "undefined") {
		document.documentElement.classList.toggle("native-app", onNative());
		document.documentElement.dataset.platform = nativePlatform();
	}
	await hapticsEnabled();
	if (!onNative()) return;
	if (chromeReady) {
		await hideNativeSplash();
		return;
	}
	chromeReady = true;
	const dark = typeof document === "undefined" ? true : document.documentElement.classList.contains("dark");
	try {
		await StatusBar.setOverlaysWebView({ overlay: true });
	} catch {}
	await applyNativeChromeTheme(dark);
	try {
		await Keyboard.setAccessoryBarVisible({ isVisible: false });
	} catch {}
	try {
		await LocalNotifications.createChannel({
			id: "nyx-default",
			name: "NYX",
			description: "Messages, mentions, and activity",
			importance: 4,
			visibility: 1,
			vibration: true,
			sound: "default"
		});
		await LocalNotifications.createChannel({
			id: "nyx-calls",
			name: "Calls",
			description: "Incoming NYX calls",
			importance: 5,
			visibility: 1,
			vibration: true,
			sound: "default"
		});
	} catch {}
	if (typeof window !== "undefined") window.requestAnimationFrame(() => {
		hideNativeSplash();
	});
	else await hideNativeSplash();
}
function serializeValue(value: unknown): string {
	if (typeof value === "string") return value;
	return JSON.stringify(value ?? null);
}
function deserializeValue(raw: string | null): unknown {
	if (raw == null || raw === "") return null;
	try {
		return JSON.parse(raw);
	} catch {
		return raw;
	}
}
export async function setStorage(key: string, value: unknown): Promise<void> {
	const k = key.trim();
	if (!k) return;
	const encoded = serializeValue(value);
	try {
		if (onNative()) {
			await Preferences.set({
				key: k,
				value: encoded
			});
			return;
		}
	} catch {}
	try {
		localStorage.setItem(k, encoded);
	} catch {}
}
export async function getStorage(key: string): Promise<unknown> {
	const k = key.trim();
	if (!k) return null;
	try {
		if (onNative()) return deserializeValue((await Preferences.get({ key: k })).value);
	} catch {}
	try {
		return deserializeValue(localStorage.getItem(k));
	} catch {
		return null;
	}
}
export async function removeStorage(key: string): Promise<void> {
	const k = key.trim();
	if (!k) return;
	try {
		if (onNative()) {
			await Preferences.remove({ key: k });
			return;
		}
	} catch {}
	try {
		localStorage.removeItem(k);
	} catch {}
}
/** Keychain / EncryptedSharedPreferences when the NyxNative plugin is present. */
export async function setSecure(key: string, value: string): Promise<void> {
	const k = key.trim();
	if (!k) return;
	if (onNative()) try {
		await NyxNative.setSecure({
			key: k,
			value
		});
		return;
	} catch {}
	await setStorage(SECURE_PREFIX + k, value);
}
export async function getSecure(key: string): Promise<string | null> {
	const k = key.trim();
	if (!k) return null;
	if (onNative()) try {
		const r = await NyxNative.getSecure({ key: k });
		if (r.value != null) return r.value;
	} catch {}
	const v = await getStorage(SECURE_PREFIX + k);
	return typeof v === "string" ? v : v == null ? null : String(v);
}
export async function removeSecure(key: string): Promise<void> {
	const k = key.trim();
	if (!k) return;
	if (onNative()) try {
		await NyxNative.removeSecure({ key: k });
	} catch {}
	await removeStorage(SECURE_PREFIX + k);
}
export function parseDeepLink(url: string): string | null {
	const raw = url.trim();
	if (!raw) return null;
	try {
		const parsed = new URL(raw);
		const proto = parsed.protocol.replace(/:$/, "").toLowerCase();
		if (proto !== "http" && proto !== "https" && proto !== "nyx" && proto !== "com.nyx.app") return null;
		if (proto === "http" || proto === "https") {
			const host = parsed.hostname.toLowerCase();
			if (host && host !== "nyx.app" && host !== "www.nyx.app" && host !== "app.nyx.app") return null;
		}
		let path = parsed.pathname || "/";
		if (proto === "nyx" || proto === "com.nyx.app") path = "/" + [parsed.hostname || parsed.host, path.replace(/^\//, "")].filter(Boolean).join("/");
		path = path.replace(/\/{2,}/g, "/");
		if (!path.startsWith("/")) path = `/${path}`;
		if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
		const segments = path.split("/").filter(Boolean);
		const alias = segments[0] ? ROUTE_ALIASES[segments[0]] : undefined;
		if (alias) {
			path = [alias, ...segments.slice(1)].join("/").replace(/\/{2,}/g, "/");
			if (!path.startsWith("/")) path = `/${path}`;
		}
		if (!ALLOWED_DEEP_PATHS.some((re) => re.test(path))) return null;
		return `${path}${parsed.search}`;
	} catch {
		return null;
	}
}
export function closeOpenOverlay() {
	if (typeof document === "undefined") return false;
	const media = document.querySelector<HTMLElement>(".kc-lightbox, [data-nyx-overlay='media']");
	if (media) {
		if (typeof window !== "undefined" && window.history.state?.nyxMedia) {
			window.history.back();
			return true;
		}
		const closer = media.querySelector<HTMLElement>("[aria-label=\"Close\"]");
		if (closer) {
			closer.click();
			return true;
		}
		document.dispatchEvent(new KeyboardEvent("keydown", {
			key: "Escape",
			bubbles: true
		}));
		return true;
	}
	const open = document.querySelector<HTMLElement>("[role=\"dialog\"][data-state=\"open\"], [data-vaul-drawer][data-state=\"open\"], [data-radix-dialog-content]");
	if (!open) return false;
	const closer = open.querySelector<HTMLElement>("[aria-label=\"Close\"], [data-dialog-close]") ?? open.parentElement?.querySelector<HTMLElement>("[data-radix-dialog-close]");
	if (closer) {
		closer.click();
		return true;
	}
	document.dispatchEvent(new KeyboardEvent("keydown", {
		key: "Escape",
		bubbles: true
	}));
	return true;
}
async function exitWhenAtRoot() {
	try {
		await App.exitApp();
	} catch {}
}
function dispatchNyx(name: string, detail?: unknown): void {
	if (typeof window === "undefined") return;
	window.dispatchEvent(new CustomEvent(name, { detail }));
}
export function initAppListeners(onDeepLink: (path: string) => void): () => void {
	if (!onNative()) {
		if (typeof window !== "undefined") {
			const onOnline = () => dispatchNyx("nyx-network", { connected: true });
			const onOffline = () => dispatchNyx("nyx-network", { connected: false });
			window.addEventListener("online", onOnline);
			window.addEventListener("offline", onOffline);
			return () => {
				window.removeEventListener("online", onOnline);
				window.removeEventListener("offline", onOffline);
			};
		}
		return () => undefined;
	}
	if (listenersReady) return () => undefined;
	listenersReady = true;
	(async () => {
		try {
			const urlOpen = await App.addListener("appUrlOpen", (event) => {
				const path = parseDeepLink(event.url);
				if (path) onDeepLink(path);
			});
			listenerHandles.push(urlOpen);
			const back = await App.addListener("backButton", ({ canGoBack }) => {
				if (closeOpenOverlay()) return;
				if (canGoBack && typeof window !== "undefined" && window.history.length > 1) {
					window.history.back();
					return;
				}
				exitWhenAtRoot();
			});
			listenerHandles.push(back);
			const state = await App.addListener("appStateChange", ({ isActive }) => {
				if (isActive) {
					dispatchNyx("nyx-app-resume", { backgroundedMs: lastBackgroundAt ? Date.now() - lastBackgroundAt : 0 });
					consumeIncomingShare().then((share) => {
						if (share) dispatchNyx("nyx-incoming-share", share);
					});
				} else {
					lastBackgroundAt = Date.now();
					dispatchNyx("nyx-app-pause");
				}
			});
			listenerHandles.push(state);
			const kbShow = await Keyboard.addListener("keyboardWillShow", () => {
				if (typeof document === "undefined") return;
				document.documentElement.style.setProperty("--kc-keyboard-h", "0px");
				document.documentElement.classList.add("keyboard-open");
			});
			listenerHandles.push(kbShow);
			const kbDidShow = await Keyboard.addListener("keyboardDidShow", () => {
				if (typeof document === "undefined") return;
				document.documentElement.style.setProperty("--kc-keyboard-h", "0px");
				document.documentElement.classList.add("keyboard-open");
			});
			listenerHandles.push(kbDidShow);
			const kbHide = await Keyboard.addListener("keyboardWillHide", () => {
				if (typeof document === "undefined") return;
				document.documentElement.style.setProperty("--kc-keyboard-h", "0px");
				document.documentElement.classList.remove("keyboard-open");
			});
			listenerHandles.push(kbHide);
			const kbDidHide = await Keyboard.addListener("keyboardDidHide", () => {
				if (typeof document === "undefined") return;
				document.documentElement.style.setProperty("--kc-keyboard-h", "0px");
				document.documentElement.classList.remove("keyboard-open");
			});
			listenerHandles.push(kbDidHide);
			const net = await Network.addListener("networkStatusChange", (status) => {
				dispatchNyx("nyx-network", {
					connected: status.connected,
					connectionType: status.connectionType
				});
			});
			listenerHandles.push(net);
			const pushReg = await PushNotifications.addListener("registration", (token) => {
				lastPushToken = {
					token: token.value,
					platform: nativePlatform()
				};
				dispatchNyx("nyx-push-token", lastPushToken);
			});
			listenerHandles.push(pushReg);
			const pushErr = await PushNotifications.addListener("registrationError", (err) => {
				dispatchNyx("nyx-push-error", { message: err.error });
			});
			listenerHandles.push(pushErr);
			const pushRecv = await PushNotifications.addListener("pushNotificationReceived", (n) => {
				dispatchNyx("nyx-push-received", n);
			});
			listenerHandles.push(pushRecv);
			const pushTap = await PushNotifications.addListener("pushNotificationActionPerformed", (n) => {
				const data = n.notification.data;
				const raw = String(data?.url ?? data?.path ?? data?.link ?? "");
				const path = raw ? parseDeepLink(raw) : null;
				if (path) onDeepLink(path);
				else if (typeof data?.path === "string" && data.path.startsWith("/")) onDeepLink(data.path);
			});
			listenerHandles.push(pushTap);
			const localTap = await LocalNotifications.addListener("localNotificationActionPerformed", (n) => {
				const extra = n.notification.extra;
				const raw = String(extra?.url ?? extra?.path ?? "");
				const path = raw ? parseDeepLink(raw) : raw.startsWith("/") ? raw : null;
				if (path) onDeepLink(path);
			});
			listenerHandles.push(localTap);
			const launch = await App.getLaunchUrl();
			if (launch?.url) {
				const path = parseDeepLink(launch.url);
				if (path) onDeepLink(path);
			}
			consumeIncomingShare().then((share) => {
				if (share) dispatchNyx("nyx-incoming-share", share);
			});
		} catch {
			listenersReady = false;
		}
	})();
	return () => {
		listenersReady = false;
		for (const handle of listenerHandles) handle.remove().catch(() => undefined);
		listenerHandles = [];
	};
}
export async function copyText(text: string): Promise<boolean> {
	const value = text.trim();
	if (!value) return false;
	try {
		if (onNative()) {
			await Clipboard.write({ string: value });
			triggerHaptic("success");
			return true;
		}
	} catch {}
	try {
		await navigator.clipboard.writeText(value);
		triggerHaptic("success");
		return true;
	} catch {
		return false;
	}
}
export async function nativeShare(payload: SharePayload): Promise<boolean> {
	const title = payload.title?.trim() || "NYX";
	const text = payload.text?.trim() || "";
	const url = payload.url?.trim() || "";
	try {
		if (onNative()) {
			await Share.share({
				title,
				text,
				url: url || undefined,
				dialogTitle: payload.dialogTitle || "Share"
			});
			triggerHaptic("light");
			return true;
		}
	} catch (e) {
		const msg = e instanceof Error ? e.message : "";
		if (/cancel/i.test(msg)) return false;
	}
	try {
		if (typeof navigator !== "undefined" && navigator.share) {
			await navigator.share({
				title,
				text,
				url: url || undefined
			});
			return true;
		}
	} catch {}
	if (url || text) return copyText(url || text);
	return false;
}
export async function openExternalUrl(url: string): Promise<void> {
	const href = url.trim();
	if (!/^https?:\/\//i.test(href)) throw new Error("Only http(s) links can open outside NYX.");
	try {
		if (onNative()) {
			await Browser.open({
				url: href,
				presentationStyle: "popover"
			});
			return;
		}
	} catch {}
	if (typeof window !== "undefined") window.open(href, "_blank", "noopener,noreferrer");
}
export async function openSystemSettings() {
	if (onNative()) {
		try {
			await NyxNative.openAppSettings();
			return;
		} catch {}
		const platform = nativePlatform();
		if (platform === "ios" || platform === "android") await AppLauncher.openUrl({ url: "app-settings:" }).catch(() => undefined);
	}
}
export function lastNativePushToken(): { token: string; platform: NativePlatform } | null {
	return lastPushToken;
}
export async function pickFromLibrary(opts?: { media?: "image" | "video" | "any"; limit?: number }): Promise<PickedMedia[]> {
	const media = opts?.media ?? "any";
	const limit = Math.max(1, Math.min(opts?.limit ?? 4, 8));
	if (onNative()) {
    const perm = await requestNyxPermission("photos");
    if (perm === "denied") {
      throw new Error("Photos permission was denied. Enable it in Settings to pick from your gallery.");
    }
    try {
		const r = await Camera.chooseFromGallery({
			mediaType: media === "image" ? MediaTypeSelection.Photo : media === "video" ? MediaTypeSelection.Video : MediaTypeSelection.All,
			allowMultipleSelection: limit > 1,
			limit,
			includeMetadata: true,
			editable: "no",
			presentationStyle: "fullscreen"
		});
		const out: PickedMedia[] = [];
		for (const item of r.results) {
			const dataUrl = await mediaResultToDataUrl(item);
			if (!dataUrl) continue;
			out.push({
				kind: classifyPickedKind(item.type === MediaType.Video ? "video" : item.metadata?.format === "gif" ? "image/gif" : "image", item.uri, dataUrl),
				dataUrl,
				fileName: item.uri
			});
		}
		if (r.results.length > 0 && out.length === 0) {
			throw new Error("Could not read that file from your gallery. Try another photo, GIF, or video.");
		}
		return out;
	} catch (e) {
		const msg = e instanceof Error ? e.message : "";
		if (/cancel|user/i.test(msg)) return [];
		throw e;
	}
  }
	return webFilePick(media, limit);
}
export async function takeNativePhoto(): Promise<PickedMedia | null> {
	if (onNative()) try {
		const dataUrl = await mediaResultToDataUrl(await Camera.takePhoto({
			quality: 100,
			saveToGallery: false,
			correctOrientation: true,
			includeMetadata: true,
			editable: "no"
		}));
		if (!dataUrl) return null;
		triggerHaptic("medium");
		return {
			kind: "image",
			dataUrl
		};
	} catch (e) {
		const msg = e instanceof Error ? e.message : "";
		if (/cancel|user|denied/i.test(msg)) return null;
		throw e;
	}
	const [file] = await webFilePick("image", 1);
	return file ?? null;
}

function nativeStillUrl(uri?: string, webPath?: string): string {
	if (uri) {
		const asFile = uri.startsWith("file:") ? uri : uri.startsWith("/") ? `file://${uri}` : uri;
		try {
			const converted = Capacitor.convertFileSrc(asFile);
			if (converted) return converted;
		} catch {
			/* continue */
		}
		try {
			const converted = Capacitor.convertFileSrc(uri);
			if (converted) return converted;
		} catch {
			/* continue */
		}
	}
	return webPath || "";
}

export async function captureNativeHighResPhoto(opts: {
	facing: "user" | "environment";
	flash: "off" | "on" | "auto";
	zoom?: number;
}): Promise<import("@/lib/kchat/camera-still").StillPhoto | null> {
	if (!onNative()) return null;
	const { stillFromBlob } = await import("@/lib/kchat/camera-still");
	const started = performance.now();
	try {
		const r = await NyxNative.captureHighResPhoto({
			facing: opts.facing,
			flash: opts.flash,
			zoom: opts.zoom ?? 1,
			quality: 100,
		});
		let blob: Blob | null = null;
		const path = nativeStillUrl(r.uri, r.webPath);
		if (path) {
			try {
				blob = await (await fetch(path)).blob();
			} catch {
				blob = null;
			}
		}
		if (!blob && r.uri) {
			const dataUrl = await mediaResultToDataUrl({ uri: r.uri, webPath: r.webPath, type: "image" });
			if (dataUrl) blob = await (await fetch(dataUrl)).blob();
		}
		if (!blob || blob.size < 800) return null;
		return stillFromBlob(blob, {
			source: "native-still",
			facing: opts.facing,
			lens: r.lens ?? (opts.facing === "user" ? "front" : "back"),
			captureMs: Math.round(performance.now() - started),
			selectedWidth: r.width || null,
			selectedHeight: r.height || null,
		});
	} catch (e) {
		const msg = e instanceof Error ? e.message : "";
		if (/not implemented|is not implemented|undefined is not/i.test(msg)) return null;
		throw e;
	}
}
export async function takeNativeVideo(): Promise<PickedMedia | null> {
	if (!onNative()) {
    const [file] = await webFilePick("video", 1);
    return file ?? null;
  }
	try {
		const dataUrl = await mediaResultToDataUrl(await Camera.recordVideo({
			saveToGallery: false,
			includeMetadata: false
		}));
		if (!dataUrl) return null;
		triggerHaptic("medium");
		return {
			kind: "video",
			dataUrl
		};
	} catch (e) {
		const msg = e instanceof Error ? e.message : "";
		if (/cancel|user|denied/i.test(msg)) return null;
		throw e;
	}
}
async function mediaResultToDataUrl(item: { webPath?: string; uri?: string; thumbnail?: string; type?: string | MediaType; metadata?: { format?: string } }): Promise<string> {
	const isVideo = item.type === MediaType.Video || typeof item.type === "string" && item.type.startsWith("video");
	const format = String(item.metadata?.format ?? "").toLowerCase();
	const fallbackMime =
		format === "gif" ? "image/gif"
		: format === "png" ? "image/png"
		: format === "webp" ? "image/webp"
		: format === "mov" || format === "quicktime" ? "video/quicktime"
		: isVideo || format === "mp4" || format === "m4v" ? "video/mp4"
		: "image/jpeg";
	if (item.uri) {
		try {
			const r = await Filesystem.readFile({ path: item.uri });
			if (typeof r.data === "string" && r.data) {
				if (r.data.startsWith("data:")) return r.data;
				return `data:${mimeFromBase64(r.data, fallbackMime)};base64,${r.data}`;
			}
		} catch {}
	}
	const path = item.webPath || (item.uri ? Capacitor.convertFileSrc(item.uri) : "");
	if (path) {
		if (path.startsWith("data:")) return path;
		try {
			return await blobUrlToDataUrl(path);
		} catch {
			if (item.uri) try {
				const r = await Filesystem.readFile({ path: item.uri });
				if (typeof r.data === "string" && r.data) {
					if (r.data.startsWith("data:")) return r.data;
					return `data:${mimeFromBase64(r.data, fallbackMime)};base64,${r.data}`;
				}
			} catch {}
		}
	}
	if (!isVideo && item.thumbnail) return item.thumbnail.startsWith("data:") ? item.thumbnail : `data:image/jpeg;base64,${item.thumbnail}`;
	return "";
}
function mimeFromBase64(b64: string, fallback: string): string {
	if (b64.startsWith("data:")) return /data:([^;,]+)/i.exec(b64)?.[1] || fallback;
	try {
		const bin = atob(b64.slice(0, 24));
		const b0 = bin.charCodeAt(0);
		const b1 = bin.charCodeAt(1);
		const b2 = bin.charCodeAt(2);
		if (b0 === 0x47 && b1 === 0x49 && b2 === 0x46) return "image/gif";
		if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4e) return "image/png";
		if (b0 === 0xff && b1 === 0xd8 && b2 === 0xff) return "image/jpeg";
		if (b0 === 0x52 && b1 === 0x49 && b2 === 0x46) return "image/webp";
		if (b0 === 0x1a && b1 === 0x45) return "video/webm";
	} catch {}
	return fallback;
}
async function webFilePick(media: "image" | "video" | "any", limit: number): Promise<PickedMedia[]> {
	if (typeof document === "undefined") return [];
	return new Promise((resolve) => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = media === "image" ? "image/*,image/gif,.gif,.heic,.heif,.webp,.jpg,.jpeg,.png" : media === "video" ? "video/*,.mp4,.mov,.m4v,.webm" : "image/*,video/*,image/gif,.gif,.heic,.heif,.webp,.jpg,.jpeg,.png,.mov,.mp4,.m4v,.webm";
		input.multiple = limit > 1;
    // WKWebView / iOS Safari ignore click() on a detached or display:none file input.
    input.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.01;pointer-events:none;z-index:-1;";
    document.body.appendChild(input);
    let settled = false;
    const finish = (items: PickedMedia[]) => {
      if (settled) return;
      settled = true;
      window.setTimeout(() => input.remove(), 0);
      resolve(items);
    };
		input.onchange = async () => {
			const files = Array.from(input.files ?? []).slice(0, limit);
			const out: PickedMedia[] = [];
			for (const f of files) {
				const dataUrl = await fileToDataUrl(f);
				out.push({
					kind: classifyPickedKind(f.type, f.name, dataUrl),
					dataUrl,
					fileName: f.name
				});
			}
			finish(out);
		};
		input.addEventListener("cancel", () => finish([]));
		input.click();
	});
}
function classifyPickedKind(type?: string | MediaType | null, name?: string | null, dataUrl?: string): PickedMedia["kind"] {
	const t = String(type ?? "").toLowerCase();
	const n = String(name ?? "").toLowerCase();
	const head = String(dataUrl ?? "").slice(0, 40).toLowerCase();
	if (t.includes("gif") || n.endsWith(".gif") || head.startsWith("data:image/gif")) return "gif";
	if (t.includes("video") || t === String(MediaType.Video) || /\.(mp4|m4v|mov|webm|3gp)$/.test(n) || head.startsWith("data:video/")) return "video";
	return "image";
}
function fileToDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const r = new FileReader();
		r.onload = () => resolve(String(r.result ?? ""));
		r.onerror = () => reject(r.error);
		r.readAsDataURL(file);
	});
}
async function blobUrlToDataUrl(url: string): Promise<string> {
	const blob = await (await fetch(url)).blob();
	return new Promise((resolve, reject) => {
		const r = new FileReader();
		r.onload = () => resolve(String(r.result ?? ""));
		r.onerror = () => reject(r.error);
		r.readAsDataURL(blob);
	});
}
export async function saveDataUrlToDevice(dataUrl: string, fileName: string): Promise<boolean> {
	return (await saveMediaToDevice(dataUrl, { fileName })).ok;
}
export function mediaSaveName(fileName?: string | null, mime?: string | null, url?: string): string {
	const extFromMime = mime?.includes("png") ? "png" : mime?.includes("jpeg") || mime?.includes("jpg") ? "jpg" : mime?.includes("gif") ? "gif" : mime?.includes("webp") ? "webp" : mime?.includes("mp4") ? "mp4" : mime?.includes("webm") ? "webm" : mime?.includes("quicktime") ? "mov" : mime?.includes("pdf") ? "pdf" : "";
	const cleaned = ((fileName || "").trim() || (url ? url.split("/").pop()?.split("?")[0] : "") || `nyx-${Date.now()}`).replace(/[^\w.\-]+/g, "_").slice(0, 80) || `nyx-${Date.now()}`;
	if (extFromMime && !cleaned.includes(".")) return `${cleaned}.${extFromMime}`;
	return cleaned;
}
export type SaveMediaResult =
  | { ok: true; fileName: string }
  | { ok: false; error: string; permissionDenied?: boolean };

export async function saveMediaToDevice(url: string, opts?: { fileName?: string; mime?: string; onProgress?: (pct: number) => void }): Promise<SaveMediaResult> {
	const src = (url ?? "").trim();
	if (!src) return {
		ok: false,
		error: "Nothing to save."
	};
	const name = mediaSaveName(opts?.fileName, opts?.mime, src);
	try {
		if (onNative()) {
			if (await requestNyxPermission("photos") === "denied") return {
				ok: false,
				error: "Photos permission was denied. Enable it in system settings to save media.",
				permissionDenied: true
			};
		}
		const dataUrl = src.startsWith("data:") ? src : await fetchMediaAsDataUrl(src, opts?.onProgress);
		if (onNative()) {
			const base64 = dataUrl.includes(",") ? dataUrl.slice(dataUrl.indexOf(",") + 1) : dataUrl;
			if (!base64) return {
				ok: false,
				error: "Couldn't read that file."
			};
			await Filesystem.writeFile({
				path: `NYX/${name}`,
				data: base64,
				directory: Directory.Documents,
				recursive: true
			});
			triggerHaptic("success");
			await nativeToast(`Saved ${name}`).catch(() => undefined);
			return {
				ok: true,
				fileName: name
			};
		}
		const a = document.createElement("a");
		a.href = dataUrl;
		a.download = name;
		a.rel = "noopener";
		document.body.appendChild(a);
		a.click();
		a.remove();
		return {
			ok: true,
			fileName: name
		};
	} catch (e) {
		const msg = e instanceof Error ? e.message : "Couldn't save that file.";
		if (/denied|permission/i.test(msg)) return {
			ok: false,
			error: "Permission was denied. Enable access in system settings.",
			permissionDenied: true
		};
		return {
			ok: false,
			error: msg
		};
	}
}
async function fetchMediaAsDataUrl(url: string, onProgress?: (pct: number) => void): Promise<string> {
	const resolved = url.startsWith("/") && typeof window !== "undefined" ? `${window.location.origin}${url}` : url;
	if (!/^https?:\/\//i.test(resolved) && !resolved.startsWith("blob:")) throw new Error("That file can't be saved.");
	const res = await fetch(resolved);
	if (!res.ok) throw new Error("Couldn't download that file.");
	const total = Number(res.headers.get("content-length") || 0);
	if (!res.body || !total || !onProgress) {
		const blob = await res.blob();
		onProgress?.(100);
		return blobToDataUrl(blob);
	}
	const reader = res.body.getReader();
	const chunks = [];
	let received = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value) {
			chunks.push(value);
			received += value.byteLength;
			onProgress(Math.min(99, Math.round(received / total * 100)));
		}
	}
	const blob = new Blob(chunks);
	onProgress(100);
	return blobToDataUrl(blob);
}
function blobToDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const r = new FileReader();
		r.onload = () => resolve(String(r.result ?? ""));
		r.onerror = () => reject(r.error ?? /* @__PURE__ */ new Error("Couldn't read that file."));
		r.readAsDataURL(blob);
	});
}
export async function getNetworkStatus(): Promise<{ connected: boolean; connectionType: NetworkKind }> {
	try {
		if (onNative()) {
			const s = await Network.getStatus();
			const t = s.connectionType;
			const connectionType = t === "wifi" ? "wifi" : t === "cellular" ? "cellular" : s.connected ? "unknown" : "none";
			return {
				connected: s.connected,
				connectionType
			};
		}
	} catch {}
	const connected = typeof navigator === "undefined" ? true : navigator.onLine;
	return {
		connected,
		connectionType: connected ? "unknown" : "none"
	};
}
export async function getDeviceSnapshot(): Promise<DeviceSnapshot> {
	const fallback = {
		platform: nativePlatform(),
		osVersion: "",
		model: "",
		manufacturer: "",
		appVersion: "1.0.0",
		build: "1",
		webViewVersion: "",
		isVirtual: false,
		language: typeof navigator === "undefined" ? "en" : navigator.language
	};
	if (!onNative()) return fallback;
	try {
		const [info, app, lang] = await Promise.all([
			Device.getInfo(),
			App.getInfo(),
			Device.getLanguageCode().catch(() => ({ value: fallback.language }))
		]);
		return {
			platform: nativePlatform(),
			osVersion: info.osVersion,
			model: info.model,
			manufacturer: info.manufacturer,
			appVersion: app.version,
			build: app.build,
			webViewVersion: info.webViewVersion ?? "",
			isVirtual: Boolean(info.isVirtual),
			language: lang.value
		};
	} catch {
		return fallback;
	}
}
export async function getCurrentPosition(): Promise<{ lat: number; lng: number; accuracy: number } | null> {
	try {
		if (onNative()) {
			const pos = await Geolocation.getCurrentPosition({
				enableHighAccuracy: false,
				timeout: 10_000,
				maximumAge: 60_000
			});
			return {
				lat: pos.coords.latitude,
				lng: pos.coords.longitude,
				accuracy: pos.coords.accuracy ?? 0
			};
		}
	} catch {}
	if (typeof document === "undefined" || typeof navigator === "undefined" || !navigator.geolocation) return null;
	return new Promise((resolve) => {
		navigator.geolocation.getCurrentPosition((pos) => resolve({
			lat: pos.coords.latitude,
			lng: pos.coords.longitude,
			accuracy: pos.coords.accuracy
		}), () => resolve(null), {
			enableHighAccuracy: false,
			timeout: 8_000,
			maximumAge: 60_000
		});
	});
}
export async function nativeToast(text: string): Promise<void> {
	try {
		if (onNative()) {
			await Toast.show({
				text,
				duration: "short",
				position: "bottom"
			});
			return;
		}
	} catch {}
}
export async function hideKeyboard() {
	try {
		if (onNative()) await Keyboard.hide();
	} catch {}
}
export async function setOrientationLock(lock: "portrait" | "landscape" | "unlock"): Promise<void> {
	if (!onNative()) return;
	try {
		if (lock === "unlock") await ScreenOrientation.unlock();
		else await ScreenOrientation.lock({ orientation: lock === "portrait" ? "portrait" : "landscape" });
	} catch {}
}
export async function setAppBadge(count: number): Promise<void> {
	const n = Math.max(0, Math.floor(count));
	if (onNative()) try {
		await NyxNative.setBadge({ count: n });
	} catch {}
	try {
		if (typeof navigator !== "undefined" && "setAppBadge" in navigator) {
			const badge = navigator;
			if (n === 0) await badge.clearAppBadge?.();
			else await badge.setAppBadge?.(n);
		}
	} catch {}
}
export async function setSecureFlag(on: boolean): Promise<void> {
	if (!onNative()) return;
	try {
		await NyxNative.setSecureFlag({ on });
	} catch {}
}
export async function applySystemTextZoom() {
	if (!onNative()) return;
	try {
		const z = await TextZoom.getPreferred();
		if (z.value) await TextZoom.set({ value: Math.min(1.35, Math.max(0.85, z.value)) });
	} catch {}
}
export async function registerPushNotifications(opts?: {
	request?: boolean;
}): Promise<"granted" | "denied" | "unavailable" | "prompt"> {
	if (!onNative()) return "unavailable";
	try {
		let perm = await PushNotifications.checkPermissions();
		if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
			if (!opts?.request) return "prompt";
			perm = await PushNotifications.requestPermissions();
		}
		if (perm.receive !== "granted") return "denied";
		try {
			await LocalNotifications.createChannel({
				id: "nyx-default",
				name: "NYX",
				description: "Messages, mentions, and activity",
				importance: 4,
				visibility: 1,
				vibration: true,
				sound: "default"
			});
		} catch {
			/* notification channels are Android-only */
		}
		await PushNotifications.register();
		return "granted";
	} catch {
		return "unavailable";
	}
}
export async function scheduleLocalNotification(opts: { id: number; title: string; body: string; at?: Date; channelId?: string; path?: string }): Promise<boolean> {
	try {
		if (!onNative()) {
			if (typeof Notification === "undefined") return false;
			if (Notification.permission === "default") await Notification.requestPermission();
			if (Notification.permission !== "granted") return false;
			new Notification(opts.title, { body: opts.body });
			return true;
		}
		let perm = await LocalNotifications.checkPermissions();
		if (perm.display === "prompt") perm = await LocalNotifications.requestPermissions();
		if (perm.display !== "granted") return false;
		await LocalNotifications.schedule({ notifications: [{
			id: opts.id,
			title: opts.title,
			body: opts.body,
			schedule: opts.at ? { at: opts.at } : undefined,
			channelId: opts.channelId ?? "nyx-default",
			extra: opts.path ? { path: opts.path } : undefined
		}] });
		return true;
	} catch {
		return false;
	}
}
export async function consumeIncomingShare(): Promise<{ text?: string; url?: string; mime?: string } | null> {
	if (!onNative()) return null;
	try {
		const r = await NyxNative.consumeShare();
		if (!r) return null;
		const text = typeof r.text === "string" ? r.text : "";
		const url = typeof r.url === "string" ? r.url : "";
		const mime = typeof r.mime === "string" ? r.mime : "";
		if (!text && !url && !mime) return null;
		return {
			text: text || undefined,
			url: url || undefined,
			mime: mime || undefined
		};
	} catch {
		return null;
	}
}
export async function hashPin(pin: string, salt?: string): Promise<string> {
	const s = salt ?? randomSalt();
	const data = new TextEncoder().encode(`nyx-lock:${s}:${pin}`);
	if (typeof crypto !== "undefined" && crypto.subtle) {
		const buf = await crypto.subtle.digest("SHA-256", data);
		const hex = Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
		return `${s}$${hex}`;
	}
	let h = 0;
	for (const c of pin) h = (h * 31 + c.charCodeAt(0)) >>> 0;
	return `${s}$weak:${h.toString(16)}`;
}
async function legacyPinHash(pin: string): Promise<string> {
	const data = new TextEncoder().encode(`nyx-lock:${pin}`);
	if (typeof crypto !== "undefined" && crypto.subtle) {
		const buf = await crypto.subtle.digest("SHA-256", data);
		return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
	}
	let h = 0;
	for (const c of pin) h = (h * 31 + c.charCodeAt(0)) >>> 0;
	return `weak:${h.toString(16)}`;
}
function randomSalt(): string {
	if (typeof crypto !== "undefined" && crypto.getRandomValues) {
		return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
	}
	return `t${Date.now().toString(16)}`;
}
export function pinShapeOk(pin: string): boolean {
	return /^\d{4,6}$/.test(pin);
}
export function pinDelayMs(fails: number): number {
	if (fails < 5) return 0;
	if (fails < 8) return 30_000;
	if (fails < 12) return 120_000;
	return 300_000;
}
export type AppLockMethod = "off" | "pin" | "biometric";
export async function appLockMethod(): Promise<AppLockMethod> {
	const v = await getStorage(LOCK_METHOD_KEY);
	if (v === "pin" || v === "biometric" || v === "off") return v;
	return (await appLockEnabled()) ? "pin" : "off";
}
export async function enableAppLock(pin: string): Promise<void> {
	if (!pinShapeOk(pin)) throw new Error("Use a 4–6 digit PIN.");
	await setSecure(LOCK_HASH_KEY, await hashPin(pin));
	await setStorage(LOCK_ON_KEY, true);
	await setStorage(LOCK_METHOD_KEY, "pin");
	await clearPinFailures();
}
export async function enableBiometricLock(): Promise<void> {
	const kind = await nativeBiometricKind();
	if (kind === "none") throw new Error("Biometric authentication is unavailable on this device.");
	const ok = await nativeBiometricUnlock("Confirm to turn on biometric lock");
	if (!ok) throw new Error("Biometric authentication was cancelled.");
	await setStorage(LOCK_ON_KEY, true);
	await setStorage(LOCK_METHOD_KEY, "biometric");
}
export async function disableAppLock() {
	await removeSecure(LOCK_HASH_KEY);
	await removeSecure(LOCK_FAIL_KEY);
	await setStorage(LOCK_ON_KEY, false);
	await setStorage(LOCK_METHOD_KEY, "off");
}
export async function appLockHasPin(): Promise<boolean> {
	return Boolean(await getSecure(LOCK_HASH_KEY));
}
export async function appLockEnabled(): Promise<boolean> {
	return (await getStorage(LOCK_ON_KEY)) === true;
}
export async function verifyAppLockPin(pin: string): Promise<boolean> {
	const stored = await getSecure(LOCK_HASH_KEY);
	if (!stored) return false;
	if (!stored.includes("$")) return stored === (await legacyPinHash(pin));
	const salt = stored.slice(0, stored.indexOf("$"));
	return (await hashPin(pin, salt)) === stored;
}
export async function pinFailureState(): Promise<{ fails: number; until: number }> {
	const raw = await getSecure(LOCK_FAIL_KEY);
	if (!raw) return { fails: 0, until: 0 };
	const [f, u] = raw.split(":");
	return { fails: Number(f) || 0, until: Number(u) || 0 };
}
export async function recordPinFailure(): Promise<{ fails: number; until: number }> {
	const cur = await pinFailureState();
	const fails = cur.fails + 1;
	const until = Date.now() + pinDelayMs(fails);
	await setSecure(LOCK_FAIL_KEY, `${fails}:${until}`);
	return { fails, until };
}
export async function clearPinFailures() {
	await removeSecure(LOCK_FAIL_KEY);
}
export async function appLockTimeoutMs(): Promise<number> {
	const v = await getStorage(LOCK_TIMEOUT_KEY);
	return typeof v === "number" && v >= 0 ? v : 60_000;
}
export async function setAppLockTimeoutMs(ms: number): Promise<void> {
	await setStorage(LOCK_TIMEOUT_KEY, Math.max(0, ms));
}
export function requestManualLock() {
	if (typeof window === "undefined") return;
	window.dispatchEvent(new CustomEvent("nyx-lock-now"));
}
export async function nativeBiometricKind(): Promise<"face" | "fingerprint" | "biometric" | "none"> {
	if (!onNative()) return "none";
	try {
		const r = await NyxNative.biometricAvailable();
		if (!r.available) return "none";
		if (r.kind === "face" || r.kind === "fingerprint" || r.kind === "biometric") return r.kind;
		return "biometric";
	} catch {
		return "none";
	}
}
export async function requestNyxPermission(kind: NyxPermission): Promise<PermissionState> {
	try {
		if (kind === "camera" && onNative()) return mapPerm((await Camera.requestPermissions({ permissions: ["camera"] })).camera);
		if (kind === "photos" && onNative()) return mapPerm((await Camera.requestPermissions({ permissions: ["photos"] })).photos);
		if (kind === "location" && onNative()) return mapPerm((await Geolocation.requestPermissions({ permissions: ["location"] })).location);
		if (kind === "notifications" && onNative()) return mapPerm((await PushNotifications.requestPermissions()).receive);
		if (kind === "microphone" && typeof navigator !== "undefined") {
			(await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop());
			return "granted";
		}
	} catch {
		return "denied";
	}
	return "prompt";
}
function mapPerm(v: string | undefined): PermissionState {
	if (v === "granted") return "granted";
	if (v === "denied") return "denied";
	if (v === "limited") return "limited";
	if (v === "prompt-with-rationale" || v === "prompt") return "prompt";
	return "denied";
}
export async function nativeBiometricAvailable(): Promise<boolean> {
	if (!onNative()) {
		if (typeof window === "undefined" || !window.PublicKeyCredential) return false;
		try {
			return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
		} catch {
			return false;
		}
	}
	try {
		const r = await NyxNative.biometricAvailable();
		return Boolean(r.available);
	} catch {
		return false;
	}
}
export async function nativeBiometricUnlock(reason = "Unlock NYX"): Promise<boolean> {
	if (!onNative()) return false;
	try {
		const r = await NyxNative.authenticate({ reason });
		if (r.ok) triggerHaptic("success");
		return Boolean(r.ok);
	} catch {
		return false;
	}
}
