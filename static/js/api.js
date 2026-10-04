/**
 * Thin fetch wrapper around the Flask JSON API (replaces the old Electron
 * IPC bridge -- see routes/*.py). The browser never holds an API key, only
 * what these calls return (account metadata without keys, signed URLs,
 * agent metadata).
 */
(function () {
  async function request(path, options) {
    options = options || {};
    const res = await fetch(path, {
      method: options.method || "GET",
      headers: options.body ? { "Content-Type": "application/json" } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.error || `Request to ${path} failed with HTTP ${res.status}`);
    }
    return body;
  }

  /** Multipart upload -- separate from request() above, which always JSON-encodes its body. The
   * browser sets the multipart boundary itself from the FormData object; setting Content-Type by
   * hand here would omit it and break parsing on the Flask side. */
  async function uploadFile(path, file) {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(path, { method: "POST", body: formData });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.error || `Upload to ${path} failed with HTTP ${res.status}`);
    }
    return body;
  }

  const api = {
    accounts: {
      list: () => request("/api/accounts"),
      test: (accountId) => request(`/api/accounts/${encodeURIComponent(accountId)}/test`, { method: "POST" }),
    },
    agents: {
      listRemote: (accountId) => request(`/api/agents/${encodeURIComponent(accountId)}/remote`),
      inspect: (accountId, agentId) => request(`/api/agents/${encodeURIComponent(accountId)}/${encodeURIComponent(agentId)}/inspect`),
      listLlms: (accountId) => request(`/api/agents/${encodeURIComponent(accountId)}/llms`),
      getWorkflowNodes: (accountId, agentId) => request(`/api/agents/${encodeURIComponent(accountId)}/${encodeURIComponent(agentId)}/workflow-nodes`),
      getWorkflow: (accountId, agentId) => request(`/api/agents/${encodeURIComponent(accountId)}/${encodeURIComponent(agentId)}/workflow`),
      setWorkflow: (accountId, agentId, workflow) =>
        request(`/api/agents/${encodeURIComponent(accountId)}/${encodeURIComponent(agentId)}/workflow`, { method: "POST", body: { workflow } }),
      setWorkflowNodeLlms: (accountId, agentId, llmByNodeId) =>
        request(`/api/agents/${encodeURIComponent(accountId)}/${encodeURIComponent(agentId)}/workflow/node-llm`, { method: "POST", body: { llmByNodeId } }),
      getModelConfig: (accountId, agentId) => request(`/api/agents/${encodeURIComponent(accountId)}/${encodeURIComponent(agentId)}/model-config`),
      setModelConfig: (accountId, agentId, cfg) =>
        request(`/api/agents/${encodeURIComponent(accountId)}/${encodeURIComponent(agentId)}/model-config`, { method: "POST", body: cfg }),
      getPendingRestore: (accountId, agentId) => request(`/api/agents/${encodeURIComponent(accountId)}/${encodeURIComponent(agentId)}/pending-restore`),
      savePendingRestore: (accountId, agentId, snapshot) =>
        request(`/api/agents/${encodeURIComponent(accountId)}/${encodeURIComponent(agentId)}/pending-restore`, { method: "POST", body: snapshot }),
      clearPendingRestore: (accountId, agentId) =>
        request(`/api/agents/${encodeURIComponent(accountId)}/${encodeURIComponent(agentId)}/pending-restore`, { method: "DELETE" }),
    },
    session: {
      getSignedUrl: (accountId, agentId) =>
        request(`/api/session/signed-url?account_id=${encodeURIComponent(accountId)}&agent_id=${encodeURIComponent(agentId)}`),
      fetchFinalTranscript: (accountId, conversationId) =>
        request(`/api/session/final-transcript?account_id=${encodeURIComponent(accountId)}&conversation_id=${encodeURIComponent(conversationId)}`),
    },
    config: {
      load: () => request("/api/config"),
      save: (cfg) => request("/api/config", { method: "POST", body: cfg }),
    },
    exports: {
      save: (name, data) => request("/api/exports", { method: "POST", body: { name, data } }),
      list: () => request("/api/exports"),
      read: (path) => request(`/api/exports/read?path=${encodeURIComponent(path)}`),
      update: (path, patch) => request(`/api/exports?path=${encodeURIComponent(path)}`, { method: "PATCH", body: patch }),
      clear: () => request("/api/exports", { method: "DELETE" }),
    },
    benchmarkRuns: {
      list: (benchmarkId) => request(`/api/benchmark-runs${benchmarkId ? `?benchmark_id=${encodeURIComponent(benchmarkId)}` : ""}`),
      save: (run) => request("/api/benchmark-runs", { method: "POST", body: run }),
      update: (runId, patch) => request(`/api/benchmark-runs/${encodeURIComponent(runId)}`, { method: "PATCH", body: patch }),
      remove: (runId) => request(`/api/benchmark-runs/${encodeURIComponent(runId)}`, { method: "DELETE" }),
      clear: () => request("/api/benchmark-runs", { method: "DELETE" }),
    },
    debugLogs: {
      save: (data) => request("/api/debug-logs", { method: "POST", body: data }),
      list: () => request("/api/debug-logs"),
      read: (path) => request(`/api/debug-logs/read?path=${encodeURIComponent(path)}`),
    },
    noiseSounds: {
      list: () => request("/api/noise-sounds"),
      upload: (file) => uploadFile("/api/noise-sounds", file),
      remove: (path) => request(`/api/noise-sounds?path=${encodeURIComponent(path)}`, { method: "DELETE" }),
      // Direct, unauthenticated-fetch URL for an <audio> element's src and for
      // AmbientSoundMixer.js's decode -- same-origin, no API key involved (see routes/noise_sounds.py).
      fileUrl: (path) => `/api/noise-sounds/file?path=${encodeURIComponent(path)}`,
    },
  };

  window.AB.api = api;
})();
