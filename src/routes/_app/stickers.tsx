import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/stickers")({
  component: StickersLayout,
});

function StickersLayout() {
  return <Outlet />;
}
