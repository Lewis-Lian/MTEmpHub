from __future__ import annotations

from datetime import datetime, timedelta, timezone
from functools import wraps

import jwt
from flask import current_app, g, jsonify, request

from models import db
from models.user import User


_REMEMBER_ME_SECONDS = 30 * 24 * 60 * 60
_HUMAN_CHECK_SECONDS = 5 * 60


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

        user = db.session.get(User, payload["sub"])
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
