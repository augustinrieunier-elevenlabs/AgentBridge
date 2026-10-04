/**
 * CRUD for noise profiles -- reusable "bad connection" configs (background noise + packet loss,
 * see model/factory.js emptyNoiseProfile) a Preset or Benchmark can reference (noiseProfileRefId)
 * so it's applied automatically from the start of a conversation, in audio mode. Same split-pane
 * list/detail pattern as ScenariosPanel/PresetsPanel/BenchmarksPanel.
 */
(function () {
  const { useEffect, useState } = React;
  const emptyNoiseProfile = window.AB.model.emptyNoiseProfile;
  const cloneNoiseProfile = window.AB.model.cloneNoiseProfile;

  const PREVIEW_DURATION_S = 12;
  const PREVIEW_FRAME_MS = 100;
  const PREVIEW_SAMPLE_RATE = 16000;

  /**
   * Builds ~12s of this profile's EXACT effect stack (background noise + packet loss + ambient
   * mp3s, all via the real runtime classes -- never a separate reimplementation that could drift
   * from what a live call actually does) over silence, and plays it through the Web Audio API.
   * Silence rather than real speech: this previews the EFFECTS themselves (what the line sounds
   * like), not a demo conversation -- packet loss still audibly mutes the noise/ambient bed, which
   * is the thing worth hearing.
   */
  async function playPreview(profile) {
    const { NoiseInjector, PacketLossSimulator, AmbientSoundMixer } = window.AB.audio;
    const frameSamples = (PREVIEW_SAMPLE_RATE * PREVIEW_FRAME_MS) / 1000;
    const frameCount = Math.round((PREVIEW_DURATION_S * 1000) / PREVIEW_FRAME_MS);

    const noise = new NoiseInjector();
    noise.setType(profile.noiseType);
    noise.setLevel(profile.noiseLevel);

    const packetLoss = new PacketLossSimulator();
    packetLoss.setEnabled(profile.packetLossEnabled);
    packetLoss.setIntervalRangeS(profile.packetLossMinS, profile.packetLossMaxS);
    packetLoss.setDropDurationS(profile.packetLossDropS);

    const ambient = new AmbientSoundMixer();
    ambient.setLevel(profile.ambientSoundLevel);
    await ambient.load(profile.ambientSoundPaths.map((path) => window.AB.api.noiseSounds.fileUrl(path)));

    const allSamples = new Int16Array(frameSamples * frameCount);
    for (let i = 0; i < frameCount; i++) {
      const frame = new Int16Array(frameSamples); // silence -- see doc comment above
      const dropped = packetLoss.apply(frame);
      if (!dropped) {
        noise.apply(frame);
        ambient.apply(frame);
      }
      allSamples.set(frame, i * frameSamples);
    }

    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const buffer = ctx.createBuffer(1, allSamples.length, PREVIEW_SAMPLE_RATE);
    buffer.getChannelData(0).set(window.AB.audio.int16ToFloat32(allSamples));
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start();

    return new Promise((resolve) => {
      source.onended = () => {
        ctx.close();
        resolve();
      };
    });
  }

  function NoiseProfilesPanel({ config, updateConfig }) {
    const [selectedId, setSelectedId] = useState(config.noiseProfiles[0] ? config.noiseProfiles[0].id : null);

    function addProfile() {
      const next = emptyNoiseProfile();
      updateConfig((prev) => ({ ...prev, noiseProfiles: [...prev.noiseProfiles, next] }));
      setSelectedId(next.id);
    }
    function updateProfile(id, patch) {
      updateConfig((prev) => ({ ...prev, noiseProfiles: prev.noiseProfiles.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
    }
    function duplicateProfile(id) {
      const original = config.noiseProfiles.find((p) => p.id === id);
      if (!original) return;
      const clone = cloneNoiseProfile(original);
      updateConfig((prev) => ({ ...prev, noiseProfiles: [...prev.noiseProfiles, clone] }));
      setSelectedId(clone.id);
    }
    function removeProfile(id) {
      updateConfig((prev) => ({ ...prev, noiseProfiles: prev.noiseProfiles.filter((p) => p.id !== id) }));
      if (selectedId === id) setSelectedId(null);
    }

    const selected = config.noiseProfiles.find((p) => p.id === selectedId) || null;

    return (
      <div className="panel panel-split">
        <div className="panel-list">
          <div className="panel-toolbar">
            <button onClick={addProfile}>+ New noise profile</button>
          </div>
          <ul className="list">
            {config.noiseProfiles.map((p) => (
              <li key={p.id} className={p.id === selectedId ? "list-item-active" : ""}>
                <button className="list-item-btn" onClick={() => setSelectedId(p.id)}>
                  {p.name || "Untitled profile"}
                </button>
                <button className="small" title="Clone this noise profile" onClick={() => duplicateProfile(p.id)}>
                  ⧉
                </button>
                <button className="danger small" onClick={() => removeProfile(p.id)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
          {config.noiseProfiles.length === 0 && <p className="panel-help">No noise profile yet.</p>}
        </div>
        <div className="panel-detail">
          {selected ? (
            <NoiseProfileEditor profile={selected} updateProfile={updateProfile} />
          ) : (
            <p className="empty-state">
              Select or create a noise profile. Reference one from a Preset or Benchmark (Settings → Presets/Benchmarks) to simulate a bad connection automatically from the start of a call, in
              audio mode -- still fully adjustable live from the Session screen's operator bar once a call is running.
            </p>
          )}
        </div>
      </div>
    );
  }

  function NoiseProfileEditor({ profile: p, updateProfile }) {
    const [sounds, setSounds] = useState([]); // the shared library -- every profile picks from the same uploaded files
    const [uploading, setUploading] = useState(false);
    const [previewing, setPreviewing] = useState(false);

    useEffect(() => {
      refreshSounds();
    }, []);

    async function refreshSounds() {
      try {
        setSounds(await window.AB.api.noiseSounds.list());
      } catch (err) {
        console.error("Could not load the ambient sound library", err);
      }
    }

    async function handleUpload(e) {
      const file = e.target.files[0];
      e.target.value = ""; // lets the same file be re-selected later (e.g. after deleting it)
      if (!file) return;
      setUploading(true);
      try {
        await window.AB.api.noiseSounds.upload(file);
        await refreshSounds();
      } catch (err) {
        alert(`Could not upload "${file.name}": ${err.message}`);
      } finally {
        setUploading(false);
      }
    }

    async function handleDeleteSound(path) {
      if (!window.confirm("Delete this sound? Any noise profile referencing it will just stop finding it.")) return;
      try {
        await window.AB.api.noiseSounds.remove(path);
        await refreshSounds();
        if (p.ambientSoundPaths.includes(path)) {
          updateProfile(p.id, { ambientSoundPaths: p.ambientSoundPaths.filter((x) => x !== path) });
        }
      } catch (err) {
        alert(`Could not delete: ${err.message}`);
      }
    }

    function toggleSound(path) {
      const has = p.ambientSoundPaths.includes(path);
      updateProfile(p.id, { ambientSoundPaths: has ? p.ambientSoundPaths.filter((x) => x !== path) : [...p.ambientSoundPaths, path] });
    }

    async function handlePreview() {
      setPreviewing(true);
      try {
        await playPreview(p);
      } catch (err) {
        alert(`Could not play preview: ${err.message}`);
      } finally {
        setPreviewing(false);
      }
    }

    return (
      <div className="card">
        <div className="card-row">
          <label className="grow">
            Name
            <input value={p.name} onChange={(e) => updateProfile(p.id, { name: e.target.value })} />
          </label>
          <button onClick={handlePreview} disabled={previewing} title="Plays ~12s of this profile's exact effect stack over silence, through the real runtime mixer code">
            {previewing ? "Playing…" : "▶ Preview"}
          </button>
        </div>

        <fieldset>
          <legend>Background noise</legend>
          <div className="card-row">
            <label>
              Type
              <select value={p.noiseType} onChange={(e) => updateProfile(p.id, { noiseType: e.target.value })}>
                <option value="ambient">Ambient</option>
                <option value="static">Static</option>
              </select>
            </label>
            <label>
              Level ({p.noiseLevel})
              <input type="range" min={0} max={100} value={p.noiseLevel} onChange={(e) => updateProfile(p.id, { noiseLevel: Number(e.target.value) })} />
            </label>
          </div>
          <p className="panel-help">Level 0 = no background noise. Mixed continuously into the caller→callee leg, during speech and silence alike.</p>
        </fieldset>

        <fieldset>
          <legend>
            <label className="checkbox-row">
              <input type="checkbox" checked={p.packetLossEnabled} onChange={(e) => updateProfile(p.id, { packetLossEnabled: e.target.checked })} />
              Packet loss
            </label>
          </legend>
          <div className="card-row">
            <label>
              Every
              <input
                type="number"
                min={0.1}
                max={p.packetLossMaxS}
                step={0.5}
                value={p.packetLossMinS}
                onChange={(e) => updateProfile(p.id, { packetLossMinS: Number(e.target.value) })}
                disabled={!p.packetLossEnabled}
              />
            </label>
            <label>
              to
              <input
                type="number"
                min={p.packetLossMinS}
                step={0.5}
                value={p.packetLossMaxS}
                onChange={(e) => updateProfile(p.id, { packetLossMaxS: Number(e.target.value) })}
                disabled={!p.packetLossEnabled}
              />
            </label>
            <label>
              seconds, drop
              <input
                type="number"
                min={0.1}
                step={0.1}
                value={p.packetLossDropS}
                onChange={(e) => updateProfile(p.id, { packetLossDropS: Number(e.target.value) })}
                disabled={!p.packetLossEnabled}
              />
            </label>
            <label>seconds each time</label>
          </div>
          <p className="panel-help">Randomly mutes outgoing audio entirely for the drop duration, at a new random point within the interval range, every time.</p>
        </fieldset>

        <fieldset>
          <legend>Ambient sounds (mp3)</legend>
          <p className="panel-help">
            Uploaded files are a shared library -- every noise profile picks from the same set. Checked sounds loop continuously, mixed together, under the background noise above.
          </p>
          <div className="card-row">
            <input type="file" id={`upload-${p.id}`} accept="audio/mpeg,.mp3" onChange={handleUpload} disabled={uploading} style={{ display: "none" }} />
            <button onClick={() => document.getElementById(`upload-${p.id}`).click()} disabled={uploading}>
              {uploading ? "Uploading…" : "+ Upload mp3"}
            </button>
          </div>
          {sounds.length === 0 && <p className="panel-help">No mp3 uploaded yet.</p>}
          {sounds.map((s) => (
            <div className="card-row" key={s.path}>
              <label className="checkbox-row grow">
                <input type="checkbox" checked={p.ambientSoundPaths.includes(s.path)} onChange={() => toggleSound(s.path)} />
                {s.name}
              </label>
              <audio controls preload="none" src={window.AB.api.noiseSounds.fileUrl(s.path)} className="noise-sound-preview" />
              <button className="danger small" onClick={() => handleDeleteSound(s.path)}>
                ×
              </button>
            </div>
          ))}
          {p.ambientSoundPaths.length > 0 && (
            <label>
              Ambient level ({p.ambientSoundLevel})
              <input type="range" min={0} max={100} value={p.ambientSoundLevel} onChange={(e) => updateProfile(p.id, { ambientSoundLevel: Number(e.target.value) })} />
            </label>
          )}
        </fieldset>
      </div>
    );
  }

  window.AB.ui.settings.NoiseProfilesPanel = NoiseProfilesPanel;
})();
