import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/support/$id")({
  component: SupportThreadRedirect,
});

function SupportThreadRedirect() {
  const { id } = Route.useParams();
  return <Navigate to="/inbox/$id" params={{ id }} replace />;
}
