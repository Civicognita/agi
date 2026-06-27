/**
 * App — wraps RouterProvider with TanStack Query provider and ThemeProvider.
 * All layout, navigation, and view logic lives in routes/.
 */

import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router";
import { Toast } from "@particle-academy/react-fancy";
import { FancyPwaProvider } from "@particle-academy/fancy-pwa";
import { queryClient } from "./lib/query-client.js";
import { ThemeProvider } from "./lib/theme-provider.js";
import { AppearanceProvider } from "./lib/appearance-provider.js";
import { router } from "./router.js";
import { DevNotesProvider } from "./components/ui/dev-notes.js";
import { isElectron } from "./lib/environment.js";

export function App() {
  return (
    // FancyPwaProvider registers the service worker once on the client (skipped
    // in Electron, which ships its own update mechanism). SW caching lives in
    // src/sw.ts; install/offline/update affordances render in the shell (root.tsx).
    <FancyPwaProvider options={{ register: !isElectron() }}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AppearanceProvider>
            <Toast.Provider position="bottom-right" maxToasts={5}>
              <DevNotesProvider>
                <RouterProvider router={router} />
              </DevNotesProvider>
            </Toast.Provider>
          </AppearanceProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </FancyPwaProvider>
  );
}
