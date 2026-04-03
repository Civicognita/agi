/**
 * Whisper STT Provider — Task #137 (ONLINE mode)
 *
 * Uses OpenAI's Whisper API for speech-to-text transcription.
 * Requires OPENAI_API_KEY environment variable or explicit config.
 */

import OpenAI from "openai";

import type { AudioData, STTOptions, STTResult, STTProvider } from "./types.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface WhisperSTTConfig {
  /** OpenAI API key. Falls back to OPENAI_API_KEY env var. */
  apiKey?: string;
  /** Model to use (default: "whisper-1"). */
  model?: string;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class WhisperSTTProvider implements STTProvider {
  readonly name = "whisper-api";
  readonly requiresNetwork = true;

  private readonly client: OpenAI;
  private readonly model: string;

  constructor(config?: WhisperSTTConfig) {
    this.client = new OpenAI({ apiKey: config?.apiKey });
    this.model = config?.model ?? "whisper-1";
  }

  async transcribe(audio: AudioData, options?: STTOptions): Promise<STTResult> {
    // Convert Buffer to a File-like object for the API
    const file = new File(
      [audio.buffer],
      `audio.${audio.format}`,
      { type: formatToMime(audio.format) },
    );

    const response = await this.client.audio.transcriptions.create({
      model: this.model,
      file,
      language: options?.language,
      prompt: options?.prompt,
      response_format: "verbose_json",
    });

    const durationSeconds = audio.durationSeconds ??
      (typeof response.duration === "number" ? response.duration : 0);

    return {
      text: response.text,
      language: response.language ?? options?.language ?? "en",
      durationSeconds,
      provider: this.name,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatToMime(format: string): string {
  const map: Record<string, string> = {
    wav: "audio/wav",
    ogg: "audio/ogg",
    mp3: "audio/mpeg",
    webm: "audio/webm",
    pcm: "audio/pcm",
  };
  return map[format] ?? "audio/wav";
}
