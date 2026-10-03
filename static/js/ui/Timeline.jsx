(function () {
  /** Two-track timeline of turns, interruptions highlighted (spec-agent-bridge-demo.md section 10). */
  function Timeline({ turns, elapsedMs }) {
    const totalMs = Math.max(elapsedMs, 1000);
    const track = (speaker) =>
      turns
        .filter((t) => (speaker === "callee" ? t.speaker === "callee" : t.speaker === "caller" || t.speaker === "operator"))
        .map((t) => {
          const left = (t.startedAt / totalMs) * 100;
          const width = Math.max(0.5, (((t.endedAt || t.startedAt + 1000) - t.startedAt) / totalMs) * 100);
          return (
            <div
              key={t.id}
              className={`timeline-segment ${t.status === "interrupted" ? "timeline-segment-interrupted" : ""} ${t.speaker === "operator" ? "timeline-segment-operator" : ""}`}
              style={{ left: `${left}%`, width: `${width}%` }}
              title={t.text}
            />
          );
        });

    return (
      <div className="timeline">
        <div className="timeline-track">
          <span className="timeline-label">Caller / Operator</span>
          <div className="timeline-lane">{track("caller-side")}</div>
        </div>
        <div className="timeline-track">
          <span className="timeline-label">Callee</span>
          <div className="timeline-lane">{track("callee")}</div>
        </div>
      </div>
    );
  }

  window.AB.ui.Timeline = Timeline;
})();
