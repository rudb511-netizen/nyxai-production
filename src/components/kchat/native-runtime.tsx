import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useMeQuery, useInboxUnread, useUnread } from "@/lib/kchat/hooks";
import { saveDevicePushToken } from "@/lib/kchat/server/graph";
import { AppLockScreen } from "@/components/kchat/app-lock-screen";
import {
  appLockEnabled,
  appLockTimeoutMs,
  applySystemTextZoom,
  getDeviceSnapshot,
  getNetworkStatus,
  initAppListeners,
  initNativeChrome,
  lastNativePushToken,
  nativePlatform,
  registerPushNotifications,
  setAppBadge,
  setSecureFlag,
} from "@/utils/nativeCapabilities";

export function NativeRuntime() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useMeQuery();
  const unread = useUnread(Boolean(me.data));
  const inbox = useInboxUnread(Boolean(me.data));
  const [offline, setOffline] = useState(false);
  const [locked, setLocked] = useState(false);
  const lockedRef = useRef(false);
  const pendingPath = useRef<string | null>(null);

  useEffect(() => {
    void initNativeChrome();
    void applySystemTextZoom();
    void getNetworkStatus().then((s) => setOffline(!s.connected));
    void appLockEnabled().then((on) => {
      if (on) {
        lockedRef.current = true;
        setLocked(true);
        void setSecureFlag(true);
      }
    });
    const dispose = initAppListeners((path) => {
      if (lockedRef.current) {
        pendingPath.current = path;
        return;
      }
      void navigate({ to: path as never });
    });
    const arm = (ms: number) => {
      void (async () => {
        if (!(await appLockEnabled())) return;
        if (ms >= (await appLockTimeoutMs())) {
          lockedRef.current = true;
          setLocked(true);
          void setSecureFlag(true);
        }
      })();
    };
    const onResume = (ev: Event) => {
      const ms = (ev as CustomEvent<{ backgroundedMs?: number }>).detail?.backgroundedMs ?? 0;
      void qc.invalidateQueries();
      arm(ms);
    };
    const onPause = () => {
      void setSecureFlag(true);
    };
    let hiddenAt = 0;
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        void setSecureFlag(true);
        return;
      }
      arm(hiddenAt ? Date.now() - hiddenAt : 0);
    };
    const onLockNow = () => {
      void appLockEnabled().then((on) => {
        if (!on) return;
        lockedRef.current = true;
        setLocked(true);
        void setSecureFlag(true);
      });
    };
    const onNet = (ev: Event) => {
      const d = (ev as CustomEvent<{ connected?: boolean }>).detail;
      setOffline(d?.connected === false);
      if (d?.connected) void qc.invalidateQueries();
    };
    const persistToken = (token: string, platform: string) => {
      if (!token || !me.data) return;
      const p = platform === "ios" || platform === "android" ? platform : nativePlatform();
      if (p === "web") return;
      void getDeviceSnapshot()
        .then((d) =>
          saveDevicePushToken({
            data: { token, platform: p, appVersion: d.appVersion || null },
          }),
        )
        .catch(() => undefined);
    };
    const onPush = (ev: Event) => {
      const d = (ev as CustomEvent<{ token?: string; platform?: string }>).detail;
      if (d?.token) persistToken(d.token, d.platform ?? nativePlatform());
    };
    const onPushIn = (ev: Event) => {
      const d = (ev as CustomEvent<{ title?: string; body?: string; data?: { title?: string; body?: string } }>).detail;
      const title = d?.title || d?.data?.title || "NYX";
      const body = d?.body || d?.data?.body || "";
      void qc.invalidateQueries({ queryKey: ["notifications"] });
      void qc.invalidateQueries({ queryKey: ["inbox-unread"] });
      if (body) toast.message(title, { description: body });
    };
    const onShare = (ev: Event) => {
      const d = (ev as CustomEvent<{ text?: string; url?: string; mime?: string }>).detail;
      const text = (d?.text || d?.url || "").trim();
      if (!text && !d?.url) return;
      try {
        sessionStorage.setItem("omni-create-tab", "post");
        sessionStorage.setItem(
          "omni-create-draft",
          JSON.stringify({ tab: "post", body: d?.text || "", mediaUrl: d?.mime?.startsWith("image/") || d?.mime?.startsWith("video/") ? d.url : null }),
        );
      } catch {
        /* ignore */
      }
      void navigate({ to: "/create" });
    };
    window.addEventListener("nyx-app-resume", onResume);
    window.addEventListener("nyx-app-pause", onPause);
    window.addEventListener("nyx-lock-now", onLockNow);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("nyx-network", onNet);
    window.addEventListener("nyx-push-token", onPush);
    window.addEventListener("nyx-push-received", onPushIn);
    window.addEventListener("nyx-incoming-share", onShare);
    void registerPushNotifications();
    return () => {
      dispose();
      window.removeEventListener("nyx-app-resume", onResume);
      window.removeEventListener("nyx-app-pause", onPause);
      window.removeEventListener("nyx-lock-now", onLockNow);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("nyx-network", onNet);
      window.removeEventListener("nyx-push-token", onPush);
      window.removeEventListener("nyx-push-received", onPushIn);
      window.removeEventListener("nyx-incoming-share", onShare);
    };
  }, [navigate, qc, me.data]);

  useEffect(() => {
    if (!me.data) return;
    const t = lastNativePushToken();
    if (!t) return;
    const platform = t.platform === "ios" || t.platform === "android" ? t.platform : null;
    if (!platform) return;
    void getDeviceSnapshot()
      .then((d) =>
        saveDevicePushToken({
          data: { token: t.token, platform, appVersion: d.appVersion || null },
        }),
      )
      .catch(() => undefined);
  }, [me.data]);

  useEffect(() => {
    const n = (unread.data?.unread ?? 0) + (inbox.data?.unread ?? 0);
    void setAppBadge(n);
  }, [unread.data?.unread, inbox.data?.unread]);

  return (
    <>
      {offline ? (
        <div className="kc-offline-banner" role="status">
          You’re offline. NYX will retry when the connection returns — nothing is sent twice.
        </div>
      ) : null}
      {locked ? (
        <AppLockScreen
          onUnlock={() => {
            lockedRef.current = false;
            setLocked(false);
            void setSecureFlag(false);
            const path = pendingPath.current;
            pendingPath.current = null;
            if (path) void navigate({ to: path as never });
          }}
        />
      ) : null}
    </>
  );
}
