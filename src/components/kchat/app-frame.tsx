import { Link, Navigate, Outlet, useRouterState } from "@tanstack/react-router";
import {
  AlignJustify,
  Bell,
  Camera,
  Clapperboard,
  Compass,
  House,
  ListFilter,
  MessageCircle,
  Plus,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useEffect, useState, type ComponentType, type SVGProps } from "react";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { signOut } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { useMeQuery, useUnread, useInboxUnread } from "@/lib/kchat/hooks";
import { heartbeat, twoFactorStatus } from "@/lib/kchat/server/profiles";
import { cn } from "@/lib/utils";
import { triggerHaptic } from "@/utils/nativeCapabilities";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Wordmark, KMark } from "./logo";
import { applyTheme } from "./theme";
import { IncomingCallHost } from "./incoming-call";
import { IncomingMessageHost, formatUnreadBadge } from "./incoming-message";
import { MusicMiniPlayer } from "./music-player";
import { ViewportSync } from "./layout";

type Icon = ComponentType<SVGProps<SVGSVGElement> & { strokeWidth?: number }>;

export function AppFrame() {
  const { user, isPending } = useCurrentUserState();
  const me = useMeQuery();
  const unread = useUnread(Boolean(user) && Boolean(me.data));
  const inboxUnread = useInboxUnread(Boolean(user) && Boolean(me.data));
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [need2fa, setNeed2fa] = useState(false);

  useEffect(() => {
    if (!user || !me.data) return;
    void heartbeat()
      .then((h) => {
        if (h.verifyKind !== me.data.verifyKind || h.role !== me.data.role || h.isArc !== me.data.isArc || h.isPremium !== me.data.isPremium || h.superOmniActive !== me.data.superOmni?.active) {
          void me.refetch();
        }
      })
      .catch((e) => {
        if (e instanceof Error && e.message === "Unauthorized") void signOut("/login");
      });
    const t = setInterval(() => {
      void heartbeat()
        .then((h) => {
          if (h.verifyKind !== me.data.verifyKind || h.role !== me.data.role || h.isArc !== me.data.isArc || h.isPremium !== me.data.isPremium || h.superOmniActive !== me.data.superOmni?.active) {
            void me.refetch();
          }
        })
        .catch((e) => {
          if (e instanceof Error && e.message === "Unauthorized") void signOut("/login");
        });
    }, 12_000);
    return () => clearInterval(t);
  }, [user, me.data, me]);

  useEffect(() => {
    if (me.data?.theme) applyTheme(me.data.theme);
  }, [me.data?.theme]);

  useEffect(() => {
    if (!me.data?.totpEnabled || path === "/verify-2fa") return;
    void twoFactorStatus().then((s) => setNeed2fa(s.required));
  }, [me.data?.totpEnabled, path]);

  useEffect(() => {
    if (me.isError && me.error instanceof Error && me.error.message === "Unauthorized") {
      void signOut("/login");
    }
  }, [me.isError, me.error]);

  if (isPending || (user && !me.data && !me.isError)) {
    return (
      <div className="kc-shell">
        <ViewportSync />
        <div className="kc-shell-body">
          <header className="kc-header kc-header-wash">
            <Wordmark />
          </header>
          <div className="flex flex-1 flex-col justify-center gap-3 px-6 pb-24">
            <p className="text-2xl font-semibold tracking-tight">Your space is opening</p>
            <p className="text-sm text-muted">Feed, Flashes, Atlas, and NYXAI — one network.</p>
            <Skeleton className="kc-skeleton-wash mt-4 h-16 w-full" />
            <Skeleton className="kc-skeleton-wash h-40 w-full" />
          </div>
        </div>
      </div>
    );
  }
  if (!user) return <RedirectToSignIn />;

  if (me.isError) {
    const msg = me.error instanceof Error ? me.error.message : "";
    if (msg === "Unauthorized") return <RedirectToSignIn />;
    return (
      <main className="kc-shell grid place-items-center p-6 text-center">
        <ViewportSync />
        <div>
          <Wordmark className="justify-center" />
          <h1 className="mt-6 text-xl font-semibold">Couldn’t load your profile</h1>
          <p className="mt-2 text-sm text-muted">
            {me.error instanceof Error ? me.error.message : "Please try again."}
          </p>
          <Button className="mt-5" onClick={() => void me.refetch()}>
            Retry
          </Button>
        </div>
      </main>
    );
  }

  if (me.data?.isBanned) {
    return (
      <main className="grid min-h-dvh place-items-center p-6 text-center">
        <h1 className="text-xl font-semibold">Account unavailable</h1>
        <p className="mt-2 text-sm text-muted">This account has been banned.</p>
      </main>
    );
  }

  if (me.data && !me.data.onboarded && path !== "/onboarding") {
    return <Navigate to="/onboarding" replace />;
  }
  if (need2fa && path !== "/verify-2fa") {
    return <Navigate to="/verify-2fa" replace />;
  }

  const isWatch = path === "/watch" || path.startsWith("/watch/");
  const isInboxHome = path === "/inbox";
  const isInboxThread = /\/inbox\/.+/.test(path);
  const immersive =
    isWatch ||
    path.startsWith("/call") ||
    path.startsWith("/story") ||
    path.startsWith("/status") ||
    path.startsWith("/capture") ||
    path.startsWith("/flash");
  const hideSidebar = immersive || path.startsWith("/onboarding") || path.startsWith("/verify-2fa");
  const hideHeader = immersive || isInboxHome || isInboxThread || path.startsWith("/kai") || path.startsWith("/onboarding") || path.startsWith("/verify-2fa");
  const hideBottom = immersive || isInboxThread || path.startsWith("/kai") || path.startsWith("/onboarding") || path.startsWith("/verify-2fa");

  const inboxCount = inboxUnread.data?.unread ?? 0;
  const alertCount = unread.data?.unread ?? 0;

  return (
    <div className={cn("kc-shell", immersive && "is-immersive", hideBottom && "is-no-bottom")}>
      <ViewportSync />
      <IncomingCallHost />
      <IncomingMessageHost />
      {!hideSidebar ? (
        <nav className="kc-sidebar" aria-label="NYX">
          <Link to="/" className="mb-3 hidden px-2 lg:flex">
            <Wordmark />
          </Link>
          <Link to="/" className="mb-2 grid place-items-center py-1 lg:hidden" aria-label="NYX home">
            <KMark className="size-8" />
          </Link>
          <SideLink to="/" icon={House} label="Home" active={path === "/"} />
          <SideLink to="/watch" icon={Clapperboard} label="Watch" active={path.startsWith("/watch")} />
          <Link
            to="/capture"
            className="kc-sidebar-create kc-glow-capture"
            aria-label="Create"
            onClick={() => triggerHaptic()}
          >
            <Camera className="size-5" />
            <span className="kc-sidebar-label">Create</span>
          </Link>
          <SideLink
            to="/inbox"
            icon={MessageCircle}
            label="Inbox"
            active={path.startsWith("/inbox")}
            badge={inboxCount}
          />
          <SideLink to="/me" icon={UserRound} label="You" active={path === "/me" || path.startsWith("/u/")} />
          <div className="my-3 h-px bg-border" />
          <SideLink to="/coins" icon={AlignJustify} label="Coins" active={path.startsWith("/coins")} />
          <SideLink to="/discover" icon={Compass} label="Discover" active={path.startsWith("/discover")} />
          <SideLink to="/lists" icon={ListFilter} label="Lists" active={path.startsWith("/lists")} />
          <SideLink to="/kai" icon={Sparkles} label="NYXAI" active={path.startsWith("/kai")} accent />
          <SideLink to="/alerts" icon={Bell} label="Alerts" active={path.startsWith("/alerts")} badge={alertCount} />
        </nav>
      ) : null}
      <div className="kc-shell-body">
        {me.data?.deactivatedAt ? (
          <div className="bg-warn/15 px-4 py-2 text-center text-xs text-warn">
            Your account is deactivated and hidden. Open Settings to reactivate.
          </div>
        ) : me.data?.isSuspended ? (
          <div className="bg-warn/15 px-4 py-2 text-center text-xs text-warn">
            This account is restricted. Open Settings to read the notice and appeal.
          </div>
        ) : me.data?.restrict && Object.values(me.data.restrict).some(Boolean) ? (
          <div className="bg-warn/15 px-4 py-2 text-center text-xs text-warn">
            Some actions are limited on this account. Open Settings to appeal.
          </div>
        ) : null}
        {!hideHeader ? (
          <header className="kc-header kc-header-wash md:hidden">
            <Wordmark />
            <div className="flex items-center">
              <Link
                to="/coins"
                className="grid size-11 place-items-center rounded-full text-fg hover:bg-elevated"
                aria-label="NYX Coins"
              >
                <AlignJustify className="size-5" strokeWidth={2.25} />
              </Link>
              <Link
                to="/discover"
                className="grid size-11 place-items-center rounded-full text-fg hover:bg-elevated"
                aria-label="Discover"
              >
                <Compass className="size-5" />
              </Link>
              <Link
                to="/create"
                className="grid size-11 place-items-center rounded-full text-fg hover:bg-elevated"
                aria-label="Create post"
              >
                <Plus className="size-5" />
              </Link>
              <Link
                to="/kai"
                className="grid size-11 place-items-center rounded-full text-ai hover:bg-elevated"
                aria-label="NYXAI"
              >
                <Sparkles className="size-5" />
              </Link>
              <Link
                to="/alerts"
                className="relative grid size-11 place-items-center rounded-full text-fg hover:bg-elevated"
                aria-label="Notifications"
              >
                <Bell className="size-5" />
                {alertCount > 0 ? <span className="absolute right-2 top-2 size-2 rounded-full bg-like" /> : null}
              </Link>
            </div>
          </header>
        ) : null}
        <div className="kc-main">
          <Outlet />
        </div>
        {!hideBottom ? <MusicMiniPlayer /> : null}
        {!hideBottom ? (
          <nav className="kc-bottom-nav" aria-label="Primary">
            <Tab to="/" icon={House} label="Home" active={path === "/"} />
            <Tab to="/watch" icon={Clapperboard} label="Watch" active={path.startsWith("/watch")} />
            <Link
              to="/capture"
              className="grid size-12 -translate-y-1 place-items-center rounded-full bg-accent text-accent-fg kc-glow-capture"
              aria-label="Create"
              onClick={() => triggerHaptic()}
            >
              <Camera className="size-6" />
            </Link>
            <Tab
              to="/inbox"
              icon={MessageCircle}
              label="Inbox"
              active={path.startsWith("/inbox")}
              badge={inboxCount}
            />
            <Tab to="/me" icon={UserRound} label="You" active={path === "/me" || path.startsWith("/u/")} />
          </nav>
        ) : null}
      </div>
    </div>
  );
}

function SideLink({
  to,
  icon: Icon,
  label,
  active,
  badge,
  accent,
}: {
  to: string;
  icon: Icon;
  label: string;
  active: boolean;
  badge?: number;
  accent?: boolean;
}) {
  return (
    <Link
      to={to as never}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      onClick={() => triggerHaptic()}
      className={cn("kc-sidebar-link relative", accent && "text-ai")}
    >
      <Icon className="kc-sidebar-ico size-5 shrink-0" />
      <span className="kc-sidebar-label truncate">{label}</span>
      {(badge ?? 0) > 0 ? (
        <span className="kc-unread absolute right-2 top-1 lg:static lg:ml-auto">
          {formatUnreadBadge(badge ?? 0)}
        </span>
      ) : null}
    </Link>
  );
}

function Tab({
  to,
  icon: Icon,
  label,
  active,
  hideLabel,
  badge,
}: {
  to: "/" | "/watch" | "/inbox" | "/me";
  icon: Icon;
  label: string;
  active: boolean;
  hideLabel?: boolean;
  badge?: number;
}) {
  return (
    <Link
      to={to}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      onClick={() => triggerHaptic()}
      className={cn(
        "kc-nav-tab relative flex min-w-11 flex-col items-center gap-0.5 pt-1 text-[10px] text-muted",
        active && "text-fg",
        hideLabel && "pt-0",
      )}
    >
      <Icon className="size-5" strokeWidth={hideLabel ? 2.25 : 2} />
      {hideLabel ? null : <span>{label}</span>}
      {(badge ?? 0) > 0 ? (
        <span className="absolute right-1/2 top-0 translate-x-3 rounded-full bg-like px-1 text-[9px] font-bold leading-4 text-white">
          {formatUnreadBadge(badge ?? 0)}
        </span>
      ) : null}
    </Link>
  );
}
