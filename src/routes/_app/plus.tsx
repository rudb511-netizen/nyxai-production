import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/plus")({
  component: PlusLayout,
});

function PlusLayout() {
  return <Outlet />;
}
