import { createFileRoute } from "@tanstack/react-router";
import { PlusPage } from "@/components/kchat/plus-page";

export const Route = createFileRoute("/_app/plus/")({
  component: PlusPage,
});
