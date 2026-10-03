import { describe, it, expect } from "vitest";
import { TranscriptStore } from "../session/TranscriptStore";

describe("TranscriptStore", () => {
  it("builds a normal caller -> callee turn sequence", () => {
    const store = new TranscriptStore(performance.now());

    store.onCallerAudioActivity("caller");
    store.onCalleeUserTranscript("What time is breakfast?");
    store.onCalleeFirstAudioChunk();
    store.onCalleeAgentResponse("Breakfast is served from 7am.");

    const turns = store.getTurns();
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ speaker: "caller", text: "What time is breakfast?", status: "final" });
    expect(turns[1]).toMatchObject({ speaker: "callee", text: "Breakfast is served from 7am.", status: "live" });
    expect(typeof turns[1].latencyMs).toBe("number");
  });

  it("marks the callee's turn interrupted, then corrected", () => {
    const store = new TranscriptStore(performance.now());

    store.onCallerAudioActivity("caller");
    store.onCalleeUserTranscript("Can I check in late?");
    store.onCalleeFirstAudioChunk();
    store.onCalleeAgentResponse("Yes, you can check in at any");
    store.onCalleeInterruption();
    store.onCalleeAgentResponseCorrection("Yes, you can check in at any time, 24/7.");

    const turns = store.getTurns();
    const calleeTurn = turns.find((t) => t.speaker === "callee");
    expect(calleeTurn?.status).toBe("corrected");
    expect(calleeTurn?.text).toBe("Yes, you can check in at any time, 24/7.");
  });

  it("attributes a turn to the operator during push-to-talk", () => {
    const store = new TranscriptStore(performance.now());

    store.onCallerAudioActivity("operator");
    store.onCalleeUserTranscript("Is there parking?");

    const turns = store.getTurns();
    expect(turns[0].speaker).toBe("operator");
  });

  it("does not insert a second caller placeholder while one is already active", () => {
    const store = new TranscriptStore(performance.now());

    store.onCallerAudioActivity("caller");
    store.onCallerAudioActivity("caller");
    store.onCalleeUserTranscript("Hello?");

    expect(store.getTurns()).toHaveLength(1);
  });
});
