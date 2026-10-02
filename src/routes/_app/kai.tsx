import { createFileRoute } from "@tanstack/react-router";
import { OmniStudio } from "@/components/kchat/omni-studio";

export const Route = createFileRoute("/_app/kai")({ component: OmniAiPage });

function OmniAiPage() {
  return <OmniStudio />;
}
