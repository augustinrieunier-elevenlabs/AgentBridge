/**
 * Server-to-client and client-to-server event shapes for the ElevenLabs
 * Conversational AI websocket, verified against
 * https://elevenlabs.io/docs/eleven-agents/api-reference/eleven-agents/websocket
 * on 2026-10-01. Keep this file in sync if the upstream schema changes.
 */
import type { ConversationConfigOverride } from "../scenario/promptBuilder";

export type ServerEvent =
  | { type: "conversation_initiation_metadata"; conversation_initiation_metadata_event: { conversation_id: string; agent_output_audio_format: string; user_input_audio_format: string } }
  | { type: "audio"; audio_event: { audio_base_64: string; event_id: number; is_final?: boolean } }
  | { type: "interruption"; interruption_event: { event_id: number } }
  | { type: "user_transcript"; user_transcription_event: { user_transcript: string; event_id: number } }
  | { type: "agent_response"; agent_response_event: { agent_response: string; event_id: number; response_id?: string } }
  | { type: "agent_response_correction"; agent_response_correction_event: { original_agent_response: string; corrected_agent_response: string; event_id: number; response_id?: string } }
  | { type: "vad_score"; vad_score_event: { vad_score: number } }
  | { type: "ping"; ping_event: { event_id: number; ping_ms?: number } }
  | { type: "client_tool_call"; client_tool_call: { tool_name: string; tool_call_id: string; parameters: unknown; expects_response?: boolean } }
  | { type: string; [key: string]: unknown }; // forward-compat catch-all, logged but not acted on

export type ClientInitPayload = {
  type: "conversation_initiation_client_data";
  conversation_config_override?: ConversationConfigOverride;
  dynamic_variables?: Record<string, string | number | boolean>;
};

export type ClientContextualUpdate = { type: "contextual_update"; text: string };
export type ClientPong = { type: "pong"; event_id: number };
export type ClientUserAudioChunk = { user_audio_chunk: string }; // no "type" field -- matches the verified wire format
