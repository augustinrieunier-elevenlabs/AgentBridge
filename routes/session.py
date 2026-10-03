import logging
import re
from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode

from flask import Blueprint, jsonify, request

from services import eleven_api, secrets
from services.eleven_api import ElevenApiError

bp = Blueprint("session", __name__, url_prefix="/api/session")
logger = logging.getLogger(__name__)

_SAFE_AGENT_ID = re.compile(r"^[a-zA-Z0-9_-]{1,100}$")
_SAFE_CONVERSATION_ID = re.compile(r"^[a-zA-Z0-9_-]{1,100}$")


def _mask_signed_url(url):
    """Never log a usable signed URL -- mask the short-lived token query param."""
    try:
        parsed = urlparse(url)
        query = dict(parse_qsl(parsed.query))
        if "token" in query:
            query["token"] = "***"
        return urlunparse(parsed._replace(query=urlencode(query)))
    except Exception:
        return "***"


@bp.get("/signed-url")
def get_signed_url():
    account_id = request.args.get("account_id", "")
    agent_id = request.args.get("agent_id", "")

    account = secrets.get_account(account_id)
    if account is None:
        return jsonify({"error": "Unknown account id"}), 400
    if not _SAFE_AGENT_ID.match(agent_id):
        return jsonify({"error": "Invalid agent id"}), 400

    try:
        url = eleven_api.get_signed_url(account_id, agent_id) if account["has_key"] else eleven_api.get_public_agent_url(account_id, agent_id)
    except ElevenApiError as exc:
        return jsonify({"error": str(exc)}), exc.status_code or 502

    logger.info("signed url ready for account=%s agent=%s: %s", account_id, agent_id, _mask_signed_url(url))
    return jsonify({"url": url})


@bp.get("/final-transcript")
def fetch_final_transcript():
    account_id = request.args.get("account_id", "")
    conversation_id = request.args.get("conversation_id", "")

    if secrets.get_account(account_id) is None:
        return jsonify({"error": "Unknown account id"}), 400
    if not _SAFE_CONVERSATION_ID.match(conversation_id):
        return jsonify({"error": "Invalid conversation id"}), 400

    try:
        raw = eleven_api.get_conversation(account_id, conversation_id)
    except ElevenApiError as exc:
        return jsonify({"error": str(exc)}), exc.status_code or 502

    transcript = [
        {"role": t.get("role"), "message": t.get("message"), "time_in_call_secs": t.get("time_in_call_secs")}
        for t in raw.get("transcript", []) or []
    ]
    return jsonify({"conversation_id": conversation_id, "transcript": transcript, "raw": raw})
