/**
 * tRPC client setup — type-safe API calls to the Fastify + tRPC backend.
 */

import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import type { AppRouter } from "@agi/trpc-api";
import { queryClient } from "./query-client.js";

/** Vanilla tRPC client for non-React usage. */
export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "/api/trpc",
    }),
  ],
});

/** React Query + tRPC integration for use in components. */
export const trpc = createTRPCOptionsProxy<AppRouter>({
  client: trpcClient,
  queryClient,
});
