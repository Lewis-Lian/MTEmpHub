import importlib
import os
import tempfile
import unittest
from unittest import mock


class RouteSeparationTests(unittest.TestCase):
    def _load_app_module(self):
        config_module = importlib.import_module("config")
        importlib.reload(config_module)

        app_module = importlib.import_module("app")
        return importlib.reload(app_module)

    def test_app_routes_only_expose_health_and_api_prefixes(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            with mock.patch.dict(
                os.environ,
                {
                    "APP_ENV": "test",
                    "DATABASE_URL": f"sqlite:///{os.path.join(tmpdir, 'route-separation.db')}",
                    "SECRET_KEY": "test-secret",
                    "UPLOAD_FOLDER": os.path.join(tmpdir, "uploads"),
                },
                clear=False,
            ):
                app = self._load_app_module().create_app()
                rules = {rule.rule for rule in app.url_map.iter_rules()}

        self.assertIn("/health", rules)
        self.assertTrue(any(rule.startswith("/api/auth/") for rule in rules))
        self.assertTrue(any(rule.startswith("/api/query/") for rule in rules))
        self.assertTrue(any(rule.startswith("/api/admin/") for rule in rules))
        self.assertNotIn("/login", rules)
        self.assertNotIn("/employee/dashboard", rules)
        self.assertNotIn("/admin/dashboard", rules)
        self.assertNotIn("/module/<slug>", rules)

    def test_api_blueprints_import_auth_helpers_instead_of_auth_module(self) -> None:
        api_auth_module = importlib.import_module("routes.api_auth")
        api_query_module = importlib.import_module("routes.api_query")
        api_admin_module = importlib.import_module("routes.api_admin")

        self.assertEqual(api_auth_module.generate_token.__module__, "routes.auth_helpers")
        self.assertEqual(api_auth_module.login_required.__module__, "routes.auth_helpers")
        self.assertEqual(api_query_module.login_required.__module__, "routes.auth_helpers")
        self.assertEqual(api_query_module.page_permission_required.__module__, "routes.auth_helpers")
        self.assertEqual(api_admin_module.admin_required.__module__, "routes.auth_helpers")


if __name__ == "__main__":
    unittest.main()
