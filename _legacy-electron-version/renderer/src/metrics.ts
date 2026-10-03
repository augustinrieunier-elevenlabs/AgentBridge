/** Pure helpers to compute the metrics shown in the Appelé column (spec-agent-bridge-demo.md section 10). */
import type { Turn } from "../../shared/types";

export type CalleeLatencyStats = { avgMs?: number; maxMs?: number };

export function computeCalleeLatencyStats(turns: Turn[]): CalleeLatencyStats {
  const latencies = turns.filter((t) => t.speaker === "callee" && typeof t.latencyMs === "number").map((t) => t.latencyMs as number);
  if (latencies.length === 0) return {};
  const avgMs = latencies.reduce((sum, v) => sum + v, 0) / latencies.length;
  const maxMs = Math.max(...latencies);
  return { avgMs, maxMs };
}

export function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60)
    .toString()
    .padStart(2, "0");
  const s = (totalSec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}
