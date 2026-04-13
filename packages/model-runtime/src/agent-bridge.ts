/**
 * ModelAgentBridge — Dynamic agent tool and LLM provider registration.
 *
 * Connects running HuggingFace models to Aionima's agent system. Subscribes
 * to model lifecycle events and registers either an LLM provider record (for
 * text-generation models) or agent tool definitions (for task-specific models)
 * when a model starts. Unregisters both on stop.
 *
 * The bridge does NOT directly import from gateway-core. It defines its own
 * AgentToolDef interface that matches the shape expected by the tool registry;
 * the gateway integration layer (hf-api.ts) bridges between this and the
 * actual ToolRegistry.
 *
 * No npm dependencies — uses only native Node.js EventEmitter and sibling modules.
 */

import type { HardwareCapabilities, ModelRuntimeEventEmitter } from "./types.js";
import { PIPELINE_TAG_TO_TOOL, LLM_PIPELINE_TAGS } from "./types.js";
import type { InferenceGateway } from "./inference-gateway.js";
import type { ModelStore } from "./model-store.js";

// ---------------------------------------------------------------------------
// AgentToolDef — local interface matching gateway-core ToolRegistry shape
// ---------------------------------------------------------------------------

export interface AgentToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (input: Record<string, unknown>) => Promise<string>;
}

// ---------------------------------------------------------------------------
// Registered provider info
// ---------------------------------------------------------------------------

interface ProviderRecord {
  baseUrl: string;
  model: string;
  label: string;
}

// ---------------------------------------------------------------------------
// Tool definitions by pipeline tag
// ---------------------------------------------------------------------------

const TOOL_DEFS: Record<string, Omit<AgentToolDef, "handler">> = {
  "feature-extraction": {
    name: "hf_embed_text",
    description: "Generate a text embedding vector using a locally running HuggingFace feature-extraction model.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "The text to embed.",
        },
        model: {
          type: "string",
          description: "Optional model ID override.",
        },
      },
      required: ["text"],
    },
  },
  "text-to-image": {
    name: "hf_generate_image",
    description: "Generate an image from a text prompt using a locally running diffusion model.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "The image generation prompt.",
        },
        negative_prompt: {
          type: "string",
          description: "Things to avoid in the generated image.",
        },
        width: {
          type: "number",
          description: "Output image width in pixels.",
        },
        height: {
          type: "number",
          description: "Output image height in pixels.",
        },
      },
      required: ["prompt"],
    },
  },
  "automatic-speech-recognition": {
    name: "hf_transcribe_audio",
    description: "Transcribe audio to text using a locally running speech-recognition model.",
    inputSchema: {
      type: "object",
      properties: {
        audio: {
          type: "string",
          description: "Base64-encoded audio data.",
        },
        format: {
          type: "string",
          description: "Audio format (e.g. \"wav\", \"mp3\", \"flac\").",
        },
        language: {
          type: "string",
          description: "Optional BCP-47 language hint (e.g. \"en\").",
        },
      },
      required: ["audio", "format"],
    },
  },
  "text-classification": {
    name: "hf_classify_text",
    description: "Classify text into labeled categories using a locally running classification model.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "The text to classify.",
        },
      },
      required: ["text"],
    },
  },
  "summarization": {
    name: "hf_summarize",
    description: "Summarize a body of text using a locally running summarization model.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "The text to summarize.",
        },
        max_length: {
          type: "number",
          description: "Optional maximum length of the summary in tokens.",
        },
      },
      required: ["text"],
    },
  },
  "translation": {
    name: "hf_translate",
    description: "Translate text to a target language using a locally running translation model.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "The text to translate.",
        },
        target_language: {
          type: "string",
          description: "The BCP-47 target language code (e.g. \"fr\", \"de\", \"es\").",
        },
      },
      required: ["text", "target_language"],
    },
  },
};

// ---------------------------------------------------------------------------
// ModelAgentBridge
// ---------------------------------------------------------------------------

export class ModelAgentBridge {
  /** modelId → tool names registered for that model. */
  private readonly registeredTools = new Map<string, string[]>();

  /** modelId → provider record (LLM models only). */
  private readonly registeredProviders = new Map<string, ProviderRecord>();

  /** Bound listener references — retained for off() calls on destroy(). */
  private readonly boundOnModelStarted: (modelId: string, port: number) => void;
  private readonly boundOnModelStopped: (modelId: string) => void;

  constructor(
    private readonly events: ModelRuntimeEventEmitter,
    private readonly modelStore: ModelStore,
    private readonly inferenceGateway: InferenceGateway,
    private readonly capabilities: HardwareCapabilities,
  ) {
    this.boundOnModelStarted = this.onModelStarted.bind(this);
    this.boundOnModelStopped = this.onModelStopped.bind(this);

    this.events.on("model:started", this.boundOnModelStarted);
    this.events.on("model:stopped", this.boundOnModelStopped);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Returns the tool-names map (modelId → string[]) for inspection. */
  getRegisteredTools(): Map<string, string[]> {
    return this.registeredTools;
  }

  /** Returns the provider map (modelId → { label }) for inspection. */
  getRegisteredProviders(): Map<string, { label: string }> {
    return this.registeredProviders;
  }

  /**
   * If the given model is registered as an LLM provider, returns the
   * { baseUrl, model } pair the gateway can use to construct an OpenAIProvider.
   * Returns undefined if the model is not a registered LLM provider.
   */
  getProviderForModel(modelId: string): { baseUrl: string; model: string } | undefined {
    const record = this.registeredProviders.get(modelId);
    if (record === undefined) return undefined;
    return { baseUrl: record.baseUrl, model: record.model };
  }

  /**
   * Build tool definitions for a running model based on its pipeline tag.
   * Returns an empty array if the model is not found, is an LLM (registered as
   * a provider instead), or has no matching tool definition.
   */
  buildToolDefinitions(modelId: string): AgentToolDef[] {
    const model = this.modelStore.getById(modelId);
    if (model === undefined) return [];

    const { pipelineTag } = model;

    if (LLM_PIPELINE_TAGS.has(pipelineTag)) return [];
    if (!(pipelineTag in PIPELINE_TAG_TO_TOOL)) return [];

    const handler = this.createToolHandler(modelId, pipelineTag);
    const def = TOOL_DEFS[pipelineTag];
    if (def === undefined) return [];

    return [{ ...def, handler }];
  }

  /** Remove all event subscriptions and clear internal maps. */
  destroy(): void {
    this.events.off("model:started", this.boundOnModelStarted);
    this.events.off("model:stopped", this.boundOnModelStopped);
    this.registeredTools.clear();
    this.registeredProviders.clear();
  }

  // ---------------------------------------------------------------------------
  // Private: event handlers
  // ---------------------------------------------------------------------------

  private onModelStarted(modelId: string, port: number): void {
    const model = this.modelStore.getById(modelId);
    if (model === undefined) return;

    const { pipelineTag, displayName, id } = model;

    if (LLM_PIPELINE_TAGS.has(pipelineTag)) {
      // Register as an LLM provider — the gateway will construct an
      // OpenAIProvider pointed at this container's /v1 endpoint.
      const baseUrl = `http://127.0.0.1:${String(port)}`;
      const label = `${displayName} (local)`;
      this.registeredProviders.set(modelId, { baseUrl, model: id, label });
      return;
    }

    if (pipelineTag in PIPELINE_TAG_TO_TOOL) {
      // Hardware capability gating
      if (pipelineTag.startsWith("text-to-image") && !this.capabilities.canRunDiffusion) {
        return;
      }
      if (pipelineTag === "automatic-speech-recognition" && !this.capabilities.canRunAudio) {
        return;
      }

      const defs = this.buildToolDefinitions(modelId);
      const toolNames = defs.map((d) => d.name);
      if (toolNames.length > 0) {
        this.registeredTools.set(modelId, toolNames);
      }
    }
  }

  private onModelStopped(modelId: string): void {
    this.registeredProviders.delete(modelId);
    this.registeredTools.delete(modelId);
  }

  // ---------------------------------------------------------------------------
  // Private: tool handler factory
  // ---------------------------------------------------------------------------

  private createToolHandler(
    modelId: string,
    pipelineTag: string,
  ): (input: Record<string, unknown>) => Promise<string> {
    switch (pipelineTag) {
      case "feature-extraction": {
        return async (input) => {
          const text = String(input["text"] ?? "");
          const result = await this.inferenceGateway.embedText(modelId, {
            input: text,
          });
          const embedding = result.data[0]?.embedding ?? [];
          return JSON.stringify({
            dimensions: embedding.length,
            model: result.model,
          });
        };
      }

      case "text-to-image": {
        return async (input) => {
          const result = await this.inferenceGateway.generateImage(modelId, {
            prompt: String(input["prompt"] ?? ""),
            negative_prompt:
              input["negative_prompt"] !== undefined
                ? String(input["negative_prompt"])
                : undefined,
            width:
              input["width"] !== undefined ? Number(input["width"]) : undefined,
            height:
              input["height"] !== undefined ? Number(input["height"]) : undefined,
          });
          const count = result.images.length;
          return JSON.stringify({
            generated: count,
            images: result.images.map((img, i) => ({
              index: i,
              revised_prompt: img.revised_prompt,
              size_bytes: img.b64_json.length,
            })),
          });
        };
      }

      case "automatic-speech-recognition": {
        return async (input) => {
          const result = await this.inferenceGateway.transcribe(modelId, {
            audio: String(input["audio"] ?? ""),
            format: String(input["format"] ?? "wav"),
            language:
              input["language"] !== undefined ? String(input["language"]) : undefined,
          });
          return result.text;
        };
      }

      case "text-classification": {
        return async (input) => {
          const result = await this.inferenceGateway.classify(modelId, {
            text: String(input["text"] ?? ""),
          });
          return JSON.stringify({
            labels: result.labels,
          });
        };
      }

      case "summarization": {
        return async (input) => {
          const text = String(input["text"] ?? "");
          const result = await this.inferenceGateway.chatCompletion(modelId, {
            messages: [{ role: "user", content: `Summarize: ${text}` }],
            max_tokens:
              input["max_length"] !== undefined ? Number(input["max_length"]) : undefined,
          });
          return result.choices[0]?.message.content ?? "";
        };
      }

      case "translation": {
        return async (input) => {
          const text = String(input["text"] ?? "");
          const targetLanguage = String(input["target_language"] ?? "");
          const result = await this.inferenceGateway.chatCompletion(modelId, {
            messages: [
              {
                role: "user",
                content: `Translate the following text to ${targetLanguage}:\n\n${text}`,
              },
            ],
          });
          return result.choices[0]?.message.content ?? "";
        };
      }

      default: {
        // Fallback for pipeline tags in PIPELINE_TAG_TO_TOOL without an explicit handler
        return async (_input) => {
          return JSON.stringify({
            error: `No handler implemented for pipeline tag: ${pipelineTag}`,
          });
        };
      }
    }
  }
}
