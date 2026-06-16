import os
from datetime import timedelta


class Config:
    APP_ENV = os.getenv("APP_ENV", "development")
    SQLALCHEMY_DATABASE_URI = os.getenv("DATABASE_URL", "sqlite:///attendance.db")
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = (
        {"pool_pre_ping": True, "pool_recycle": 3600}
        if os.getenv("DATABASE_URL", "").startswith("mysql")
        else {}
    )
    SECRET_KEY = os.getenv("SECRET_KEY") or ("dev-secret-key" if APP_ENV != "production" else None)
    JWT_EXPIRES_HOURS = int(os.getenv("JWT_EXPIRES_HOURS", "12"))
    JWT_EXPIRES_DELTA = timedelta(hours=JWT_EXPIRES_HOURS)
    FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
    FRONTEND_APP_URL = os.getenv("FRONTEND_APP_URL", FRONTEND_ORIGIN)
    SESSION_COOKIE_NAME = os.getenv("SESSION_COOKIE_NAME", "access_token")
    SESSION_COOKIE_SAMESITE = os.getenv("SESSION_COOKIE_SAMESITE", "Lax")
    SESSION_COOKIE_SECURE = os.getenv("SESSION_COOKIE_SECURE", "false").lower() == "true"
    INITIAL_ADMIN_PASSWORD = os.getenv("INITIAL_ADMIN_PASSWORD")
    UPLOAD_FOLDER = os.getenv(
        "UPLOAD_FOLDER",
        os.path.join(os.path.dirname(__file__), "static", "uploads"),
    )

    @classmethod
    def validate(cls) -> None:
        if cls.APP_ENV == "production" and not cls.SECRET_KEY:
            raise RuntimeError("SECRET_KEY must be set in production")
