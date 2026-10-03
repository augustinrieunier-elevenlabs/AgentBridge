from flask import Blueprint, jsonify

from services import eleven_api, secrets

bp = Blueprint("accounts", __name__, url_prefix="/api/accounts")


@bp.get("")
def list_accounts():
    return jsonify(secrets.list_accounts_public())


@bp.post("/<account_id>/test")
def test_account(account_id):
    if secrets.get_account(account_id) is None:
        return jsonify({"error": "Unknown account id"}), 404
    return jsonify(eleven_api.test_account(account_id))
