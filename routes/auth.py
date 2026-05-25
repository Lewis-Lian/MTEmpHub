from __future__ import annotations

from functools import wraps

from flask import current_app, jsonify, redirect, request, g

from models import db
from models.user import User
from routes.auth_helpers import decode_token, extract_token


def frontend_url(path: str) -> str:
    if path.startswith("http://") or path.startswith("https://"):
        return path
    base_url = (
        current_app.config.get("FRONTEND_APP_URL")
        or current_app.config.get("FRONTEND_ORIGIN")
        or "http://localhost:5173"
    ).rstrip("/")
    normalized_path = path if path.startswith("/") else f"/{path}"
    return f"{base_url}{normalized_path}"


def frontend_redirect(path: str):
    target = frontend_url(path)
    query_string = request.query_string.decode().strip()
    if query_string:
        separator = "&" if "?" in target else "?"
        target = f"{target}{separator}{query_string}"
    return redirect(target)


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        token = extract_token()
        if not token:
            if request.path.startswith("/api/"):
                return jsonify({"error": "Unauthorized"}), 401
            return redirect(frontend_url("/login"))

        payload = decode_token(token)
        if not payload:
            if request.path.startswith("/api/"):
                return jsonify({"error": "Invalid token"}), 401
            resp = redirect(frontend_url("/login"))
            resp.delete_cookie(current_app.config.get("SESSION_COOKIE_NAME", "access_token"))
            return resp

        user = db.session.get(User, payload["sub"])
        if not user:
            if request.path.startswith("/api/"):
                return jsonify({"error": "User not found"}), 401
            resp = redirect(frontend_url("/login"))
            resp.delete_cookie(current_app.config.get("SESSION_COOKIE_NAME", "access_token"))
            return resp
        g.current_user = user
        return fn(*args, **kwargs)

    return wrapper


def admin_required(fn):
    @wraps(fn)
    @login_required
    def wrapper(*args, **kwargs):
        if g.current_user.role != "admin":
            if request.path.startswith("/api/"):
                return jsonify({"error": "Forbidden"}), 403
            return redirect(frontend_url("/employee/dashboard"))
        return fn(*args, **kwargs)

    return wrapper


def page_permission_required(page_key: str):
    def decorator(fn):
        @wraps(fn)
        @login_required
        def wrapper(*args, **kwargs):
            if g.current_user.role == "admin" or g.current_user.can_access_page(page_key):
                return fn(*args, **kwargs)
            if request.path.startswith("/api/"):
                return jsonify({"error": "Forbidden"}), 403
            return redirect(frontend_url("/"))

        return wrapper

    return decorator
