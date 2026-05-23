from flask import g, request
from flask_cors import CORS

from .api_admin import api_admin_bp
from .api_auth import api_auth_bp
from .api_query import api_query_bp
from .auth import auth_bp
from .employee import employee_bp
from .admin import admin_bp
from .module import module_bp
from utils.app_navigation import nav_context


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


def register_routes(app):
    configure_api_cors(app)
    app.register_blueprint(api_auth_bp)
    app.register_blueprint(api_query_bp)
    app.register_blueprint(api_admin_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(employee_bp)
    app.register_blueprint(admin_bp)
    app.register_blueprint(module_bp)

    @app.context_processor
    def inject_app_navigation():
        return {"app_nav": nav_context(getattr(g, "current_user", None), request.path)}
