"""测试辅助：为 Flask test client 自动注入 Origin 头。

后端对写请求校验 Origin/Referer（CSRF 防护），现有测试多不带 Origin。
用 attach_origin 包装 client 后，post/put/patch/delete 会自动带上
与 FRONTEND_ORIGIN 匹配的 Origin，无需逐个修改调用点。
"""
from __future__ import annotations

from typing import Any

ALLOWED_ORIGIN = "http://localhost:5173"
_WRITE_METHODS = ("post", "put", "patch", "delete")


def attach_origin(client: Any) -> Any:
    """包装 test client 的写方法，自动注入 Origin 头。"""
    for method in _WRITE_METHODS:
        original = getattr(client, method)

        def make_wrapper(fn):
            def wrapper(*args, **kwargs):
                headers = kwargs.pop("headers", None)
                merged: dict[str, str] = {}
                if headers:
                    try:
                        merged.update(dict(headers))
                    except (TypeError, ValueError):
                        merged.update(headers.to_wsgi_list() if hasattr(headers, "to_wsgi_list") else {})
                merged.setdefault("Origin", ALLOWED_ORIGIN)
                return fn(*args, headers=merged, **kwargs)
            return wrapper

        setattr(client, method, make_wrapper(original))
    return client
