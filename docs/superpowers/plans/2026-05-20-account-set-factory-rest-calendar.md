# 账套厂休日期配置与假期重叠扣减 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在账套中新增厂休日期明细配置，自动汇总厂休总数，并让管理人员考勤中的出差、婚假、丧假按半天粒度扣除与厂休重叠的部分。

**Architecture:** 保留 `account_sets.factory_rest_days` 作为现有总量计算的兼容字段，新增账套厂休明细表承载日期与上午/下午/全天信息。账套管理接口负责读写明细并回填总数，管理人员考勤服务在计算 `business_trip_days / marriage_days / funeral_days` 时查询当月厂休明细并扣减重叠值。

**Tech Stack:** Python/Flask, SQLAlchemy, Jinja2 templates, vanilla JavaScript, SQLite, unittest/pytest

---

### Task 1: 增加账套厂休明细模型与序列化字段

**Files:**
- Modify: `models/account_set.py`
- Modify: `services/bootstrap_service.py`
- Modify: `routes/admin.py`
- Test: `tests/test_attendance_override_features.py`

- [ ] **Step 1: 先写序列化层的失败测试**

在 `tests/test_attendance_override_features.py` 中新增一个账套 API 用例，验证账套详情会返回厂休明细和自动汇总后的总数：

```python
    def test_account_sets_api_returns_factory_rest_entries(self):
        with self.app.app_context():
            account = AccountSet(month="2026-04", name="2026-04 账套", factory_rest_days=1.5, monthly_benefit_days=0)
            db.session.add(account)
            db.session.flush()
            db.session.add_all(
                [
                    AccountSetFactoryRestDay(account_set_id=account.id, rest_date=date(2026, 4, 8), rest_period="full"),
                    AccountSetFactoryRestDay(account_set_id=account.id, rest_date=date(2026, 4, 9), rest_period="am"),
                ]
            )
            db.session.commit()

        res = self.client.get("/admin/account-sets")
        self.assertEqual(res.status_code, 200)
        payload = res.get_json()
        self.assertEqual(payload[0]["factory_rest_days"], 1.5)
        self.assertEqual(
            payload[0]["factory_rest_entries"],
            [
                {"date": "2026-04-08", "period": "full", "unit": 1.0},
                {"date": "2026-04-09", "period": "am", "unit": 0.5},
            ],
        )
```

- [ ] **Step 2: 运行单测，确认当前失败**

Run: `python3 -m pytest tests/test_attendance_override_features.py -k factory_rest_entries -v`

Expected: FAIL，报 `NameError: name 'AccountSetFactoryRestDay' is not defined` 或返回 payload 中缺少 `factory_rest_entries`

- [ ] **Step 3: 在模型中新增厂休明细表和关系**

修改 `models/account_set.py`，追加新模型与关系：

```python
from datetime import datetime

from . import db


class AccountSet(db.Model):
    __tablename__ = "account_sets"

    id = db.Column(db.Integer, primary_key=True)
    month = db.Column(db.String(7), unique=True, nullable=False, index=True)
    name = db.Column(db.String(100), nullable=False)
    is_active = db.Column(db.Boolean, default=False, nullable=False)
    is_locked = db.Column(db.Boolean, default=False, nullable=False)
    locked_at = db.Column(db.DateTime, nullable=True)
    locked_by = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    factory_rest_days = db.Column(db.Float, default=0, nullable=False)
    monthly_benefit_days = db.Column(db.Float, default=0, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    imports = db.relationship("AccountSetImport", back_populates="account_set", cascade="all, delete-orphan")
    factory_rest_entries = db.relationship(
        "AccountSetFactoryRestDay",
        back_populates="account_set",
        cascade="all, delete-orphan",
        order_by="AccountSetFactoryRestDay.rest_date.asc()",
    )


class AccountSetFactoryRestDay(db.Model):
    __tablename__ = "account_set_factory_rest_days"

    id = db.Column(db.Integer, primary_key=True)
    account_set_id = db.Column(db.Integer, db.ForeignKey("account_sets.id"), nullable=False, index=True)
    rest_date = db.Column(db.Date, nullable=False, index=True)
    rest_period = db.Column(db.String(10), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    account_set = db.relationship("AccountSet", back_populates="factory_rest_entries")

    __table_args__ = (
        db.UniqueConstraint("account_set_id", "rest_date", "rest_period", name="uq_account_rest_date_period"),
    )
```

- [ ] **Step 4: 在启动补丁里补建新表**

修改 `services/bootstrap_service.py`，在现有账套表补丁附近增加：

```python
    inspector = inspect(db.engine)
    if "account_set_factory_rest_days" not in inspector.get_table_names():
        AccountSetFactoryRestDay.__table__.create(bind=db.engine)
```

同时补充导入：

```python
from sqlalchemy import inspect, text

from models.account_set import AccountSetFactoryRestDay
```

- [ ] **Step 5: 在管理端序列化中返回明细**

修改 `routes/admin.py`，新增两个辅助函数并扩展 `_serialize_account_set`：

```python
def _factory_rest_unit(period: str) -> float:
    return 1.0 if period == "full" else 0.5


def _serialize_factory_rest_entry(row: AccountSetFactoryRestDay) -> dict[str, object]:
    return {
        "date": row.rest_date.isoformat(),
        "period": row.rest_period,
        "unit": _factory_rest_unit(row.rest_period),
    }
```

```python
def _serialize_account_set(row: AccountSet) -> dict:
    success_count = 0
    error_count = 0
    pending_count = 0
    latest_import_at = None
    for item in row.imports:
        if item.status == "ok":
            success_count += 1
        elif item.status == "error":
            error_count += 1
        else:
            pending_count += 1
        if item.created_at and (latest_import_at is None or item.created_at > latest_import_at):
            latest_import_at = item.created_at

    return {
        "id": row.id,
        "month": row.month,
        "name": row.name,
        "is_active": row.is_active,
        "is_locked": bool(row.is_locked),
        "locked_at": row.locked_at.isoformat() if row.locked_at else None,
        "locked_by": row.locked_by,
        "factory_rest_days": row.factory_rest_days or 0,
        "factory_rest_entries": [_serialize_factory_rest_entry(item) for item in row.factory_rest_entries],
        "monthly_benefit_days": row.monthly_benefit_days or 0,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "imports_count": len(row.imports),
        "pending_count": pending_count,
        "success_count": success_count,
        "error_count": error_count,
        "latest_import_at": latest_import_at.isoformat() if latest_import_at else None,
    }
```

- [ ] **Step 6: 重新运行单测，确认通过**

Run: `python3 -m pytest tests/test_attendance_override_features.py -k factory_rest_entries -v`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add models/account_set.py services/bootstrap_service.py routes/admin.py tests/test_attendance_override_features.py
git commit -m "feat: add account set factory rest entry model"
```

---

### Task 2: 让账套保存厂休日期明细并自动回填总数

**Files:**
- Modify: `routes/admin.py`
- Modify: `templates/admin/dashboard.html`
- Modify: `static/js/admin.js`
- Test: `tests/test_attendance_override_features.py`

- [ ] **Step 1: 先写账套更新接口的失败测试**

在 `tests/test_attendance_override_features.py` 中新增用例，验证保存厂休明细会自动汇总 `factory_rest_days`：

```python
    def test_update_account_set_recalculates_factory_rest_days_from_entries(self):
        with self.app.app_context():
            account = AccountSet(month="2026-04", name="2026-04 账套", factory_rest_days=0, monthly_benefit_days=1)
            db.session.add(account)
            db.session.commit()
            account_id = account.id

        res = self.client.put(
            f"/admin/account-sets/{account_id}",
            json={
                "monthly_benefit_days": 2,
                "factory_rest_entries": [
                    {"date": "2026-04-08", "period": "full"},
                    {"date": "2026-04-09", "period": "am"},
                    {"date": "2026-04-10", "period": "pm"},
                ],
            },
        )

        self.assertEqual(res.status_code, 200)
        payload = res.get_json()["account_set"]
        self.assertEqual(payload["factory_rest_days"], 2.0)
        self.assertEqual(len(payload["factory_rest_entries"]), 3)
```

- [ ] **Step 2: 运行单测，确认当前失败**

Run: `python3 -m pytest tests/test_attendance_override_features.py -k recalculates_factory_rest_days -v`

Expected: FAIL，返回总数仍为 `0` 或接口忽略 `factory_rest_entries`

- [ ] **Step 3: 在后端新增厂休明细解析与汇总函数**

修改 `routes/admin.py`，新增：

```python
def _factory_rest_unit(period: str) -> float:
    if period == "full":
        return 1.0
    if period in {"am", "pm"}:
        return 0.5
    raise ValueError("invalid factory rest period")


def _parse_factory_rest_entries(entries: object, month: str) -> list[dict[str, object]]:
    if not isinstance(entries, list):
        return []

    normalized: list[dict[str, object]] = []
    seen: set[tuple[str, str]] = set()
    month_prefix = f"{month}-"
    for item in entries:
        if not isinstance(item, dict):
            continue
        date_text = str(item.get("date") or "").strip()
        period = str(item.get("period") or "").strip()
        if not date_text.startswith(month_prefix):
            raise ValueError("厂休日期必须属于当前账套月份")
        if period not in {"full", "am", "pm"}:
            raise ValueError("厂休时段仅支持 full/am/pm")
        key = (date_text, period)
        if key in seen:
            continue
        seen.add(key)
        normalized.append({"date": datetime.strptime(date_text, "%Y-%m-%d").date(), "period": period})
    return normalized


def _replace_factory_rest_entries(account_set: AccountSet, entries: list[dict[str, object]]) -> float:
    account_set.factory_rest_entries.clear()
    total = 0.0
    for item in entries:
        period = str(item["period"])
        account_set.factory_rest_entries.append(
            AccountSetFactoryRestDay(rest_date=item["date"], rest_period=period)
        )
        total += _factory_rest_unit(period)
    account_set.factory_rest_days = total
    return total
```

- [ ] **Step 4: 改账套创建与更新接口，统一走明细保存**

修改 `create_account_set()` 和 `update_account_set()`：

```python
@admin_bp.route("/account-sets", methods=["POST"])
@admin_required
def create_account_set():
    data = request.json or {}
    month = (data.get("month") or "").strip()
    monthly_benefit_days = data.get("monthly_benefit_days", 0)
    if not month or len(month) != 7:
        return jsonify({"error": "month is required in YYYY-MM format"}), 400
    if AccountSet.query.filter_by(month=month).first():
        return jsonify({"error": "该月份账套已存在"}), 400

    row = AccountSet(
        month=month,
        name=f"{month} 账套",
        factory_rest_days=0,
        monthly_benefit_days=float(monthly_benefit_days or 0),
    )
    if AccountSet.query.count() == 0:
        row.is_active = True
    db.session.add(row)
    db.session.flush()
    _replace_factory_rest_entries(row, _parse_factory_rest_entries(data.get("factory_rest_entries"), month))
    db.session.commit()
    return jsonify({"status": "ok", "account_set": _serialize_account_set(row)})
```

```python
@admin_bp.route("/account-sets/<int:account_set_id>", methods=["PUT"])
@admin_required
def update_account_set(account_set_id: int):
    row = _require_model(AccountSet, account_set_id)
    locked_error = _ensure_account_set_unlocked(row, "修改账套参数")
    if locked_error:
        return locked_error

    data = request.json or {}
    row.monthly_benefit_days = float(data.get("monthly_benefit_days") or 0)
    try:
        entries = _parse_factory_rest_entries(data.get("factory_rest_entries"), row.month)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    _replace_factory_rest_entries(row, entries)
    db.session.commit()
    return jsonify({"status": "ok", "account_set": _serialize_account_set(row)})
```

- [ ] **Step 5: 把账套页数字输入改成只读汇总展示，并加明细容器**

修改 `templates/admin/dashboard.html` 中账套参数区域：

```html
<div class="row g-2 mb-2">
  <div class="col-6">
    <label class="form-label small mb-1">本月厂休天数</label>
    <input type="number" class="form-control form-control-sm" id="factoryRestDaysInput" min="0" step="0.5" value="0" readonly>
    <div class="form-text">由下方厂休日期自动汇总</div>
  </div>
  <div class="col-6">
    <label class="form-label small mb-1">本月可用福利天数</label>
    <input type="number" class="form-control form-control-sm" id="monthlyBenefitDaysInput" min="0" step="0.5" value="0">
  </div>
</div>
<div class="mb-2">
  <label class="form-label small mb-1">厂休日期明细</label>
  <div id="factoryRestCalendar" class="border rounded p-2 bg-light"></div>
  <div class="form-text">点击日期可在非厂休、上午、下午、全天之间切换。</div>
</div>
```

- [ ] **Step 6: 在前端维护日期状态、汇总值和保存 payload**

修改 `static/js/admin.js`，增加状态与渲染函数：

```javascript
  const factoryRestCalendar = document.getElementById("factoryRestCalendar");
  let factoryRestEntries = [];

  function restUnit(period) {
    return period === "full" ? 1 : (period === "am" || period === "pm" ? 0.5 : 0);
  }

  function buildMonthDays(month) {
    const [year, monthNo] = month.split("-").map(Number);
    const lastDay = new Date(year, monthNo, 0).getDate();
    return Array.from({ length: lastDay }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
  }

  function entryPeriod(dateText) {
    const row = factoryRestEntries.find((item) => item.date === dateText);
    return row ? row.period : "";
  }

  function setEntryPeriod(dateText, period) {
    factoryRestEntries = factoryRestEntries.filter((item) => item.date !== dateText);
    if (period) {
      factoryRestEntries.push({ date: dateText, period });
      factoryRestEntries.sort((a, b) => a.date.localeCompare(b.date));
    }
  }

  function cyclePeriod(period) {
    if (!period) return "am";
    if (period === "am") return "pm";
    if (period === "pm") return "full";
    return "";
  }

  function syncFactoryRestDays() {
    const total = factoryRestEntries.reduce((sum, item) => sum + restUnit(item.period), 0);
    factoryRestDaysInput.value = String(total);
  }

  function renderFactoryRestCalendar() {
    const row = currentAccountSet();
    if (!row) {
      factoryRestCalendar.innerHTML = `<div class="text-muted small">请选择账套</div>`;
      return;
    }
    const disabledAttr = row.is_locked ? "disabled" : "";
    factoryRestCalendar.innerHTML = buildMonthDays(row.month)
      .map((dateText) => {
        const period = entryPeriod(dateText);
        const label = period === "full" ? "全天" : (period === "am" ? "上午" : (period === "pm" ? "下午" : "无"));
        return `<button type="button" class="btn btn-sm ${period ? "btn-primary" : "btn-outline-secondary"} m-1 factory-rest-day-btn" data-date="${dateText}" ${disabledAttr}>${dateText.slice(8)}日 ${label}</button>`;
      })
      .join("");
    syncFactoryRestDays();
  }
```

并更新 `renderAccountSetParams()` 和保存逻辑：

```javascript
  function renderAccountSetParams() {
    const row = currentAccountSet();
    factoryRestEntries = row ? (row.factory_rest_entries || []).map((item) => ({ date: item.date, period: item.period })) : [];
    factoryRestDaysInput.value = row ? String(row.factory_rest_days || 0) : "0";
    monthlyBenefitDaysInput.value = row ? String(row.monthly_benefit_days || 0) : "0";
    const isLocked = Boolean(row?.is_locked);
    factoryRestDaysInput.disabled = true;
    monthlyBenefitDaysInput.disabled = isLocked;
    saveAccountSetParamsBtn.disabled = isLocked || !row;
    deleteAccountSetBtn.disabled = isLocked || !row;
    importRawBtn.disabled = isLocked || !row;
    calculateEmployeeBtn.disabled = isLocked || !row;
    calculateManagerBtn.disabled = isLocked || !row;
    lockAccountSetBtn.disabled = !row || isLocked;
    unlockAccountSetBtn.disabled = !row || !isLocked;
    accountSetLockNotice.className = `small mb-2 ${isLocked ? "text-danger" : "text-muted"}`;
    accountSetLockNotice.textContent = !row
      ? "请选择账套"
      : (isLocked ? "该账套已锁定，仅允许查看、设为当前和解锁。" : "该账套未锁定，可继续上传、计算和修改。");
    renderFactoryRestCalendar();
  }
```

```javascript
  factoryRestCalendar.addEventListener("click", (event) => {
    const button = event.target.closest(".factory-rest-day-btn");
    const row = currentAccountSet();
    if (!button || !row || row.is_locked) return;
    const dateText = button.dataset.date;
    setEntryPeriod(dateText, cyclePeriod(entryPeriod(dateText)));
    renderFactoryRestCalendar();
  });
```

```javascript
  saveAccountSetParamsBtn.addEventListener("click", async () => {
    const id = currentAccountSetId();
    if (!id) {
      window.AppFeedback.setResult(accountSetResult, "请先选择账套", "danger");
      return;
    }
    const res = await fetch(`/admin/account-sets/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        monthly_benefit_days: monthlyBenefitDaysInput.value || "0",
        factory_rest_entries: factoryRestEntries,
      }),
    });
```

- [ ] **Step 7: 重新运行账套测试**

Run: `python3 -m pytest tests/test_attendance_override_features.py -k "factory_rest_entries or recalculates_factory_rest_days" -v`

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add routes/admin.py templates/admin/dashboard.html static/js/admin.js tests/test_attendance_override_features.py
git commit -m "feat: manage factory rest days from account set calendar"
```

---

### Task 3: 在管理人员考勤中扣除与厂休重叠的出差/婚假/丧假

**Files:**
- Modify: `services/manager_attendance_service.py`
- Test: `tests/test_manager_attendance_service.py`

- [ ] **Step 1: 先写出差与厂休重叠的失败测试**

在 `tests/test_manager_attendance_service.py` 中新增用例：

```python
class ManagerFactoryRestOverlapTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.tmpdir.name, "manager-factory-rest.db")

        app = Flask(__name__)
        app.config.update(
            TESTING=True,
            SQLALCHEMY_DATABASE_URI=f"sqlite:///{self.db_path}",
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
        )
        db.init_app(app)
        self.app = app

        with self.app.app_context():
            db.create_all()
            dept = Department(dept_no="D001", dept_name="行政部")
            manager = Employee(emp_no="M001", name="练义炜", is_manager=True)
            db.session.add_all([dept, manager])
            db.session.flush()
            manager.dept_id = dept.id
            account = AccountSet(month="2026-04", name="2026-04 账套", factory_rest_days=1.5, monthly_benefit_days=0)
            db.session.add(account)
            db.session.flush()
            db.session.add_all(
                [
                    AccountSetFactoryRestDay(account_set_id=account.id, rest_date=date(2026, 4, 8), rest_period="full"),
                    AccountSetFactoryRestDay(account_set_id=account.id, rest_date=date(2026, 4, 9), rest_period="am"),
                ]
            )
            db.session.add(
                MonthlyReport(emp_id=manager.id, report_month="2026-04", manager_raw_data={"出勤天数": 2})
            )
            db.session.add(
                LeaveRecord(
                    emp_id=manager.id,
                    leave_no="QYQJ2026050234",
                    leave_type="出差",
                    start_time=datetime(2026, 4, 8, 8, 0, 0),
                    end_time=datetime(2026, 4, 10, 17, 0, 0),
                    duration=2.375,
                )
            )
            db.session.commit()
            self.manager_id = manager.id

    def tearDown(self) -> None:
        with self.app.app_context():
            db.session.remove()
            db.drop_all()
        self.tmpdir.cleanup()

    def test_business_trip_days_subtract_factory_rest_overlap(self) -> None:
        with self.app.app_context():
            rows = build_manager_rows(ManagerAttendanceOptions(month="2026-04", factory_rest_days=1.5), [self.manager_id])

        self.assertEqual(rows[0]["business_trip_days"], 1.5)
        self.assertEqual(rows[0]["attendance_days"], 3.5)
```

- [ ] **Step 2: 运行单测，确认当前失败**

Run: `python3 -m pytest tests/test_manager_attendance_service.py -k factory_rest_overlap -v`

Expected: FAIL，当前 `business_trip_days` 仍按原始折算结果返回 `3.0`

- [ ] **Step 3: 在服务层增加厂休查询、半天映射与重叠扣减函数**

修改 `services/manager_attendance_service.py`，新增：

```python
def _account_set_for_month(month: str) -> AccountSet | None:
    return AccountSet.query.filter_by(month=month).first()


def _factory_rest_entries_by_date(month: str) -> dict[date, set[str]]:
    account = _account_set_for_month(month)
    if not account:
        return {}

    result: dict[date, set[str]] = {}
    for item in account.factory_rest_entries:
        parts = result.setdefault(item.rest_date, set())
        if item.rest_period == "full":
            parts.update({"am", "pm"})
        else:
            parts.add(item.rest_period)
    return result


def _date_period_overlap(start_dt: datetime, end_dt: datetime, day: date) -> set[str]:
    day_start = datetime.combine(day, time.min)
    midday = datetime.combine(day, time(hour=12))
    day_end = datetime.combine(day + timedelta(days=1), time.min)
    periods: set[str] = set()
    if start_dt < midday and end_dt > day_start:
        periods.add("am")
    if start_dt < day_end and end_dt > midday:
        periods.add("pm")
    return periods


def _rest_overlap_days(start_dt: datetime, end_dt: datetime, month: str) -> float:
    entries = _factory_rest_entries_by_date(month)
    total = 0.0
    for rest_date, rest_periods in entries.items():
        leave_periods = _date_period_overlap(start_dt, end_dt, rest_date)
        total += 0.5 * len(rest_periods & leave_periods)
    return total
```

- [ ] **Step 4: 在假期累加时先减去厂休重叠**

把 `build_manager_rows()` 中的请假循环改成：

```python
        for leave in _leave_rows(employee.id, options.month):
            raw_days = normalize_days(_leave_days_in_month(leave, options.month))
            bucket = _leave_bucket(leave.leave_type)
            overlap_days = 0.0
            if bucket in {"business_trip", "marriage", "funeral"}:
                overlap_days = _rest_overlap_days(leave.start_time, leave.end_time, options.month)
            days = max(_round2(raw_days - overlap_days), 0.0)

            if bucket == "injury":
                injury_days += days
            elif bucket == "business_trip":
                business_trip_days += days
            elif bucket == "marriage":
                marriage_days += days
            elif bucket == "funeral":
                funeral_days += days
            elif bucket == "personal_sick" and _has_half_day_component(days):
                half_leave_days += 0.5
            elif bucket == "time_off" and _has_half_day_component(days):
                half_time_off_days += 0.5
```

- [ ] **Step 5: 再补一个婚假半天不重叠的测试**

在同一测试文件中追加：

```python
    def test_marriage_leave_only_subtracts_matching_half_day(self) -> None:
        with self.app.app_context():
            manager = Employee.query.get(self.manager_id)
            db.session.add(
                LeaveRecord(
                    emp_id=manager.id,
                    leave_no="HJ001",
                    leave_type="婚假",
                    start_time=datetime(2026, 4, 9, 13, 0, 0),
                    end_time=datetime(2026, 4, 9, 17, 0, 0),
                    duration=0.5,
                )
            )
            db.session.commit()

            rows = build_manager_rows(ManagerAttendanceOptions(month="2026-04", factory_rest_days=1.5), [self.manager_id])

        self.assertEqual(rows[0]["marriage_days"], 0.5)
```

- [ ] **Step 6: 运行服务层测试**

Run: `python3 -m pytest tests/test_manager_attendance_service.py -k "factory_rest_overlap or marriage_leave_only_subtracts_matching_half_day" -v`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add services/manager_attendance_service.py tests/test_manager_attendance_service.py
git commit -m "feat: subtract factory rest overlap from manager leave additions"
```

---

### Task 4: 做账套与管理人员考勤的回归验证

**Files:**
- Modify: `tests/test_attendance_override_features.py`
- Modify: `tests/test_manager_attendance_service.py`

- [ ] **Step 1: 补锁定账套后不可修改厂休明细的测试**

在 `tests/test_attendance_override_features.py` 中新增：

```python
    def test_locked_account_set_rejects_factory_rest_entry_updates(self):
        with self.app.app_context():
            account = AccountSet(month="2026-04", name="2026-04 账套", is_locked=True)
            db.session.add(account)
            db.session.commit()
            account_id = account.id

        res = self.client.put(
            f"/admin/account-sets/{account_id}",
            json={"factory_rest_entries": [{"date": "2026-04-08", "period": "full"}]},
        )

        self.assertEqual(res.status_code, 400)
        self.assertIn("账套已锁定", res.get_json()["error"])
```

- [ ] **Step 2: 补非法月份日期的测试**

```python
    def test_update_account_set_rejects_factory_rest_date_outside_month(self):
        with self.app.app_context():
            account = AccountSet(month="2026-04", name="2026-04 账套")
            db.session.add(account)
            db.session.commit()
            account_id = account.id

        res = self.client.put(
            f"/admin/account-sets/{account_id}",
            json={"factory_rest_entries": [{"date": "2026-05-01", "period": "full"}]},
        )

        self.assertEqual(res.status_code, 400)
        self.assertIn("厂休日期必须属于当前账套月份", res.get_json()["error"])
```

- [ ] **Step 3: 跑账套相关测试**

Run: `python3 -m pytest tests/test_attendance_override_features.py -k "factory_rest" -v`

Expected: PASS

- [ ] **Step 4: 跑管理人员考勤相关测试**

Run: `python3 -m pytest tests/test_manager_attendance_service.py -v`

Expected: PASS

- [ ] **Step 5: 跑最小联动回归**

Run: `python3 -m pytest tests/test_attendance_override_features.py tests/test_manager_attendance_service.py -v`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add tests/test_attendance_override_features.py tests/test_manager_attendance_service.py
git commit -m "test: cover factory rest calendar regressions"
```

## Self-Review

- 规格覆盖检查：
  - “账套维护具体厂休日期”由 Task 1、Task 2 覆盖。
  - “自动汇总 `factory_rest_days`”由 Task 2 覆盖。
  - “出差/婚假/丧假扣除与厂休重叠部分”由 Task 3 覆盖。
  - “锁定与兼容校验”由 Task 4 覆盖。
- 占位符检查：计划中没有 `TODO/TBD/稍后实现` 一类占位描述。
- 类型一致性检查：
  - 明细字段统一命名为 `factory_rest_entries`。
  - 明细项字段统一命名为 `date` 和 `period`。
  - 时段统一只使用 `full / am / pm`。

