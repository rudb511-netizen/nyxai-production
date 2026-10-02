import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/input";
import { authClient, signOut } from "@/lib/auth/client";
import { UserButton } from "@/lib/auth/gates";
import { useMeQuery } from "@/lib/kchat/hooks";
import { compressImage } from "@/lib/kchat/media-client";
import {
  beginTotp,
  confirmTotp,
  deleteAccount,
  disableTotp,
  loginHistory,
  redeemMark,
  updatePrivacy,
  updateProfile,
  updateSoundPrefs,
} from "@/lib/kchat/server/profiles";
import {
  confirmEmailVerify,
  confirmPhoneOtp,
  deactivateAccount,
  exportAccount,
  listMuted,
  listRestricted,
  phoneStatus,
  reactivateAccount,
  requestEmailVerify,
  requestPhoneOtp,
  unmuteUser,
  unrestrictUser,
} from "@/lib/kchat/server/graph";
import { listMySessions, revokeAllSessions, revokeSession } from "@/lib/kchat/server/security";
import { passwordIssue } from "@/lib/kchat/password-policy";
import { listBlocked, unblockUser } from "@/lib/kchat/server/social";
import { openDm } from "@/lib/kchat/server/messages";
import { OMNI_SUPPORT_USERNAME } from "@/lib/kchat/omni-support-ids";
import { mySanctions, myWarningStatus, submitAppeal } from "@/lib/kchat/server/more";
import { NameMark } from "@/components/kchat/verified-badge";
import { applyTheme } from "@/components/kchat/theme";
import { useQuery } from "@tanstack/react-query";
import type { ThemePref } from "@/lib/kchat/types";
import { canAccessSafety } from "@/lib/kchat/safety";
import { verifyLabel } from "@/lib/kchat/types";
import { AppLockSettings } from "@/components/kchat/app-lock-settings";
import { biometricChallenge, disableBiometric, registerBiometric } from "@/lib/kchat/server/biometric";
import {
  getDeviceSnapshot,
  hapticsEnabled,
  isNativePlatform,
  openSystemSettings,
  permissionWhy,
  registerPushNotifications,
  setHapticsEnabled,
  triggerHaptic,
} from "@/utils/nativeCapabilities";

export const Route = createFileRoute("/_app/settings")({ component: Settings });

function Settings() {
  const me = useMeQuery();
  const nav = useNavigate();
  const p = me.data;
  const history = useQuery({ queryKey: ["login-history"], queryFn: () => loginHistory() });
  const sessions = useQuery({ queryKey: ["my-sessions"], queryFn: () => listMySessions() });
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const sanctions = useQuery({ queryKey: ["my-sanctions"], queryFn: () => mySanctions() });
  const warnings = useQuery({ queryKey: ["my-warnings"], queryFn: () => myWarningStatus() });
  const muted = useQuery({ queryKey: ["muted"], queryFn: () => listMuted() });
  const restricted = useQuery({ queryKey: ["restricted"], queryFn: () => listRestricted() });
  const blocked = useQuery({ queryKey: ["blocked"], queryFn: () => listBlocked() });
  const phoneInfo = useQuery({ queryKey: ["phone-status"], queryFn: () => phoneStatus() });
  const [displayName, setDisplayName] = useState(p?.displayName ?? "");
  const [username, setUsername] = useState(p?.username ?? "");
  const [bio, setBio] = useState(p?.bio ?? "");
  const [website, setWebsite] = useState(p?.website ?? "");
  const [location, setLocation] = useState(p?.location ?? "");
  const [phone, setPhone] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [deact, setDeact] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [totpUrl, setTotpUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [markCode, setMarkCode] = useState("");
  const [del, setDel] = useState("");
  const [hapticOn, setHapticOn] = useState(true);
  const [deviceLine, setDeviceLine] = useState("");
  const native = isNativePlatform();

  useEffect(() => {
    void hapticsEnabled().then(setHapticOn);
    void getDeviceSnapshot().then((d) => {
      const bits = [d.platform, d.model, d.osVersion && `iOS/Android ${d.osVersion}`, d.appVersion && `NYX ${d.appVersion}`].filter(Boolean);
      setDeviceLine(bits.join(" · "));
    });
  }, []);

  if (!p) return null;

  async function saveProfile() {
    try {
      await updateProfile({ data: { displayName, username, bio, website, location } });
      toast.success("Profile updated");
      void me.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <div className="kc-page-enter kc-page space-y-10 px-4 py-6">
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted">Account</h2>
        <p className="text-sm text-muted">{p.email}</p>
        <div className="space-y-1.5">
          <Label>Display name</Label>
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Username</Label>
          <Input value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Bio</Label>
          <Textarea value={bio} maxLength={160} onChange={(e) => setBio(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Website</Label>
          <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" />
        </div>
        <div className="space-y-1.5">
          <Label>Location</Label>
          <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="City" />
        </div>
        <ProfileImageButton
          label="Photo"
          button="Upload photo"
          current={p.avatarUrl}
          maxEdge={640}
          maxBytes={180_000}
          onUploaded={async (url) => {
            await updateProfile({ data: { avatarUrl: url } });
            void me.refetch();
          }}
        />
        <ProfileImageButton
          label="Cover"
          button="Upload cover photo"
          current={p.coverUrl}
          maxEdge={1400}
          maxBytes={320_000}
          wide
          onUploaded={async (url) => {
            await updateProfile({ data: { coverUrl: url } });
            void me.refetch();
          }}
        />
        <Button onClick={() => void saveProfile()}>Save profile</Button>
        <ChangePassword />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted">NYX Verified</h2>
        <p className="text-sm text-muted">
          {p.isPremium
            ? "Premium verification is on. It does not include NYXAI+ or ARC Admin."
            : p.isArc
              ? "ARC Admin is a separate identity. Ordinary green verification is only shown if you purchase NYX Verified."
              : "Optional paid verification: a glowing green check next to your name. It does not include NYXAI+."}
        </p>
        <Button asChild variant={p.isPremium ? "secondary" : "default"} size="sm">
          <Link to="/plus">{p.isPremium ? "Manage verification" : "Get verified"}</Link>
        </Button>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted">NYXAI+</h2>
        <p className="text-sm text-muted">
          {p.nyxaiPlus?.active
            ? p.nyxaiPlus.source === "arc_grant"
              ? "NYXAI+ is included with ARC Admin. Everyday NYXAI stays free for everyone else."
              : "NYXAI+ is on. The green check is a separate plan."
            : "Optional paid NYXAI plan for longer memory and higher limits. Everyday NYXAI stays free. It does not include verification."}
        </p>
        {p.isArc && p.nyxaiPlus?.source === "arc_grant" ? null : (
          <Button asChild variant={p.nyxaiPlus?.active ? "secondary" : "default"} size="sm">
            <Link to="/plus/ai">{p.nyxaiPlus?.active ? "Manage NYXAI+" : "View NYXAI+"}</Link>
          </Button>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted">Account mark</h2>
        {(p.verifyKind && p.verifyKind !== "none") || p.isArc ? (
          <p className="flex items-center gap-2 text-sm">
            <NameMark name={p.displayName} verifyKind={p.verifyKind} isArc={p.isArc} isPremium={p.isPremium} className="font-medium" />
            <span className="text-muted">
              {[verifyLabel(p.verifyKind), p.isArc ? "ARC Admin" : null].filter(Boolean).join(" · ")}
            </span>
          </p>
        ) : (
          <p className="text-sm text-muted">
            If you were given a private mark code, enter it here. The right code puts a check next to your name everywhere people find you.
          </p>
        )}
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            const code = markCode;
            if (!code.trim()) {
              toast.error("That code didn’t work.");
              return;
            }
            void redeemMark({ data: { code } })
              .then((r) => {
                setMarkCode("");
                toast.success(r.label ? `${r.label} mark is on your profile.` : "Mark applied.");
                void me.refetch();
              })
              .catch((err) => toast.error(err instanceof Error ? err.message : "That code didn’t work."));
          }}
        >
          <Input
            id="account-mark-code"
            name="mark-code"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={markCode}
            onChange={(e) => setMarkCode(e.target.value)}
            placeholder="Mark code"
            maxLength={12}
          />
          <Button type="submit" variant="secondary" disabled={!markCode.trim()}>
            Apply mark
          </Button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted">Privacy</h2>
        <Toggle
          label="Private account"
          checked={p.isPrivate}
          onChange={(v) => void updatePrivacy({ data: { isPrivate: v } }).then(() => me.refetch())}
        />
        <Toggle
          label="Show online status"
          checked={p.showOnline}
          onChange={(v) => void updatePrivacy({ data: { showOnline: v } }).then(() => me.refetch())}
        />
        <Toggle
          label="Show last seen"
          checked={p.showLastSeen}
          onChange={(v) => void updatePrivacy({ data: { showLastSeen: v } }).then(() => me.refetch())}
        />
        <Toggle
          label="Read receipts"
          checked={p.readReceipts}
          onChange={(v) => void updatePrivacy({ data: { readReceipts: v } }).then(() => me.refetch())}
        />
        <WhoPicker
          label="Who can call you"
          value={p.whoCanCall}
          onChange={(v) => void updatePrivacy({ data: { whoCanCall: v } }).then(() => me.refetch())}
        />
        <WhoPicker
          label="Who can message you"
          value={p.whoCanMessage}
          onChange={(v) => void updatePrivacy({ data: { whoCanMessage: v } }).then(() => me.refetch())}
        />
        <WhoPicker
          label="Who can send friend requests"
          value={p.whoCanFriend}
          onChange={(v) => void updatePrivacy({ data: { whoCanFriend: v } }).then(() => me.refetch())}
        />
        <WhoPicker
          label="Who can follow you"
          value={p.whoCanFollow}
          onChange={(v) => void updatePrivacy({ data: { whoCanFollow: v } }).then(() => me.refetch())}
        />
        <div className="space-y-1.5 py-1">
          <p className="text-sm">Story visibility</p>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["everyone", "Everyone"],
                ["friends", "Friends"],
                ["close", "Close Friends"],
              ] as const
            ).map(([v, label]) => (
              <Button
                key={v}
                size="sm"
                variant={p.storyVisibility === v ? "default" : "outline"}
                onClick={() => void updatePrivacy({ data: { storyVisibility: v } }).then(() => me.refetch())}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
        <Toggle
          label="Safe Mode"
          checked={Boolean(p.safeMode)}
          onChange={(v) =>
            void import("@/lib/kchat/server/platform")
              .then((m) => m.updateModes({ data: { safeMode: v } }))
              .then(() => me.refetch())
          }
        />
        <Toggle
          label="Focus Mode"
          checked={Boolean(p.focusMode)}
          onChange={(v) =>
            void import("@/lib/kchat/server/platform")
              .then((m) => m.updateModes({ data: { focusMode: v } }))
              .then(() => me.refetch())
          }
        />
        <p className="text-xs text-muted">
          Safe Mode reduces recommended noise. Focus Mode mutes likes, follows, and similar alerts so only messages and calls come through.
        </p>
        <div className="space-y-1.5 py-1">
          <p className="text-sm">Default Status audience</p>
          <p className="text-xs text-muted">
            Friends, except some friends, or only share with. Lists are chosen when you post.
          </p>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["friends", "Friends"],
                ["except", "Friends except…"],
                ["only", "Only share with…"],
              ] as const
            ).map(([v, label]) => (
              <Button
                key={v}
                size="sm"
                variant={p.statusPrivacy === v ? "default" : "outline"}
                onClick={() => void updatePrivacy({ data: { statusPrivacy: v } }).then(() => me.refetch())}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
        <Toggle
          label="Allow Status Resharing"
          checked={p.allowStatusReshare !== false}
          onChange={(v) =>
            void updatePrivacy({ data: { allowStatusReshare: v } })
              .then(() => me.refetch())
              .catch((e) => toast.error(e instanceof Error ? e.message : "Couldn't save."))
          }
        />
        <p className="text-xs text-muted">
          When this is on, people who can see your status can reshare it to their own. You stay credited as the original creator.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted">Notifications & sounds</h2>
        <p className="text-xs text-muted">
          Short tones for send, incoming, and typing. Typing is throttled so it never chatters. Silent mode on the
          device still wins.
        </p>
        <Toggle
          label="Message sounds"
          checked={p.soundPrefs?.messages !== false}
          onChange={(v) => void updateSoundPrefs({ data: { messages: v } }).then(() => me.refetch())}
        />
        <Toggle
          label="Typing sound"
          checked={p.soundPrefs?.typing !== false}
          onChange={(v) => void updateSoundPrefs({ data: { typing: v } }).then(() => me.refetch())}
        />
        <Toggle
          label="Call ringtone"
          checked={p.soundPrefs?.calls !== false}
          onChange={(v) => void updateSoundPrefs({ data: { calls: v } }).then(() => me.refetch())}
        />
        <Toggle
          label="Notification sounds"
          checked={p.soundPrefs?.notifications !== false}
          onChange={(v) => void updateSoundPrefs({ data: { notifications: v } }).then(() => me.refetch())}
        />
        <Toggle
          label="Vibration"
          checked={p.soundPrefs?.vibration !== false}
          onChange={(v) => void updateSoundPrefs({ data: { vibration: v } }).then(() => me.refetch())}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted">Device</h2>
        <p className="text-xs text-muted">
          Native controls for this phone. Web keeps the same settings with browser fallbacks.
        </p>
        {deviceLine ? <p className="text-xs text-subtle">{deviceLine}</p> : null}
        <Toggle
          label="Haptic feedback"
          checked={hapticOn}
          onChange={(v) => {
            setHapticOn(v);
            void setHapticsEnabled(v);
          }}
        />
      </section>

      <AppLockSettings />

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted">Push</h2>
        {native ? (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void registerPushNotifications({ request: true }).then((s) => {
                  if (s === "granted") toast.success("Push permission granted. NYX will store this device token.");
                  else if (s === "denied") toast.error("Notifications were denied. You can enable them in system settings.");
                  else toast.message("Push is only available in the Android and iOS apps.");
                })
              }
            >
              Enable push notifications
            </Button>
            <Button variant="outline" size="sm" onClick={() => void openSystemSettings()}>
              Open system settings
            </Button>
            <p className="text-xs text-muted">{permissionWhy("notifications")}</p>
          </>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted">Account security</h2>
        <p className="text-xs leading-relaxed text-muted">
          Optional device biometrics or a passkey. NYX will never photograph you in the background. If a check fails,
          sensitive actions stay locked until you confirm it is you — the account is not permanently closed.
        </p>
        <p className="text-sm">{p.biometricEnabled ? "Biometric protection is on." : "Biometric protection is off."}</p>
        <BiometricControls enabled={Boolean(p.biometricEnabled)} onChange={() => void me.refetch()} />
      </section>

      <section id="sanctions" className="space-y-3">
        <h2 className="text-sm font-medium text-muted">Account status</h2>
        {warnings.data && warnings.data.count > 0 ? (
          <div className="kc-priority rounded-2xl border border-border p-3">
            <p className="text-sm font-medium">
              Warning {Math.min(warnings.data.count, 3)} of 3
            </p>
            <p className="mt-1 text-xs text-muted">
              NYX Support recorded {warnings.data.count} notice{warnings.data.count === 1 ? "" : "s"} on this account.
              Administrators review after three.
            </p>
            <ul className="mt-2 space-y-1 text-xs text-subtle">
              {warnings.data.items.slice(0, 3).map((w) => (
                <li key={w.id}>{w.body}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {p.isSuspended ? (
          <p className="text-sm text-warn">This account is temporarily suspended.</p>
        ) : null}
        {p.isBanned ? <p className="text-sm text-danger">This account is banned.</p> : null}
        {p.sanctionUntil ? (
          <p className="text-xs text-subtle">Until {new Date(p.sanctionUntil).toLocaleString()}</p>
        ) : null}
        {(sanctions.data ?? []).length === 0 ? (
          <p className="text-sm text-muted">No warnings or restrictions on this account.</p>
        ) : (
          <ul className="space-y-3">
            {(sanctions.data ?? []).map((s) => (
              <SanctionRow
                key={s.id}
                item={s}
                onAppealed={() => void sanctions.refetch()}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted">Appearance</h2>
        <div className="flex gap-2">
          {(["light", "dark", "system"] as ThemePref[]).map((t) => (
            <Button
              key={t}
              size="sm"
              variant={p.theme === t ? "default" : "outline"}
              onClick={() => {
                applyTheme(t);
                void updatePrivacy({ data: { theme: t } }).then(() => me.refetch());
              }}
            >
              {t}
            </Button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted">Notifications</h2>
        <p className="text-xs leading-relaxed text-muted">
          NYX asks for notification permission only when you turn this on. Alerts are sent from the server to this device. Nothing is invented on the phone.
        </p>
        <button
          type="button"
          className="kc-pay-glow inline-flex min-h-11 items-center rounded-full px-5 text-sm font-semibold !text-white"
          onClick={() => {
            void registerPushNotifications({ request: true }).then((r) => {
              if (r === "granted") toast.success("Notifications are on for this device.");
              else if (r === "denied") toast.error("Notifications are blocked in system settings.");
              else if (r === "unavailable") toast.message("Push is available in the NYX Android and iOS apps.");
            });
          }}
        >
          Turn on notifications
        </button>
        {(
          [
            ["messages", "Messages"],
            ["friends", "Friends"],
            ["followers", "Followers"],
            ["likes", "Likes"],
            ["comments", "Comments"],
            ["live", "Live"],
            ["stories", "Stories"],
            ["streaks", "Streaks"],
            ["messagePopup", "Incoming message popup"],
            ["messageReminders", "20-minute unread reminders"],
            ["mentions", "Mentions"],
          ] as const
        ).map(([k, label]) => (
          <Toggle
            key={k}
            label={label}
            checked={p.notifPrefs[k]}
            onChange={(v) =>
              void updatePrivacy({
                data: { notifPrefs: { ...p.notifPrefs, [k]: v } },
              }).then(() => me.refetch())
            }
          />
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted">Two-factor authentication</h2>
        {p.totpEnabled ? (
          <div className="space-y-2">
            <p className="text-sm text-ok">Authenticator app is on.</p>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code to disable" />
            <Button variant="outline" onClick={() => void disableTotp({ data: { code } }).then(() => me.refetch())}>
              Disable 2FA
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <Button
              variant="secondary"
              onClick={() =>
                void beginTotp().then((r) => {
                  setTotpUrl(r.url);
                  toast.message("Add this secret in your authenticator app", { description: r.secret });
                })
              }
            >
              Set up authenticator
            </Button>
            {totpUrl ? <p className="break-all text-xs text-muted">{totpUrl}</p> : null}
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="6-digit code" />
            <Button
              onClick={() =>
                void confirmTotp({ data: { code } }).then((r) => {
                  setCodes(r.backupCodes);
                  void me.refetch();
                })
              }
            >
              Confirm
            </Button>
            {codes ? (
              <ul className="rounded-xl bg-elevated p-3 font-mono text-sm">
                {codes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted">Password</h2>
        <p className="text-xs text-muted">
          Change it while you’re signed in. Reset-by-email isn’t available without a mail provider.
        </p>
        <Input type="password" placeholder="Current password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} autoComplete="current-password" />
        <Input type="password" placeholder="New password (10+ characters)" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" />
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            const issue = passwordIssue(newPw, p.email ?? undefined);
            if (issue) return toast.error(issue);
            const client = authClient as typeof authClient & {
              changePassword?: (d: {
                currentPassword: string;
                newPassword: string;
                revokeOtherSessions?: boolean;
              }) => Promise<{ error: { message?: string } | null }>;
            };
            if (!client.changePassword) {
              toast.error("Password change is not available.");
              return;
            }
            void client
              .changePassword({
                currentPassword: currentPw,
                newPassword: newPw,
                revokeOtherSessions: true,
              })
              .then(({ error }) => {
                if (error) throw new Error(error.message ?? "Could not change password.");
                toast.success("Password updated. Other devices were signed out.");
                setCurrentPw("");
                setNewPw("");
              })
              .catch((e) => toast.error(e instanceof Error ? e.message : "Could not change password."));
          }}
        >
          Update password
        </Button>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted">Devices</h2>
        <p className="text-xs text-muted">Sign out a stolen browser, or all of them at once.</p>
        {(sessions.data ?? []).length === 0 ? (
          <p className="text-sm text-muted">This browser session is the one that’s signed in.</p>
        ) : (
          <ul className="space-y-2">
            {(sessions.data ?? []).map((s) => (
              <li key={s.id} className="flex items-start justify-between gap-2 rounded-xl bg-elevated px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm">{s.userAgent || "Unknown browser"}</p>
                  <p className="text-xs text-muted">{new Date(s.updatedAt).toLocaleString()}</p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void revokeSession({ data: { id: s.id } })
                      .then(() => sessions.refetch())
                      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed"))
                  }
                >
                  Sign out
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void revokeAllSessions()
              .then(() => signOut("/login"))
              .catch((e) => toast.error(e instanceof Error ? e.message : "Failed"))
          }
        >
          Sign out of all devices
        </Button>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted">Login history</h2>
        {(history.data ?? []).length === 0 ? (
          <p className="text-sm text-muted">Successful sign-ins will show up here.</p>
        ) : (
          (history.data ?? []).map((h) => (
            <p key={h.id} className="text-sm text-muted">
              {new Date(h.created_at).toLocaleString()}
              {"kind" in h && (h as { kind?: string }).kind ? ` · ${(h as { kind?: string }).kind}` : ""}
            </p>
          ))
        )}
      </section>

      {canAccessSafety(p.role, p.verifyKind, p.isArc) && (
        <div className="space-y-2">
          <Link to="/admin" className="block text-sm text-accent">
            Open safety desk
          </Link>
          {p.isArc ? (
            <Link to="/support" className="block text-sm text-accent">
              ARC support inbox
            </Link>
          ) : null}
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted">Session</h2>
        <UserButton />
        <Button variant="outline" onClick={() => void signOut("/login")}>
          Sign out
        </Button>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted">Email verification</h2>
        <p className="text-sm text-muted">{p.emailVerified ? "Email is verified." : "Verify your email with a code we send to your inbox."}</p>
        {!p.emailVerified ? (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void requestEmailVerify()
                  .then((r) => toast.success(r.already ? "Already verified" : "Code sent"))
                  .catch((e) => toast.error(e instanceof Error ? e.message : "Failed"))
              }
            >
              Send code
            </Button>
            <Input value={emailCode} onChange={(e) => setEmailCode(e.target.value)} placeholder="6-digit code" />
            <Button
              size="sm"
              onClick={() =>
                void confirmEmailVerify({ data: { code: emailCode } })
                  .then(() => {
                    toast.success("Email verified");
                    void me.refetch();
                  })
                  .catch((e) => toast.error(e instanceof Error ? e.message : "Failed"))
              }
            >
              Confirm
            </Button>
          </>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted">Phone</h2>
        <p className="text-sm text-muted">
          {phoneInfo.data?.verifiedAt
            ? `Verified ${phoneInfo.data.phone}`
            : phoneInfo.data?.configured
              ? "Add a number. We send a real SMS via Twilio."
              : "SMS is not configured on this server. Phone login stays off until Twilio credentials are set."}
        </p>
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+2348012345678" />
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void requestPhoneOtp({ data: { phone } })
                .then(() => toast.success("Code sent"))
                .catch((e) => toast.error(e instanceof Error ? e.message : "Failed"))
            }
          >
            Send SMS
          </Button>
          <Input value={phoneCode} onChange={(e) => setPhoneCode(e.target.value)} placeholder="Code" className="max-w-[8rem]" />
          <Button
            size="sm"
            onClick={() =>
              void confirmPhoneOtp({ data: { phone, code: phoneCode } })
                .then(() => {
                  toast.success("Phone verified");
                  void phoneInfo.refetch();
                  void me.refetch();
                })
                .catch((e) => toast.error(e instanceof Error ? e.message : "Failed"))
            }
          >
            Confirm
          </Button>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted">Muted accounts</h2>
        {(muted.data ?? []).length === 0 ? (
          <p className="text-sm text-muted">Nobody muted.</p>
        ) : (
          (muted.data ?? []).map((u) => (
            <div key={u.userId} className="flex items-center justify-between text-sm">
              <span>@{u.username}</span>
              <Button size="sm" variant="ghost" onClick={() => void unmuteUser({ data: { username: u.username } }).then(() => muted.refetch())}>
                Unmute
              </Button>
            </div>
          ))
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted">Restricted accounts</h2>
        {(restricted.data ?? []).length === 0 ? (
          <p className="text-sm text-muted">Nobody restricted.</p>
        ) : (
          (restricted.data ?? []).map((u) => (
            <div key={u.userId} className="flex items-center justify-between text-sm">
              <span>@{u.username}</span>
              <Button size="sm" variant="ghost" onClick={() => void unrestrictUser({ data: { username: u.username } }).then(() => restricted.refetch())}>
                Unrestrict
              </Button>
            </div>
          ))
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted">Blocked accounts</h2>
        {(blocked.data ?? []).length === 0 ? (
          <p className="text-sm text-muted">Nobody blocked.</p>
        ) : (
          (blocked.data ?? []).map((u) => (
            <div key={u.userId} className="flex items-center justify-between text-sm">
              <Link to="/u/$username" params={{ username: u.username }} className="text-accent">
                @{u.username}
              </Link>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void unblockUser({ data: { username: u.username } }).then(() => blocked.refetch())
                }
              >
                Unblock
              </Button>
            </div>
          ))
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted">NYX Support</h2>
        <p className="text-xs text-muted">
          Message official NYX Support. ARC Admins read and reply in this chat.
        </p>
        <Button
          variant="outline"
          onClick={() =>
            void openDm({ data: { username: OMNI_SUPPORT_USERNAME } })
              .then((r) => nav({ to: "/inbox/$id", params: { id: r.id } }))
              .catch((e) => toast.error(e instanceof Error ? e.message : "Couldn't open NYX Support."))
          }
        >
          Contact NYX Support
        </Button>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted">Your data</h2>
        <Button
          variant="outline"
          onClick={() =>
            void exportAccount()
              .then((payload) => {
                const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `nyx-export-${p.username}.json`;
                a.click();
                URL.revokeObjectURL(url);
                toast.success("Export downloaded");
              })
              .catch((e) => toast.error(e instanceof Error ? e.message : "Failed"))
          }
        >
          Download my data
        </Button>
        <Link to="/lists" className="block text-sm text-accent">
          Manage lists
        </Link>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted">Deactivate</h2>
        {p.deactivatedAt ? (
          <>
            <p className="text-sm text-muted">This account is hidden. Reactivate to appear in search and feeds again.</p>
            <Button onClick={() => void reactivateAccount().then(() => me.refetch())}>Reactivate</Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted">Hide your profile without deleting posts. Type DEACTIVATE to confirm.</p>
            <Input value={deact} onChange={(e) => setDeact(e.target.value)} placeholder="DEACTIVATE" />
            <Button
              variant="outline"
              onClick={() =>
                void deactivateAccount({ data: { confirm: deact } })
                  .then(() => {
                    toast.success("Account deactivated");
                    void me.refetch();
                  })
                  .catch((e) => toast.error(e instanceof Error ? e.message : "Failed"))
              }
            >
              Deactivate
            </Button>
          </>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-danger">Delete account</h2>
        <Input value={del} onChange={(e) => setDel(e.target.value)} placeholder="Type DELETE" />
        <Button
          variant="danger"
          onClick={() =>
            void deleteAccount({ data: { confirm: del } })
              .then(() => signOut("/login"))
              .catch((e) => toast.error(e instanceof Error ? e.message : "Failed"))
          }
        >
          Delete forever
        </Button>
      </section>
    </div>
  );
}

function WhoPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: "everyone" | "friends" | "nobody";
  onChange: (v: "everyone" | "friends" | "nobody") => void;
}) {
  return (
    <div className="space-y-1.5 py-1">
      <p className="text-sm">{label}</p>
      <div className="flex gap-2">
        {(["everyone", "friends", "nobody"] as const).map((v) => (
          <Button key={v} size="sm" variant={value === v ? "default" : "outline"} onClick={() => onChange(v)}>
            {v}
          </Button>
        ))}
      </div>
    </div>
  );
}

function SanctionRow({
  item,
  onAppealed,
}: {
  item: Awaited<ReturnType<typeof mySanctions>>[number];
  onAppealed: () => void;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const canAppeal = item.status === "active" && !item.appealStatus;
  return (
    <li className="rounded-2xl border border-border p-3 text-sm">
      <p className="font-medium capitalize">{item.kind}</p>
      <p className="mt-1 text-muted">{item.reason}</p>
      <p className="mt-1 text-xs text-subtle">
        {new Date(item.startsAt).toLocaleDateString()}
        {item.endsAt ? ` – ${new Date(item.endsAt).toLocaleDateString()}` : " – permanent"}
        {item.appealStatus ? ` · appeal ${item.appealStatus}` : ""}
      </p>
      {canAppeal ? (
        <form
          className="mt-2 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            void submitAppeal({ data: { sanctionId: item.id, body } })
              .then(() => {
                toast.success("Appeal sent to safety");
                setBody("");
                onAppealed();
              })
              .catch((err) => toast.error(err instanceof Error ? err.message : "Could not send appeal."))
              .finally(() => setBusy(false));
          }}
        >
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Explain why this action should be reviewed"
            maxLength={2000}
          />
          <Button type="submit" size="sm" disabled={busy || body.trim().length < 8}>
            {busy ? "Sending…" : "Appeal"}
          </Button>
        </form>
      ) : null}
    </li>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <span className="text-sm">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  return (
    <div className="space-y-2 pt-4">
      <Label>Change password</Label>
      <Input type="password" placeholder="Current" value={current} onChange={(e) => setCurrent(e.target.value)} />
      <Input type="password" placeholder="New password" value={next} onChange={(e) => setNext(e.target.value)} />
      <Button
        variant="outline"
        onClick={async () => {
          const client = authClient as typeof authClient & {
            changePassword?: (d: {
              currentPassword: string;
              newPassword: string;
            }) => Promise<{ error: { message?: string } | null }>;
          };
          if (!client.changePassword) {
            toast.error("Password change is not available.");
            return;
          }
          const { error } = await client.changePassword({
            currentPassword: current,
            newPassword: next,
          });
          if (error) toast.error(error.message ?? "Could not change password");
          else toast.success("Password updated");
        }}
      >
        Update password
      </Button>
    </div>
  );
}


function BiometricControls({ enabled, onChange }: { enabled: boolean; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  async function enable() {
    if (typeof window === "undefined" || !("credentials" in navigator)) {
      toast.error("This browser does not support device biometrics or passkeys.");
      return;
    }
    setBusy(true);
    try {
      const ch = await biometricChallenge({ data: { purpose: "register" } });
      const cred = (await navigator.credentials.create({
        publicKey: {
          challenge: Uint8Array.from(atob(ch.challenge.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
          rp: { id: ch.rpId, name: ch.rpName },
          user: {
            id: Uint8Array.from(atob(ch.userId.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
            name: ch.userName,
            displayName: ch.displayName,
          },
          pubKeyCredParams: [
            { type: "public-key", alg: -7 },
            { type: "public-key", alg: -257 },
          ],
          authenticatorSelection: { userVerification: "preferred", residentKey: "preferred" },
          timeout: 60_000,
          attestation: "none",
        },
      })) as PublicKeyCredential | null;
      if (!cred) throw new Error("Enrollment was cancelled.");
      const att = cred.response as AuthenticatorAttestationResponse;
      const publicKey = att.getPublicKey ? att.getPublicKey() : null;
      if (!publicKey) throw new Error("This authenticator did not return a public key.");
      await registerBiometric({
        data: {
          credentialId: cred.id,
          publicKey: btoa(String.fromCharCode(...new Uint8Array(publicKey))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""),
          clientDataJSON: btoa(String.fromCharCode(...new Uint8Array(att.clientDataJSON))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""),
        },
      });
      toast.success("Biometric protection is on.");
      onChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not enable biometrics.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" disabled={busy || enabled} onClick={() => void enable()}>
        Enable biometric protection
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={busy || !enabled}
        onClick={() =>
          void disableBiometric()
            .then(() => {
              toast.message("Biometric enrollment deleted.");
              onChange();
            })
            .catch((e) => toast.error(e instanceof Error ? e.message : "Could not disable."))
        }
      >
        Delete enrollment
      </Button>
    </div>
  );
}

function ProfileImageButton({
  label,
  button,
  current,
  maxEdge,
  maxBytes,
  wide,
  onUploaded,
}: {
  label: string;
  button: string;
  current: string | null;
  maxEdge: number;
  maxBytes: number;
  wide?: boolean;
  onUploaded: (dataUrl: string) => Promise<void>;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  async function onPick(file: File | undefined) {
    if (!file) return;
    const okType = /^image\/(jpeg|png|webp|gif)$/.test(file.type) || /\.(jpe?g|png|webp|gif)$/i.test(file.name);
    if (!okType) {
      toast.error("Use a JPEG, PNG, WebP, or GIF.");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      toast.error("That image is too large.");
      return;
    }
    const local = URL.createObjectURL(file);
    setPreview((prev) => {
      if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
      return local;
    });
    setBusy(true);
    try {
      const c = await compressImage(file, { maxEdge, maxBytes });
      await onUploaded(c.dataUrl);
      toast.success(label === "Cover" ? "Cover photo updated" : "Profile photo updated");
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      toast.error(
        name === "NotAllowedError"
          ? "Photo permission was denied."
          : e instanceof Error
            ? e.message
            : "Could not upload that photo.",
      );
      setPreview(null);
      URL.revokeObjectURL(local);
    } finally {
      setBusy(false);
    }
  }

  const src = preview || current;
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {src ? (
        wide ? (
          <img src={src} alt="" className="h-28 w-full rounded-2xl object-cover" />
        ) : (
          <img src={src} alt="" className="size-20 rounded-full object-cover" />
        )
      ) : null}
      <input
        ref={ref}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          void onPick(f);
        }}
      />
      <button
        type="button"
        disabled={busy}
        className="kc-pay-glow inline-flex min-h-12 items-center gap-2 rounded-full px-5 text-sm font-semibold !text-white disabled:opacity-70"
        onClick={() => {
          triggerHaptic("light");
          ref.current?.click();
        }}
      >
        {busy ? "Uploading…" : button}
      </button>
    </div>
  );
}
