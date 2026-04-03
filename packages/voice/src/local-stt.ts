/**
 * Local STT Provider — Task #137 (OFFLINE mode)
 *
 * Uses sherpa-onnx for local speech-to-text transcription.
 * No network access required — runs entirely on local models.
 *
 * Models are downloaded via `aionima voice download-models`.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import type { AudioData, STTOptions, STTResult, STTProvider } from "./types.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface LocalSTTConfig {
  /** Path to sherpa-onnx model directory. */
  modelDir: string;
  /** Model name (default: "whisper-tiny"). */
  modelName?: string;
  /** Number of threads (default: 4). */
  numThreads?: number;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class LocalSTTProvider implements STTProvider {
  readonly name = "sherpa-onnx-stt";
  readonly requiresNetwork = false;

  private readonly modelDir: string;
  private readonly modelName: string;
  constructor(config: LocalSTTConfig) {
    this.modelDir = config.modelDir;
    this.modelName = config.modelName ?? "whisper-tiny";
  }

  /**
   * Check if the required model files exist.
   */
  isModelAvailable(): boolean {
    const modelPath = join(this.modelDir, this.modelName);
    return existsSync(modelPath);
  }

  async transcribe(_audio: AudioData, _options?: STTOptions): Promise<STTResult> {
    if (!this.isModelAvailable()) {
      throw new Error(
        `Local STT model not found at ${join(this.modelDir, this.modelName)}. ` +
        `Run 'aionima voice download-models' to download.`,
      );
    }

    // sherpa-onnx integration stub.
    // Real implementation loads the ONNX model via sherpa-onnx-node bindings:
    //   const recognizer = new OfflineRecognizer(config);
    //   const stream = recognizer.createStream();
    //   stream.acceptWaveform(sampleRate, samples);
    //   recognizer.decode(stream);
    //   const text = recognizer.getResult(stream).text;

    // For now, this throws a clear error indicating local models
    // need the native sherpa-onnx-node package installed.
    throw new Error(
      "Local STT requires sherpa-onnx-node native bindings. " +
      "Install with: npm install sherpa-onnx-node",
    );
  }
}

// ---------------------------------------------------------------------------
// Model download helper
// ---------------------------------------------------------------------------

/** Available models for download. */
export const AVAILABLE_STT_MODELS = [
  {
    name: "whisper-tiny",
    sizeBytes: 75_000_000,
    description: "Whisper Tiny (75MB) — fast, lower accuracy",
  },
  {
    name: "whisper-base",
    sizeBytes: 142_000_000,
    description: "Whisper Base (142MB) — balanced",
  },
  {
    name: "whisper-small",
    sizeBytes: 466_000_000,
    description: "Whisper Small (466MB) — higher accuracy",
  },
] as const;
