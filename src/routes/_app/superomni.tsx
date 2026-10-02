import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/superomni")({
  component: function SuperOmniRedirect() {
    return <Navigate to="/plus" replace />;
  },
});
