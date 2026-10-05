"""
Agent Bridge -- Flask backend.

Serves the single-page frontend (templates/index.html + static/js, plain
JSX transpiled in-browser by Babel standalone, no Node build step) and a
small JSON API that holds every ElevenLabs API key: the browser never sees
a key, only short-lived signed WebSocket URLs (see services/eleven_api.py
and routes/session.py).

Run with:
    flask --app app run --debug      (dev)
    gunicorn -w 1 -b 127.0.0.1:5000 app:app   (prod-ish; keep workers=1, see README)
"""
import logging

from dotenv import load_dotenv
from flask import Flask, render_template

load_dotenv()  # before any route/service touches services.secrets

from routes import accounts, agents, benchmark_runs, config, debug_logs, exports, noise_sounds, session  # noqa: E402  (after load_dotenv)

logging.basicConfig(level=logging.INFO)


def create_app(instance_path=None):
    app = Flask(__name__, instance_path=instance_path, instance_relative_config=False)

    app.register_blueprint(accounts.bp)
    app.register_blueprint(agents.bp)
    app.register_blueprint(session.bp)
    app.register_blueprint(config.bp)
    app.register_blueprint(exports.bp)
    app.register_blueprint(benchmark_runs.bp)
    app.register_blueprint(debug_logs.bp)
    app.register_blueprint(noise_sounds.bp)

    @app.get("/")
    def index():
        return render_template("index.html")

    @app.after_request
    def set_security_headers(response):
        # Only ElevenLabs hosts for API/WebSocket traffic, only cdnjs for the
        # CDN-loaded React/Babel runtime (see README "why a CDN" note).
        # NOTE: 'unsafe-inline' + 'unsafe-eval' are required because Babel
        # standalone transforms and executes <script type="text/babel"> tags
        # at runtime in the browser (no build step -- see README "why a CDN
        # and why this CSP is looser than the Electron version's"). This is
        # an accepted trade-off for a local-only internal tool, not something
        # you'd want on an internet-facing app.
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com; "
            # style-src/font-src additions: the ElevenLabs brand charter (Inter + JetBrains Mono,
            # see styles.css) loads those two from Google Fonts, same CDN-not-bundled trade-off as
            # the React/Babel runtime above -- KMR Waldenburg itself is self-hosted (static/fonts/),
            # no additional host needed for that one.
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            "img-src 'self' data:; "
            "connect-src 'self' https://*.elevenlabs.io wss://*.elevenlabs.io; "
            "media-src 'self' blob:; "
            "worker-src 'self' blob:;"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    return app


app = create_app()

if __name__ == "__main__":
    app.run(debug=True, port=5000)
