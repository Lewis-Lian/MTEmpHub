from flask_cors import CORS

from .api_admin import api_admin_bp
from .api_auth import api_auth_bp
from .api_query import api_query_bp


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
