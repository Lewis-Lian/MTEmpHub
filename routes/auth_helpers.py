from __future__ import annotations

import threading
import uuid
from datetime import datetime, timedelta, timezone
from functools import wraps

import jwt
from flask import current_app, g, jsonify, request

from models import db
from models.user import User


_REMEMBER_ME_SECONDS = 30 * 24 * 60 * 60
_HUMAN_CHECK_SECONDS = 5 * 60

# 已消费的滑块 challenge id 集合（防重放）。进程级、带锁；
# 单实例部署够用，多实例部署需替换为共享存储（如 Redis）。
_CONSUMED_CAPTCHA_IDS: set[str] = set()
_CONSUMED_CAPTCHA_LOCK = threading.Lock()
# 已消费集合无上限会缓慢增长；保留最近 N 条，旧的在加入时顺带清理。
_CONSUMED_CAPTCHA_MAX = 2048
_CAPTCHA_PURPOSE = "slider-captcha"



def session_cookie_kwargs(*, remember_me: bool = False) -> dict:
    cookie_kwargs = {
        "httponly": True,
        "samesite": current_app.config["SESSION_COOKIE_SAMESITE"],
        "secure": current_app.config["SESSION_COOKIE_SECURE"],
        "path": "/",
    }
    if remember_me:
        cookie_kwargs["max_age"] = _REMEMBER_ME_SECONDS
    return cookie_kwargs


def generate_token(user: User, *, remember_me: bool = False) -> str:
    now = datetime.now(tz=timezone.utc)
    expires_at = now + (
        timedelta(seconds=_REMEMBER_ME_SECONDS)
        if remember_me
        else current_app.config["JWT_EXPIRES_DELTA"]
    )
    payload = {
        "sub": str(user.id),
        "username": user.username,
        "role": user.role,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    return jwt.encode(payload, current_app.config["SECRET_KEY"], algorithm="HS256")


def generate_human_check() -> dict[str, str]:
    now = datetime.now(tz=timezone.utc)
    payload = {
        "purpose": "human-check",
        "verified": False,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=_HUMAN_CHECK_SECONDS)).timestamp()),
    }
    token = jwt.encode(payload, current_app.config["SECRET_KEY"], algorithm="HS256")
    return {"token": token}


def verify_human_check(challenge_token: str) -> str | None:
    if not challenge_token:
        return None
    try:
        payload = jwt.decode(challenge_token, current_app.config["SECRET_KEY"], algorithms=["HS256"])
    except jwt.InvalidTokenError:
        return None

    if payload.get("purpose") != "human-check" or payload.get("verified"):
        return None

    now = datetime.now(tz=timezone.utc)
    verified_payload = {
        "purpose": "human-check",
        "verified": True,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=_HUMAN_CHECK_SECONDS)).timestamp()),
    }
    return jwt.encode(verified_payload, current_app.config["SECRET_KEY"], algorithm="HS256")


def is_verified_human_check(token: str) -> bool:
    if not token:
        return False
    try:
        payload = jwt.decode(token, current_app.config["SECRET_KEY"], algorithms=["HS256"])
    except jwt.InvalidTokenError:
        return False
    return payload.get("purpose") == "human-check" and bool(payload.get("verified"))


def generate_slider_challenge(target_x: int) -> tuple[str, str]:
    """签发一次滑块挑战。

    :param target_x: 缺口目标 x 坐标（服务端生成，写入 JWT 防篡改）。
    :returns: (challenge_id, token)。challenge_id 供日志/调试，token 交给前端，
        在 verify 时回传。
    """
    now = datetime.now(tz=timezone.utc)
    challenge_id = uuid.uuid4().hex
    payload = {
        "purpose": _CAPTCHA_PURPOSE,
        "cid": challenge_id,
        "target_x": int(target_x),
        "verified": False,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=_HUMAN_CHECK_SECONDS)).timestamp()),
    }
    token = jwt.encode(payload, current_app.config["SECRET_KEY"], algorithm="HS256")
    return challenge_id, token


def consume_slider_challenge(token: str) -> dict | None:
    """消费一次滑块挑战，返回 payload（含 target_x）。

    校验 token 合法性 + 未过期 + 未被消费过（防重放）。已消费的 challenge id 会
    被记录，二次消费返回 None。
    """
    try:
        payload = jwt.decode(token, current_app.config["SECRET_KEY"], algorithms=["HS256"])
    except jwt.InvalidTokenError:
        return None
    if payload.get("purpose") != _CAPTCHA_PURPOSE or payload.get("verified"):
        return None

    cid = payload.get("cid")
    if not cid:
        return None

    with _CONSUMED_CAPTCHA_LOCK:
        if cid in _CONSUMED_CAPTCHA_IDS:
            return None  # 重放
        _CONSUMED_CAPTCHA_IDS.add(cid)
        # 顺手清理，避免集合无限增长。
        if len(_CONSUMED_CAPTCHA_IDS) > _CONSUMED_CAPTCHA_MAX:
            excess = len(_CONSUMED_CAPTCHA_IDS) - _CONSUMED_CAPTCHA_MAX
            for old in list(_CONSUMED_CAPTCHA_IDS)[:excess]:
                _CONSUMED_CAPTCHA_IDS.discard(old)

    return payload


def issue_slider_verified_token() -> str:
    """滑块校验通过后，签发最终 verified token（供 change-password 校验）。"""
    now = datetime.now(tz=timezone.utc)
    payload = {
        "purpose": _CAPTCHA_PURPOSE,
        "verified": True,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=_HUMAN_CHECK_SECONDS)).timestamp()),
    }
    return jwt.encode(payload, current_app.config["SECRET_KEY"], algorithm="HS256")


def is_verified_captcha(token: str) -> bool:
    """校验最终 verified token 是否合法且已验证（供 change-password 入口调用）。"""
    if not token:
        return False
    try:
        payload = jwt.decode(token, current_app.config["SECRET_KEY"], algorithms=["HS256"])
    except jwt.InvalidTokenError:
        return False
    return payload.get("purpose") == _CAPTCHA_PURPOSE and bool(payload.get("verified"))


def decode_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, current_app.config["SECRET_KEY"], algorithms=["HS256"])
    except jwt.InvalidTokenError:
        return None


def extract_token() -> str | None:
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header[7:]
    return request.cookies.get(current_app.config.get("SESSION_COOKIE_NAME", "access_token"))


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        token = extract_token()
        if not token:
            return jsonify({"error": "Unauthorized"}), 401

        payload = decode_token(token)
        if not payload:
            return jsonify({"error": "Invalid token"}), 401

        user_id = payload.get("sub")
        user = db.session.get(User, user_id) if user_id else None
        if not user:
            return jsonify({"error": "User not found"}), 401
        g.current_user = user
        return fn(*args, **kwargs)

    return wrapper


def admin_required(fn):
    @wraps(fn)
    @login_required
    def wrapper(*args, **kwargs):
        if g.current_user.role != "admin":
            return jsonify({"error": "Forbidden"}), 403
        return fn(*args, **kwargs)

    return wrapper


def page_permission_required(page_key: str):
    def decorator(fn):
        @wraps(fn)
        @login_required
        def wrapper(*args, **kwargs):
            if g.current_user.role == "admin" or g.current_user.can_access_page(page_key):
                return fn(*args, **kwargs)
            return jsonify({"error": "Forbidden"}), 403

        return wrapper

    return decorator


def any_page_permission_required(page_keys: tuple[str, ...]):
    def decorator(fn):
        @wraps(fn)
        @login_required
        def wrapper(*args, **kwargs):
            if g.current_user.role == "admin" or g.current_user.has_any_page_access(page_keys):
                return fn(*args, **kwargs)
            return jsonify({"error": "Forbidden"}), 403

        return wrapper

    return decorator
