import { createFileRoute } from "@tanstack/react-router";
import { AppFrame } from "@/components/kchat/app-frame";

export const Route = createFileRoute("/_app")({
  component: AppFrame,
});
