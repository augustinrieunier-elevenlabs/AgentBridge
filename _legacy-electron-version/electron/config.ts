/**
 * Loads and saves the secret-free app configuration (agents, scenarios,
 * presets, settings) to app.getPath('userData')/config.json.
 *
 * Account secrets are never part of this file -- see secrets.ts.
 */
import { app } from "electron";
import { promises as fs } from "fs";
import path from "path";
import type { AppConfig } from "../shared/types";

function configPath(): string {
  return path.join(app.getPath("userData"), "config.json");
}

const DEFAULT_CONFIG: AppConfig = {
  agents: [],
  scenarios: [],
  presets: [],
  settings: { frameSizeMs: 100, asrComparisonEnabled: false, voiceTable: {} },
};

export async function loadConfig(): Promise<AppConfig> {
  try {
    const raw = await fs.readFile(configPath(), "utf-8");
    const parsed = JSON.parse(raw);
    return {
      agents: parsed.agents ?? [],
      scenarios: parsed.scenarios ?? [],
      presets: parsed.presets ?? [],
      settings: { ...DEFAULT_CONFIG.settings, ...(parsed.settings ?? {}) },
    };
  } catch (err: any) {
    if (err.code === "ENOENT") return DEFAULT_CONFIG;
    throw err;
  }
}

export async function saveConfig(cfg: AppConfig): Promise<void> {
  // Defensive: strip anything that looks like a secret if a caller accidentally
  // included one (config.json must never carry API keys or signed URLs).
  const safe = JSON.parse(JSON.stringify(cfg), (key, value) => {
    if (typeof value === "string" && /^(sk_|wss:\/\/.*token=)/i.test(value)) return undefined;
    return value;
  });
  await fs.mkdir(path.dirname(configPath()), { recursive: true });
  await fs.writeFile(configPath(), JSON.stringify(safe, null, 2), "utf-8");
}

export function exportsDir(): string {
  return path.join(app.getPath("userData"), "exports");
}

export async function saveExport(name: string, data: unknown): Promise<string> {
  await fs.mkdir(exportsDir(), { recursive: true });
  const safeName = name.replace(/[^a-z0-9-_]+/gi, "-").slice(0, 80);
  const fileName = `${Date.now()}-${safeName || "session"}.json`;
  const filePath = path.join(exportsDir(), fileName);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
  return filePath;
}

export async function listExports(): Promise<Array<{ name: string; path: string; savedAt: string }>> {
  try {
    const files = await fs.readdir(exportsDir());
    const entries = await Promise.all(
      files
        .filter((f) => f.endsWith(".json"))
        .map(async (f) => {
          const full = path.join(exportsDir(), f);
          const stat = await fs.stat(full);
          return { name: f, path: full, savedAt: stat.mtime.toISOString() };
        }),
    );
    return entries.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  } catch (err: any) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

export async function readExport(filePath: string): Promise<unknown> {
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(exportsDir()))) {
    throw new Error("Refusing to read a file outside the exports directory");
  }
  const raw = await fs.readFile(resolved, "utf-8");
  return JSON.parse(raw);
}
