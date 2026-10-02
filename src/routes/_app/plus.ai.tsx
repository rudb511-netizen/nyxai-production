import { createFileRoute } from "@tanstack/react-router";
import { NyxaiPlusPage } from "@/components/kchat/plus-page";

export const Route = createFileRoute("/_app/plus/ai")({ component: NyxaiPlusPage });
