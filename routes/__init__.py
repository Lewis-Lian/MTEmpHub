from flask_cors import CORS
from flask import Flask, jsonify, request

from .api_admin import api_admin_bp
from .api_auth import api_auth_bp
from .api_query import api_query_bp

_WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def configure_api_cors(app):
    if app.extensions.get("task1_api_cors_configured"):
        return
    CORS(
        app,
        resources={r"/api/*": {"origins": [app.config["FRONTEND_ORIGIN"]]}},
        supports_credentials=True,
        allow_headers=["Authorization", "Content-Type"],
        methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    )

    app.extensions["task1_api_cors_configured"] = True


def configure_csrf_protection(app: Flask) -> None:
    """校验写请求的 Origin/Referer，防御 CSRF。

    对 /api/ 前缀的 POST/PUT/PATCH/DELETE 请求，要求 Origin 或 Referer
    与 FRONTEND_ORIGIN 匹配；两者均缺失时返回 403。浏览器跨站请求必然
    携带其中之一，因此能有效拦截伪造的跨站写请求。GET/HEAD/OPTIONS 放行。
    """
    allowed_origin = app.config["FRONTEND_ORIGIN"].rstrip("/")

    @app.before_request
    def _enforce_origin_for_writes():
        if request.method not in _WRITE_METHODS:
            return None
        if not request.path.startswith("/api/"):
            return None

        origin = (request.headers.get("Origin") or "").rstrip("/")
        referer = (request.headers.get("Referer") or "").rstrip("/")
        if origin == allowed_origin or referer == allowed_origin:
            return None
        # Referer 可能带路径（如 http://host/path），用前缀匹配兜底
        if referer and referer.startswith(allowed_origin + "/"):
            return None

        return jsonify({"error": "跨站请求校验失败"}), 403


def register_routes(app):
    configure_api_cors(app)
    configure_csrf_protection(app)
    app.register_blueprint(api_auth_bp)
    app.register_blueprint(api_query_bp)
    app.register_blueprint(api_admin_bp)
