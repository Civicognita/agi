# Voice Pipeline

The voice pipeline enables Aionima to receive voice messages (audio files) from channels, transcribe them to text, process them through the agent, and optionally synthesize the agent's text response back to audio. This enables natural voice interactions over messaging platforms.

---

## Overview

The pipeline has two halves:

- **Speech-to-Text (STT)** — converts inbound audio to text so the agent can process it.
- **Text-to-Speech (TTS)** — converts the agent's text response to audio for delivery back to the channel.

TTS is optional. If the channel does not support voice responses or if TTS is not configured, the agent's text reply is sent as plain text even when the inbound message was audio.

---

## Enabling Voice

Enable the voice pipeline in `aionima.json`:

```json
{
  "voice": {
    "enabled": true,
    "sttProvider": "whisper",
    "ttsProvider": "edge"
  }
}
```

| Field | Default | Options | Description |
|-------|---------|---------|-------------|
| `enabled` | `false` | `true` / `false` | Enable the voice pipeline |
| `sttProvider` | `"whisper"` | `"whisper"`, `"local"` | STT provider for ONLINE state |
| `ttsProvider` | `"edge"` | `"edge"`, `"local"` | TTS provider for ONLINE state |
| `whisperApiKey` | — | string | Whisper API key (falls back to `OPENAI_API_KEY`) |
| `whisperModel` | `"whisper-1"` | string | Whisper model to use |

---

## STT Providers

### Whisper (OpenAI)

The default STT provider when the gateway is ONLINE. Uses the OpenAI Whisper API (`whisper-1` model).

Requirements:
- `OPENAI_API_KEY` in `.env` (or `voice.whisperApiKey` in config).
- Network access to `api.openai.com`.

The Whisper API transcribes audio with high accuracy across 50+ languages. The detected language is returned alongside the transcription and stored with the message.

Supported input formats: `wav`, `ogg`, `mp3`, `webm`, `mp4`.

Maximum audio duration: 120 seconds (configurable via `voice.maxDurationSeconds`).

### Local STT

When the gateway is OFFLINE (or when `sttProvider` is `"local"`), a local STT model is used. The local provider uses a small bundled model — accuracy is lower than Whisper API but requires no network access.

Local STT is suitable for privacy-sensitive deployments or air-gapped environments.

---

## TTS Providers

### Edge TTS (Microsoft)

The default TTS provider when the gateway is ONLINE. Uses Microsoft Edge's neural TTS service via the `edge-tts` integration.

Edge TTS provides high-quality neural voices in 40+ languages. No API key is required. The service is accessed over the public internet.

Default voice: `en-US-AriaNeural`.

Available voice names follow the format `{language}-{region}-{name}Neural`, for example:
- `en-US-AriaNeural`
- `en-GB-SoniaNeural`
- `es-ES-ElviraNeural`
- `fr-FR-DeniseNeural`
- `de-DE-KatjaNeural`

### Local TTS

When the gateway is OFFLINE (or when `ttsProvider` is `"local"`), a local TTS engine is used. The local provider produces audio without any external API calls.

Local TTS quality is lower than Edge TTS. It is suitable for environments without reliable internet access.

---

## Audio Formats

| Format | Input (STT) | Output (TTS) |
|--------|------------|-------------|
| MP3 | Yes | Yes (default output) |
| WAV | Yes | Yes |
| OGG | Yes | Yes |
| WebM | Yes | No |
| PCM | Yes | Yes |

The default TTS output format is `mp3`. Channels that support audio messages (Telegram, WhatsApp, Signal) receive the audio directly. Channels without audio support receive the text response.

---

## Voice Message Flow

```
User sends voice message (audio file)
    |
    v
Channel Adapter
    |
    | AionimaMessage { type: "voice", url: "...", duration: 15 }
    v
InboundRouter
    |
    | fetch audio from URL
    v
VoicePipeline.processInbound(audio)
    |
    | 1. duration check (max 120s)
    | 2. STT budget check (per entity per day)
    | 3. STT transcription (Whisper or local)
    v
Transcribed text
    |
    v
Normal agent pipeline (prompt assembly → LLM → response text)
    |
    v
VoicePipeline.synthesize(responseText)
    |
    | 1. TTS budget check (per entity per day)
    | 2. TTS synthesis (Edge TTS or local)
    v
Audio response (MP3)
    |
    v
OutboundDispatcher
    |
    v
Channel Adapter → sends audio reply
```

---

## Per-Entity Daily Budgets

To prevent abuse, the voice pipeline enforces daily usage budgets per entity:

| Limit | Default |
|-------|---------|
| STT seconds per day | 600 (10 minutes) |
| TTS characters per day | 50,000 |

When an entity exceeds their budget, the pipeline returns a text-only response for that entity for the remainder of the day. Budgets reset at midnight UTC.

Budgets are tracked in memory and reset on gateway restart.

---

## Language Detection

The Whisper API returns the detected language of the transcription (BCP-47 code, e.g. `en`, `es`, `fr`). This language code is:

- Stored with the message in the entity's session.
- Available to the agent as metadata.
- Used to set the expected response language (the agent's response format directives include "respond in the language used by the entity").

If the transcription confidence is low (below 0.7), the voice pipeline logs a warning but still processes the message.

---

## TTS in Replies

TTS synthesis is applied to the agent's text response when:

1. The voice pipeline is enabled.
2. The originating channel supports audio messages.
3. The inbound message was a voice message (type: `"voice"`).
4. The entity has not exceeded their TTS daily budget.

The synthesized audio is attached to the outbound message. The text version of the response is also sent as a caption (platform-dependent) so the user can read it if the audio fails to play.

---

## Troubleshooting

### Transcription Fails

- Check that `OPENAI_API_KEY` is set in `.env` (or `voice.whisperApiKey`).
- Verify the audio file is in a supported format and under 120 seconds.
- Check the gateway logs for error details: `logs/gateway.log`.
- If the audio URL is unreachable (e.g. Telegram file download requires the bot token), ensure the channel adapter is configured to resolve file URLs before passing them to the voice pipeline.

### TTS Does Not Produce Audio

- Confirm `voice.ttsProvider` is `"edge"` and the gateway is ONLINE.
- The Edge TTS service requires network access to Microsoft's TTS endpoints.
- If using `"local"`, ensure the local TTS binary is installed.

### Audio Reply Not Received on Channel

- Confirm the channel supports audio messages. Check the channel adapter's `capabilities.voice` field.
- Telegram and Signal support audio; Gmail does not.
- Check the outbound dispatcher logs for errors when sending the audio file.

### Daily Budget Exceeded

The entity will receive a text-only response with a brief notice that their voice budget for the day has been reached. The budget resets at midnight UTC or on gateway restart.
