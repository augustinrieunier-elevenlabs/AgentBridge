import React, { useEffect, useRef, useState } from "react";
import type { Turn } from "../../../shared/types";
import { formatElapsed } from "../metrics";

function bubbleClass(turn: Turn): string {
  const side = turn.speaker === "callee" ? "right" : "left";
  return `bubble bubble-${side} bubble-${turn.speaker} status-${turn.status}`;
}

export function CenterTranscript({ turns, asrComparisonEnabled, expanded, onToggleExpanded }: { turns: Turn[]; asrComparisonEnabled: boolean; expanded: boolean; onToggleExpanded: () => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns, autoScroll]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  }

  return (
    <div className={`center-transcript ${expanded ? "center-transcript-expanded" : ""}`}>
      <div className="center-transcript-toolbar">
        <strong>Transcript (Callee's view)</strong>
        <button onClick={onToggleExpanded}>{expanded ? "Collapse" : "Expand"}</button>
      </div>
      <div className="center-transcript-scroll" ref={scrollRef} onScroll={onScroll}>
        {turns.map((turn) => (
          <div key={turn.id} className={bubbleClass(turn)} dir="auto">
            <div className="bubble-meta">
              <span className="bubble-speaker">{turn.speaker === "callee" ? "Callee" : turn.speaker === "operator" ? "Operator" : "Caller"}</span>
              <span className="bubble-time">{formatElapsed(turn.startedAt)}</span>
              {typeof turn.latencyMs === "number" && <span className="badge badge-latency">{Math.round(turn.latencyMs)} ms</span>}
              {turn.status === "interrupted" && <span className="badge badge-warn">interrupted</span>}
              {turn.status === "corrected" && <span className="badge badge-warn">corrected</span>}
            </div>
            <div className="bubble-text" dir="auto">
              {turn.text}
            </div>
            {asrComparisonEnabled && turn.callerIntended && turn.callerIntended !== turn.text && (
              <div className="bubble-asr-compare" dir="auto">
                Caller intended: {turn.callerIntended}
                <span className="badge badge-warn">ASR gap</span>
              </div>
            )}
          </div>
        ))}
        {turns.length === 0 && <p className="empty-state">The transcript will appear here once the call starts.</p>}
      </div>
      {!autoScroll && (
        <button
          className="back-to-live"
          onClick={() => {
            setAutoScroll(true);
          }}
        >
          Back to live
        </button>
      )}
    </div>
  );
}
