import { app, BrowserWindow, session } from "electron";
import path from "path";
import dotenv from "dotenv";
import { registerIpcHandlers } from "./ipc";

// Load .env from the project root before anything else touches secrets.ts.
// __dirname at runtime is dist-electron/electron (see tsconfig.electron.json), so go up two levels.
dotenv.config({ path: path.join(__dirname, "..", "..", ".env") });

const isDev = !app.isPackaged;

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: "Agent Bridge",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Strict CSP: only ElevenLabs REST/WS hosts may be reached from the renderer,
  // and only our own bundled assets may be loaded/executed.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; " +
            "script-src 'self'; " +
            "style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data:; " +
            "connect-src 'self' https://*.elevenlabs.io wss://*.elevenlabs.io; " +
            "media-src 'self' blob:;",
        ],
      },
    });
  });

  if (isDev) {
    win.loadURL("http://localhost:5173");
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(path.join(__dirname, "..", "..", "renderer-dist", "index.html"));
  }
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
