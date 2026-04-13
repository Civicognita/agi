/**
 * InferenceGateway — Unified routing layer for local model inference.
 *
 * Forwards inference requests to the correct running model container by looking
 * up the model in ModelStore, validating its status, and proxying the request to
 * the container's HTTP API via native fetch().
 *
 * All public methods call touchLastUsed() on success and throw descriptive errors
 * on any failure (model not found, model not running, upstream error, timeout).
 *
 * No npm dependencies — uses only native fetch() and sibling modules.
 */

import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  EmbeddingRequest,
  EmbeddingResponse,
  ImageGenerationRequest,
  ImageGenerationResponse,
  TranscriptionRequest,
  TranscriptionResponse,
  ClassificationRequest,
  ClassificationResponse,
} from "./types.js";
import { ModelStore } from "./model-store.js";

// ---------------------------------------------------------------------------
// InferenceGateway
// ---------------------------------------------------------------------------

export class InferenceGateway {
  constructor(
    private readonly modelStore: ModelStore,
    private readonly timeoutMs: number = 120_000,
  ) {}

  // ---------------------------------------------------------------------------
  // Public inference methods
  // ---------------------------------------------------------------------------

  /**
   * OpenAI-compatible chat completion.
   *
   * Routes to POST /v1/chat/completions on the model's container port.
   * Works with any OpenAI-compatible server (llama.cpp, vllm, ollama, etc.).
   */
  async chatCompletion(
    modelId: string,
    request: ChatCompletionRequest,
  ): Promise<ChatCompletionResponse> {
    return this.forwardRequest<ChatCompletionResponse>(
      modelId,
      "/v1/chat/completions",
      request,
    );
  }

  /**
   * Generate text embeddings.
   *
   * Routes to POST /v1/embeddings on the model's container port.
   */
  async embedText(
    modelId: string,
    request: EmbeddingRequest,
  ): Promise<EmbeddingResponse> {
    return this.forwardRequest<EmbeddingResponse>(
      modelId,
      "/v1/embeddings",
      request,
    );
  }

  /**
   * Generate an image from a text prompt.
   *
   * Routes to POST /v1/generate on the model's container port.
   * Expects a diffusion runtime container.
   */
  async generateImage(
    modelId: string,
    request: ImageGenerationRequest,
  ): Promise<ImageGenerationResponse> {
    return this.forwardRequest<ImageGenerationResponse>(
      modelId,
      "/v1/generate",
      request,
    );
  }

  /**
   * Transcribe audio to text.
   *
   * Routes to POST /v1/transcribe on the model's container port.
   * Audio must be base64-encoded in the request.
   */
  async transcribe(
    modelId: string,
    request: TranscriptionRequest,
  ): Promise<TranscriptionResponse> {
    return this.forwardRequest<TranscriptionResponse>(
      modelId,
      "/v1/transcribe",
      request,
    );
  }

  /**
   * Classify text into labeled categories.
   *
   * Routes to POST /v1/classify on the model's container port.
   */
  async classify(
    modelId: string,
    request: ClassificationRequest,
  ): Promise<ClassificationResponse> {
    return this.forwardRequest<ClassificationResponse>(
      modelId,
      "/v1/classify",
      request,
    );
  }

  // ---------------------------------------------------------------------------
  // Private: forwardRequest
  // ---------------------------------------------------------------------------

  /**
   * Common implementation for all inference methods.
   *
   * 1. Looks up the model in ModelStore — throws if not found.
   * 2. Validates model status is "running" — throws if not.
   * 3. Validates model has a container port — throws if not.
   * 4. Forwards the request to the container with an AbortSignal timeout.
   * 5. Parses and returns the typed response — throws on upstream error.
   * 6. Calls touchLastUsed() on success.
   */
  private async forwardRequest<T>(
    modelId: string,
    endpoint: string,
    body: unknown,
  ): Promise<T> {
    const model = this.modelStore.getById(modelId);

    if (!model) {
      throw new Error(`Model not found: "${modelId}"`);
    }

    if (model.status !== "running") {
      throw new Error(
        `Model "${modelId}" is not running (status: "${model.status}") — start the model before sending inference requests.`,
      );
    }

    if (model.containerPort == null) {
      throw new Error(
        `Model "${modelId}" has no container port assigned — container may not have started correctly.`,
      );
    }

    const url = `http://localhost:${String(model.containerPort)}${endpoint}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new Error(
          `Inference request to model "${modelId}" timed out after ${String(this.timeoutMs)}ms.`,
        );
      }
      throw new Error(
        `Failed to reach model container for "${modelId}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!response.ok) {
      let detail = "";
      try {
        const text = await response.text();
        detail = text ? ` — ${text}` : "";
      } catch {
        // Body read failure is non-critical
      }
      throw new Error(
        `Upstream error from model "${modelId}" at ${endpoint}: HTTP ${String(response.status)}${detail}`,
      );
    }

    let result: T;
    try {
      result = (await response.json()) as T;
    } catch (err) {
      throw new Error(
        `Failed to parse response from model "${modelId}" at ${endpoint}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    this.modelStore.touchLastUsed(modelId);

    return result;
  }
}
