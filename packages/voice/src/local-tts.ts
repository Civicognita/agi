/**
 * Local TTS Provider — Task #138 (OFFLINE mode)
 *
 * Uses sherpa-onnx for local text-to-speech synthesis.
 * No network access required — runs entirely on local models.
 *
 * Models are downloaded via `aionima voice download-models`.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import type { TTSOptions, TTSResult, TTSProvider } from "./types.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface LocalTTSConfig {
  /** Path to sherpa-onnx model directory. */
  modelDir: string;
  /** Model name (default: "vits-piper-en"). */
  modelName?: string;
  /** Number of threads (default: 4). */
  numThreads?: number;
  /** Default voice. */
  defaultVoice?: string;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class LocalTTSProvider implements TTSProvider {
  readonly name = "sherpa-onnx-tts";
  readonly requiresNetwork = false;

  private readonly modelDir: string;
  private readonly modelName: string;
  constructor(config: LocalTTSConfig) {
    this.modelDir = config.modelDir;
    this.modelName = config.modelName ?? "vits-piper-en";
  }

  /**
   * Check if the required model files exist.
   */
  isModelAvailable(): boolean {
    const modelPath = join(this.modelDir, this.modelName);
    return existsSync(modelPath);
  }

  async synthesize(_text: string, _options?: TTSOptions): Promise<TTSResult> {
    if (!this.isModelAvailable()) {
      throw new Error(
        `Local TTS model not found at ${join(this.modelDir, this.modelName)}. ` +
        `Run 'aionima voice download-models' to download.`,
      );
    }

    // sherpa-onnx integration stub.
    // Real implementation:
    //   const tts = new OfflineTts(config);
    //   const audio = tts.generate({ text, sid: 0, speed: rate });
    //   return { sampleRate: audio.sampleRate, samples: audio.samples };

    throw new Error(
      "Local TTS requires sherpa-onnx-node native bindings. " +
      "Install with: npm install sherpa-onnx-node",
    );
  }
}

// ---------------------------------------------------------------------------
// Model download helper
// ---------------------------------------------------------------------------

/** Available TTS models for download. */
export const AVAILABLE_TTS_MODELS = [
  {
    name: "vits-piper-en",
    sizeBytes: 63_000_000,
    description: "VITS Piper English (63MB) — natural sounding",
  },
  {
    name: "vits-piper-multi",
    sizeBytes: 120_000_000,
    description: "VITS Piper Multilingual (120MB) — 20+ languages",
  },
] as const;
