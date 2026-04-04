/**
 * channel-defs — Channel wizard step definitions.
 *
 * Each channel defines its own wizard steps. Supports four step types:
 * - instructions: rendered HTML content with links and code snippets
 * - credentials: input fields for tokens/API keys
 * - oauth: popup-based OAuth flow
 * - configure: optional configuration fields (post-auth)
 * - test: live connection test
 *
 * The ownerIdField is shown on all channels at the test step to identify
 * the owner entity across channels.
 */

import type { JSX } from "react";

export interface ChannelFieldDef {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
  helpText?: string;
}

export interface ChannelStepDef {
  title: string;
  description?: string;
  type: "instructions" | "credentials" | "oauth" | "configure" | "test";
  content?: JSX.Element;
  fields?: ChannelFieldDef[];
  oauthProvider?: string;
  oauthDescription?: string;
}

export interface ChannelDef {
  id: string;
  label: string;
  description: string;
  icon: JSX.Element;
  color: string;
  steps: ChannelStepDef[];
  ownerIdField: { label: string; placeholder: string; helpText?: string };
}

// ---------------------------------------------------------------------------
// Channel icons — inline SVGs matching existing dashboard ProfileCard pattern
// ---------------------------------------------------------------------------

function TelegramIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248l-1.97 9.289c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.88 14.03 5.04 13.17c-.652-.204-.665-.652.136-.966l10.875-4.193c.544-.196 1.02.121.511.237z" />
    </svg>
  );
}

function DiscordIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.043.031.056a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

function GmailIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
      <path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.364l-6.545-4.636v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.273l6.545-4.636 1.528-1.145C21.69 2.28 24 3.434 24 5.457z" />
    </svg>
  );
}

function SignalIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
      <path d="M12 0C5.372 0 0 5.372 0 12c0 6.627 5.372 12 12 12 6.627 0 12-5.373 12-12 0-6.628-5.373-12-12-12zm0 4.5c4.142 0 7.5 3.358 7.5 7.5 0 4.142-3.358 7.5-7.5 7.5-4.142 0-7.5-3.358-7.5-7.5 0-4.142 3.358-7.5 7.5-7.5zm0 3c-2.485 0-4.5 2.015-4.5 4.5s2.015 4.5 4.5 4.5 4.5-2.015 4.5-4.5-2.015-4.5-4.5-4.5z" />
    </svg>
  );
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Channel definitions
// ---------------------------------------------------------------------------

export const CHANNEL_DEFS: ChannelDef[] = [
  {
    id: "telegram",
    label: "Telegram",
    description: "Connect a Telegram bot to receive and send messages",
    icon: <TelegramIcon />,
    color: "bg-sky-500",
    steps: [
      {
        title: "Create a Telegram Bot",
        type: "instructions",
        content: (
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              1. Open{" "}
              <a
                href="https://t.me/BotFather"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline"
              >
                @BotFather
              </a>{" "}
              on Telegram
            </p>
            <p>
              2. Send{" "}
              <code className="bg-secondary px-1.5 py-0.5 rounded text-xs font-mono">
                /newbot
              </code>{" "}
              and follow the prompts
            </p>
            <p>
              3. BotFather will give you a bot token — copy it for the next
              step
            </p>
          </div>
        ),
      },
      {
        title: "Enter Bot Token",
        type: "credentials",
        fields: [
          {
            key: "botToken",
            label: "Bot Token",
            placeholder: "123456789:AABBccDDee...",
            secret: true,
            helpText: "The token BotFather gave you",
          },
        ],
      },
      { title: "Test Connection", type: "test" },
    ],
    ownerIdField: {
      label: "Your Telegram User ID",
      placeholder: "123456789",
      helpText: "Send /start to @userinfobot to find your ID",
    },
  },
  {
    id: "discord",
    label: "Discord",
    description: "Connect a Discord bot to your server",
    icon: <DiscordIcon />,
    color: "bg-indigo-500",
    steps: [
      {
        title: "Create a Discord Bot",
        type: "instructions",
        content: (
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              1. Go to the{" "}
              <a
                href="https://discord.com/developers/applications"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline"
              >
                Discord Developer Portal
              </a>
            </p>
            <p>2. Click &ldquo;New Application&rdquo; and give it a name</p>
            <p>3. Go to the &ldquo;Bot&rdquo; tab and click &ldquo;Reset Token&rdquo;</p>
            <p>4. Copy the bot token</p>
            <p>
              5. Under &ldquo;Privileged Gateway Intents&rdquo;, enable Message
              Content Intent
            </p>
            <p>
              6. Copy the Application ID from the &ldquo;General
              Information&rdquo; tab
            </p>
          </div>
        ),
      },
      {
        title: "Enter Bot Credentials",
        type: "credentials",
        fields: [
          {
            key: "botToken",
            label: "Bot Token",
            placeholder: "MTQ3NTcx...",
            secret: true,
          },
          {
            key: "applicationId",
            label: "Application ID",
            placeholder: "1234567890123456789",
          },
        ],
      },
      { title: "Test Connection", type: "test" },
    ],
    ownerIdField: {
      label: "Your Discord User ID",
      placeholder: "196170122770120704",
      helpText:
        "Enable Developer Mode in Discord, right-click your name, Copy User ID",
    },
  },
  {
    id: "gmail",
    label: "Gmail",
    description: "Connect a Gmail account for email messaging",
    icon: <GmailIcon />,
    color: "bg-red-500",
    steps: [
      {
        title: "Connect Google Account",
        type: "oauth",
        oauthProvider: "google",
        oauthDescription:
          "Aionima needs permission to read and send emails on your behalf. Click below to authenticate with Google.",
      },
      {
        title: "Configure Email Settings",
        type: "configure",
        fields: [
          {
            key: "label",
            label: "Gmail Label",
            placeholder: "INBOX",
            helpText: "Which label to monitor (default: INBOX)",
          },
          {
            key: "pollingIntervalMs",
            label: "Poll Interval (ms)",
            placeholder: "15000",
            helpText: "How often to check for new messages",
          },
        ],
      },
      { title: "Test Connection", type: "test" },
    ],
    ownerIdField: {
      label: "Your Email Address",
      placeholder: "you@gmail.com",
      helpText: "The email address that owns this Aionima instance",
    },
  },
  {
    id: "signal",
    label: "Signal",
    description: "Connect via Signal CLI REST API",
    icon: <SignalIcon />,
    color: "bg-blue-600",
    steps: [
      {
        title: "Set Up Signal CLI",
        type: "instructions",
        content: (
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              Signal requires the{" "}
              <a
                href="https://github.com/bbernhard/signal-cli-rest-api"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline"
              >
                signal-cli REST API
              </a>{" "}
              running as a container.
            </p>
            <p>
              1. Run:{" "}
              <code className="bg-secondary px-1.5 py-0.5 rounded text-xs font-mono">
                podman run -p 8080:8080 bbernhard/signal-cli-rest-api
              </code>
            </p>
            <p>2. Register or link a phone number via the API</p>
            <p>
              3. Verify the API is running at{" "}
              <code className="bg-secondary px-1.5 py-0.5 rounded text-xs font-mono">
                http://localhost:8080
              </code>
            </p>
          </div>
        ),
      },
      {
        title: "Configure Signal",
        type: "credentials",
        fields: [
          {
            key: "apiUrl",
            label: "API URL",
            placeholder: "http://localhost:8080",
            helpText: "URL of the signal-cli REST API",
          },
          {
            key: "account",
            label: "Phone Number",
            placeholder: "+12345678900",
            helpText: "Signal account number (E.164 format)",
          },
        ],
      },
      { title: "Test Connection", type: "test" },
    ],
    ownerIdField: {
      label: "Your Signal Number",
      placeholder: "+12345678900",
    },
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    description: "Connect via WhatsApp Business API",
    icon: <WhatsAppIcon />,
    color: "bg-green-600",
    steps: [
      {
        title: "Configure WhatsApp Business",
        type: "instructions",
        content: (
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              1. Go to{" "}
              <a
                href="https://developers.facebook.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline"
              >
                Meta for Developers
              </a>
            </p>
            <p>2. Create or select your app, add WhatsApp product</p>
            <p>3. Go to WhatsApp &gt; API Setup</p>
            <p>
              4. Copy the access token, phone number ID, and generate a verify
              token
            </p>
          </div>
        ),
      },
      {
        title: "Enter API Credentials",
        type: "credentials",
        fields: [
          {
            key: "accessToken",
            label: "Access Token",
            secret: true,
            placeholder: "EAABx...",
          },
          {
            key: "phoneNumberId",
            label: "Phone Number ID",
            placeholder: "123456789012345",
          },
          {
            key: "verifyToken",
            label: "Verify Token",
            placeholder: "my-verify-token",
            helpText: "Used for webhook verification",
          },
          {
            key: "appSecret",
            label: "App Secret",
            secret: true,
            placeholder: "abc123...",
            helpText: "For webhook signature verification",
          },
        ],
      },
      { title: "Test Connection", type: "test" },
    ],
    ownerIdField: {
      label: "Your WhatsApp Number",
      placeholder: "+12345678900",
    },
  },
];
