/**
 * Voice Pipeline — Task #139
 *
 * Orchestrates the full voice round-trip:
 *   audio in → STT → [agent text] → TTS → audio out
 *
 * STATE-gated provider selection:
 *   ONLINE/LIMBO: Whisper API + Edge TTS
 *   OFFLINE/UNKNOWN: sherpa-onnx local models
 *
 * Budget-limited per entity per day.
 */

import type {
  VoiceGatewayState,
  STTProvider,
  TTSProvider,
  AudioData,
  STTResult,
  TTSResult,
  VoicePipelineConfig,
  VoiceRoundTripResult,
  VoiceBudgetEntry,
  STTOptions,
  TTSOptions,
} from "./types.js";
import { DEFAULT_VOICE_CONFIG } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VoicePipelineDeps {
  /** ONLINE/LIMBO STT provider (e.g. Whisper API). */
  onlineSTT: STTProvider;
  /** OFFLINE STT provider (e.g. sherpa-onnx). */
  offlineSTT: STTProvider;
  /** ONLINE/LIMBO TTS provider (e.g. Edge TTS). */
  onlineTTS: TTSProvider;
  /** OFFLINE TTS provider (e.g. sherpa-onnx). */
  offlineTTS: TTSProvider;
}

export interface TranscribeParams {
  audio: AudioData;
  entityId: string;
  state: VoiceGatewayState;
  options?: STTOptions;
}

export interface SynthesizeParams {
  text: string;
  entityId: string;
  state: VoiceGatewayState;
  options?: TTSOptions;
}

export interface RoundTripParams {
  audio: AudioData;
  entityId: string;
  state: VoiceGatewayState;
  /** Whether the channel supports voice output. */
  voiceOutputEnabled: boolean;
  /** Callback to get agent response text from transcription. */
  getAgentResponse: (transcription: string) => Promise<string>;
  sttOptions?: STTOptions;
  ttsOptions?: TTSOptions;
}

// ---------------------------------------------------------------------------
// VoicePipeline
// ---------------------------------------------------------------------------

export class VoicePipeline {
  private readonly deps: VoicePipelineDeps;
  private readonly config: VoicePipelineConfig;

  /** Per-entity per-day budget tracking (in-memory). */
  private readonly budgets = new Map<string, VoiceBudgetEntry>();

  constructor(deps: VoicePipelineDeps, config?: Partial<VoicePipelineConfig>) {
    this.deps = deps;
    this.config = { ...DEFAULT_VOICE_CONFIG, ...config };
  }

  // ---------------------------------------------------------------------------
  // Provider selection (STATE-gated)
  // ---------------------------------------------------------------------------

  private selectSTT(state: VoiceGatewayState): STTProvider {
    if (state === "ONLINE" || state === "LIMBO") {
      return this.deps.onlineSTT;
    }
    return this.deps.offlineSTT;
  }

  private selectTTS(state: VoiceGatewayState): TTSProvider {
    if (state === "ONLINE" || state === "LIMBO") {
      return this.deps.onlineTTS;
    }
    return this.deps.offlineTTS;
  }

  // ---------------------------------------------------------------------------
  // Budget management
  // ---------------------------------------------------------------------------

  private getBudgetKey(entityId: string): string {
    const today = new Date().toISOString().split("T")[0]!;
    return `${entityId}:${today}`;
  }

  private getBudget(entityId: string): VoiceBudgetEntry {
    const key = this.getBudgetKey(entityId);
    let entry = this.budgets.get(key);
    if (!entry) {
      entry = {
        entityId,
        date: new Date().toISOString().split("T")[0]!,
        sttSecondsUsed: 0,
        ttsCharsUsed: 0,
      };
      this.budgets.set(key, entry);
    }
    return entry;
  }

  private checkSTTBudget(entityId: string, durationSeconds: number): boolean {
    const budget = this.getBudget(entityId);
    return (budget.sttSecondsUsed + durationSeconds) <= this.config.sttBudgetSecondsPerDay;
  }

  private checkTTSBudget(entityId: string, charCount: number): boolean {
    const budget = this.getBudget(entityId);
    return (budget.ttsCharsUsed + charCount) <= this.config.ttsBudgetCharsPerDay;
  }

  private consumeSTTBudget(entityId: string, durationSeconds: number): void {
    const budget = this.getBudget(entityId);
    budget.sttSecondsUsed += durationSeconds;
  }

  private consumeTTSBudget(entityId: string, charCount: number): void {
    const budget = this.getBudget(entityId);
    budget.ttsCharsUsed += charCount;
  }

  // ---------------------------------------------------------------------------
  // Transcription (STT)
  // ---------------------------------------------------------------------------

  /**
   * Transcribe audio to text using the STATE-appropriate provider.
   *
   * @throws If audio exceeds maxDurationSeconds or budget is exhausted.
   */
  async transcribe(params: TranscribeParams): Promise<STTResult> {
    const { audio, entityId, state, options } = params;

    // Duration check
    if (
      audio.durationSeconds !== undefined &&
      audio.durationSeconds > this.config.maxDurationSeconds
    ) {
      throw new VoicePipelineError(
        "duration_exceeded",
        `Audio duration ${audio.durationSeconds}s exceeds maximum ${this.config.maxDurationSeconds}s. ` +
        `Please send a shorter voice message.`,
      );
    }

    // Budget check
    const estimatedDuration = audio.durationSeconds ?? 30; // conservative estimate
    if (!this.checkSTTBudget(entityId, estimatedDuration)) {
      throw new VoicePipelineError(
        "budget_exceeded",
        `Daily voice transcription budget exceeded. ` +
        `Limit: ${this.config.sttBudgetSecondsPerDay}s per day.`,
      );
    }

    // Select provider and transcribe
    const provider = this.selectSTT(state);
    const result = await provider.transcribe(audio, options);

    // Consume actual duration
    this.consumeSTTBudget(entityId, result.durationSeconds);

    return result;
  }

  // ---------------------------------------------------------------------------
  // Synthesis (TTS)
  // ---------------------------------------------------------------------------

  /**
   * Synthesize text to audio using the STATE-appropriate provider.
   *
   * @throws If text exceeds maxTTSChars or budget is exhausted.
   */
  async synthesize(params: SynthesizeParams): Promise<TTSResult> {
    const { text, entityId, state, options } = params;

    // Length check
    if (text.length > this.config.maxTTSChars) {
      throw new VoicePipelineError(
        "text_too_long",
        `Text length ${text.length} exceeds maximum ${this.config.maxTTSChars} characters for TTS.`,
      );
    }

    // Budget check
    if (!this.checkTTSBudget(entityId, text.length)) {
      throw new VoicePipelineError(
        "budget_exceeded",
        `Daily TTS budget exceeded. Limit: ${this.config.ttsBudgetCharsPerDay} characters per day.`,
      );
    }

    // Select provider and synthesize
    const provider = this.selectTTS(state);

    const ttsOptions: TTSOptions = {
      voice: options?.voice ?? this.config.defaultVoice,
      outputFormat: options?.outputFormat ?? this.config.defaultOutputFormat,
      ...options,
    };

    const result = await provider.synthesize(text, ttsOptions);

    // Consume budget
    this.consumeTTSBudget(entityId, text.length);

    return result;
  }

  // ---------------------------------------------------------------------------
  // Full round-trip
  // ---------------------------------------------------------------------------

  /**
   * Execute the full voice round-trip:
   *   audio in → STT → agent response → TTS → audio out
   */
  async roundTrip(params: RoundTripParams): Promise<VoiceRoundTripResult> {
    // Step 1: Transcribe inbound audio
    const transcription = await this.transcribe({
      audio: params.audio,
      entityId: params.entityId,
      state: params.state,
      options: params.sttOptions,
    });

    // Step 2: Get agent response
    const agentResponseText = await params.getAgentResponse(transcription.text);

    // Step 3: Synthesize response (if voice output enabled)
    let audioResponse: TTSResult | null = null;
    if (params.voiceOutputEnabled && agentResponseText.length > 0) {
      audioResponse = await this.synthesize({
        text: agentResponseText,
        entityId: params.entityId,
        state: params.state,
        options: params.ttsOptions,
      });
    }

    return {
      transcription,
      agentResponseText,
      audioResponse,
      voiceEnabled: params.voiceOutputEnabled,
    };
  }

  // ---------------------------------------------------------------------------
  // Budget inspection
  // ---------------------------------------------------------------------------

  /** Get current budget usage for an entity. */
  getBudgetUsage(entityId: string): VoiceBudgetEntry {
    return { ...this.getBudget(entityId) };
  }

  /** Reset all budgets (e.g. for testing or daily reset). */
  resetBudgets(): void {
    this.budgets.clear();
  }
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export type VoicePipelineErrorCode =
  | "duration_exceeded"
  | "budget_exceeded"
  | "text_too_long"
  | "provider_unavailable";

export class VoicePipelineError extends Error {
  readonly code: VoicePipelineErrorCode;

  constructor(code: VoicePipelineErrorCode, message: string) {
    super(message);
    this.name = "VoicePipelineError";
    this.code = code;
  }
}
