import { cn, initials } from "@/lib/utils";

export function Avatar({
  src,
  name,
  size = "md",
  className,
}: {
  src?: string | null;
  name: string;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const dim =
    size === "sm" ? "size-8 text-[10px]" : size === "lg" ? "size-14 text-lg" : size === "xl" ? "size-24 text-2xl" : "size-10 text-xs";
  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden rounded-full bg-elevated text-muted font-medium grid place-items-center",
        dim,
        className,
      )}
    >
      {src ? (
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        <span>{initials(name)}</span>
      )}
    </div>
  );
}
