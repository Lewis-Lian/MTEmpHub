from datetime import datetime

from flask import Blueprint, current_app, g, jsonify, make_response, request

from models import db
from models.user import User
from routes.auth_helpers import (
    generate_human_check,
    generate_token,
    is_verified_human_check,
    login_required,
    session_cookie_kwargs,
    verify_human_check,
)


api_auth_bp = Blueprint("api_auth", __name__, url_prefix="/api/auth")


@api_auth_bp.get("/human-check")
def api_human_check():
    return jsonify(generate_human_check())


@api_auth_bp.post("/human-check/verify")
def api_human_check_verify():
    payload = request.get_json(silent=True) or {}
    challenge_token = (payload.get("challenge_token") or "").strip()
    verified_token = verify_human_check(challenge_token)
    if not verified_token:
        return jsonify({"error": "机器人检测未通过，请重试"}), 400
    return jsonify({"verified_token": verified_token})


@api_auth_bp.post("/login")
def api_login():
    payload = request.get_json(silent=True) or {}
    username = (payload.get("username") or "").strip()
    password = payload.get("password") or ""
    remember_me = bool(payload.get("remember_me"))
    now = datetime.utcnow()

    user = User.query.filter_by(username=username).first()
    if user and user.is_login_disabled():
        return jsonify({"error": "该账号已被禁用，请联系管理员解锁"}), 423
    if user and user.is_temporarily_login_locked(now):
        return jsonify({"error": "该账号已被临时禁用 10 分钟，请稍后再试"}), 423

    if not user or not user.check_password(password):
        if user:
            lock_state = user.register_failed_login(now)
            db.session.commit()
            if lock_state == "admin_unlock_required":
                return jsonify({"error": "该账号已被禁用，请联系管理员解锁"}), 423
            if lock_state == "temporary_lock":
                return jsonify({"error": "该账号已被临时禁用 10 分钟，请稍后再试"}), 423
        return jsonify({"error": "用户名或密码错误"}), 401

    user.clear_login_lockout()
    db.session.commit()

    token = generate_token(user, remember_me=remember_me)
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
    response.set_cookie(
        current_app.config["SESSION_COOKIE_NAME"],
        token,
        **session_cookie_kwargs(remember_me=remember_me),
    )
    return response


@api_auth_bp.post("/logout")
def api_logout():
    response = make_response(jsonify({"ok": True}))
    response.delete_cookie(current_app.config["SESSION_COOKIE_NAME"], path="/")
    return response


@api_auth_bp.post("/change-password")
def api_change_password():
    payload = request.get_json(silent=True) or {}
    username = (payload.get("username") or "").strip()
    current_password = payload.get("current_password") or ""
    new_password = payload.get("new_password") or ""
    confirm_password = payload.get("confirm_password") or ""

    if not username or not current_password or not new_password or not confirm_password:
        return jsonify({"error": "请完整填写用户名、原密码和新密码"}), 400
    if new_password != confirm_password:
        return jsonify({"error": "两次输入的新密码不一致"}), 400

    user = User.query.filter_by(username=username).first()
    if not user or not user.check_password(current_password):
        return jsonify({"error": "用户名或原密码错误"}), 401

    user.set_password(new_password)
    db.session.commit()
    return jsonify({"ok": True})


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
