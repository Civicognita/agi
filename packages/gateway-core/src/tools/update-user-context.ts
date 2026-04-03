/**
 * update_user_context tool — save relationship notes for the current entity.
 *
 * Writes or overwrites the per-entity USER.md file via the UserContextStore.
 * The content is injected into the system prompt on the next invocation.
 */
import type { ToolHandler } from "../tool-registry.js";
import type { UserContextStore } from "../user-context-store.js";

export interface UpdateUserContextConfig {
  userContextStore: UserContextStore;
}

export function createUpdateUserContextHandler(config: UpdateUserContextConfig): ToolHandler {
  return async (input: Record<string, unknown>, ctx): Promise<string> => {
    const content = String(input.content ?? "").trim();
    if (content.length === 0) {
      return JSON.stringify({ error: "content must not be empty" });
    }

    const entityId = ctx?.entityId;
    if (entityId === undefined || entityId === "") {
      return JSON.stringify({ error: "no entity context available" });
    }

    try {
      config.userContextStore.save(entityId, content);
      return JSON.stringify({ ok: true, entityId, bytes: content.length });
    } catch (err) {
      return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
    }
  };
}

export const UPDATE_USER_CONTEXT_MANIFEST = {
  name: "update_user_context",
  description: "Update relationship notes for the current entity. Content is stored as markdown and injected into your system prompt on future interactions.",
  requiresState: ["ONLINE" as const, "LIMBO" as const],
  requiresTier: ["verified" as const, "sealed" as const],
};

export const UPDATE_USER_CONTEXT_INPUT_SCHEMA = {
  type: "object",
  properties: {
    content: { type: "string", description: "Markdown content to store as relationship context for this entity" },
  },
  required: ["content"],
};
