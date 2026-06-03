import pathlib
import unittest


PROJECT_ROOT = pathlib.Path(__file__).resolve().parents[1]


class RunScriptTests(unittest.TestCase):
    def _read_script(self, name: str) -> str:
        return (PROJECT_ROOT / name).read_text(encoding="utf-8")

    def test_localrun_sets_up_frontend_dev_server(self) -> None:
        content = self._read_script("localrun.sh")

        self.assertIn("FRONTEND_HOST", content)
        self.assertIn("FRONTEND_PORT", content)
        self.assertIn("VITE_BACKEND_TARGET", content)
        self.assertIn("npm run dev", content)

    def test_winrun_sets_up_frontend_dev_server(self) -> None:
        content = self._read_script("winrun.sh")

        self.assertIn("FRONTEND_HOST", content)
        self.assertIn("FRONTEND_PORT", content)
        self.assertIn("VITE_BACKEND_TARGET", content)
        self.assertIn("npm run dev", content)

    def test_windows_production_scripts_do_not_require_legacy_templates(self) -> None:
        for script_name in ("winrun_prod.sh", "winrun_prod_server.sh"):
            with self.subTest(script=script_name):
                content = self._read_script(script_name)

                self.assertNotIn("templates/base.html", content)
                self.assertNotIn("templates/dashboard.html", content)
                self.assertNotIn("templates/partials/app_nav.html", content)
                self.assertIn("/health", content)

    def test_windows_deploy_script_covers_bootstrap_init_and_service_install(self) -> None:
        content = self._read_script("scripts/windows/deploy_production.ps1")

        self.assertIn("bootstrap_windows.ps1", content)
        self.assertIn("init-db", content)
        self.assertIn("upgrade-legacy-schema", content)
        self.assertIn("init-admin", content)
        self.assertIn("install_service.ps1", content)
        self.assertIn('"APP_ENV"', content)
        self.assertIn('"production"', content)


if __name__ == "__main__":
    unittest.main()
