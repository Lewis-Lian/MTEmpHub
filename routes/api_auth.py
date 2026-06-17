from __future__ import annotations

from datetime import datetime

from flask import Blueprint, current_app, g, jsonify, make_response, request

from models import db
from models.user import User
from routes.auth_helpers import (
    consume_slider_challenge,
    generate_human_check,
    generate_slider_challenge,
    generate_token,
    is_verified_captcha,
    is_verified_human_check,
    issue_slider_verified_token,
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


@api_auth_bp.get("/captcha/slider")
def api_captcha_slider():
    """签发一组滑块验证码图像 + 挑战 token。

    返回的 background/slider 是 data URL，可直接用于 <img src>；target_x 仅作前端
    提示用（真正的校验值封在 token 内）。GET 方法，CSRF 自动放行。
    """
    from services.captcha_service import generate_captcha_image

    challenge_id, target_x, background_url, slider_url = generate_captcha_image()
    _, token = generate_slider_challenge(target_x)
    return jsonify(
        {
            "challenge_id": challenge_id,
            "token": token,
            "background": background_url,
            "slider": slider_url,
            "slider_width": 44,
        }
    )


# 轨迹校验阈值（经验值，兼顾通过率与防自动化）。
_CAPTCHA_POSITION_TOLERANCE = 5  # 终点位置容差 px
_CAPTCHA_MIN_DURATION_MS = 400  # 最短拖动耗时，防瞬移
_CAPTCHA_MIN_TRACE_POINTS = 5  # 最少采样点数，防直接提交终点
# 速度变异系数（标准差/均值）下限：人手拖动有明显加速减速，CV 通常 > 0.4；
# 匀速机器人轨迹 CV 接近 0。用相对值而非绝对方差，避免受速度量级影响。
_CAPTCHA_MIN_SPEED_CV = 0.3


def _validate_slider_trace(trace: list, target_x: int, x_offset) -> str | None:
    """校验滑块轨迹，返回失败原因（None 表示通过）。"""
    try:
        x_offset = float(x_offset)
    except (TypeError, ValueError):
        return "滑块位置数据无效"

    if abs(x_offset - target_x) > _CAPTCHA_POSITION_TOLERANCE:
        return "滑块位置不正确"

    if not isinstance(trace, list) or len(trace) < _CAPTCHA_MIN_TRACE_POINTS:
        return "验证轨迹无效"

    # 解析轨迹点 {x, t}。
    points: list[tuple[float, int]] = []
    for item in trace:
        if not isinstance(item, dict):
            return "验证轨迹无效"
        try:
            px = float(item.get("x"))
            pt = int(item.get("t"))
        except (TypeError, ValueError):
            return "验证轨迹无效"
        points.append((px, pt))

    if len(points) < _CAPTCHA_MIN_TRACE_POINTS:
        return "验证轨迹无效"

    # 耗时检查：首末点时间差必须足够（防瞬移）。
    duration = points[-1][1] - points[0][1]
    if duration < _CAPTCHA_MIN_DURATION_MS:
        return "验证轨迹无效"

    # 速度变异系数检查：人手拖动有加速减速，速度序列的标准差相对均值较大（CV 高）；
    # 匀速机器人 CV 接近 0。用 CV（无量纲）而非绝对方差，避免受速度量级影响。
    speeds: list[float] = []
    for i in range(1, len(points)):
        dx = points[i][0] - points[i - 1][0]
        dt = points[i][1] - points[i - 1][1]
        if dt <= 0:
            continue
        speeds.append(dx / dt)
    if len(speeds) >= 3:
        mean_speed = sum(speeds) / len(speeds)
        if mean_speed > 0:
            std_speed = (sum((s - mean_speed) ** 2 for s in speeds) / len(speeds)) ** 0.5
            cv = std_speed / mean_speed
            if cv < _CAPTCHA_MIN_SPEED_CV:
                return "验证轨迹无效"

    return None


@api_auth_bp.post("/captcha/slider/verify")
def api_captcha_slider_verify():
    """校验滑块拖动轨迹，通过后签发 verified token。"""
    payload = request.get_json(silent=True) or {}
    token = (payload.get("token") or "").strip()
    x_offset = payload.get("x_offset")
    trace = payload.get("trace") or []

    challenge = consume_slider_challenge(token)
    if not challenge:
        return jsonify({"error": "验证已失效，请刷新滑块"}), 400

    target_x = int(challenge.get("target_x") or 0)
    reason = _validate_slider_trace(trace, target_x, x_offset)
    if reason:
        return jsonify({"error": reason}), 400

    return jsonify({"verified_token": issue_slider_verified_token()})


@api_auth_bp.post("/login")
def api_login():
    payload = request.get_json(silent=True) or {}
    username = (payload.get("username") or "").strip()
    password = payload.get("password") or ""
    remember_me = bool(payload.get("remember_me"))
    now = datetime.utcnow()

    captcha_token = (payload.get("captcha_token") or "").strip()
    if not is_verified_captcha(captcha_token):
        return jsonify({"error": "请先完成滑块验证"}), 403

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

    # 滑块人机验证：公开自助改密流程必须先通过滑块，防自动化爆破。
    captcha_token = (payload.get("captcha_token") or "").strip()
    if not is_verified_captcha(captcha_token):
        return jsonify({"error": "请先完成滑块验证"}), 403

    now = datetime.utcnow()
    user = User.query.filter_by(username=username).first()
    if user and user.is_login_disabled():
        return jsonify({"error": "该账号已被禁用，请联系管理员解锁"}), 423
    if user and user.is_temporarily_login_locked(now):
        return jsonify({"error": "该账号已被临时禁用 10 分钟，请稍后再试"}), 423

    if not user or not user.check_password(current_password):
        if user:
            lock_state = user.register_failed_login(now)
            db.session.commit()
            if lock_state == "admin_unlock_required":
                return jsonify({"error": "该账号已被禁用，请联系管理员解锁"}), 423
            if lock_state == "temporary_lock":
                return jsonify({"error": "该账号已被临时禁用 10 分钟，请稍后再试"}), 423
        return jsonify({"error": "用户名或原密码错误"}), 401

    user.clear_login_lockout()
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
