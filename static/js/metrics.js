/** Pure helpers to compute the metrics shown in the Callee column (spec-agent-bridge-demo.md section 10). */
(function () {
  function computeCalleeLatencyStats(turns) {
    const latencies = turns.filter((t) => t.speaker === "callee" && typeof t.latencyMs === "number").map((t) => t.latencyMs);
    if (latencies.length === 0) return {};
    const avgMs = latencies.reduce((sum, v) => sum + v, 0) / latencies.length;
    const maxMs = Math.max(...latencies);
    return { avgMs, maxMs };
  }

  function formatElapsed(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(totalSec / 60).toString().padStart(2, "0");
    const s = (totalSec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

  window.AB.computeCalleeLatencyStats = computeCalleeLatencyStats;
  window.AB.formatElapsed = formatElapsed;
})();
