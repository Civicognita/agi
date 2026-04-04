/**
 * System Identity page — embeds the ID service UI (id.ai.on) in an iframe.
 * Provides access to OAuth connections, channel wizard, entity management,
 * and federated identity from within the AGI dashboard.
 */

import { useRootContext } from "./root.js";

export default function IdentityServicePage() {
  const { overview } = useRootContext();
  const idService = overview.data?.idService;

  if (!idService || idService.status === "missing" || idService.status === "error") {
    return (
      <div className="max-w-2xl mx-auto p-6 text-center space-y-4">
        <h1 className="text-xl font-semibold text-foreground">Identity Service</h1>
        <p className="text-subtext0">
          {idService?.status === "error"
            ? "Identity service is not responding. Check that aionima-id is running."
            : "Identity service is not configured. Set up the ID service in Settings \u2192 Identity."}
        </p>
        {idService?.url && (
          <p className="text-xs text-subtext1">Expected at: {idService.url}</p>
        )}
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-4rem)] w-full">
      <iframe
        src={idService.url}
        className="w-full h-full border-0 rounded-lg"
        title="Identity Service"
        allow="clipboard-write"
      />
    </div>
  );
}
