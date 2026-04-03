import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const WEB_UI_VERSION = "0.1.0";

/** Absolute path to the public/ directory containing static assets */
export const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

export {
  createWebChatServer,
  startWebChatServer,
  type WebChatServerOptions,
} from "./static-server.js";
