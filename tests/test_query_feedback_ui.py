import os
import unittest


class QueryFeedbackUITests(unittest.TestCase):
    def setUp(self) -> None:
        self.project_root = os.path.dirname(os.path.dirname(__file__))
        self.static_dir = os.path.join(self.project_root, "static", "js")

    def _read_script(self, filename: str) -> str:
        script_path = os.path.join(self.static_dir, filename)
        with open(script_path, "r", encoding="utf-8") as fh:
            return fh.read()

    def test_toast_script_defines_ten_second_pauseable_timer(self) -> None:
        script = self._read_script("app_dialog.js")

        self.assertIn("const AUTO_HIDE_DELAY_MS = 10000;", script)
        self.assertIn('toastEl.addEventListener("mouseenter"', script)
        self.assertIn('toastEl.addEventListener("mouseleave"', script)
        self.assertIn("remainingMs", script)

    def test_account_set_script_uses_progress_overlay(self) -> None:
        script = self._read_script("admin.js")

        self.assertIn("window.AppQueryProgress.with", script)

    def test_punch_record_download_script_passes_selected_headers(self) -> None:
        script = self._read_script("punch_records.js")

        self.assertIn('query.set("punch_headers"', script)
        self.assertIn('document.getElementById("toggleRawPunch").checked', script)
        self.assertIn('document.getElementById("toggleInOutPunch").checked', script)

    def test_annual_leave_and_overtime_save_show_success_feedback(self) -> None:
        annual_leave_script = self._read_script("manager_annual_leave.js")
        overtime_script = self._read_script("manager_overtime.js")

        self.assertIn('window.AppToast.success("年休修正已保存", "保存成功")', annual_leave_script)
        self.assertIn('window.AppToast.success("加班修正已保存", "保存成功")', overtime_script)


if __name__ == "__main__":
    unittest.main()
