import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition-[opacity,transform,background-color] duration-150 ease-out active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
  {
    variants: {
      variant: {
        default: "bg-accent text-accent-fg hover:opacity-90",
        secondary: "bg-elevated text-fg hover:bg-elevated/80",
        ghost: "text-fg hover:bg-elevated",
        outline: "border border-border bg-transparent text-fg hover:bg-elevated",
        danger: "bg-danger text-white hover:opacity-90",
        like: "text-like hover:bg-like/10",
      },
      size: {
        sm: "h-9 px-3.5 text-sm",
        md: "h-11 px-4 text-sm",
        lg: "h-12 px-5 text-base",
        icon: "size-11",
        "icon-sm": "size-9",
      },
    },
    defaultVariants: { variant: "default", size: "md" },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}
