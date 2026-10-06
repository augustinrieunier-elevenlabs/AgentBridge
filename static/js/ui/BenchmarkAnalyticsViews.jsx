/**
 * Shared presentational components for a latency-analysis `result`: { variants: [...] }, each
 * variant shaped { variantId, label, asr, perNode, scenarioRuns }. See session/BenchmarkRunner.js
 * for how a Benchmark run builds this, and session/GlobalAnalytics.js for how the cross-feature
 * Analytics view (History → Analytics) builds the same shape by harmonizing session/batch/benchmark
 * history by (llm, tts) config instead of by benchmark-defined variant. Both consumers
 * (ui/BenchmarkSession.jsx and ui/AnalyticsPanel.jsx) render the exact same tables/chart from here
 * so the two views read identically regardless of which feature produced the underlying data.
 */
(function () {
  const { combineNodeStats, NORMAL_END_REASONS } = window.AB.session.BenchmarkRunner;

  function formatMs(valueSec) {
    return valueSec == null ? "—" : `${Math.round(valueSec * 1000)} ms`;
  }

  /** Call duration in seconds -> "37s" / "1m 15s" -- distinct from formatMs (which treats its input
   * as sub-second latency) since a whole conversation's duration is always several seconds at
   * least, where "37000 ms" would read far worse than "37s". */
  function formatDuration(valueSec) {
    if (valueSec == null) return "—";
    const total = Math.round(valueSec);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  /** A plain count (turns) -- one decimal place so an average like "4.3 turns" stays meaningful,
   * while min/max (always whole turns) round cleanly back down to integers. */
  function formatCount(value) {
    return value == null ? "—" : (Math.round(value * 10) / 10).toString();
  }

  /** Token counts: thousands separator, no decimals -- a fractional token average reads as noise. */
  function formatTokens(value) {
    return value == null ? "—" : Math.round(value).toLocaleString();
  }

  // `nodeNames` (workflow node id -> {label, type}) is optional everywhere it's passed -- older
  // runs/exports predating this lookup, or a run whose live resolution hasn't landed yet, simply
  // fall back to the raw id (exactly what every node looked like before this existed), never a
  // blank/broken cell.
  function nodeLabel(nodeId, nodeNames) {
    const info = nodeNames && nodeNames[nodeId];
    return (info && info.label) || nodeId;
  }

  function nodeTitle(nodeId, nodeNames) {
    const info = nodeNames && nodeNames[nodeId];
    return info ? `id: ${nodeId}${info.type ? `, type: ${info.type}` : ""}` : nodeId;
  }

  /** Wraps one analytics section in a collapsible "card" -- a single benchmark/Analytics page can
   * stack a dozen+ of these (node coverage, stacked chart, a results table per node...), so
   * collapsing the ones you're not looking at is the difference between scrolling past everything
   * every time and actually navigating. Only the title (icon + text) toggles the body; `headerExtra`
   * (e.g. NodeCoverageMatrix/StackedLatencyChart's sort buttons) stays a normal sibling in the same
   * `.card-row`, unaffected by and not triggering the toggle, so it's still usable without first
   * expanding anything. Defaults open so nothing changes for anyone who never touches the toggle. */
  function CollapsibleCard({ title, headerExtra, defaultOpen = true, children }) {
    const { useState } = React;
    const [open, setOpen] = useState(defaultOpen);
    return (
      <div className="card">
        <div className="card-row">
          <strong className="collapsible-title" onClick={() => setOpen((o) => !o)}>
            <span className={`collapsible-caret${open ? " open" : ""}`}>▸</span> {title}
          </strong>
          {headerExtra}
        </div>
        {open && children}
      </div>
    );
  }

  // Matches --ok/--warn/--fail from styles.css, for a continuous coverage-ratio gradient (see
  // NodeCoverageMatrix's Total row) where the binary badge-ok/badge-warn classes aren't granular
  // enough to tell "almost full coverage" apart from "barely any" across many variant columns.
  const OK_RGB = [31, 107, 58];
  const WARN_RGB = [138, 91, 8];
  const FAIL_RGB = [154, 45, 33];

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function lerpColor(c1, c2, t) {
    return `rgb(${Math.round(lerp(c1[0], c2[0], t))}, ${Math.round(lerp(c1[1], c2[1], t))}, ${Math.round(lerp(c1[2], c2[2], t))})`;
  }

  /** ratio = visitedCount/totalNodes, 1 = every node visited (green) down to 0 (red), amber midway. */
  function coverageColor(ratio) {
    if (ratio >= 1) return `rgb(${OK_RGB.join(", ")})`;
    if (ratio >= 0.5) return lerpColor(WARN_RGB, OK_RGB, (ratio - 0.5) / 0.5);
    return lerpColor(FAIL_RGB, WARN_RGB, ratio / 0.5);
  }

  /** Simple stat cell for a value that's always expected to exist (e.g. the global ASR row, where
   * every variant always has caller turns) -- no "was this even reached" ambiguity to resolve. */
  function StatCell({ stat, format = formatMs }) {
    if (!stat) return <span className="muted small">n/a</span>;
    return (
      <span title={`${stat.n} sample${stat.n === 1 ? "" : "s"}`}>
        {format(stat.avg)} <span className="muted small">({format(stat.min)}–{format(stat.max)})</span>
      </span>
    );
  }

  /**
   * Per-node stat cell. A node can be missing data for two very different reasons that used to
   * render identically as a blank cell: the variant's calls never routed through this node at all
   * (e.g. a weaker LLM took a different branch than another variant for the same scenario -- a real
   * finding, not a bug), or the node WAS visited but the platform hadn't finished finalizing
   * conversation_turn_metrics for that turn yet (see BenchmarkRunner.js refreshRunStats / the
   * Session "Refresh stats" button). `nodeStats` is undefined for the first case and an object
   * (possibly with a null `stat`) for the second -- see extractMetricsFromConversation's turnCount.
   */
  function NodeStatCell({ stat, nodeStats }) {
    if (!nodeStats) {
      return (
        <span className="muted small" title="None of this variant's calls routed through this node.">
          not visited
        </span>
      );
    }
    if (!stat) {
      return (
        <span
          className="muted small"
          title={`Visited ${nodeStats.turnCount || "some"} time${nodeStats.turnCount === 1 ? "" : "s"}, but no timing landed here for this metric -- may be normal (e.g. no retrieval happened), or try "Refresh stats" if the run just finished.`}
        >
          n/a
        </span>
      );
    }
    return <StatCell stat={stat} />;
  }

  /** All-nodes-combined min/max/avg per variant for ASR/LLM/TTS. Derived from `v.perNode` at
   * display time (combineNodeStats), not from a stored field -- so this is correct immediately for
   * every run, including ones saved before this table existed, with no "Refresh stats" needed. A
   * node a variant never visited simply isn't in `perNode` and correctly contributes nothing. */
  function GlobalStatsTable({ result, showAsr = true }) {
    return (
      <CollapsibleCard title="Global stats -- all nodes combined">
        <table className="table">
          <thead>
            <tr>
              <th>Variant</th>
              {showAsr && <th>ASR (avg / min–max)</th>}
              <th>LLM (avg / min–max)</th>
              <th>TTS (avg / min–max)</th>
              <th title="Number of 'agent' turns per conversation -- a model that needs more back-and-forth to get through the same scenario, or is simply more verbose, shows up here.">
                Turns (avg / min–max)
              </th>
              <th>Duration (avg / min–max)</th>
              <th title="Total LLM tokens (input + cached + output) actually billed for the whole conversation -- a rough cost/efficiency indicator, independent of raw latency.">
                Tokens (avg / min–max)
              </th>
            </tr>
          </thead>
          <tbody>
            {result.variants.map((v) => (
              <tr key={v.variantId}>
                <td>{v.label}</td>
                {showAsr && (
                  <td>
                    <StatCell stat={v.asr} />
                  </td>
                )}
                <td>
                  <StatCell stat={combineNodeStats(v.perNode, "llm")} />
                </td>
                <td>
                  <StatCell stat={combineNodeStats(v.perNode, "tts")} />
                </td>
                <td>
                  <StatCell stat={v.conversationStats && v.conversationStats.turnCount} format={formatCount} />
                </td>
                <td>
                  <StatCell stat={v.conversationStats && v.conversationStats.durationSecs} format={formatDuration} />
                </td>
                <td>
                  <StatCell stat={v.conversationStats && v.conversationStats.totalTokens} format={formatTokens} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CollapsibleCard>
    );
  }

  // A node's turnCount well below what another variant achieved in the SAME node is the second
  // divergence signal (see LOW_TURN_COUNT_RATIO below): a variant can be attributed a node at all
  // (passes the presence check) and still have gotten far less done there before stalling -- exactly
  // what a deadlock_timeout mid-node looks like. Calibrated against a real run (2026-10-03): 6
  // variants that deadlocked mid-node showed turnCount 4-6 there, against 10 for the one variant
  // that completed the same node normally.
  //
  // Gated on NORMAL_END_REASONS, not applied unconditionally: a benchmark with several DIFFERENT
  // scenarios naturally produces real, legitimate turnCount variance per node between variants
  // (different scenarios ask different questions, routing different numbers of times through a
  // given node) -- checked against a second real run with 3 distinct scenarios, all of which closed
  // normally, and the unconditional ratio check flagged over a dozen cells that were just ordinary
  // variance, not stalls. Restricting the flag to variants that had at least one scenario end
  // abnormally ties it to an observed problem instead of inferring one from statistics alone, and
  // eliminated every false positive in that comparison.
  const LOW_TURN_COUNT_RATIO = 0.7;

  /**
   * For the same scenarios, every variant should in principle route through the same workflow
   * nodes -- the caller follows the same script either way. Two different ways a variant can
   * diverge from that, both independent of (and often more informative than) the latency numbers
   * above:
   *   - a node another variant visited that this one never reaches at all (✗) -- a routing/behavior
   *     change from the model/TTS swap, not a timing gap (see NodeStatCell's "not visited" vs "n/a").
   *   - for a variant that had a scenario end abnormally (deadlock_timeout, max_duration_reached, a
   *     failed start -- anything other than a clean websocket close): a node it DOES reach, but with
   *     notably fewer turns than another variant achieved there (⚠) -- a likely clue to WHERE it
   *     stalled, not just THAT it did.
   * Rows = nodes, columns = variants, so either kind of divergence reads as a single flagged cell in
   * an otherwise-clean column rather than being buried in six separate per-node tables below.
   */
  const COVERAGE_SORT_OPTIONS = [
    { value: "label", label: "A→Z" },
    { value: "coverage-desc", label: "Coverage ↓" },
    { value: "coverage-asc", label: "Coverage ↑" },
  ];
  // Beyond this many columns a single table gets wider than it's useful (a 20+-variant benchmark
  // scrolls off-screen and loses the "scan a row" readability this matrix is for) -- wrap into
  // several same-width tables instead, each capped at this many variant columns.
  const MAX_COVERAGE_COLUMNS = 7;
  // Fixed per-column widths (see .coverage-table in styles.css) so every chunk's Node column and
  // variant columns line up at the exact same width, instead of each chunk's table sizing its own
  // columns off its own content/column count.
  const COVERAGE_NODE_COL_PX = 220;
  const COVERAGE_VARIANT_COL_PX = 160;

  function NodeCoverageMatrix({ result, nodeNames }) {
    const { useState } = React;
    const [sortOrder, setSortOrder] = useState("label");

    const allNodeIds = Array.from(new Set(result.variants.flatMap((v) => Object.keys(v.perNode)))).sort();
    if (allNodeIds.length === 0) return null;

    const maxTurnCountByNode = {};
    for (const nodeId of allNodeIds) {
      maxTurnCountByNode[nodeId] = Math.max(...result.variants.map((v) => (v.perNode[nodeId] && v.perNode[nodeId].turnCount) || 0));
    }

    const hadAbnormalEnd = (v) => (v.scenarioRuns || []).some((r) => !NORMAL_END_REASONS.has(r.endReason));
    const isThin = (v, nodeId) => {
      const stats = v.perNode[nodeId];
      const maxForNode = maxTurnCountByNode[nodeId];
      return Boolean(stats) && hadAbnormalEnd(v) && maxForNode > 1 && stats.turnCount / maxForNode < LOW_TURN_COUNT_RATIO;
    };

    const coverageByVariantId = new Map(
      result.variants.map((v) => {
        const visitedCount = allNodeIds.filter((id) => v.perNode[id]).length;
        const lowTurnCount = allNodeIds.filter((id) => isThin(v, id)).length;
        return [v.variantId, { visitedCount, lowTurnCount, clean: visitedCount === allNodeIds.length && lowTurnCount === 0 }];
      }),
    );

    const sortedVariants = [...result.variants].sort((a, b) => {
      if (sortOrder === "label") return a.label.localeCompare(b.label);
      const diff = coverageByVariantId.get(a.variantId).visitedCount - coverageByVariantId.get(b.variantId).visitedCount;
      return sortOrder === "coverage-asc" ? diff : -diff;
    });
    const coverage = sortedVariants.map((v) => ({ variantId: v.variantId, label: v.label, ...coverageByVariantId.get(v.variantId) }));
    const anyMismatch = coverage.some((c) => !c.clean);

    const chunks = [];
    for (let i = 0; i < sortedVariants.length; i += MAX_COVERAGE_COLUMNS) {
      chunks.push({ variants: sortedVariants.slice(i, i + MAX_COVERAGE_COLUMNS), coverage: coverage.slice(i, i + MAX_COVERAGE_COLUMNS) });
    }

    return (
      <CollapsibleCard
        title="Node coverage -- did every variant reach the same nodes, the same number of times?"
        headerExtra={
          <div className="stacked-chart-sort">
            {COVERAGE_SORT_OPTIONS.map((opt) => (
              <button key={opt.value} className={sortOrder === opt.value ? "active" : ""} onClick={() => setSortOrder(opt.value)}>
                {opt.label}
              </button>
            ))}
          </div>
        }
      >
        <p className="panel-help">
          Every variant runs the same scenarios, so it should visit the same nodes about as many times. ✗ means that variant's calls never routed through this node at all -- a routing/behavior
          change from the model/TTS swap, not a timing gap. ⚠ (only shown for a variant that had a scenario end abnormally) means it DID reach the node but did notably less there than another
          variant managed before stopping -- hover a cell for the exact turn counts; often a clue to where it stalled. Either way, treat that variant as less reliable for this agent and worth a
          closer manual look, regardless of how its latency numbers compare.
        </p>
        {!anyMismatch && <p className="panel-help">✅ Full parity -- every variant visited every node that any variant visited, with no sign of stalling partway through one.</p>}
        {chunks.map((chunk, chunkIdx) => (
          <div key={chunkIdx} style={{ overflowX: "auto", marginTop: chunkIdx > 0 ? "12px" : 0 }}>
            <table className="table coverage-table">
              <colgroup>
                <col style={{ width: COVERAGE_NODE_COL_PX }} />
                {chunk.coverage.map((c) => (
                  <col key={c.variantId} style={{ width: COVERAGE_VARIANT_COL_PX }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th>Node</th>
                  {chunk.coverage.map((c) => (
                    <th key={c.variantId} title={c.label}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {allNodeIds.map((nodeId) => {
                  const maxForNode = maxTurnCountByNode[nodeId];
                  return (
                    <tr key={nodeId}>
                      <td title={nodeTitle(nodeId, nodeNames)}>{nodeLabel(nodeId, nodeNames)}</td>
                      {chunk.variants.map((v) => {
                        const stats = v.perNode[nodeId];
                        if (!stats) {
                          return (
                            <td key={v.variantId}>
                              <span className="badge badge-fail" title="Never visited">
                                ✗
                              </span>
                            </td>
                          );
                        }
                        const low = isThin(v, nodeId);
                        return (
                          <td key={v.variantId}>
                            <span
                              className={`badge ${low ? "badge-warn" : "badge-ok"}`}
                              title={low ? `${stats.turnCount} turn${stats.turnCount === 1 ? "" : "s"} here, vs up to ${maxForNode} elsewhere` : `${stats.turnCount} turn${stats.turnCount === 1 ? "" : "s"}`}
                            >
                              {low ? "⚠" : "✓"}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                <tr>
                  <td>
                    <strong>Total</strong>
                  </td>
                  {chunk.coverage.map((c) => {
                    const ratio = c.visitedCount / allNodeIds.length;
                    return (
                      <td key={c.variantId}>
                        <span
                          className="badge"
                          style={{ background: coverageColor(ratio), color: "var(--accent-foreground)" }}
                          title={`${Math.round(ratio * 100)}% of nodes visited`}
                        >
                          {c.visitedCount}/{allNodeIds.length} visited{c.lowTurnCount > 0 ? `, ${c.lowTurnCount} thin` : ""}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        ))}
      </CollapsibleCard>
    );
  }

  // ASR uses --operator (violet), freed up now that LLM is gradient-colored by node coverage
  // instead of a fixed swatch -- keeps every segment visually distinct (TTS blue, ASR violet, LLM
  // green/amber/red), where ASR previously used an orange that could be confused for the LLM
  // segment's warn/fail range.
  const CHART_SERIES = [
    { key: "asr", label: "ASR", cssVar: "--operator" },
    { key: "llm", label: "LLM", cssVar: null },
    { key: "tts", label: "TTS", cssVar: "--callee" },
  ];
  const CHART_AXIS_FRACTIONS = [0, 0.25, 0.5, 0.75, 1];

  /** Horizontal stacked bar chart of average ASR + LLM + TTS (not RAG -- the spec excludes it
   * here, since stacking it alongside the others would double-count: a RAG lookup happens as part
   * of an LLM turn, not as a separate step in the round trip). One row per variant -- horizontal
   * reads much better than vertical columns once labels get as long as "V3 Conversational +
   * qwen35-397b-a17b": the label sits beside its own full-width row instead of squeezed under a
   * narrow column. X axis = duration, Y axis = the TTS/LLM variant pairs, with a 5-tick scale
   * (0/25/50/75/100% of the longest total) under the bars. Plain CSS grid/flex, no charting
   * library, consistent with this app's no-build-step/CDN-only dependency policy. */
  const SORT_OPTIONS = [
    { value: "none", label: "As run" },
    { value: "latency-asc", label: "Latency ↑" },
    { value: "latency-desc", label: "Latency ↓" },
    { value: "coverage-asc", label: "Coverage ↑" },
    { value: "coverage-desc", label: "Coverage ↓" },
  ];

  function StackedLatencyChart({ result, showAsr = true }) {
    const { useState } = React;
    const [sortOrder, setSortOrder] = useState("none");

    // ASR is excluded (not just hidden) from the "pure LLM performance" view (AnalyticsPanel's
    // breakdown-by-TTS toggle off) -- otherwise a bar's displayed total/sort order would silently
    // include a number no longer shown anywhere on it.
    const series = showAsr ? CHART_SERIES : CHART_SERIES.filter((s) => s.key !== "asr");

    // Same coverage ratio as NodeCoverageMatrix's Total row, so the LLM segment's color means the
    // same thing in both places: how much of this agent's workflow this variant actually exercised.
    const allNodeIds = Array.from(new Set(result.variants.flatMap((v) => Object.keys(v.perNode))));
    const bars = result.variants.map((v) => {
      const llm = combineNodeStats(v.perNode, "llm");
      const tts = combineNodeStats(v.perNode, "tts");
      const values = { asr: (v.asr && v.asr.avg) || 0, llm: (llm && llm.avg) || 0, tts: (tts && tts.avg) || 0 };
      const total = series.reduce((sum, s) => sum + values[s.key], 0);
      const coverageRatio = allNodeIds.length > 0 ? allNodeIds.filter((id) => v.perNode[id]).length / allNodeIds.length : 1;
      return { key: v.variantId, label: v.label, ...values, total, coverageRatio };
    });
    if (sortOrder === "latency-asc") bars.sort((a, b) => a.total - b.total);
    else if (sortOrder === "latency-desc") bars.sort((a, b) => b.total - a.total);
    else if (sortOrder === "coverage-asc") bars.sort((a, b) => a.coverageRatio - b.coverageRatio);
    else if (sortOrder === "coverage-desc") bars.sort((a, b) => b.coverageRatio - a.coverageRatio);
    const maxTotal = Math.max(1e-9, ...bars.map((b) => b.total));
    const axisTicks = CHART_AXIS_FRACTIONS.map((f) => f * maxTotal);

    return (
      <CollapsibleCard
        title={`Average latency per variant -- ${series.map((s) => s.label).join(" + ")} stacked (all nodes combined)`}
        headerExtra={
          <div className="stacked-chart-sort">
            {SORT_OPTIONS.map((opt) => (
              <button key={opt.value} className={sortOrder === opt.value ? "active" : ""} onClick={() => setSortOrder(opt.value)}>
                {opt.label}
              </button>
            ))}
          </div>
        }
      >
        <div className="stacked-chart-legend">
          {series.map((s) => {
            const isLlm = s.key === "llm";
            const background = isLlm ? `linear-gradient(90deg, rgb(${FAIL_RGB.join(", ")}), rgb(${WARN_RGB.join(", ")}), rgb(${OK_RGB.join(", ")}))` : `var(${s.cssVar})`;
            return (
              <span key={s.key} className="stacked-chart-legend-item">
                <span className="stacked-chart-swatch" style={{ background }} />
                {s.label}
                {isLlm && <span className="muted small"> (node coverage: green = all nodes, red = fewest)</span>}
              </span>
            );
          })}
        </div>
        <div className="stacked-chart-h">
          {bars.map((b) => (
            <React.Fragment key={b.key}>
              <div className="stacked-chart-h-label small">{b.label}</div>
              <div className="stacked-chart-h-track">
                {series.map((s) => {
                  const value = b[s.key];
                  const width = (value / maxTotal) * 100;
                  const isLlm = s.key === "llm";
                  const background = isLlm ? coverageColor(b.coverageRatio) : `var(${s.cssVar})`;
                  const title = isLlm ? `${s.label}: ${formatMs(value)} -- ${Math.round(b.coverageRatio * 100)}% of nodes visited` : `${s.label}: ${formatMs(value)}`;
                  return <div key={s.key} className="stacked-chart-h-segment" title={title} style={{ width: `${width}%`, background }} />;
                })}
                <span className="stacked-chart-h-total small muted" style={{ left: `calc(${(b.total / maxTotal) * 100}% + 6px)` }}>
                  {formatMs(b.total)}
                </span>
              </div>
            </React.Fragment>
          ))}
          <div />
          <div className="stacked-chart-h-axis">
            {axisTicks.map((t, i) => (
              <span key={i} className="small muted">
                {formatMs(t)}
              </span>
            ))}
          </div>
        </div>
      </CollapsibleCard>
    );
  }

  function ResultsTables({ result, nodeNames }) {
    const nodeIds = Array.from(new Set(result.variants.flatMap((v) => Object.keys(v.perNode)))).sort();
    return (
      <div>
        <CollapsibleCard title="ASR time -- global, across all of the caller's turns">
          <table className="table">
            <thead>
              <tr>
                <th>Variant</th>
                <th>ASR (avg / min–max)</th>
              </tr>
            </thead>
            <tbody>
              {result.variants.map((v) => (
                <tr key={v.variantId}>
                  <td>{v.label}</td>
                  <td>
                    <StatCell stat={v.asr} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CollapsibleCard>

        {nodeIds.length === 0 && <p className="panel-help">No per-node data found in the collected conversations -- the workflow may not have reported node ids for these turns.</p>}

        {nodeIds.map((nodeId) => (
          // Collapsed by default -- these are the most granular, least-often-needed-at-a-glance
          // tables on the page (one per node, every one of them, regardless of how many), and the
          // card coverage matrix/stacked chart above already give the at-a-glance picture.
          <CollapsibleCard key={nodeId} title={<span title={nodeTitle(nodeId, nodeNames)}>Node: {nodeLabel(nodeId, nodeNames)}</span>} defaultOpen={false}>
            <table className="table">
              <thead>
                <tr>
                  <th>Variant</th>
                  <th>LLM (avg / min–max)</th>
                  <th>TTS (avg / min–max)</th>
                  <th>RAG (avg / min–max)</th>
                </tr>
              </thead>
              <tbody>
                {result.variants.map((v) => {
                  const nodeStats = v.perNode[nodeId];
                  return (
                    <tr key={v.variantId}>
                      <td>{v.label}</td>
                      <td>
                        <NodeStatCell stat={nodeStats && nodeStats.llm} nodeStats={nodeStats} />
                      </td>
                      <td>
                        <NodeStatCell stat={nodeStats && nodeStats.tts} nodeStats={nodeStats} />
                      </td>
                      <td>
                        <NodeStatCell stat={nodeStats && nodeStats.rag} nodeStats={nodeStats} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CollapsibleCard>
        ))}
      </div>
    );
  }

  // Plot geometry. The viewBox is large (and the chart renders at up to SCATTER_MAX_WIDTH, not a
  // small fixed box) because a real agent's history can carry dozens of LLM candidates (seen
  // 2026-10-06: ~39 on one agent) -- a small canvas crowds that many bubbles into illegibility
  // regardless of anything else. Height is a fraction of the rendered width (not fixed), via
  // `aspect-ratio` in CSS, so it scales down gracefully on a narrower screen too.
  const SCATTER_WIDTH = 1000;
  const SCATTER_HEIGHT = 580;
  const SCATTER_PAD = { top: 20, right: 24, bottom: 48, left: 64 };
  // Bubble radius spec (marks-and-anatomy.md): >= 8px marker floor. Kept modest at the top end
  // (vs. a smaller-candidate-count chart) specifically BECAUSE there can be dozens of points on
  // screen at once -- a larger max would make overlap worse, not clearer, at that density.
  const SCATTER_R_MIN = 9;
  const SCATTER_R_MAX = 26;
  const SCATTER_AXIS_TICKS = [0.25, 0.5, 0.75, 1];

  /**
   * One point per model (LLM candidate), positioning "how it behaves" (turns, duration) against
   * "how it performed" (reliability, as color) and "how much it cost" (tokens, as size) all at
   * once -- the four-variable comparison the per-model table above can't show in one glance.
   *
   * Color is the SAME green -> amber -> red reliability gradient used everywhere else in this app
   * (coverageColor, see NodeCoverageMatrix's Total row / StackedLatencyChart's LLM segment) -- a
   * reliability score is exactly a "good -> critical" status metric (dataviz skill's color-formula:
   * "when a series means good/bad ... it wears status tokens"), so this reuses that established
   * scale rather than inventing a new one, confirmed with the user 2026-10-06 ("la couleur ...
   * doit être alignée avec le résultat des tests").
   *
   * Radius encodes avg tokens via sqrt scaling (not linear) so the bubble's AREA -- what the eye
   * actually compares -- is proportional to the token count, not its radius.
   *
   * No always-on per-point label: with a real agent's history carrying dozens of candidates, static
   * labels on every bubble collide into unreadable text soup (confirmed with the user 2026-10-06,
   * who hit exactly this on real data). Identity instead comes from a real hover/focus tooltip
   * (dataviz skill's interaction.md: "each dot ... carries its own pointermove/focus tooltip ...
   * the hovered mark lifts") -- every value it shows is also a plain column in RankingTable above,
   * so nothing here is only reachable by hovering.
   */
  function ModelEfficiencyScatter({ candidates, title = "Model efficiency -- turns × duration × tokens, colored by reliability" }) {
    const { useState, useRef } = React;
    const containerRef = useRef(null);
    const [hovered, setHovered] = useState(null); // { point, left, top } in container-relative px

    const points = (candidates || [])
      .map((c) => {
        const stats = c.conversationStats || {};
        const x = stats.turnCount && stats.turnCount.avg;
        const y = stats.durationSecs && stats.durationSecs.avg;
        if (x == null || y == null) return null;
        const tokens = stats.totalTokens && stats.totalTokens.avg;
        return { id: c.id, x, y, tokens, reliability: c.reliability, hangupRate: c.hangupRate, coverage: c.coverage, sampleCount: c.sampleCount };
      })
      .filter(Boolean);

    function showTooltip(e, point) {
      const rect = containerRef.current.getBoundingClientRect();
      setHovered({ point, left: e.clientX - rect.left + 16, top: e.clientY - rect.top + 16 });
    }

    return (
      <CollapsibleCard title={title}>
        {points.length === 0 ? (
          <p className="panel-help">No model has both a turn-count and a duration figure yet -- run (or "Refresh stats" on) a benchmark that measures LLM variants to populate this.</p>
        ) : (
          <>
            <p className="panel-help">
              Each point is one model -- hover (or focus with Tab) a bubble for its name and exact figures. Position shows how it talks (fewer/more turns, shorter/longer calls); size shows average
              tokens spent per call; color shows reliability (hangup rate × workflow coverage) -- the same gradient as the Node coverage table above.
            </p>
            {(() => {
              const xs = points.map((p) => p.x);
              const ys = points.map((p) => p.y);
              const tokenValues = points.map((p) => p.tokens).filter((v) => v != null);
              const xMax = Math.max(1, ...xs) * 1.2;
              const yMax = Math.max(1, ...ys) * 1.2;
              const maxTokens = Math.max(1, ...tokenValues);
              const plotW = SCATTER_WIDTH - SCATTER_PAD.left - SCATTER_PAD.right;
              const plotH = SCATTER_HEIGHT - SCATTER_PAD.top - SCATTER_PAD.bottom;

              const px = (x) => SCATTER_PAD.left + (x / xMax) * plotW;
              const py = (y) => SCATTER_PAD.top + plotH - (y / yMax) * plotH;
              const radiusFor = (tokens) => {
                if (tokens == null) return (SCATTER_R_MIN + SCATTER_R_MAX) / 2;
                const frac = Math.sqrt(tokens / maxTokens);
                return SCATTER_R_MIN + frac * (SCATTER_R_MAX - SCATTER_R_MIN);
              };

              return (
                <>
                  <div className="scatter-chart-wrap" ref={containerRef}>
                    <div className="scatter-chart-aspect">
                    <svg viewBox={`0 0 ${SCATTER_WIDTH} ${SCATTER_HEIGHT}`} className="scatter-chart" role="img" aria-label={title}>
                      {/* Gridlines -- hairline, recessive, same one-step-off-surface treatment as every other chart here. */}
                      {SCATTER_AXIS_TICKS.map((f) => (
                        <line key={`vgrid-${f}`} x1={px(f * xMax)} y1={SCATTER_PAD.top} x2={px(f * xMax)} y2={SCATTER_PAD.top + plotH} className="scatter-gridline" />
                      ))}
                      {SCATTER_AXIS_TICKS.map((f) => (
                        <line key={`hgrid-${f}`} x1={SCATTER_PAD.left} y1={py(f * yMax)} x2={SCATTER_PAD.left + plotW} y2={py(f * yMax)} className="scatter-gridline" />
                      ))}
                      {/* Axes */}
                      <line x1={SCATTER_PAD.left} y1={SCATTER_PAD.top} x2={SCATTER_PAD.left} y2={SCATTER_PAD.top + plotH} className="scatter-axis" />
                      <line x1={SCATTER_PAD.left} y1={SCATTER_PAD.top + plotH} x2={SCATTER_PAD.left + plotW} y2={SCATTER_PAD.top + plotH} className="scatter-axis" />
                      {/* Axis tick labels */}
                      {SCATTER_AXIS_TICKS.map((f) => (
                        <text key={`vlabel-${f}`} x={px(f * xMax)} y={SCATTER_PAD.top + plotH + 16} className="scatter-tick-label" textAnchor="middle">
                          {formatCount(f * xMax)}
                        </text>
                      ))}
                      {SCATTER_AXIS_TICKS.map((f) => (
                        <text key={`hlabel-${f}`} x={SCATTER_PAD.left - 8} y={py(f * yMax) + 4} className="scatter-tick-label" textAnchor="end">
                          {formatDuration(f * yMax)}
                        </text>
                      ))}
                      {/* Axis titles */}
                      <text x={SCATTER_PAD.left + plotW / 2} y={SCATTER_HEIGHT - 8} className="scatter-axis-title" textAnchor="middle">
                        Avg turns per conversation →
                      </text>
                      <text x={14} y={SCATTER_PAD.top + plotH / 2} className="scatter-axis-title" textAnchor="middle" transform={`rotate(-90 14 ${SCATTER_PAD.top + plotH / 2})`}>
                        Avg duration →
                      </text>
                      {/* Points -- hit area wider than the painted bubble (interaction.md: never only the painted pixels); the hovered bubble "lifts" (bigger radius, brighter ring) so it's clear which one the tooltip describes. */}
                      {points.map((p) => {
                        const cx = px(p.x);
                        const cy = py(p.y);
                        const r = radiusFor(p.tokens);
                        const color = coverageColor(p.reliability == null ? 0 : p.reliability);
                        const isHovered = hovered && hovered.point.id === p.id;
                        return (
                          <g key={p.id}>
                            <circle
                              cx={cx}
                              cy={cy}
                              r={r + 14}
                              fill="transparent"
                              tabIndex={0}
                              onMouseEnter={(e) => showTooltip(e, p)}
                              onMouseMove={(e) => showTooltip(e, p)}
                              onMouseLeave={() => setHovered(null)}
                              onFocus={(e) => showTooltip(e, p)}
                              onBlur={() => setHovered(null)}
                              className="scatter-point-hit"
                            />
                            <circle
                              cx={cx}
                              cy={cy}
                              r={isHovered ? r + 3 : r}
                              fill={color}
                              stroke="var(--panel)"
                              strokeWidth={isHovered ? 3 : 2}
                              className="scatter-point-bubble"
                              style={{ pointerEvents: "none" }}
                            />
                          </g>
                        );
                      })}
                    </svg>
                    </div>
                    {hovered && (
                      <div className="scatter-tooltip" style={{ left: hovered.left, top: hovered.top }}>
                        <strong>{hovered.point.id}</strong>
                        <div>
                          {formatCount(hovered.point.x)} turns · {formatDuration(hovered.point.y)} · {hovered.point.tokens == null ? "n/a" : formatTokens(hovered.point.tokens)} tokens
                        </div>
                        <div className="muted small">
                          reliability {hovered.point.reliability == null ? "n/a" : `${Math.round(hovered.point.reliability * 100)}%`} (hangup{" "}
                          {hovered.point.hangupRate == null ? "n/a" : `${Math.round(hovered.point.hangupRate * 100)}%`}, coverage{" "}
                          {hovered.point.coverage == null ? "n/a" : `${Math.round(hovered.point.coverage * 100)}%`}), {hovered.point.sampleCount} run{hovered.point.sampleCount === 1 ? "" : "s"}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="stacked-chart-legend">
                    <span className="stacked-chart-legend-item">
                      <span className="stacked-chart-swatch" style={{ background: `linear-gradient(90deg, rgb(${FAIL_RGB.join(", ")}), rgb(${WARN_RGB.join(", ")}), rgb(${OK_RGB.join(", ")}))` }} />
                      Color: reliability (red = less reliable, green = more reliable)
                    </span>
                    <span className="stacked-chart-legend-item">
                      <svg width="56" height="28" className="scatter-legend-bubbles" aria-hidden="true">
                        <circle cx={16} cy={18} r={SCATTER_R_MIN / 1.6} fill="var(--muted)" />
                        <circle cx={42} cy={14} r={SCATTER_R_MAX / 1.6} fill="var(--muted)" />
                      </svg>
                      Size: avg tokens per call (bigger = more tokens)
                    </span>
                  </div>
                </>
              );
            })()}
          </>
        )}
      </CollapsibleCard>
    );
  }

  window.AB.ui.benchmarkViews = {
    formatMs,
    formatDuration,
    formatCount,
    formatTokens,
    StatCell,
    NodeStatCell,
    GlobalStatsTable,
    NodeCoverageMatrix,
    StackedLatencyChart,
    ResultsTables,
    ModelEfficiencyScatter,
    CollapsibleCard,
    nodeLabel,
    nodeTitle,
  };
})();
