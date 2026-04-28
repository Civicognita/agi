import type { OutboundContent } from "@agi/channel-sdk";
import type { GmailClient } from "./gmail-client.js";
import type { ThreadContext } from "./normalizer.js";

// ---------------------------------------------------------------------------
// Outbound: OutboundContent → Gmail API calls
// ---------------------------------------------------------------------------

/**
 * Send an {@link OutboundContent} payload to an email recipient.
 *
 * When a {@link ThreadContext} is provided, the reply is threaded in Gmail
 * using In-Reply-To, References, and threadId.
 *
 * For replies, the subject is prefixed with "Re: " if not already present.
 */
export async function sendOutbound(
  client: GmailClient,
  recipientEmail: string,
  content: OutboundContent,
  threadContext?: ThreadContext,
): Promise<void> {
  if (content.type !== "text") {
    console.warn(`[email] unsupported outbound content type: ${content.type} — skipping`);
    return;
  }

  const subject = threadContext
    ? ensureRePrefix(threadContext.subject)
    : "(no subject)";

  await client.sendMessage(
    recipientEmail,
    subject,
    content.text,
    threadContext?.threadId,
    threadContext?.messageId,
    threadContext?.references,
  );
}

function ensureRePrefix(subject: string): string {
  if (/^re:/i.test(subject)) return subject;
  return `Re: ${subject}`;
}
