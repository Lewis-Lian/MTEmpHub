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
    SECRET_KEY = os.getenv("SECRET_KEY")

    # 已知的不安全占位符/默认值，任何环境都不应使用（JWT 用它签名）
    _INSECURE_SECRET_KEYS = {
        "dev-secret-key",
        "replace-this-with-a-secure-key",
        "change-me",
        "secret",
    }
    JWT_EXPIRES_HOURS = int(os.getenv("JWT_EXPIRES_HOURS", "12"))
    JWT_EXPIRES_DELTA = timedelta(hours=JWT_EXPIRES_HOURS)
    # 允许的前端来源（CSRF/CORS 白名单）。
    # 优先读 FRONTEND_ORIGINS（逗号分隔多个，如 "http://a.com,http://1.2.3.4"）；
    # 未配置时回退到单值 FRONTEND_ORIGIN，最终回退到 localhost:5173。
    _raw_origins = os.getenv("FRONTEND_ORIGINS") or os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
    FRONTEND_ORIGINS = [o.strip().rstrip("/") for o in _raw_origins.split(",") if o.strip()]
    # 单值别名，保留向后兼容（取白名单首项）
    FRONTEND_ORIGIN = FRONTEND_ORIGINS[0]
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
        if not cls.SECRET_KEY:
            raise RuntimeError("SECRET_KEY 未设置，请在 .env 中配置一个安全的密钥")
        if cls.SECRET_KEY in cls._INSECURE_SECRET_KEYS:
            raise RuntimeError(
                "SECRET_KEY 使用了不安全的占位符，请替换为随机生成的强密钥"
            )
