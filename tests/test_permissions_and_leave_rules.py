import unittest

from models.user import ALL_PAGE_PERMISSION_KEYS
from routes.admin import _default_page_permissions_for_role
from routes.employee import _normalized_leave_days
from services.manager_attendance_service import normalize_days


class PermissionDefaultsTests(unittest.TestCase):
    def test_readonly_default_permissions_only_keep_home_page(self) -> None:
        permissions = _default_page_permissions_for_role("readonly")

        self.assertEqual(
            permissions,
            {
                key: (key == "query_home")
                for key in ALL_PAGE_PERMISSION_KEYS
            },
        )


class LeaveNormalizationRuleTests(unittest.TestCase):
    def test_employee_leave_normalization_matches_manager_rule(self) -> None:
        self.assertEqual(_normalized_leave_days(0.1), normalize_days(0.1))
        self.assertEqual(_normalized_leave_days(0.2), normalize_days(0.2))


if __name__ == "__main__":
    unittest.main()
