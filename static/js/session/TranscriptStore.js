/**
 * Builds the central transcript (spec-agent-bridge-demo.md section 8) purely
 * from the callee's websocket events + locally-known operator state. The
 * caller's own WS events are NOT used to build turns here -- only to fill the
 * optional `callerIntended` ASR-comparison field, per section 8.1.
 *
 * Event -> turn mapping (section 8.2):
 *  - non-silent audio flowing caller->callee with no active caller turn: insert a "live" placeholder (caller or operator)
 *  - callee's `user_transcript`: fills/finalizes that placeholder
 *  - callee's first `audio` chunk of a turn: insert a "live" "…" placeholder for the callee
 *  - callee's `agent_response`: fills that placeholder
 *  - callee's `interruption`: marks the active callee turn "interrupted"
 *  - callee's `agent_response_correction`: marks the (just finished) callee turn "corrected"
 *
 * Turn shape: { id, speaker: "caller"|"operator"|"callee", text, status: "live"|"final"|"interrupted"|"corrected",
 *               startedAt (ms since session start), endedAt?, latencyMs?, callerIntended? }
 */
(function () {
  let idCounter = 0;
  function nextId() {
    idCounter += 1;
    return `turn-${idCounter}`;
  }

  class TranscriptStore {
    constructor(sessionStartedAt) {
      this.sessionStartedAt = sessionStartedAt;
      this.turns = [];
      this.listeners = [];

      this.activeCallerTurnId = null;
      this.activeCalleeTurnId = null;
      this.lastInterruptedCalleeTurnId = null;
      this.lastTurnEndedAt = null;
    }

    subscribe(listener) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((l) => l !== listener);
      };
    }

    getTurns() {
      return this.turns.slice();
    }

    _notify() {
      const snapshot = this.getTurns();
      for (const listener of this.listeners) listener(snapshot);
    }

    _now() {
      return performance.now() - this.sessionStartedAt;
    }

    _findTurn(id) {
      if (!id) return undefined;
      return this.turns.find((t) => t.id === id);
    }

    _finalizeIfActive(id) {
      const turn = this._findTurn(id);
      if (turn && turn.status === "live") {
        turn.status = "final";
        turn.endedAt = this._now();
        this.lastTurnEndedAt = turn.endedAt;
      }
    }

    /** Called by the Bridge when a non-silent frame flows caller->callee. */
    onCallerAudioActivity(attributedTo) {
      if (this.activeCallerTurnId) return; // already tracking this turn
      this._finalizeIfActive(this.activeCalleeTurnId);
      this.activeCalleeTurnId = null;

      const turn = { id: nextId(), speaker: attributedTo, text: "…", status: "live", startedAt: this._now() };
      this.turns.push(turn);
      this.activeCallerTurnId = turn.id;
      this._notify();
    }

    /** Callee WS: user_transcript -- what the callee understood from the caller. */
    onCalleeUserTranscript(text) {
      const turn = this._findTurn(this.activeCallerTurnId);
      const now = this._now();
      if (turn) {
        turn.text = text;
        turn.status = "final";
        turn.endedAt = now;
      } else {
        // ASR arrived without a detected activity placeholder (e.g. missed VAD) -- still show it.
        this.turns.push({ id: nextId(), speaker: "caller", text, status: "final", startedAt: now, endedAt: now });
      }
      this.lastTurnEndedAt = now;
      this.activeCallerTurnId = null;
      this._notify();
    }

    /** Optional: caller's own agent_response for the current turn, used for the ASR-comparison toggle. */
    onCallerOwnUtterance(text) {
      for (let i = this.turns.length - 1; i >= 0; i--) {
        if (this.turns[i].speaker === "caller" || this.turns[i].speaker === "operator") {
          this.turns[i].callerIntended = text;
          this._notify();
          return;
        }
      }
    }

    /** Callee WS: first audio chunk of a new response. */
    onCalleeFirstAudioChunk() {
      if (this.activeCalleeTurnId) return;
      this._finalizeIfActive(this.activeCallerTurnId);
      this.activeCallerTurnId = null;

      const now = this._now();
      const latencyMs = this.lastTurnEndedAt !== null ? Math.max(0, now - this.lastTurnEndedAt) : undefined;
      const turn = { id: nextId(), speaker: "callee", text: "…", status: "live", startedAt: now, latencyMs };
      this.turns.push(turn);
      this.activeCalleeTurnId = turn.id;
      this._notify();
    }

    /** Callee WS: agent_response -- what the callee says. */
    onCalleeAgentResponse(text) {
      const turn = this._findTurn(this.activeCalleeTurnId);
      if (turn) {
        turn.text = text;
      } else {
        const now = this._now();
        const newTurn = { id: nextId(), speaker: "callee", text, status: "live", startedAt: now };
        this.turns.push(newTurn);
        this.activeCalleeTurnId = newTurn.id;
      }
      this._notify();
    }

    /** Callee WS: interruption -- the callee's own speech was cut off. */
    onCalleeInterruption() {
      const turn = this._findTurn(this.activeCalleeTurnId);
      if (turn) {
        turn.status = "interrupted";
        turn.endedAt = this._now();
        this.lastTurnEndedAt = turn.endedAt;
        this.lastInterruptedCalleeTurnId = turn.id;
      }
      this.activeCalleeTurnId = null;
      this._notify();
    }

    /**
     * Text-only mode (Bridge.textOnly): each side's `agent_response` arrives as one complete
     * block, with no ASR/audio-activity event to build a "live" placeholder from -- so each
     * call below pushes an already-`final` turn directly, instead of the audio-mode dance of
     * onCallerAudioActivity/onCalleeUserTranscript or onCalleeFirstAudioChunk/onCalleeAgentResponse.
     */
    onCallerTextUtterance(text) {
      this._finalizeIfActive(this.activeCalleeTurnId);
      this.activeCalleeTurnId = null;
      const now = this._now();
      const turn = { id: nextId(), speaker: "caller", text, status: "final", startedAt: now, endedAt: now };
      this.turns.push(turn);
      this.activeCallerTurnId = null;
      this.lastTurnEndedAt = now;
      this._notify();
    }

    onCalleeTextUtterance(text) {
      this._finalizeIfActive(this.activeCallerTurnId);
      this.activeCallerTurnId = null;
      const now = this._now();
      const latencyMs = this.lastTurnEndedAt !== null ? Math.max(0, now - this.lastTurnEndedAt) : undefined;
      const turn = { id: nextId(), speaker: "callee", text, status: "final", startedAt: now, endedAt: now, latencyMs };
      this.turns.push(turn);
      this.activeCalleeTurnId = null;
      this.lastTurnEndedAt = now;
      this._notify();
    }

    /** Callee WS: agent_response_correction -- replaces the just-finished callee turn's text. */
    onCalleeAgentResponseCorrection(correctedText) {
      const lastCalleeTurn = this.turns.filter((t) => t.speaker === "callee").at(-1);
      const targetId = this.lastInterruptedCalleeTurnId || this.activeCalleeTurnId || (lastCalleeTurn ? lastCalleeTurn.id : null);
      const turn = this._findTurn(targetId);
      if (turn) {
        turn.text = correctedText;
        turn.status = "corrected";
        if (turn.endedAt === undefined) turn.endedAt = this._now();
      }
      this.lastInterruptedCalleeTurnId = null;
      this.activeCalleeTurnId = null;
      this._notify();
    }
  }

  window.AB.session.TranscriptStore = TranscriptStore;
})();
