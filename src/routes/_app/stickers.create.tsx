import { createFileRoute } from "@tanstack/react-router";
import { StickerStudio } from "@/components/kchat/sticker-studio";

export const Route = createFileRoute("/_app/stickers/create")({ component: StickerCreatePage });

function StickerCreatePage() {
  return <StickerStudio />;
}
