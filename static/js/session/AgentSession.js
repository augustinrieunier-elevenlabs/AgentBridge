/**
 * Wraps a single raw websocket connection to one ElevenLabs agent:
 * sends the initiation overrides/dynamic variables, answers ping with pong,
 * decodes incoming audio to Int16Array, and surfaces every other event
 * through onEvent for the TranscriptStore / DebugPanel to consume.
 *
 * Event shapes verified against
 * https://elevenlabs.io/docs/eleven-agents/api-reference/eleven-agents/websocket
 * on 2026-10-01:
 *  server->client: conversation_initiation_metadata, audio (audio_event.audio_base_64),
 *    interruption, user_transcript (user_transcription_event.user_transcript),
 *    agent_response (agent_response_event.agent_response), agent_response_correction,
 *    vad_score, ping (ping_event.event_id), client_tool_call.
 *  client->server: conversation_initiation_client_data, {"user_audio_chunk": "<base64>"}
 *    (no "type" field), {"type":"pong","event_id":...}, {"type":"contextual_update","text":...},
 *    {"type":"user_message","text":...} (text-only mode, conversation.text_only=true override --
 *    see Bridge.js, no audio/interruption/vad_score events are sent back in this mode).
 */
(function () {
  const base64ToInt16Array = window.AB.audio.base64ToInt16Array;
  const int16ArrayToBase64 = window.AB.audio.int16ArrayToBase64;

  class AgentSession {
    constructor(label, handlers) {
      this.label = label;
      this.handlers = handlers || {};
      this.ws = null;
      this.status = "idle";
      this.conversationId = null;
    }

    connect(url, init) {
      init = init || {};
      this._setStatus("connecting");
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        this.ws = ws;

        ws.onopen = () => {
          const payload = { type: "conversation_initiation_client_data" };
          if (init.override) payload.conversation_config_override = init.override;
          if (init.dynamicVariables) payload.dynamic_variables = init.dynamicVariables;
          ws.send(JSON.stringify(payload));
        };

        ws.onmessage = (event) => {
          let parsed;
          try {
            parsed = JSON.parse(event.data);
          } catch (err) {
            console.warn(`[${this.label}] non-JSON websocket message, ignoring`);
            return;
          }
          this._handleServerEvent(parsed, resolve);
        };

        ws.onerror = (event) => {
          this._setStatus("error");
          // The browser's websocket error Event carries no diagnostic detail by design (a security
          // restriction, not something this code can work around) -- but even a bare "an error
          // happened at this timestamp" is a real signal once correlated against everything else in
          // a saved debug log (see BenchmarkRunner.js), and this was previously dropped entirely.
          if (this.handlers.onError) this.handlers.onError(event);
        };

        ws.onclose = (event) => {
          this._setStatus("closed");
          if (this.handlers.onClose) this.handlers.onClose(event.code, event.reason, event.wasClean);
        };
      });
    }

    _handleServerEvent(event, resolveConnect) {
      if (this.handlers.onEvent) this.handlers.onEvent(event);

      switch (event.type) {
        case "conversation_initiation_metadata": {
          const meta = event.conversation_initiation_metadata_event;
          this.conversationId = meta.conversation_id;
          this._setStatus("open");
          if (this.handlers.onMetadata) this.handlers.onMetadata(meta.conversation_id, meta.user_input_audio_format, meta.agent_output_audio_format);
          resolveConnect();
          break;
        }
        case "audio": {
          const audioEvent = event.audio_event;
          const samples = base64ToInt16Array(audioEvent.audio_base_64);
          if (this.handlers.onAudioFrame) this.handlers.onAudioFrame(samples, Boolean(audioEvent.is_final));
          break;
        }
        case "interruption": {
          if (this.handlers.onInterruption) this.handlers.onInterruption();
          break;
        }
        case "ping": {
          this._sendPong(event.ping_event.event_id);
          break;
        }
        // user_transcript / agent_response / agent_response_correction / vad_score / client_tool_call
        // are forwarded via onEvent above; TranscriptStore and DebugPanel subscribe there.
        default:
          break;
      }
    }

    _setStatus(status) {
      this.status = status;
      if (this.handlers.onStatusChange) this.handlers.onStatusChange(status);
    }

    sendAudioFrame(samples) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.ws.send(JSON.stringify({ user_audio_chunk: int16ArrayToBase64(samples) }));
    }

    sendTextMessage(text) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.ws.send(JSON.stringify({ type: "user_message", text }));
    }

    sendContextualUpdate(text) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.ws.send(JSON.stringify({ type: "contextual_update", text }));
    }

    _sendPong(eventId) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.ws.send(JSON.stringify({ type: "pong", event_id: eventId }));
    }

    close() {
      if (this.ws) this.ws.close();
      this.ws = null;
    }
  }

  window.AB.session.AgentSession = AgentSession;
})();
