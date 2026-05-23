from flask import Blueprint, current_app, g, jsonify, make_response, request

from models.user import User
from routes.auth import _generate_token, _session_cookie_kwargs, login_required


api_auth_bp = Blueprint("api_auth", __name__, url_prefix="/api/auth")

@api_auth_bp.post("/login")
def api_login():
    payload = request.get_json(silent=True) or {}
    username = payload.get("username")
    password = payload.get("password") or ""

    user = User.query.filter_by(username=username).first()
    if not user or not user.check_password(password):
        return jsonify({"error": "用户名或密码错误"}), 401

    token = _generate_token(user)
    response = make_response(
        jsonify(
            {
                "user": {
                    "id": user.id,
                    "username": user.username,
                    "role": user.role,
                    "page_permissions": user.effective_page_permissions(),
                }
            }
        )
    )
    response.set_cookie(current_app.config["SESSION_COOKIE_NAME"], token, **_session_cookie_kwargs())
    return response


@api_auth_bp.post("/logout")
def api_logout():
    response = make_response(jsonify({"ok": True}))
    response.delete_cookie(current_app.config["SESSION_COOKIE_NAME"], path="/")
    return response


@api_auth_bp.get("/me")
@login_required
def api_me():
    return jsonify(
        {
            "id": g.current_user.id,
            "username": g.current_user.username,
            "role": g.current_user.role,
            "page_permissions": g.current_user.effective_page_permissions(),
        }
    )
