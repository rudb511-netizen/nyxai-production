import { useId } from "react";
import type { VerifyKind } from "@/lib/kchat/types";
import { identityKind, verifyLabel } from "@/lib/kchat/types";
import { cn } from "@/lib/utils";

function PremiumCheck({ labeled, className }: { labeled?: boolean; className?: string }) {
  return (
    <span
      className={cn("kc-premium-mark inline-flex max-w-[8.5rem] items-center gap-0.5 align-middle", className)}
      role="img"
      aria-label="NYX verified"
      title="NYX verified"
    >
      <svg viewBox="0 0 20 20" className="kc-premium-badge size-3.5 shrink-0">
        <circle cx="10" cy="10" r="9" fill="var(--kc-verify)" />
        <path
          d="M6.15 10.35 8.55 12.75 13.85 7.25"
          fill="none"
          stroke="#fff"
          strokeWidth="2.15"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="kc-premium-check"
        />
      </svg>
      {labeled ? <span className="kc-premium-label">Verified</span> : null}
    </span>
  );
}

export function VerifiedBadge({
  kind,
  labeled,
  className,
}: {
  kind?: VerifyKind | null;
  labeled?: boolean;
  className?: string;
}) {
  const gid = useId().replace(/:/g, "");
  const identity = identityKind(kind);
  const showArc = kind === "arc";
  if (showArc) {
    const label = verifyLabel("arc") ?? "ARC Admin";
    return (
      <span
        className={cn("kc-arc-mark inline-flex max-w-[8.5rem] items-center gap-0.5 align-middle", className)}
        role="img"
        aria-label={label}
        title={label}
      >
        <svg viewBox="0 0 20 20" className="kc-arc-badge size-3.5 shrink-0">
          <defs>
            <linearGradient id={gid} x1="2" y1="18" x2="18" y2="2" gradientUnits="userSpaceOnUse">
              <stop stopColor="var(--kc-arc-ink)" />
              <stop offset="0.55" stopColor="var(--kc-arc)" />
              <stop offset="1" stopColor="var(--kc-arc-metal)" />
            </linearGradient>
          </defs>
          <path
            d="M10 1.6 17.2 5.8 17.2 14.2 10 18.4 2.8 14.2 2.8 5.8Z"
            fill={`url(#${gid})`}
            stroke="var(--kc-arc-metal)"
            strokeWidth="0.7"
          />
          <path
            d="M6.4 10.2 8.7 12.5 13.6 7.4"
            fill="none"
            stroke="var(--kc-arc-ember)"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="kc-arc-check"
          />
        </svg>
        <span className="kc-arc-label">ARC ADMIN</span>
      </span>
    );
  }
  if (!identity || identity === "none") return null;
  const label = verifyLabel(identity) ?? "Verified";
  if (identity === "founder") {
    return (
      <span
        className={cn("kc-founder-mark inline-flex max-w-[9.5rem] items-center gap-0.5 align-middle", className)}
        role="img"
        aria-label={label}
        title={label}
      >
        <svg viewBox="0 0 20 20" className="kc-founder-badge size-3.5 shrink-0">
          <defs>
            <linearGradient id={gid} x1="2" y1="2" x2="18" y2="18" gradientUnits="userSpaceOnUse">
              <stop stopColor="#4c1d95" />
              <stop offset="0.45" stopColor="#7c3aed" />
              <stop offset="1" stopColor="#c4b5fd" />
            </linearGradient>
          </defs>
          <circle cx="10" cy="10" r="9" fill={`url(#${gid})`} />
          <circle cx="5" cy="4.8" r="0.9" fill="#fff" className="kc-founder-spark" />
          <circle cx="15.4" cy="6" r="0.7" fill="#fff" className="kc-founder-spark-2" />
          <circle cx="11.6" cy="15.4" r="0.55" fill="#fff" className="kc-founder-spark" />
          <circle cx="4.2" cy="12.6" r="0.45" fill="#ffe8ee" className="kc-founder-spark-2" />
          <path
            d="M6.15 10.35 8.55 12.75 13.85 7.25"
            fill="none"
            stroke="#ff2d4a"
            strokeWidth="2.15"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="kc-founder-check"
          />
        </svg>
        <span className="kc-founder-label">Nyx founder</span>
      </span>
    );
  }
  if (identity === "developer") {
    return (
      <span
        className={cn("inline-flex max-w-[8.5rem] items-center gap-0.5 align-middle", className)}
        role="img"
        aria-label={label}
        title={label}
      >
        <svg viewBox="0 0 20 20" className="inline-block size-3.5 shrink-0">
          <circle cx="10" cy="10" r="9" fill="var(--kc-atlas)" />
          <path
            d="M6.2 10.2 8.6 12.7 13.8 7.4"
            fill="none"
            stroke="#fff"
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {labeled ? <span className="kc-org-label text-atlas">Developer</span> : null}
      </span>
    );
  }
  return (
    <span
      className={cn("inline-flex max-w-[14rem] items-center gap-0.5 align-middle", className)}
      role="img"
      aria-label={label}
      title={label}
    >
      <svg viewBox="0 0 20 20" className="inline-block size-3.5 shrink-0">
        <circle cx="10" cy="10" r="9" fill="#e8b923" />
        <path
          d="M6.2 10.2 8.6 12.7 13.8 7.4"
          fill="none"
          stroke="#fff"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {labeled ? <span className="kc-org-label">Verified Organization</span> : null}
    </span>
  );
}

export function NameMark({
  name,
  verifyKind,
  isArc,
  isPremium,
  className,
}: {
  name: string;
  verifyKind?: VerifyKind | null;
  isArc?: boolean;
  isPremium?: boolean;
  className?: string;
}) {
  const primary = identityKind(verifyKind);
  const showArc = Boolean(isArc) || verifyKind === "arc";
  const hasPrimary = primary !== "none";
  const showPremium = Boolean(isPremium);
  if (hasPrimary && showArc) {
    return (
      <span
        className={cn("kc-mark-stack inline-flex min-w-0 max-w-full flex-col items-start gap-0.5", className)}
        data-testid="badge-stack"
      >
        <span className="inline-flex max-w-full items-center gap-1">
          <span className="truncate">{name}</span>
          <VerifiedBadge kind={primary} labeled />
          {showPremium ? <PremiumCheck /> : null}
        </span>
        <VerifiedBadge kind="arc" />
      </span>
    );
  }
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1", className)}>
      <span className="truncate">{name}</span>
      {hasPrimary ? <VerifiedBadge kind={primary} /> : null}
      {showPremium ? <PremiumCheck /> : null}
      {showArc ? <VerifiedBadge kind="arc" /> : null}
    </span>
  );
}
