/**
 * System Identity page — embeds the ID service UI in an iframe.
 * Provides access to OAuth connections, channel wizard, entity management,
 * and federated identity from within the AGI dashboard.
 */

import { useEffect, useState } from "react";
import { fetchConnectionStatus } from "@/api.js";
import type { ConnectionStatus } from "@/types.js";

export default function IdentityServicePage() {
  const [connections, setConnections] = useState<ConnectionStatus | null>(null);

  useEffect(() => {
    fetchConnectionStatus().then(setConnections).catch(() => {});
  }, []);

  const idService = connections?.idService;

  if (connections === null) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <div className="text-subtext0">Loading...</div>
      </div>
    );
  }

  if (!idService || idService.status === "missing" || idService.status === "error") {
    return (
      <div className="max-w-2xl mx-auto p-6 text-center space-y-4">
        <h1 className="text-xl font-semibold text-foreground">Identity Service</h1>
        <p className="text-subtext0">
          {idService?.status === "error"
            ? "Identity service is not responding. Check that aionima-id is running."
            : "Identity service is not configured. Set up the ID service in Settings \u2192 Identity."}
        </p>
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
