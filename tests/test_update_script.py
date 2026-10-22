import pathlib
import subprocess
import time
import unittest


PROJECT_ROOT = pathlib.Path(__file__).resolve().parents[1]


class UpdateScriptTests(unittest.TestCase):
    def _start_pull(self) -> subprocess.Popen:
        script = (PROJECT_ROOT / "update.sh").read_text(encoding="utf-8")
        pull_step = script.split('echo "2. 更新后端依赖..."', 1)[0]
        # Only exercise the pull step; never touch deployment files or the network.
        harness = 'id() { echo deploy; }; cd() { :; }; git() { printf "GIT %s\\n" "$*"; };\n'
        return subprocess.Popen(
            ["bash", "-c", harness + pull_step],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

    def test_pull_source_selection(self) -> None:
        for choice, source in [
            ("1\n", "http://172.16.20.17/Lewis/MTEmpHub.git"),
            ("2\n", "https://github.com/Lewis-Lian/MTEmpHub.git"),
            ("\n", "http://172.16.20.17/Lewis/MTEmpHub.git"),
            ("", "http://172.16.20.17/Lewis/MTEmpHub.git"),
        ]:
            with self.subTest(choice=choice):
                process = self._start_pull()
                stdout, stderr = process.communicate(choice, timeout=5)
                self.assertEqual(process.returncode, 0, stderr)
                self.assertIn(f"GIT pull --ff-only {source} master\n", stdout)

    def test_no_input_defaults_to_gitlab_after_two_seconds(self) -> None:
        process = self._start_pull()
        started = time.monotonic()
        try:
            process.wait(timeout=5)  # Keep stdin open to exercise timeout, not EOF.
        finally:
            if process.poll() is None:
                process.kill()
            stdout, stderr = process.communicate()
        self.assertEqual(process.returncode, 0, stderr)
        self.assertGreaterEqual(time.monotonic() - started, 1.8)
        self.assertIn(
            "GIT pull --ff-only http://172.16.20.17/Lewis/MTEmpHub.git master\n",
            stdout,
        )
