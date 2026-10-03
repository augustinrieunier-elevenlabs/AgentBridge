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
 */
import type { Turn, TurnSpeaker } from "../../../shared/types";

type Listener = (turns: Turn[]) => void;

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `turn-${idCounter}`;
}

export class TranscriptStore {
  private turns: Turn[] = [];
  private listeners: Listener[] = [];

  private activeCallerTurnId: string | null = null;
  private activeCalleeTurnId: string | null = null;
  private lastInterruptedCalleeTurnId: string | null = null;
  private lastTurnEndedAt: number | null = null;

  constructor(private readonly sessionStartedAt: number) {}

  subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  getTurns(): Turn[] {
    return [...this.turns];
  }

  private notify(): void {
    const snapshot = this.getTurns();
    for (const listener of this.listeners) listener(snapshot);
  }

  private now(): number {
    return performance.now() - this.sessionStartedAt;
  }

  private findTurn(id: string | null): Turn | undefined {
    if (!id) return undefined;
    return this.turns.find((t) => t.id === id);
  }

  private finalizeIfActive(id: string | null): void {
    const turn = this.findTurn(id);
    if (turn && turn.status === "live") {
      turn.status = "final";
      turn.endedAt = this.now();
      this.lastTurnEndedAt = turn.endedAt;
    }
  }

  /** Called by the Bridge when a non-silent frame flows caller->callee. */
  onCallerAudioActivity(attributedTo: "caller" | "operator"): void {
    if (this.activeCallerTurnId) return; // already tracking this turn
    this.finalizeIfActive(this.activeCalleeTurnId);
    this.activeCalleeTurnId = null;

    const turn: Turn = {
      id: nextId(),
      speaker: attributedTo,
      text: "…",
      status: "live",
      startedAt: this.now(),
    };
    this.turns.push(turn);
    this.activeCallerTurnId = turn.id;
    this.notify();
  }

  /** Callee WS: user_transcript -- what the callee understood from the caller. */
  onCalleeUserTranscript(text: string): void {
    const turn = this.findTurn(this.activeCallerTurnId);
    const now = this.now();
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
    this.notify();
  }

  /** Optional: caller's own agent_response for the current turn, used for the ASR-comparison toggle. */
  onCallerOwnUtterance(text: string): void {
    // Attach to the most recent caller/operator turn, whether or not it has been finalized yet.
    for (let i = this.turns.length - 1; i >= 0; i--) {
      if (this.turns[i].speaker === "caller" || this.turns[i].speaker === "operator") {
        this.turns[i].callerIntended = text;
        this.notify();
        return;
      }
    }
  }

  /** Callee WS: first audio chunk of a new response. */
  onCalleeFirstAudioChunk(): void {
    if (this.activeCalleeTurnId) return;
    this.finalizeIfActive(this.activeCallerTurnId);
    this.activeCallerTurnId = null;

    const now = this.now();
    const latencyMs = this.lastTurnEndedAt !== null ? Math.max(0, now - this.lastTurnEndedAt) : undefined;
    const turn: Turn = {
      id: nextId(),
      speaker: "callee",
      text: "…",
      status: "live",
      startedAt: now,
      latencyMs,
    };
    this.turns.push(turn);
    this.activeCalleeTurnId = turn.id;
    this.notify();
  }

  /** Callee WS: agent_response -- what the callee says. */
  onCalleeAgentResponse(text: string): void {
    const turn = this.findTurn(this.activeCalleeTurnId);
    if (turn) {
      turn.text = text;
    } else {
      const now = this.now();
      const newTurn: Turn = { id: nextId(), speaker: "callee", text, status: "live", startedAt: now };
      this.turns.push(newTurn);
      this.activeCalleeTurnId = newTurn.id;
    }
    this.notify();
  }

  /** Callee WS: interruption -- the callee's own speech was cut off. */
  onCalleeInterruption(): void {
    const turn = this.findTurn(this.activeCalleeTurnId);
    if (turn) {
      turn.status = "interrupted";
      turn.endedAt = this.now();
      this.lastTurnEndedAt = turn.endedAt;
      this.lastInterruptedCalleeTurnId = turn.id;
    }
    this.activeCalleeTurnId = null;
    this.notify();
  }

  /** Callee WS: agent_response_correction -- replaces the just-finished callee turn's text. */
  onCalleeAgentResponseCorrection(correctedText: string): void {
    const targetId = this.lastInterruptedCalleeTurnId ?? this.activeCalleeTurnId ?? this.turns.filter((t) => t.speaker === "callee").at(-1)?.id ?? null;
    const turn = this.findTurn(targetId);
    if (turn) {
      turn.text = correctedText;
      turn.status = "corrected";
      if (turn.endedAt === undefined) turn.endedAt = this.now();
    }
    this.lastInterruptedCalleeTurnId = null;
    this.activeCalleeTurnId = null;
    this.notify();
  }
}
