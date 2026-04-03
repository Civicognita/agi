/**
 * One-time OAuth2 consent helper for Gmail.
 *
 * Usage:
 *   npx tsx scripts/gmail-auth.ts <clientId> <clientSecret>
 *
 * This script:
 * 1. Starts a temporary local HTTP server on port 3000
 * 2. Generates an authorization URL with gmail.modify scope
 * 3. You visit the URL and grant consent
 * 4. Google redirects back to localhost with the auth code
 * 5. Exchanges the code for tokens
 * 6. Prints the refresh token to store in aionima.json
 */

import { Auth } from "googleapis";
import { createServer } from "node:http";

const SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];
const PORT = 3000;
const REDIRECT_URI = `http://localhost:${PORT}`;

async function main(): Promise<void> {
  const clientId = process.argv[2];
  const clientSecret = process.argv[3];

  if (!clientId || !clientSecret) {
    console.error("Usage: npx tsx scripts/gmail-auth.ts <clientId> <clientSecret>");
    process.exit(1);
  }

  const oauth2Client = new Auth.OAuth2Client(clientId, clientSecret, REDIRECT_URI);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });

  console.log("\n=== Gmail OAuth2 Setup ===\n");
  console.log("1. Visit this URL in your browser:\n");
  console.log(`   ${authUrl}\n`);
  console.log("2. Sign in with the Gmail account configured for this instance");
  console.log("3. Grant the requested permissions");
  console.log("4. You'll be redirected back to localhost automatically\n");
  console.log("Waiting for OAuth2 callback...\n");

  const code = await waitForCallback();

  try {
    const { tokens } = await oauth2Client.getToken(code);
    console.log("\n=== Success! ===\n");

    if (tokens.refresh_token) {
      console.log("Refresh token:\n");
      console.log(`  ${tokens.refresh_token}\n`);
      console.log("Add this to your aionima.json email channel config as \"refreshToken\".");
    } else {
      console.log("WARNING: No refresh token received. Re-run with a fresh consent prompt.");
    }
  } catch (err) {
    console.error(
      "\nFailed to exchange code for tokens:",
      err instanceof Error ? err.message : String(err),
    );
    process.exit(1);
  }
}

function waitForCallback(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(`<h1>Authorization failed</h1><p>${error}</p>`);
        server.close();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }

      if (code) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<h1>Authorization successful!</h1><p>You can close this tab.</p>");
        server.close();
        resolve(code);
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    });

    server.listen(PORT, () => {
      console.log(`Listening on http://localhost:${PORT} for OAuth2 callback...`);
    });

    server.on("error", (err) => {
      reject(new Error(`Failed to start callback server: ${err.message}`));
    });
  });
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
