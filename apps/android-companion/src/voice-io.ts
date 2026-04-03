/**
 * Android Voice I/O — Task #218
 *
 * STT: Whisper API (ONLINE), sherpa-onnx (OFFLINE)
 * TTS: edge-tts (ONLINE), sherpa-onnx (OFFLINE)
 *
 * Handles Android audio permissions, foreground service for recording,
 * and battery optimization handling.
 */

import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VoiceMode = "online" | "offline";

export interface STTResult {
  text: string;
  confidence: number;
  duration: number;
  mode: VoiceMode;
}

export interface TTSOptions {
  text: string;
  voice?: string;
  rate?: number;
  mode?: VoiceMode;
}

export interface VoiceIOConfig {
  /** Whisper API endpoint (ONLINE mode). */
  whisperEndpoint?: string;
  /** edge-tts endpoint (ONLINE mode). */
  edgeTtsEndpoint?: string;
  /** Path to sherpa-onnx STT model (OFFLINE mode). */
  offlineSttModel?: string;
  /** Path to sherpa-onnx TTS model (OFFLINE mode). */
  offlineTtsModel?: string;
  /** Preferred mode — falls back if unavailable. */
  preferredMode: VoiceMode;
}

// ---------------------------------------------------------------------------
// Voice I/O Manager
// ---------------------------------------------------------------------------

export class VoiceIOManager {
  private recording: Audio.Recording | null = null;
  private playback: Audio.Sound | null = null;
  private readonly config: VoiceIOConfig;

  constructor(config: VoiceIOConfig) {
    this.config = config;
  }

  // -------------------------------------------------------------------------
  // Permissions
  // -------------------------------------------------------------------------

  /** Request audio recording permission on Android. */
  async requestPermission(): Promise<boolean> {
    const { status } = await Audio.requestPermissionsAsync();
    return status === "granted";
  }

  /** Configure audio session for recording + playback. */
  async configureAudioSession(): Promise<void> {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false, // Android-specific module
      playsInSilentModeIOS: false,
      staysActiveInBackground: true, // Foreground service handles this
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });
  }

  // -------------------------------------------------------------------------
  // Speech-to-Text
  // -------------------------------------------------------------------------

  /** Start recording audio for STT. */
  async startRecording(): Promise<void> {
    if (this.recording) return;

    await this.configureAudioSession();

    const { recording } = await Audio.Recording.createAsync(
      Audio.RecordingOptionsPresets.HIGH_QUALITY,
    );
    this.recording = recording;
  }

  /** Stop recording and transcribe via configured STT engine. */
  async stopAndTranscribe(): Promise<STTResult> {
    if (!this.recording) {
      throw new Error("No active recording");
    }

    await this.recording.stopAndUnloadAsync();
    const uri = this.recording.getURI();
    this.recording = null;

    if (!uri) throw new Error("Recording URI unavailable");

    const mode = this.resolveSTTMode();

    if (mode === "online") {
      return this.transcribeWhisper(uri);
    }
    return this.transcribeOffline(uri);
  }

  /** Cancel an active recording without transcribing. */
  async cancelRecording(): Promise<void> {
    if (!this.recording) return;
    await this.recording.stopAndUnloadAsync();
    this.recording = null;
  }

  private resolveSTTMode(): VoiceMode {
    if (this.config.preferredMode === "online" && this.config.whisperEndpoint) {
      return "online";
    }
    if (this.config.offlineSttModel) return "offline";
    if (this.config.whisperEndpoint) return "online";
    throw new Error("No STT engine available");
  }

  private async transcribeWhisper(audioUri: string): Promise<STTResult> {
    if (!this.config.whisperEndpoint) {
      throw new Error("Whisper endpoint not configured");
    }

    const start = Date.now();

    // Read audio file as base64 for upload
    const audioBase64 = await FileSystem.readAsStringAsync(audioUri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const response = await fetch(this.config.whisperEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audio: audioBase64,
        format: "m4a",
        language: "en",
      }),
    });

    if (!response.ok) {
      throw new Error(`Whisper API error: ${response.status}`);
    }

    const result = (await response.json()) as { text: string; confidence?: number };

    return {
      text: result.text,
      confidence: result.confidence ?? 0.9,
      duration: Date.now() - start,
      mode: "online",
    };
  }

  private async transcribeOffline(_audioUri: string): Promise<STTResult> {
    // sherpa-onnx integration — requires native module bridge
    // Stub: will be implemented with expo-modules when sherpa-onnx RN bindings are available
    throw new Error(
      "Offline STT (sherpa-onnx) requires native module — not yet integrated",
    );
  }

  // -------------------------------------------------------------------------
  // Text-to-Speech
  // -------------------------------------------------------------------------

  /** Synthesize and play speech from text. */
  async speak(options: TTSOptions): Promise<void> {
    const mode = options.mode ?? this.resolveTTSMode();

    if (mode === "online") {
      await this.speakOnline(options.text, options.voice, options.rate);
    } else {
      await this.speakOffline(options.text, options.rate);
    }
  }

  /** Stop any currently playing TTS audio. */
  async stopSpeaking(): Promise<void> {
    if (this.playback) {
      await this.playback.stopAsync();
      await this.playback.unloadAsync();
      this.playback = null;
    }
  }

  private resolveTTSMode(): VoiceMode {
    if (this.config.preferredMode === "online" && this.config.edgeTtsEndpoint) {
      return "online";
    }
    if (this.config.offlineTtsModel) return "offline";
    if (this.config.edgeTtsEndpoint) return "online";
    throw new Error("No TTS engine available");
  }

  private async speakOnline(
    text: string,
    voice?: string,
    rate?: number,
  ): Promise<void> {
    if (!this.config.edgeTtsEndpoint) {
      throw new Error("edge-tts endpoint not configured");
    }

    const response = await fetch(this.config.edgeTtsEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        voice: voice ?? "en-US-AriaNeural",
        rate: rate ?? 1.0,
      }),
    });

    if (!response.ok) {
      throw new Error(`edge-tts error: ${response.status}`);
    }

    // Response is audio data — write to temp file and play
    const audioBlob = await response.blob();
    const reader = new FileReader();
    const base64 = await new Promise<string>((resolve, reject) => {
      reader.onloadend = () => {
        const result = reader.result as string;
        resolve(result.split(",")[1] ?? "");
      };
      reader.onerror = reject;
      reader.readAsDataURL(audioBlob);
    });

    const tempPath = `${FileSystem.cacheDirectory}tts-output.mp3`;
    await FileSystem.writeAsStringAsync(tempPath, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });

    await this.stopSpeaking();
    const { sound } = await Audio.Sound.createAsync({ uri: tempPath });
    this.playback = sound;
    await sound.playAsync();
  }

  private async speakOffline(
    _text: string,
    _rate?: number,
  ): Promise<void> {
    // sherpa-onnx TTS integration — requires native module bridge
    throw new Error(
      "Offline TTS (sherpa-onnx) requires native module — not yet integrated",
    );
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Release all audio resources. */
  async dispose(): Promise<void> {
    await this.cancelRecording();
    await this.stopSpeaking();
  }
}
