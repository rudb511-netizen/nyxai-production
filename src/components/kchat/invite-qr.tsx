import { qrSvg } from "@/lib/kchat/qr";

export function InviteQr({ value, label }: { value: string; label?: string }) {
  let svg = "";
  try {
    svg = qrSvg(value, 192);
  } catch {
    return null;
  }
  return (
    <div className="grid place-items-center gap-2 py-2">
      <div
        className="rounded-2xl bg-white p-3"
        aria-hidden
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      {label ? <p className="text-center text-xs text-muted">{label}</p> : null}
    </div>
  );
}
