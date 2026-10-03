/**
 * Orchestrates the two AgentSessions, their Pacers, local playback and the
 * operator controls (push-to-talk, takeover, pause, contextual nudge) --
 * spec-agent-bridge-demo.md sections 7 and 9.
 */
import type { Account, AgentRef, BridgeApi, Scenario, Turn } from "../../../shared/types";
import { AudioBus, AudioChannel } from "../audio/Player";
import { Pacer } from "../audio/Pacer";
import { isSilentFrame, silenceFrame } from "../audio/pcm";
import { MicCapture } from "../audio/mic";
import { AgentSession } from "./AgentSession";
import { buildCalleeOverride, buildCallerOverride } from "../scenario/promptBuilder";
import { buildDynamicVariables } from "../scenario/dynamicVariables";
import { TranscriptStore } from "./TranscriptStore";
import type { ServerEvent } from "./wsProtocol";
import { computeCalleeLatencyStats } from "../metrics";

export type BridgeStatus = "idle" | "connecting" | "live" | "ended";
export type DebugLogEntry = { at: number; agent: "caller" | "callee"; summary: string };
export type BridgeMetrics = {
  elapsedSec: number;
  calleeLatencyAvgMs?: number;
  calleeLatencyMaxMs?: number;
  callerQueueMs: number;
  calleeQueueMs: number;
};

export type BridgeEvents = {
  onStatusChange?: (status: BridgeStatus) => void;
  onTranscriptUpdate?: (turns: Turn[]) => void;
  onDebugLog?: (entry: DebugLogEntry) => void;
  onMetrics?: (metrics: BridgeMetrics) => void;
  onEnded?: (reason: string) => void;
  onDeadlock?: () => void;
  onConversationIds?: (callerConversationId: string | null, calleeConversationId: string | null) => void;
  onVadScore?: (agent: "caller" | "callee", score: number) => void;
};

const SILENCE_THRESHOLD_ABS = 60;
const DEADLOCK_SILENCE_MS = 15000;

export class Bridge {
  readonly transcriptStore: TranscriptStore;
  readonly audioBus = new AudioBus();

  private callerSession: AgentSession;
  private calleeSession: AgentSession;
  private callerToCalleePacer = new Pacer(100);
  private calleeToCallerPacer = new Pacer(100);
  private callerChannel: AudioChannel;
  private calleeChannel: AudioChannel;

  private mic: MicCapture | null = null;
  private pttActive = false;
  private takeoverActive = false;
  private bridgePaused = false;

  private calleeAudioActive = false;
  private calleeAudioWatchdog: ReturnType<typeof setTimeout> | null = null;
  private callerAudioActive = false;
  private callerAudioWatchdog: ReturnType<typeof setTimeout> | null = null;
  private operatorAudioActive = false;
  private operatorAudioWatchdog: ReturnType<typeof setTimeout> | null = null;

  private sessionStartedAt = 0;
  private lastAnyAudioAt = 0;
  private deadlockTimer: ReturnType<typeof setInterval> | null = null;
  private metricsTimer: ReturnType<typeof setInterval> | null = null;
  private maxDurationTimer: ReturnType<typeof setTimeout> | null = null;
  private status: BridgeStatus = "idle";
  private ended = false;

  constructor(private events: BridgeEvents) {
    this.callerSession = new AgentSession("caller", {
      onEvent: (e) => this.handleCallerEvent(e),
      onAudioFrame: (samples, isFinal) => this.onCallerAgentAudio(samples, isFinal),
      onStatusChange: () => {},
      onClose: (code, reason) => this.handleSessionClosed("caller", code, reason),
    });
    this.calleeSession = new AgentSession("callee", {
      onEvent: (e) => this.handleCalleeEvent(e),
      onAudioFrame: (samples, isFinal) => this.onCalleeAgentAudio(samples, isFinal),
      onInterruption: () => this.transcriptStore.onCalleeInterruption(),
      onStatusChange: () => {},
      onClose: (code, reason) => this.handleSessionClosed("callee", code, reason),
    });

    this.callerChannel = this.audioBus.createChannel(-1); // left
    this.calleeChannel = this.audioBus.createChannel(1); // right

    this.sessionStartedAt = performance.now();
    this.transcriptStore = new TranscriptStore(this.sessionStartedAt);
    this.transcriptStore.subscribe((turns) => this.events.onTranscriptUpdate?.(turns));
  }

  private setStatus(status: BridgeStatus): void {
    this.status = status;
    this.events.onStatusChange?.(status);
  }

  private log(agent: "caller" | "callee", summary: string): void {
    this.events.onDebugLog?.({ at: performance.now() - this.sessionStartedAt, agent, summary });
  }

  // ---- lifecycle ---------------------------------------------------------

  async start(args: {
    api: Pick<BridgeApi, "session">;
    accounts: Account[];
    callerAgent: AgentRef;
    calleeAgent: AgentRef;
    scenario: Scenario;
  }): Promise<void> {
    await this.audioBus.resume();
    this.setStatus("connecting");

    const [callerUrl, calleeUrl] = await Promise.all([
      args.api.session.getSignedUrl(args.callerAgent.accountId, args.callerAgent.agentId),
      args.api.session.getSignedUrl(args.calleeAgent.accountId, args.calleeAgent.agentId),
    ]);

    const callerOverride = buildCallerOverride(args.scenario);
    const calleeOverride = buildCalleeOverride(args.scenario);
    const dynamicVariables = buildDynamicVariables(args.scenario);

    await Promise.all([
      this.callerSession.connect(callerUrl.url, { override: callerOverride, dynamicVariables }),
      this.calleeSession.connect(calleeUrl.url, { override: calleeOverride }),
    ]);

    this.events.onConversationIds?.(this.callerSession.conversationId, this.calleeSession.conversationId);

    this.callerToCalleePacer.start((frame) => this.onCallerToCalleeTick(frame));
    this.calleeToCallerPacer.start((frame) => this.onCalleeToCallerTick(frame));

    this.lastAnyAudioAt = performance.now();
    this.deadlockTimer = setInterval(() => this.checkDeadlock(), 2000);
    this.metricsTimer = setInterval(() => this.emitMetrics(), 1000);

    if (args.scenario.maxDurationSec > 0) {
      this.maxDurationTimer = setTimeout(() => this.end("max_duration_reached"), args.scenario.maxDurationSec * 1000);
    }

    this.setStatus("live");
  }

  end(reason: string): void {
    if (this.ended) return;
    this.ended = true;

    this.callerToCalleePacer.stop();
    this.calleeToCallerPacer.stop();
    if (this.deadlockTimer) clearInterval(this.deadlockTimer);
    if (this.metricsTimer) clearInterval(this.metricsTimer);
    if (this.maxDurationTimer) clearTimeout(this.maxDurationTimer);
    this.mic?.stop();

    this.callerSession.close();
    this.calleeSession.close();

    this.setStatus("ended");
    this.events.onEnded?.(reason);
  }

  private handleSessionClosed(agent: "caller" | "callee", code: number, reason: string): void {
    this.log(agent, `websocket closed (code=${code}${reason ? `, reason=${reason}` : ""})`);
    if (!this.ended) this.end(`${agent}_websocket_closed`);
  }

  // ---- events from the two websockets ------------------------------------

  private handleCallerEvent(event: ServerEvent): void {
    if (event.type === "agent_response") {
      this.transcriptStore.onCallerOwnUtterance((event as any).agent_response_event.agent_response);
    }
    if (event.type === "client_tool_call") {
      this.log("caller", `tool call: ${(event as any).client_tool_call?.tool_name}`);
    }
    if (event.type === "vad_score") {
      this.events.onVadScore?.("caller", (event as any).vad_score_event.vad_score);
    }
    if (event.type !== "audio" && event.type !== "ping" && event.type !== "vad_score") {
      this.log("caller", event.type);
    }
  }

  private handleCalleeEvent(event: ServerEvent): void {
    switch (event.type) {
      case "user_transcript":
        this.transcriptStore.onCalleeUserTranscript((event as any).user_transcription_event.user_transcript);
        break;
      case "agent_response":
        this.transcriptStore.onCalleeAgentResponse((event as any).agent_response_event.agent_response);
        break;
      case "agent_response_correction":
        this.transcriptStore.onCalleeAgentResponseCorrection((event as any).agent_response_correction_event.corrected_agent_response);
        break;
      case "client_tool_call":
        this.log("callee", `tool call: ${(event as any).client_tool_call?.tool_name}`);
        break;
      case "vad_score":
        this.events.onVadScore?.("callee", (event as any).vad_score_event.vad_score);
        break;
      default:
        break;
    }
    if (event.type !== "audio" && event.type !== "ping" && event.type !== "vad_score") {
      this.log("callee", event.type);
    }
  }

  // ---- audio received directly from each agent's websocket --------------

  private onCallerAgentAudio(samples: Int16Array, isFinal: boolean): void {
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

  private onCalleeAgentAudio(samples: Int16Array, isFinal: boolean): void {
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

  // ---- paced relay ticks --------------------------------------------------

  private onCallerToCalleeTick(frame: Int16Array): void {
    this.calleeSession.sendAudioFrame(frame);
    this.callerChannel.playFrame(frame);
  }

  private onCalleeToCallerTick(frame: Int16Array): void {
    this.calleeChannel.playFrame(frame);
    const muteToCaller = this.pttActive || this.takeoverActive || this.bridgePaused;
    this.callerSession.sendAudioFrame(muteToCaller ? silenceFrame(frame.length) : frame);
  }

  private emitMetrics(): void {
    const stats = computeCalleeLatencyStats(this.transcriptStore.getTurns());
    this.events.onMetrics?.({
      elapsedSec: (performance.now() - this.sessionStartedAt) / 1000,
      calleeLatencyAvgMs: stats.avgMs,
      calleeLatencyMaxMs: stats.maxMs,
      callerQueueMs: (this.callerToCalleePacer.queuedSampleCount / 16000) * 1000,
      calleeQueueMs: (this.calleeToCallerPacer.queuedSampleCount / 16000) * 1000,
    });
  }

  private checkDeadlock(): void {
    if (this.status !== "live") return;
    if (performance.now() - this.lastAnyAudioAt > DEADLOCK_SILENCE_MS) {
      this.events.onDeadlock?.();
    }
  }

  // ---- operator controls (spec-agent-bridge-demo.md section 7.4) --------

  async startPushToTalk(): Promise<void> {
    if (this.pttActive || this.takeoverActive) return;
    this.pttActive = true;
    await this.ensureMic();
  }

  stopPushToTalk(): void {
    if (!this.pttActive) return;
    this.pttActive = false;
    if (!this.takeoverActive) this.mic?.stop();
  }

  async setTakeover(active: boolean): Promise<void> {
    this.takeoverActive = active;
    if (active) await this.ensureMic();
    else if (!this.pttActive) this.mic?.stop();
  }

  setBridgePaused(paused: boolean): void {
    this.bridgePaused = paused;
  }

  sendContextualNudge(text: string): void {
    this.callerSession.sendContextualUpdate(text);
    this.log("caller", `operator nudge: ${text}`);
  }

  setCallerVolume(volume: number): void {
    this.callerChannel.setVolume(volume);
  }
  setCalleeVolume(volume: number): void {
    this.calleeChannel.setVolume(volume);
  }
  setCallerMuted(muted: boolean): void {
    this.callerChannel.setMuted(muted);
  }
  setCalleeMuted(muted: boolean): void {
    this.calleeChannel.setMuted(muted);
  }

  async setOutputDevice(deviceId: string | undefined): Promise<void> {
    await this.audioBus.setOutputDevice(deviceId);
  }

  get callerConversationId(): string | null {
    return this.callerSession.conversationId;
  }
  get calleeConversationId(): string | null {
    return this.calleeSession.conversationId;
  }

  private async ensureMic(): Promise<void> {
    if (!this.mic) {
      this.mic = new MicCapture(this.audioBus.context, (samples) => this.onMicChunk(samples));
    }
    if (!this.mic.isActive) await this.mic.start();
  }

  private onMicChunk(samples: Int16Array): void {
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
