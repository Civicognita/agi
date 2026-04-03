/** True when running inside Electron. */
export function isElectron(): boolean {
  return (
    typeof navigator !== "undefined" &&
    navigator.userAgent.toLowerCase().includes("electron")
  );
}

/** True when running as an installed PWA (standalone display mode). */
export function isStandalonePwa(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches;
}
