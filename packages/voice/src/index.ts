// Voice package — Talk Mode
export type {
  VoiceGatewayState,
  AudioFormat,
  AudioData,
  STTOptions,
  STTResult,
  STTProvider,
  TTSOptions,
  TTSResult,
  TTSProvider,
  VoicePipelineConfig,
  VoiceRoundTripResult,
  VoiceBudgetEntry,
} from "./types.js";
export { DEFAULT_VOICE_CONFIG } from "./types.js";

export { WhisperSTTProvider } from "./whisper-stt.js";
export type { WhisperSTTConfig } from "./whisper-stt.js";

export { EdgeTTSProvider, edgeOutputFormat } from "./edge-tts.js";
export type { EdgeTTSConfig } from "./edge-tts.js";

export { LocalSTTProvider, AVAILABLE_STT_MODELS } from "./local-stt.js";
export type { LocalSTTConfig } from "./local-stt.js";

export { LocalTTSProvider, AVAILABLE_TTS_MODELS } from "./local-tts.js";
export type { LocalTTSConfig } from "./local-tts.js";

export { VoicePipeline, VoicePipelineError } from "./pipeline.js";
export type {
  VoicePipelineDeps,
  TranscribeParams,
  SynthesizeParams,
  RoundTripParams,
  VoicePipelineErrorCode,
} from "./pipeline.js";
