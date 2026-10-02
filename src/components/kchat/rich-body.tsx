import { Link } from "@tanstack/react-router";
import { splitRichTokens } from "@/lib/kchat/mention";
import { openExternalUrl } from "@/utils/nativeCapabilities";

export function RichBody({ text, className }: { text: string; className?: string }) {
  return (
    <span className={className}>
      {splitRichTokens(text).map((t, i) => {
        if (t.type === "mention") {
          const username = t.value.slice(1);
          return (
            <Link
              key={i}
              to="/u/$username"
              params={{ username: username.toLowerCase() }}
              className="font-medium text-atlas hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {t.value}
            </Link>
          );
        }
        if (t.type === "tag") {
          const tag = t.value.replace(/^#/, "").toLowerCase();
          return (
            <Link
              key={i}
              to="/tag/$tag"
              params={{ tag }}
              className="font-medium text-accent hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {t.value}
            </Link>
          );
        }
        if (t.type === "link") {
          return (
            <button
              key={i}
              type="button"
              className="break-all font-medium text-atlas underline-offset-2 hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                void openExternalUrl(t.value);
              }}
            >
              {t.value}
            </button>
          );
        }
        return <span key={i}>{t.value}</span>;
      })}
    </span>
  );
}
