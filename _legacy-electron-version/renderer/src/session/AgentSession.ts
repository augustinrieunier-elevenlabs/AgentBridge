/**
 * Wraps a single raw websocket connection to one ElevenLabs agent:
 * sends the initiation overrides/dynamic variables, answers ping with pong,
 * decodes incoming audio to Int16Array, and surfaces every other event
 * through onEvent for the TranscriptStore / DebugPanel to consume.
 */
import { base64ToInt16Array, int16ArrayToBase64 } from "../audio/pcm";
import type { ConversationConfigOverride } from "../scenario/promptBuilder";
import type { ServerEvent } from "./wsProtocol";

export type AgentSessionStatus = "idle" | "connecting" | "open" | "closed" | "error";

export type AgentSessionHandlers = {
  onStatusChange?: (status: AgentSessionStatus) => void;
  onAudioFrame?: (samples: Int16Array, isFinal: boolean) => void;
  onInterruption?: () => void;
  onEvent?: (event: ServerEvent) => void;
  onMetadata?: (conversationId: string, inputFormat: string, outputFormat: string) => void;
  onClose?: (code: number, reason: string) => void;
};

export class AgentSession {
  private ws: WebSocket | null = null;
  status: AgentSessionStatus = "idle";
  conversationId: string | null = null;

  constructor(private label: string, private handlers: AgentSessionHandlers) {}

  connect(
    url: string,
    init: { override?: ConversationConfigOverride; dynamicVariables?: Record<string, string | number | boolean> },
  ): Promise<void> {
    this.setStatus("connecting");
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = () => {
        const payload: Record<string, unknown> = { type: "conversation_initiation_client_data" };
        if (init.override) payload.conversation_config_override = init.override;
        if (init.dynamicVariables) payload.dynamic_variables = init.dynamicVariables;
        ws.send(JSON.stringify(payload));
      };

      ws.onmessage = (event: MessageEvent<string>) => {
        let parsed: ServerEvent;
        try {
          parsed = JSON.parse(event.data);
        } catch {
          console.warn(`[${this.label}] non-JSON websocket message, ignoring`);
          return;
        }
        this.handleServerEvent(parsed, resolve);
      };

      ws.onerror = () => {
        this.setStatus("error");
      };

      ws.onclose = (event) => {
        this.setStatus("closed");
        this.handlers.onClose?.(event.code, event.reason);
      };
    });
  }

  private handleServerEvent(event: ServerEvent, resolveConnect: () => void): void {
    this.handlers.onEvent?.(event);

    switch (event.type) {
      case "conversation_initiation_metadata": {
        const meta = (event as any).conversation_initiation_metadata_event;
        this.conversationId = meta.conversation_id;
        this.setStatus("open");
        this.handlers.onMetadata?.(meta.conversation_id, meta.user_input_audio_format, meta.agent_output_audio_format);
        resolveConnect();
        break;
      }
      case "audio": {
        const audioEvent = (event as any).audio_event;
        const samples = base64ToInt16Array(audioEvent.audio_base_64);
        this.handlers.onAudioFrame?.(samples, Boolean(audioEvent.is_final));
        break;
      }
      case "interruption": {
        this.handlers.onInterruption?.();
        break;
      }
      case "ping": {
        const pingEvent = (event as any).ping_event;
        this.sendPong(pingEvent.event_id);
        break;
      }
      // user_transcript / agent_response / agent_response_correction / vad_score / client_tool_call
      // are forwarded via onEvent above; TranscriptStore and DebugPanel subscribe there.
      default:
        break;
    }
  }

  private setStatus(status: AgentSessionStatus): void {
    this.status = status;
    this.handlers.onStatusChange?.(status);
  }

  sendAudioFrame(samples: Int16Array): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ user_audio_chunk: int16ArrayToBase64(samples) }));
  }

  sendContextualUpdate(text: string): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: "contextual_update", text }));
  }

  private sendPong(eventId: number): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: "pong", event_id: eventId }));
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}
