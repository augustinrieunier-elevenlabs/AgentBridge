/**
 * Orchestrates the two AgentSessions, their Pacers, local playback and the
 * operator controls (push-to-talk, takeover, pause, contextual nudge) --
 * spec-agent-bridge-demo.md sections 7 and 9.
 *
 * DebugLogEntry shape: { at, agent: "caller"|"callee", summary }
 * BridgeMetrics shape: { elapsedSec, calleeLatencyAvgMs?, calleeLatencyMaxMs?, callerQueueMs,
 *   calleeQueueMs, callerUnderruns, calleeUnderruns }
 */
(function () {
  const AudioBus = window.AB.audio.AudioBus;
  const Pacer = window.AB.audio.Pacer;
  const isSilentFrame = window.AB.audio.isSilentFrame;
  const silenceFrame = window.AB.audio.silenceFrame;
  const MicCapture = window.AB.audio.MicCapture;
  const NoiseInjector = window.AB.audio.NoiseInjector;
  const PacketLossSimulator = window.AB.audio.PacketLossSimulator;
  const AmbientSoundMixer = window.AB.audio.AmbientSoundMixer;
  const AgentSession = window.AB.session.AgentSession;
  const buildCalleeOverride = window.AB.scenario.buildCalleeOverride;
  const buildCallerOverride = window.AB.scenario.buildCallerOverride;
  const buildDynamicVariables = window.AB.scenario.buildDynamicVariables;
  const TranscriptStore = window.AB.session.TranscriptStore;
  const computeCalleeLatencyStats = window.AB.computeCalleeLatencyStats;

  const SILENCE_THRESHOLD_ABS = 60;
  const DEADLOCK_SILENCE_MS = 15000;
  // Text-only mode: after a tool call / workflow edge event, the agent can immediately generate a
  // SECOND, separate agent_response with nothing new having arrived (e.g. a workflow node transition
  // re-greets or re-asks a question that was just asked) -- in audio mode this just plays as one
  // continuous utterance with no visible seam, but relayed as two discrete user_messages in text
  // mode it reads as a confusing double turn. Hold briefly after such an event to see whether more
  // text follows and, if so, merge it into one relayed message instead of sending each separately.
  const TEXT_FOLLOWUP_GRACE_MS = 1000;
  // Pure housekeeping events that never precede a chained agent_response -- everything else
  // (tool calls, workflow condition checks, mcp events, ...) is treated as a "more may follow" signal.
  const NON_SPEECH_EVENT_TYPES = new Set(["agent_response", "ping", "conversation_initiation_metadata", "audio", "vad_score"]);

  class Bridge {
    constructor(events) {
      this.events = events || {};
      this.audioBus = new AudioBus();

      this.callerToCalleePacer = new Pacer(100);
      this.calleeToCallerPacer = new Pacer(100);
      // Simulates a bad phone line / noisy environment on the caller->callee leg only (confirmed
      // with the user 2026-10-05) -- mixed in at the pacer tick, see _onCallerToCalleeTick.
      this.callerToCalleeNoise = new NoiseInjector();
      this.callerToCalleePacketLoss = new PacketLossSimulator();
      this.callerToCalleeAmbient = new AmbientSoundMixer();

      this.textOnly = false;
      this.textOnlyReady = false; // both sessions' websockets confirmed open -- see _relayText
      this.pendingToCaller = [];
      this.pendingToCallee = [];
      // Text-only turn-merging (see TEXT_FOLLOWUP_GRACE_MS above).
      this.callerPendingText = [];
      this.calleePendingText = [];
      this.callerFlushTimer = null;
      this.calleeFlushTimer = null;
      this.callerExpectMore = false;
      this.calleeExpectMore = false;
      this.mic = null;
      this.pttActive = false;
      this.takeoverActive = false;
      this.bridgePaused = false;

      this.calleeAudioActive = false;
      this.calleeAudioWatchdog = null;
      this.callerAudioActive = false;
      this.callerAudioWatchdog = null;
      this.operatorAudioActive = false;
      this.operatorAudioWatchdog = null;

      this.deadlockTimer = null;
      this.metricsTimer = null;
      this.maxDurationTimer = null;
      this.status = "idle";
      this.ended = false;

      this.callerSession = new AgentSession("caller", {
        onEvent: (e) => this._handleCallerEvent(e),
        onAudioFrame: (samples, isFinal) => this._onCallerAgentAudio(samples, isFinal),
        onInterruption: () => this._onCallerInterruption(),
        onStatusChange: () => {},
        onClose: (code, reason, wasClean) => this._handleSessionClosed("caller", code, reason, wasClean),
        onError: () => this._handleSessionError("caller"),
      });
      this.calleeSession = new AgentSession("callee", {
        onEvent: (e) => this._handleCalleeEvent(e),
        onAudioFrame: (samples, isFinal) => this._onCalleeAgentAudio(samples, isFinal),
        onInterruption: () => this._onCalleeInterruption(),
        onStatusChange: () => {},
        onClose: (code, reason, wasClean) => this._handleSessionClosed("callee", code, reason, wasClean),
        onError: () => this._handleSessionError("callee"),
      });

      this.callerChannel = this.audioBus.createChannel(-1); // left
      this.calleeChannel = this.audioBus.createChannel(1); // right

      this.sessionStartedAt = performance.now();
      this.transcriptStore = new TranscriptStore(this.sessionStartedAt);
      this.transcriptStore.subscribe((turns) => {
        if (this.events.onTranscriptUpdate) this.events.onTranscriptUpdate(turns);
      });
    }

    _setStatus(status) {
      this.status = status;
      if (this.events.onStatusChange) this.events.onStatusChange(status);
    }

    _log(agent, summary) {
      if (this.events.onDebugLog) this.events.onDebugLog({ at: performance.now() - this.sessionStartedAt, agent, summary });
    }

    // ---- lifecycle ---------------------------------------------------------

    async start({ api, accounts, callerAgent, calleeAgent, scenario, calleeDynamicVariables, textOnly, noiseProfile }) {
      this.textOnly = Boolean(textOnly);
      if (!this.textOnly) await this.audioBus.resume();
      this._setStatus("connecting");

      // Applied immediately, before anything connects, so a referenced noise profile (see
      // model/factory.js emptyNoiseProfile / ui/settings/NoiseProfilesPanel.jsx) is already active
      // from the conversation's very first turn -- not something the operator has to dial in after
      // the fact. No-op in text-only mode: there's no audio pipeline to inject noise/drops into.
      // Still fully overridable afterwards via setCallerToCalleeNoise*/setCallerToCalleePacketLoss*
      // (see SessionScreen.jsx's operator bar), confirmed with the user 2026-10-05.
      let ambientLoad = Promise.resolve();
      if (!this.textOnly && noiseProfile) {
        this.callerToCalleeNoise.setType(noiseProfile.noiseType);
        this.callerToCalleeNoise.setLevel(noiseProfile.noiseLevel);
        this.callerToCalleePacketLoss.setEnabled(noiseProfile.packetLossEnabled);
        this.callerToCalleePacketLoss.setIntervalRangeS(noiseProfile.packetLossMinS, noiseProfile.packetLossMaxS);
        this.callerToCalleePacketLoss.setDropDurationS(noiseProfile.packetLossDropS);
        this.callerToCalleeAmbient.setLevel(noiseProfile.ambientSoundLevel);
        // Fetch+decode happens in parallel with the signed-url calls below, not after them -- an
        // ambient track shouldn't add to call setup latency just because it also needs a network
        // round trip.
        ambientLoad = this.callerToCalleeAmbient.load(noiseProfile.ambientSoundPaths.map((p) => api.noiseSounds.fileUrl(p)));
      }

      const [callerUrl, calleeUrl] = await Promise.all([
        api.session.getSignedUrl(callerAgent.accountId, callerAgent.agentId),
        api.session.getSignedUrl(calleeAgent.accountId, calleeAgent.agentId),
        ambientLoad,
      ]);

      const callerOverride = buildCallerOverride(scenario);
      let calleeOverride = buildCalleeOverride(scenario);
      const dynamicVariables = buildDynamicVariables(scenario);

      if (this.textOnly) {
        // No audio pipeline at all in this mode (see AgentSession.js) -- force it on both
        // sessions so agent_response text is what's actually exchanged, not a transcript of
        // audio nobody generates.
        callerOverride.conversation = { ...callerOverride.conversation, text_only: true };
        calleeOverride = { ...(calleeOverride || {}), conversation: { ...(calleeOverride && calleeOverride.conversation), text_only: true } };
      }

      await Promise.all([
        this.callerSession.connect(callerUrl.url, { override: callerOverride, dynamicVariables }),
        // calleeDynamicVariables: the agent's own hard values merged with any
        // preset override (see SessionScreen.jsx) -- empty unless the callee
        // agent declares dynamic variables that need a real value for this demo.
        this.calleeSession.connect(calleeUrl.url, { override: calleeOverride, dynamicVariables: calleeDynamicVariables }),
      ]);

      if (this.events.onConversationIds) this.events.onConversationIds(this.callerSession.conversationId, this.calleeSession.conversationId);

      if (this.textOnly) {
        // Event handlers are wired in the constructor and can fire while the OTHER session's
        // websocket is still CONNECTING (e.g. the callee's first_message streams back before the
        // caller's socket is OPEN) -- unlike audio frames, which harmlessly queue in a Pacer that
        // hasn't started yet, sendTextMessage would silently drop that message. Queue until both
        // sides are confirmed connected, then flush in order.
        this.textOnlyReady = true;
        this._flushPendingText();
      }

      if (!this.textOnly) {
        this.callerToCalleePacer.start((frame) => this._onCallerToCalleeTick(frame));
        this.calleeToCallerPacer.start((frame) => this._onCalleeToCallerTick(frame));
      }

      this.lastAnyAudioAt = performance.now();
      this.deadlockTimer = setInterval(() => this._checkDeadlock(), 2000);
      this.metricsTimer = setInterval(() => this._emitMetrics(), 1000);

      if (scenario.maxDurationSec > 0) {
        this.maxDurationTimer = setTimeout(() => this.end("max_duration_reached"), scenario.maxDurationSec * 1000);
      }

      this._setStatus("live");
    }

    end(reason) {
      if (this.ended) return;
      this.ended = true;

      this.callerToCalleePacer.stop();
      this.calleeToCallerPacer.stop();
      if (this.deadlockTimer) clearInterval(this.deadlockTimer);
      if (this.metricsTimer) clearInterval(this.metricsTimer);
      if (this.maxDurationTimer) clearTimeout(this.maxDurationTimer);
      if (this.mic) this.mic.stop();

      this.callerSession.close();
      this.calleeSession.close();

      this._setStatus("ended");
      if (this.events.onEnded) this.events.onEnded(reason);
    }

    _handleSessionClosed(agent, code, reason, wasClean) {
      this._log(agent, `websocket closed (code=${code}${reason ? `, reason=${reason}` : ""}${wasClean === false ? ", unclean" : ""})`);
      if (!this.ended) this.end(`${agent}_websocket_closed`);
    }

    _handleSessionError(agent) {
      // No detail is available on the event itself (browser security restriction) -- logging that
      // it happened, and when, is still a real signal once correlated against everything else in a
      // saved debug log (e.g. "an error fired right before the close that ended this run").
      this._log(agent, "websocket error");
    }

    // ---- text-only relay, race-safe (see the comment in start()) -----------

    _relayText(to, text) {
      if (this.textOnlyReady) {
        (to === "callee" ? this.calleeSession : this.callerSession).sendTextMessage(text);
      } else {
        (to === "callee" ? this.pendingToCallee : this.pendingToCaller).push(text);
      }
    }

    _flushPendingText() {
      for (const t of this.pendingToCallee) this.calleeSession.sendTextMessage(t);
      for (const t of this.pendingToCaller) this.callerSession.sendTextMessage(t);
      this.pendingToCallee = [];
      this.pendingToCaller = [];
    }

    /**
     * Queues one agent_response for `side` ("caller"|"callee"). If the side just produced a
     * tool-call/workflow event (see _handleCallerEvent/_handleCalleeEvent setting *ExpectMore),
     * holds briefly in case a second, immediately-chained response follows, then relays the merged
     * text as one turn. Otherwise relays immediately -- zero added latency for an ordinary turn.
     */
    _queueText(side, text) {
      const pendingKey = side === "caller" ? "callerPendingText" : "calleePendingText";
      const timerKey = side === "caller" ? "callerFlushTimer" : "calleeFlushTimer";
      const expectKey = side === "caller" ? "callerExpectMore" : "calleeExpectMore";

      this[pendingKey].push(text);
      if (this[timerKey]) clearTimeout(this[timerKey]);

      if (this[expectKey]) {
        this[expectKey] = false;
        this[timerKey] = setTimeout(() => this._flushText(side), TEXT_FOLLOWUP_GRACE_MS);
      } else {
        this._flushText(side);
      }
    }

    _flushText(side) {
      const pendingKey = side === "caller" ? "callerPendingText" : "calleePendingText";
      const timerKey = side === "caller" ? "callerFlushTimer" : "calleeFlushTimer";
      const texts = this[pendingKey];
      this[pendingKey] = [];
      this[timerKey] = null;
      if (texts.length === 0) return;
      const combined = texts.join(" ");
      if (side === "caller") {
        this.transcriptStore.onCallerTextUtterance(combined);
        this._relayText("callee", combined);
      } else {
        this.transcriptStore.onCalleeTextUtterance(combined);
        this._relayText("caller", combined);
      }
    }

    // ---- events from the two websockets ------------------------------------

    _handleCallerEvent(event) {
      if (event.type === "agent_response") {
        const text = event.agent_response_event.agent_response;
        if (this.textOnly) {
          this.lastAnyAudioAt = performance.now();
          this._queueText("caller", text);
        } else {
          this.transcriptStore.onCallerOwnUtterance(text);
        }
      } else if (!NON_SPEECH_EVENT_TYPES.has(event.type)) {
        // A tool call, workflow edge, or similar still-in-progress signal just fired. In audio mode
        // this is a secondary activity signal alongside audio frames; in text-only mode it is the
        // ONLY one for a turn that hasn't produced a new agent_response yet -- confirmed 2026-10-04:
        // a multi-step MCP tool chain spanning ~10s between agent_response events, each step a few
        // seconds apart, got misread as a deadlock because only agent_response refreshed the clock
        // there, even though the call was genuinely still progressing. Excludes vad_score/ping/audio
        // deliberately -- vad_score alone fires every ~100ms regardless of real activity (even
        // during genuine silence) and would otherwise defeat deadlock detection entirely.
        this.lastAnyAudioAt = performance.now();
        // A tool call or workflow edge just fired -- a second, immediately-chained agent_response
        // may follow with nothing new having arrived; see _queueText.
        if (this.textOnly) this.callerExpectMore = true;
      }
      if (event.type === "client_tool_call") {
        this._log("caller", `tool call: ${event.client_tool_call && event.client_tool_call.tool_name}`);
      }
      if (event.type === "vad_score") {
        if (this.events.onVadScore) this.events.onVadScore("caller", event.vad_score_event.vad_score);
      }
      if (event.type !== "audio" && event.type !== "ping" && event.type !== "vad_score") {
        this._log("caller", event.type);
      }
    }

    _handleCalleeEvent(event) {
      switch (event.type) {
        case "user_transcript":
          this.transcriptStore.onCalleeUserTranscript(event.user_transcription_event.user_transcript);
          break;
        case "agent_response": {
          const text = event.agent_response_event.agent_response;
          if (this.textOnly) {
            this.lastAnyAudioAt = performance.now();
            this._queueText("callee", text);
          } else {
            this.transcriptStore.onCalleeAgentResponse(text);
          }
          break;
        }
        case "agent_response_correction":
          this.transcriptStore.onCalleeAgentResponseCorrection(event.agent_response_correction_event.corrected_agent_response);
          break;
        case "client_tool_call":
          this._log("callee", `tool call: ${event.client_tool_call && event.client_tool_call.tool_name}`);
          break;
        case "vad_score":
          if (this.events.onVadScore) this.events.onVadScore("callee", event.vad_score_event.vad_score);
          break;
        default:
          break;
      }
      if (!NON_SPEECH_EVENT_TYPES.has(event.type)) {
        // See the matching comment in _handleCallerEvent: a still-in-progress signal (tool call,
        // workflow edge, MCP status, ...) counts as activity for deadlock purposes even without a
        // new agent_response yet.
        this.lastAnyAudioAt = performance.now();
        // A tool call or workflow edge just fired -- a second, immediately-chained agent_response
        // may follow with nothing new having arrived; see _queueText.
        if (this.textOnly) this.calleeExpectMore = true;
      }
      if (event.type !== "audio" && event.type !== "ping" && event.type !== "vad_score") {
        this._log("callee", event.type);
      }
    }

    // ---- audio received directly from each agent's websocket --------------

    _onCallerAgentAudio(samples, isFinal) {
      this.lastAnyAudioAt = performance.now();
      if (this.pttActive || this.takeoverActive) return; // mic replaces the caller while the operator has the line

      if (!this.callerAudioActive) {
        this.callerAudioActive = true;
        this.transcriptStore.onCallerAudioActivity("caller");
      }
      if (this.callerAudioWatchdog) clearTimeout(this.callerAudioWatchdog);
      this.callerAudioWatchdog = setTimeout(() => {
        this.callerAudioActive = false;
      }, 600);
      if (isFinal) {
        this.callerAudioActive = false;
        if (this.callerAudioWatchdog) clearTimeout(this.callerAudioWatchdog);
      }

      this.callerToCalleePacer.push(samples);
    }

    _onCalleeAgentAudio(samples, isFinal) {
      this.lastAnyAudioAt = performance.now();
      if (!this.calleeAudioActive) {
        this.calleeAudioActive = true;
        this.transcriptStore.onCalleeFirstAudioChunk();
      }
      if (this.calleeAudioWatchdog) clearTimeout(this.calleeAudioWatchdog);
      this.calleeAudioWatchdog = setTimeout(() => {
        this.calleeAudioActive = false;
      }, 600);
      if (isFinal) {
        this.calleeAudioActive = false;
        if (this.calleeAudioWatchdog) clearTimeout(this.calleeAudioWatchdog);
      }
      this.calleeToCallerPacer.push(samples);
    }

    // ---- self-interruptions (an agent replacing its own in-flight utterance) -----

    /**
     * An agent can interrupt its OWN speech mid-utterance -- most commonly a speculative/draft
     * response (seen in a real transcript tagged "[ALIGNMENT]") that gets replaced moments later by
     * a tool-informed final answer. Pacer.flush() existed for exactly this (see its own doc comment)
     * but was never actually wired up anywhere in this file until now (confirmed 2026-10-04): the
     * draft's audio sat in the outgoing pacer's queue, and the corrected answer's audio was pushed
     * in BEHIND it instead of replacing it, so the far side received the stale draft followed
     * immediately by the real answer concatenated together -- which its own ASR could not parse
     * into a coherent turn. Confirmed via both sides' own conversation records on a real session: the
     * callee's record showed it genuinely completed a correct final answer, the caller's record
     * never received it at all, and the session's own debug metrics showed 2205ms of audio still
     * backed up in this exact queue. The result read as a silent deadlock with no error anywhere --
     * the operator had to hang up manually, with nothing in the UI explaining why the call stopped
     * progressing. Flushing on interruption discards the now-stale audio instead of concatenating
     * the correction after it.
     */
    _onCallerInterruption() {
      this.callerToCalleePacer.flush();
    }

    _onCalleeInterruption() {
      this.transcriptStore.onCalleeInterruption();
      this.calleeToCallerPacer.flush();
    }

    // ---- paced relay ticks --------------------------------------------------

    _onCallerToCalleeTick(frame) {
      // Packet loss wins over noise/ambient for any frame it drops -- a lost packet carries no
      // signal at all, not even background line noise or ambient sound, so both layers are
      // skipped entirely on a dropped tick.
      const dropped = this.callerToCalleePacketLoss.apply(frame);
      if (!dropped) {
        this.callerToCalleeNoise.apply(frame);
        this.callerToCalleeAmbient.apply(frame);
      }
      this.calleeSession.sendAudioFrame(frame);
      this.callerChannel.playFrame(frame);
    }

    _onCalleeToCallerTick(frame) {
      this.calleeChannel.playFrame(frame);
      const muteToCaller = this.pttActive || this.takeoverActive || this.bridgePaused;
      this.callerSession.sendAudioFrame(muteToCaller ? silenceFrame(frame.length) : frame);
    }

    _emitMetrics() {
      const stats = computeCalleeLatencyStats(this.transcriptStore.getTurns());
      if (this.events.onMetrics) {
        this.events.onMetrics({
          elapsedSec: (performance.now() - this.sessionStartedAt) / 1000,
          calleeLatencyAvgMs: stats.avgMs,
          calleeLatencyMaxMs: stats.maxMs,
          callerQueueMs: (this.callerToCalleePacer.queuedSampleCount / 16000) * 1000,
          calleeQueueMs: (this.calleeToCallerPacer.queuedSampleCount / 16000) * 1000,
          // Ticked every second into a saved debug log's metricsLog (see BenchmarkRunner.js), so a
          // mid-call cutoff can be diagnosed from the TREND (queue depth/underruns climbing before
          // it happened) instead of only a final snapshot.
          callerUnderruns: this.callerToCalleePacer.underrunCount,
          calleeUnderruns: this.calleeToCallerPacer.underrunCount,
        });
      }
    }

    _checkDeadlock() {
      if (this.status !== "live") return;
      // A long response can arrive FASTER than real-time -- TTS streaming doesn't pace itself to
      // playback speed -- so a pacer can still be draining a multi-second backlog well after the
      // last audio frame actually ARRIVED. Confirmed via a saved benchmark debug log (2026-10-04):
      // calleeQueueMs peaked at 30.8s with zero new frames arriving after it, and this check fired
      // while 15.8s of legitimate, not-yet-played audio was still queued -- cutting the callee off
      // mid-sentence while it was genuinely still speaking (confirmed live by the operator listening
      // at the time), not stalled at all. Treat "still draining a backlog" as activity: it keeps
      // lastAnyAudioAt fresh so the real silence window only starts counting once both queues have
      // actually finished playing out, not from whenever the last chunk happened to arrive.
      const stillDrainingBacklog = this.callerToCalleePacer.queuedSampleCount > 0 || this.calleeToCallerPacer.queuedSampleCount > 0;
      if (stillDrainingBacklog) {
        this.lastAnyAudioAt = performance.now();
        return;
      }
      if (performance.now() - this.lastAnyAudioAt > DEADLOCK_SILENCE_MS) {
        if (this.events.onDeadlock) this.events.onDeadlock();
      }
    }

    // ---- operator controls (spec-agent-bridge-demo.md section 7.4) --------

    async startPushToTalk() {
      if (this.textOnly || this.pttActive || this.takeoverActive) return; // no mic/audio pipeline in text-only mode
      this.pttActive = true;
      await this._ensureMic();
    }

    stopPushToTalk() {
      if (!this.pttActive) return;
      this.pttActive = false;
      if (!this.takeoverActive && this.mic) this.mic.stop();
    }

    async setTakeover(active) {
      if (this.textOnly) return; // no mic/audio pipeline in text-only mode
      this.takeoverActive = active;
      if (active) await this._ensureMic();
      else if (!this.pttActive && this.mic) this.mic.stop();
    }

    setBridgePaused(paused) {
      if (this.textOnly) return; // mutes the audio relay, which doesn't exist in text-only mode
      this.bridgePaused = paused;
    }

    sendContextualNudge(text) {
      this.callerSession.sendContextualUpdate(text);
      this._log("caller", `operator nudge: ${text}`);
    }

    setCallerToCalleeNoiseType(type) {
      this.callerToCalleeNoise.setType(type);
    }
    setCallerToCalleeNoiseLevel(level) {
      this.callerToCalleeNoise.setLevel(level);
    }
    setCallerToCalleePacketLossEnabled(enabled) {
      this.callerToCalleePacketLoss.setEnabled(enabled);
    }
    setCallerToCalleePacketLossIntervalRange(minS, maxS) {
      this.callerToCalleePacketLoss.setIntervalRangeS(minS, maxS);
    }
    setCallerToCalleePacketLossDropDuration(seconds) {
      this.callerToCalleePacketLoss.setDropDurationS(seconds);
    }

    setCallerVolume(volume) {
      this.callerChannel.setVolume(volume);
    }
    setCalleeVolume(volume) {
      this.calleeChannel.setVolume(volume);
    }
    setCallerMuted(muted) {
      this.callerChannel.setMuted(muted);
    }
    setCalleeMuted(muted) {
      this.calleeChannel.setMuted(muted);
    }

    async setOutputDevice(deviceId) {
      await this.audioBus.setOutputDevice(deviceId);
    }

    get callerConversationId() {
      return this.callerSession.conversationId;
    }
    get calleeConversationId() {
      return this.calleeSession.conversationId;
    }

    async _ensureMic() {
      if (!this.mic) {
        this.mic = new MicCapture(this.audioBus.context, (samples) => this._onMicChunk(samples));
      }
      if (!this.mic.isActive) await this.mic.start();
    }

    _onMicChunk(samples) {
      this.lastAnyAudioAt = performance.now();
      this.callerToCalleePacer.push(samples);

      const speaking = !isSilentFrame(samples, SILENCE_THRESHOLD_ABS);
      if (speaking && !this.operatorAudioActive) {
        this.operatorAudioActive = true;
        this.transcriptStore.onCallerAudioActivity("operator");
      }
      if (this.operatorAudioWatchdog) clearTimeout(this.operatorAudioWatchdog);
      this.operatorAudioWatchdog = setTimeout(() => {
        this.operatorAudioActive = false;
      }, 700);
    }
  }

  window.AB.session.Bridge = Bridge;
})();
