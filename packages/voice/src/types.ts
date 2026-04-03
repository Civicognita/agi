/**
 * Voice Types — Talk Mode
 *
 * Provider interfaces and configuration for STT/TTS pipeline.
 * STATE-gated: ONLINE uses cloud APIs, OFFLINE uses local models.
 */

// ---------------------------------------------------------------------------
// Gateway state (reuse type without importing gateway-core)
// ---------------------------------------------------------------------------

export type VoiceGatewayState = "ONLINE" | "LIMBO" | "OFFLINE" | "UNKNOWN";

// ---------------------------------------------------------------------------
// Audio formats
// ---------------------------------------------------------------------------

/** Supported audio formats for input/output. */
export type AudioFormat = "wav" | "ogg" | "mp3" | "webm" | "pcm";

/** Audio data with metadata. */
export interface AudioData {
  /** Raw audio buffer. */
  buffer: Buffer;
  /** Audio format. */
  format: AudioFormat;
  /** Duration in seconds (if known). */
  durationSeconds?: number;
  /** Sample rate in Hz (if known). */
  sampleRate?: number;
}

// ---------------------------------------------------------------------------
// STT (Speech-to-Text) Provider
// ---------------------------------------------------------------------------

/** Options for STT transcription. */
export interface STTOptions {
  /** Language hint (BCP-47, e.g. "en", "es"). */
  language?: string;
  /** Prompt / context hint for better accuracy. */
  prompt?: string;
}

/** Result of STT transcription. */
export interface STTResult {
  /** Transcribed text. */
  text: string;
  /** Detected language (BCP-47). */
  language: string;
  /** Confidence score (0.0–1.0), if available. */
  confidence?: number;
  /** Duration of the audio in seconds. */
  durationSeconds: number;
  /** Which provider handled the transcription. */
  provider: string;
}

/** Speech-to-Text provider interface. */
export interface STTProvider {
  /** Provider name for logging (e.g. "whisper-api", "sherpa-onnx"). */
  readonly name: string;
  /** Whether this provider requires network access. */
  readonly requiresNetwork: boolean;
  /** Transcribe audio to text. */
  transcribe(audio: AudioData, options?: STTOptions): Promise<STTResult>;
}

// ---------------------------------------------------------------------------
// TTS (Text-to-Speech) Provider
// ---------------------------------------------------------------------------

/** Options for TTS synthesis. */
export interface TTSOptions {
  /** Voice ID or name. */
  voice?: string;
  /** Speech rate multiplier (1.0 = normal). */
  rate?: number;
  /** Output audio format (default: "mp3"). */
  outputFormat?: AudioFormat;
  /** Language (BCP-47). */
  language?: string;
}

/** Result of TTS synthesis. */
export interface TTSResult {
  /** Synthesized audio. */
  audio: AudioData;
  /** Which provider handled the synthesis. */
  provider: string;
  /** Character count of the input text. */
  characterCount: number;
}

/** Text-to-Speech provider interface. */
export interface TTSProvider {
  /** Provider name for logging (e.g. "edge-tts", "sherpa-onnx"). */
  readonly name: string;
  /** Whether this provider requires network access. */
  readonly requiresNetwork: boolean;
  /** Synthesize text to audio. */
  synthesize(text: string, options?: TTSOptions): Promise<TTSResult>;
}

// ---------------------------------------------------------------------------
// Voice Pipeline Configuration
// ---------------------------------------------------------------------------

export interface VoicePipelineConfig {
  /** Maximum audio duration in seconds (default: 120). */
  maxDurationSeconds: number;
  /** Maximum text length for TTS (default: 4096 chars). */
  maxTTSChars: number;
  /** Default TTS voice. */
  defaultVoice: string;
  /** Default output format. */
  defaultOutputFormat: AudioFormat;
  /** Budget: max STT seconds per entity per day. */
  sttBudgetSecondsPerDay: number;
  /** Budget: max TTS characters per entity per day. */
  ttsBudgetCharsPerDay: number;
}

export const DEFAULT_VOICE_CONFIG: VoicePipelineConfig = {
  maxDurationSeconds: 120,
  maxTTSChars: 4096,
  defaultVoice: "en-US-AriaNeural",
  defaultOutputFormat: "mp3",
  sttBudgetSecondsPerDay: 600, // 10 minutes STT per entity per day
  ttsBudgetCharsPerDay: 50_000,
};

// ---------------------------------------------------------------------------
// Voice Pipeline Result
// ---------------------------------------------------------------------------

/** Full round-trip result: audio in → text → agent → text → audio out. */
export interface VoiceRoundTripResult {
  /** Transcription of the inbound audio. */
  transcription: STTResult;
  /** The agent's text response. */
  agentResponseText: string;
  /** Synthesized audio response (null if voice disabled for channel). */
  audioResponse: TTSResult | null;
  /** Whether voice response was generated or text-only. */
  voiceEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Budget tracking
// ---------------------------------------------------------------------------

export interface VoiceBudgetEntry {
  entityId: string;
  date: string; // YYYY-MM-DD
  sttSecondsUsed: number;
  ttsCharsUsed: number;
}
