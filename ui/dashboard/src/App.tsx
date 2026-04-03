/**
 * App — wraps RouterProvider with TanStack Query provider and ThemeProvider.
 * All layout, navigation, and view logic lives in routes/.
 */

import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router";
import { queryClient } from "./lib/query-client.js";
import { ThemeProvider } from "./lib/theme-provider.js";
import { router } from "./router.js";

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
