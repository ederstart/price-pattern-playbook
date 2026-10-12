import { createFileRoute, redirect } from "@tanstack/react-router";

// The live chart moved to "/"; keep old links working.
export const Route = createFileRoute("/ao-vivo")({
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
});
