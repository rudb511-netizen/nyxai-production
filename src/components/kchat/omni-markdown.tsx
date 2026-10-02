import { useState } from "react";
import { Copy } from "lucide-react";
import { highlightCode } from "@/lib/kchat/omni-highlight";
import { splitMarkdown } from "@/lib/kchat/omni-md";
import { cn } from "@/lib/utils";
import { ImageLightbox } from "@/components/kchat/image-lightbox";

function inline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\$[^$]+\$)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold">
          {p.slice(2, -2)}
        </strong>
      );
    }
    if (p.startsWith("`") && p.endsWith("`")) {
      return (
        <code key={i} className="rounded bg-elevated px-1 py-0.5 font-mono text-[0.85em]">
          {p.slice(1, -1)}
        </code>
      );
    }
    const link = p.match(/^\[([^\]]+)\]\((https?:[^)]+)\)$/);
    if (link) {
      return (
        <a key={i} href={link[2]} target="_blank" rel="noreferrer" className="text-ai underline-offset-2 hover:underline">
          {link[1]}
        </a>
      );
    }
    if (p.startsWith("$") && p.endsWith("$")) {
      return (
        <span key={i} className="font-mono text-[0.9em] text-muted">
          {p}
        </span>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

function CodeBlock({ lang, text }: { lang: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const tokens = highlightCode(lang, text);
  return (
    <div className="overflow-hidden rounded-xl bg-elevated">
      <div className="flex items-center justify-between px-3 py-1.5">
        <p className="text-[10px] uppercase tracking-wide text-subtle">{lang || "code"}</p>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] text-muted hover:bg-surface"
          onClick={() => {
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            });
          }}
        >
          <Copy className="size-3" />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed">
        <code>
          {tokens.map((tok, i) => (
            <span
              key={i}
              className={
                tok.k === "kw"
                  ? "text-ai"
                  : tok.k === "str"
                    ? "text-ok"
                    : tok.k === "cm"
                      ? "text-muted"
                      : tok.k === "num"
                        ? "text-warn"
                        : tok.k === "fn"
                          ? "text-atlas"
                          : undefined
              }
            >
              {tok.t}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

export function OmniMarkdown({ text, className }: { text: string; className?: string }) {
  const nodes = splitMarkdown(text);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className={cn("space-y-2 text-[15px] leading-relaxed", className)}>
      {nodes.map((n, i) => {
        if (n.t === "h") {
          const Tag = (n.level <= 2 ? "h3" : "h4") as "h3" | "h4";
          return (
            <Tag key={i} className="font-semibold tracking-tight">
              {inline(n.text)}
            </Tag>
          );
        }
        if (n.t === "code") {
          return <CodeBlock key={i} lang={n.lang} text={n.text} />;
        }
        if (n.t === "ul") {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {n.items.map((it, j) => (
                <li key={j}>{inline(it)}</li>
              ))}
            </ul>
          );
        }
        if (n.t === "ol") {
          return (
            <ol key={i} className="list-decimal space-y-1 pl-5">
              {n.items.map((it, j) => (
                <li key={j}>{inline(it)}</li>
              ))}
            </ol>
          );
        }
        if (n.t === "quote") {
          return (
            <blockquote key={i} className="border-l-2 border-ai/50 pl-3 text-muted">
              {inline(n.text)}
            </blockquote>
          );
        }
        if (n.t === "table") {
          return (
            <div key={i} className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    {n.headers.map((h) => (
                      <th key={h} className="border-b border-border px-2 py-1 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {n.rows.map((r, ri) => (
                    <tr key={ri}>
                      {r.map((c, ci) => (
                        <td key={ci} className="border-b border-border px-2 py-1">
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (n.t === "hr") return <hr key={i} className="border-border" />;
        if (n.t === "img" || /^!\[([^\]]*)\]\((.+)\)$/.test("text" in n ? n.text : "")) {
          const fromText = n.t !== "img" && "text" in n ? n.text.match(/^!\[([^\]]*)\]\((.+)\)$/) : null;
          const src = n.t === "img" ? n.src : fromText?.[2] || "";
          const alt = n.t === "img" ? n.alt : fromText?.[1] || "";
          if (!src) {
            return null;
          }
          if (alt === "video" || src.startsWith("data:video/") || /\.mp4($|\?)/i.test(src)) {
            return (
              <div key={i} className="space-y-1">
                <video src={src} controls playsInline className="max-h-72 w-full rounded-2xl bg-black" />
                <a href={src} download="nyx-video.mp4" className="text-xs text-ai hover:underline">
                  Download
                </a>
              </div>
            );
          }
          return (
            <button
              key={i}
              type="button"
              className="block w-full"
              onClick={() => setOpen(src)}
              aria-label={alt || "View image"}
            >
              <img src={src} alt={alt || "generated"} className="max-h-72 w-full rounded-2xl object-contain" />
            </button>
          );
        }
        return (
          <p key={i} className="whitespace-pre-wrap">
            {inline(n.text)}
          </p>
        );
      })}
      {open ? <ImageLightbox item={{ url: open, kind: "image" }} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
