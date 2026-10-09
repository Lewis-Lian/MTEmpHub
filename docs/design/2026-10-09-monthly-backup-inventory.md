# Monthly backup stage 0 inventory

Date: 2026-10-09. Static ORM metadata and source inspection only; no business database read. This records v1 mappings and v2 requirements, not a claim that v2 exists.

## Every ORM table and field

JSON business columns travel intact, including source identities and idempotency data. Stage 4 will add the automatic coverage gate.

### `account_set_backup_origins`

Fields: `id`, `dataset`, `origin_key`, `local_id`, `provenance`

Local mapping table, not copied wholesale: id/local_id stay local; dataset/origin_key/provenance travel with imports/sync_history/override_history portable identities. Restore rebuilds local_id.

Foreign keys: (none)

### `account_set_backup_restores`

Fields: `id`, `month`, `operator_id`, `backup_digest`, `counts`, `created_at`

Local restore audit, excluded from overwritable backup content: id/month/operator_id/backup_digest/counts/created_at stay at target. Keep user rows for operator_id. Stage 3/8 adds operator-name snapshot and multi-month task information.

Foreign keys: operator_id -> users.id

### `account_set_factory_rest_days`

Category: account_settings; dataset: `factory_rest`; key: `rest_date + rest_period`; scope: `account`.

Mapped fields: `rest_date`, `rest_period`

References/exclusions: `id`: local ID, never imported; `account_set_id`: map through month; `created_at`: excluded local creation timestamp (explicitly mapped business-audit timestamps remain exported)

Foreign keys: account_set_id -> account_sets.id

### `account_set_imports`

Category: attendance / archives for imports; dataset: `imports`; key: `origin_key`; scope: `account`.

Mapped fields: `source_filename`, `file_type`, `status`, `imported_count`, `error_message`, `created_at`

References/exclusions: `id`: local ID, never imported; `account_set_id`: map through month; `stored_path`: archives member, checksum and size; allocate a target path

Foreign keys: account_set_id -> account_sets.id

### `account_sets`

Fields: `id`, `month`, `name`, `is_active`, `is_locked`, `locked_at`, `locked_by`, `factory_rest_days`, `monthly_benefit_days`, `created_at`, `updated_at`

account_settings: month is the scope key; name/factory_rest_days/monthly_benefit_days are exported. id is local. is_active is target selection state; is_locked/locked_at/locked_by are target locks, not overwritten. created_at/updated_at are local lifecycle timestamps.

Foreign keys: locked_by -> users.id

### `annual_leave`

Category: annual_stats; dataset: `annual_leave`; key: `emp_no + year`; scope: `year`.

Mapped fields: `year`, `total_days`, `used_days`, `remaining_days`

References/exclusions: `id`: local ID, never imported; `emp_id`: map through emp_no

Foreign keys: emp_id -> employees.id

### `attendance_override_histories`

Category: attendance / archives for imports; dataset: `override_history`; key: `origin_key`; scope: `month`.

Mapped fields: `override_type`, `month`, `action_type`, `changed_fields_json`, `before_values_json`, `after_values_json`, `remark`, `source_file_name`, `created_at`

References/exclusions: `id`: local ID, never imported; `emp_id`: map through emp_no; `operator_user_id`: source audit identity in provenance, not a target ID

Foreign keys: emp_id -> employees.id; operator_user_id -> users.id

### `daily_attendance_overrides`

Category: attendance / archives for imports; dataset: `daily_overrides`; key: `emp_no + record_date`; scope: `date`.

Mapped fields: `record_date`, `status`, `is_evening_overtime`, `is_actual_attendance`, `work_hours`, `late_minutes`, `early_leave_minutes`, `remark`

References/exclusions: `id`: local ID, never imported; `emp_id`: map through emp_no; `updated_by`: v1 excluded local operator; v2 needs username/source-identity decision; `updated_at`: v1 excluded local update timestamp; v2 must explicitly register source-history or exclusion

Foreign keys: emp_id -> employees.id; updated_by -> users.id

### `daily_records`

Category: attendance / archives for imports; dataset: `daily_records`; key: `emp_no + record_date`; scope: `date`.

Mapped fields: `record_date`, `expected_hours`, `actual_hours`, `absent_hours`, `check_in_times`, `check_out_times`, `leave_hours`, `leave_type`, `overtime_hours`, `overtime_type`, `late_minutes`, `early_leave_minutes`, `exception_reason`, `raw_data`, `employee_payload`, `manager_payload`

References/exclusions: `id`: local ID, never imported; `emp_id`: map through emp_no; `shift_id`: map through shift_no

Foreign keys: emp_id -> employees.id; shift_id -> shifts.id

### `departments`

Category: departments; dataset: `departments`; key: `dept_no`; scope: `shared`.

Mapped fields: `dept_no`, `dept_name`, `is_locked`

References/exclusions: `id`: local ID, never imported; `parent_id`: map through parent_no/dept_no

Foreign keys: parent_id -> departments.id

### `dingtalk_sync_runs`

Category: attendance / archives for imports; dataset: `sync_history`; key: `origin_key`; scope: `account`.

Mapped fields: `month`, `source`, `status`, `read_count`, `imported_count`, `unmatched_count`, `unmatched`, `error_message`, `started_at`, `finished_at`

References/exclusions: `id`: local ID, never imported; `account_set_id`: map through month

Foreign keys: account_set_id -> account_sets.id

### `employee_attendance_overrides`

Category: attendance / archives for imports; dataset: `employee_overrides`; key: `emp_no + month`; scope: `month`.

Mapped fields: `month`, `attendance_days`, `work_hours`, `half_days`, `actual_attendance_days`, `late_early_minutes`, `remark`

References/exclusions: `id`: local ID, never imported; `emp_id`: map through emp_no; `updated_by`: v1 excluded local operator; v2 needs username/source-identity decision; `updated_at`: v1 excluded local update timestamp; v2 must explicitly register source-history or exclusion

Foreign keys: emp_id -> employees.id; updated_by -> users.id

### `employee_shift_assignments`

Category: employee_shift_assignments; dataset: `employee_shift_assignments`; key: `emp_no`; scope: `shared`.

Mapped fields: (references only)

References/exclusions: `id`: local ID, never imported; `emp_id`: map through emp_no; `shift_id`: map through shift_no

Foreign keys: emp_id -> employees.id; shift_id -> shifts.id

### `employees`

Category: employees; dataset: `employees`; key: `emp_no`; scope: `shared`.

Mapped fields: `emp_no`, `name`, `card_no`, `dingtalk_user_id`, `is_manager`, `is_nursing`, `meal_ticket_as_manager`, `include_in_manager_stats`, `employee_stats_attendance_source`, `manager_stats_attendance_source`, `resigned_at`

References/exclusions: `id`: local ID, never imported; `dept_id`: map through dept_no; `created_at`: excluded local creation timestamp (explicitly mapped business-audit timestamps remain exported)

Foreign keys: dept_id -> departments.id

### `leave_records`

Category: cross_month; dataset: `leave_records`; key: `leave_no`; scope: `interval`.

Mapped fields: `leave_no`, `apply_date`, `leave_type`, `start_time`, `end_time`, `duration`, `reason`, `approval_status`, `approval_comment`, `is_revoked`, `is_manual_edited`

References/exclusions: `id`: local ID, never imported; `emp_id`: map through emp_no

Foreign keys: emp_id -> employees.id

### `manager_attendance_overrides`

Category: attendance / archives for imports; dataset: `manager_overrides`; key: `emp_no + month`; scope: `month`.

Mapped fields: `month`, `attendance_days`, `injury_days`, `business_trip_days`, `marriage_days`, `funeral_days`, `late_early_minutes`, `remark`

References/exclusions: `id`: local ID, never imported; `emp_id`: map through emp_no; `updated_by`: v1 excluded local operator; v2 needs username/source-identity decision; `updated_at`: v1 excluded local update timestamp; v2 must explicitly register source-history or exclusion

Foreign keys: emp_id -> employees.id; updated_by -> users.id

### `manager_month_stats`

Category: annual_stats; dataset: `manager_stats`; key: `emp_no + year + stat_type`; scope: `year`.

Mapped fields: `year`, `stat_type`, `prev_dec`, `m1`, `m2`, `m3`, `m4`, `m5`, `m6`, `m7`, `m8`, `m9`, `m10`, `m11`, `m12`, `remaining`, `remark`, `automatic_values`, `manual_values`

References/exclusions: `id`: local ID, never imported; `emp_id`: map through emp_no

Foreign keys: emp_id -> employees.id

### `meal_ledger_imports`

Category: meal_ledgers; dataset: `meal_ledger_imports`; key: `key`; scope: `month`.

Mapped fields: `key`, `kind`, `month`, `source_filename`, `file_digest`, `data`, `status`, `operator`, `created_at`

References/exclusions: `id`: local ID, never imported; `stored_path`: archives member, checksum and size; allocate a target path

Foreign keys: (none)

### `meal_ledger_records`

Category: meal_ledgers; dataset: `meal_ledger_records`; key: `key`; scope: `month`.

Mapped fields: `key`, `kind`, `month`, `record_date`, `amount_cents`, `data`, `active_slot`, `request_key`, `request_digest`, `source_key`, `operator`, `created_at`, `voided`, `void_reason`, `void_operator`, `voided_at`

References/exclusions: `id`: local ID, never imported

Foreign keys: (none)

### `meal_ticket_adjustments`

Category: meal_tickets; dataset: `meal_adjustments`; key: `key`; scope: `month`.

Mapped fields: `key`, `item_key`, `month`, `amount_cents`, `reason`, `operator`, `created_at`

References/exclusions: `id`: local ID, never imported

Foreign keys: item_key -> meal_ticket_items.key

### `meal_ticket_batches`

Category: meal_tickets; dataset: `meal_batches`; key: `month`; scope: `account`.

Mapped fields: `key`, `month`, `recharge_month`, `rule_version`, `rate_cents`, `status`, `version`, `source_digest`, `created_by`, `confirmed_by`, `created_at`, `confirmed_at`, `reconciliation`

References/exclusions: `id`: local ID, never imported; `account_set_id`: map through month

Foreign keys: account_set_id -> account_sets.id

### `meal_ticket_import_rows`

Category: meal_tickets; dataset: `meal_import_rows`; key: `key`; scope: `month`.

Mapped fields: `key`, `import_key`, `month`, `data`

References/exclusions: `id`: local ID, never imported; `emp_id`: map through emp_no

Foreign keys: import_key -> meal_ticket_imports.key; emp_id -> employees.id

### `meal_ticket_imports`

Category: meal_tickets; dataset: `meal_imports`; key: `key`; scope: `month`.

Mapped fields: `key`, `month`, `recharge_month`, `source_filename`, `file_digest`, `status`, `operator`, `created_at`

References/exclusions: `id`: local ID, never imported; `stored_path`: archives member, checksum and size; allocate a target path

Foreign keys: (none)

### `meal_ticket_items`

Category: meal_tickets; dataset: `meal_items`; key: `key`; scope: `month`.

Mapped fields: `key`, `batch_key`, `month`, `emp_no_snapshot`, `name`, `dept_name`, `is_manager`, `days`, `base_cents`, `source`, `error`

References/exclusions: `id`: local ID, never imported; `emp_id`: map through emp_no

Foreign keys: batch_key -> meal_ticket_batches.key; emp_id -> employees.id

### `meal_ticket_payments`

Category: meal_tickets; dataset: `meal_payments`; key: `key`; scope: `month`.

Mapped fields: `key`, `item_key`, `month`, `kind`, `amount_cents`, `payment_date`, `reference`, `operator`, `request_key`, `request_digest`, `reversal_of`, `created_at`

References/exclusions: `id`: local ID, never imported

Foreign keys: item_key -> meal_ticket_items.key; reversal_of -> meal_ticket_payments.key

### `messages`

Fields: `id`, `sender_id`, `recipient_id`, `title`, `content`, `created_at`, `read_at`

Excluded: id/sender_id/recipient_id/title/content/created_at/read_at belong to independent messaging and read state, outside the confirmed monthly business scope. Keep users to preserve local audit/message FKs.

Foreign keys: sender_id -> users.id; recipient_id -> users.id

### `monthly_reports`

Category: attendance / archives for imports; dataset: `monthly_reports`; key: `emp_no + report_month`; scope: `report_month`.

Mapped fields: `report_month`, `agg_01`, `agg_02`, `agg_03`, `agg_04`, `agg_05`, `agg_06`, `agg_07`, `agg_08`, `agg_09`, `agg_10`, `agg_11`, `agg_12`, `agg_13`, `agg_14`, `agg_15`, `agg_16`, `agg_17`, `agg_18`, `agg_19`, `agg_20`, `agg_21`, `agg_22`, `agg_23`, `agg_24`, `agg_25`, `agg_26`, `agg_27`, `agg_28`, `agg_29`, `agg_30`, `agg_31`, `agg_32`, `agg_33`, `agg_34`, `agg_35`, `agg_36`, `agg_37`, `agg_38`, `agg_39`, `agg_40`, `agg_41`, `agg_42`, `agg_43`, `agg_44`, `agg_45`, `agg_46`, `agg_47`, `agg_48`, `agg_49`, `agg_50`, `agg_51`, `agg_52`, `agg_53`, `agg_54`, `agg_55`, `agg_56`, `agg_57`, `agg_58`, `agg_59`, `agg_60`, `agg_61`, `agg_62`, `agg_63`, `agg_64`, `agg_65`, `agg_66`, `agg_67`, `agg_68`, `agg_69`, `agg_70`, `agg_71`, `agg_72`, `agg_73`, `agg_74`, `agg_75`, `agg_76`, `agg_77`, `agg_78`, `agg_79`, `agg_80`, `agg_81`, `agg_82`, `agg_83`, `agg_84`, `raw_data`, `employee_raw_data`, `manager_raw_data`

References/exclusions: `id`: local ID, never imported; `emp_id`: map through emp_no

Foreign keys: emp_id -> employees.id

### `overtime_records`

Category: cross_month; dataset: `overtime_records`; key: `overtime_no`; scope: `interval`.

Mapped fields: `overtime_no`, `start_time`, `end_time`, `is_weekend`, `is_holiday`, `salary_option`, `effective_hours`, `reason`, `approval_status`, `approval_comment`, `is_revoked`, `is_manual_edited`

References/exclusions: `id`: local ID, never imported; `emp_id`: map through emp_no

Foreign keys: emp_id -> employees.id

### `shifts`

Category: shifts; dataset: `shifts`; key: `shift_no`; scope: `shared`.

Mapped fields: `shift_no`, `shift_name`, `time_slots`, `is_cross_day`

References/exclusions: `id`: local ID, never imported

Foreign keys: (none)

### `system_settings`

Fields: `id`, `key`, `value`

Excluded: id/key/value are global runtime/integration settings and may contain secrets; not confirmed backup content. Stage 2 must freeze the actual attendance source used for historical calculation, instead of trusting current manager_attendance_source.

Foreign keys: (none)

### `user_department_assignments`

Fields: `id`, `user_id`, `dept_id`

accounts: user_id -> username, dept_id -> dept_no; id is local.

Foreign keys: user_id -> users.id; dept_id -> departments.id

### `user_employee_assignments`

Fields: `id`, `user_id`, `emp_id`

accounts: user_id -> username, emp_id -> emp_no; id is local.

Foreign keys: user_id -> users.id; emp_id -> employees.id

### `users`

Fields: `id`, `username`, `profile_emp_no`, `profile_name`, `profile_dept_id`, `password_hash`, `role`, `page_permissions`, `login_failed_attempts`, `login_locked_until`, `login_disabled_until_admin_unlock`, `login_disabled_reason`, `avatar`, `created_at`

accounts (stages 3/5): username is the key; profile_emp_no/profile_name/password_hash/role/page_permissions/is_active/login_disabled_until_admin_unlock/login_disabled_reason/created_at are account data. profile_dept_id maps through dept_no (no declared FK today). user_employee_assignments/user_department_assignments map through emp_no/dept_no. avatar becomes an archives reference, never a local path. id and auth_version are local only; auth_version must increment on the target for affected restored accounts, never be imported from the source. login_failed_attempts/login_locked_until are local temporary lockout state and excluded. Long-term disable state must not be mistaken for temporary lockout. is_active is independent of these lockout fields; clearing a lockout never reactivates an archived account. Stage 4 must register these explicit field decisions; stage 5 implements serialization and stage 8 calls local revocation during atomic restore.

Foreign keys: (none)

## Boundaries and known gaps

Stage 1 adds `monthly_reference_snapshots` (the ORM now has 34 tables):
`month/kind/business_key` form the portable monthly identity; `payload`, `provenance`,
`quality`, `schema_version`, `created_at`, `updated_at` are month-owned business
reference data, to be registered with monthly backup categories in stage 4.
`id` stays local. There are no FKs to mutable current rows. Stage 1 also adds
`employees.is_active`, `departments.is_active`, `shifts.is_active`: portable current
state for stages 4/5, independent of resignation and locking. V1 remains unchanged.

- Account avatars need private file collection and portable references in stages 5/6. Preview tokens, metadata/progress files, locks and file cleanup journals are local temporary filesystem state, not ORM content.
- Employee deletion cascades through daily/monthly/leave/overtime/annual/manager/authorization/shift-assignment relationships. Exiting current references must update independent active state, not delete rows. Department parent trees, shifts and meal payment/reversal FKs must remain intact.
- Meal import preview statuses and data JSON are business source information, not disposable preview-token state. Preserve request_key/request_digest/source_key and file dependencies.
- Cross-month leave/overtime is deduplicated by business key and actual interval. Annual data including prev_dec and m1..m12 needs explicit effect scope.
- Existing whole-database migration list omits daily_attendance_overrides, messages and account_set_backup_origins/restores. Record this prior gap; stage 1 only adds the new snapshot table.

## Historical consumers for stage 2

| Location | Current reference dependency |
| --- | --- |
| routes/query_core.py _accessible_emp_ids, _non_manager_emp_ids, _manager_emp_ids, _accessible_manager_emp_ids, _keyword_filtered_emp_ids, departments_api | Current resignation, manager flag, department tree, name filtering; keep current account authorization but match historical membership by month |
| query_core _build_final_rows, _build_abnormal_rows, _build_leave_detail_rows, _build_department_hours_rows, _build_manager_department_hours_rows, _top_level_department_name | Current names and department hierarchy used by historical lists and grouped results |
| query_core _resolve_shift_for_record, _build_shift_break_windows, _calc_record_work_hours, _build_attendance_calendar_payload | Current default shift, shift time_slots and attendance source/type used in historical hours/calendar |
| query_core home_manager_summary_api, punch_records API/export/modal export, manager_punch_records_api, manager_leave_records_api, leave_records_export_api, summary_download_export_api | Current employee/department/type data repeatedly loaded for history and downloads |
| query_core _manager_export_rows_with_top_level_departments, _manager_export_scope, final/manager/abnormal/department export endpoints | Template exports reload current highest-level departments and names |
| services/manager_attendance_service.py build_manager_rows, _manager_schedule_late_minutes_from_views | Current is_manager/resigned_at/name/department/source/shift used for selection and recalculation |
| services/attendance_source_service.py attendance_source_for_context, build_attendance_record_view, attendance_views_by_employee, selected_monthly_report_raw | Current employee source configuration and record.employee/shift ORM relations |
| services/attendance_service.py monthly_summary/yearly_summary/deduction_calc; attendance_summary_service.py batch_monthly_summaries | Current employee chooses attendance source; applies to year and deduction calculations |
| services/late_offset_service.py late_offset_candidates/_late_views_by_employee/_day_late_minutes/confirm_late_offset | Current manager/resignation filtering, source and identity affects historical offset selection/calculation |
| services/meal_ticket_service.py source_snapshot/attendance_recalculation_preview/supplement_person/recalculate_attendance/serialize_batch | Current membership, resignation, manager/exemption flags, department and source; existing item identity snapshots must survive current changes |
| routes/admin_core.py calculate_account_set/_manager_base_month_values/_apply_saved_manager_stats/_manager_attendance_list_response/_employee_override_list_response/_sync_manager_stats_from_manager_rows | Current employee/type/source participates in calculation and annual exports |
| admin_core employee/department/shift maintenance; admin_imports base XLSX import/export | Use active current candidates; re-import business key reuses row; separate current changes from explicit monthly reference correction |
| services/import_service.py daily/monthly imports; dingtalk_manager_attendance_service.py; card_attendance_sync_service.py; admin_imports import_raw_files | Month creation/write entry points for missing-only capture in stage 2 |
| routes/auth_helpers.py, admin_accounts.py, messages.py | Keep current permissions and operator identities; source IDs are not reusable target IDs |
| services/account_set_backup_service.py/account_set_restore_service.py | v1 shared data is a related subset; changed defaults to system; deletion whitelist and meal overwrite blockers remain until stages 4-8 |
| services/meal_ledger_export.py, meal_ticket_import_service.py | Existing data/item history is evidence; current employee lookup is for matching, not historical truth |

## Baseline evidence

- Initial branch master; only the two untracked design/plan documents. Work in the user-requested directory, preserve contents; no reset/stash/checkout, production DB, deployment or push.
- No python command on PATH. .venv-mac/bin/python and .venv-mac2/bin/python provide Python 3.9.6; use the former. Tests use fixture SQLite memory/tmp_path databases.
- `.venv-mac/bin/python -m pytest tests/test_account_set_backup.py tests/test_account_set_restore.py tests/test_account_set_backup_api.py -q`: 37 passed in 4.29s.
- In frontend: `npm test -- src/components/admin/AccountSetBackupModal.test.tsx`: 6 passed.
- Stage 0 is read-only inventory, with no new production behavior to drive a RED test. RED/GREEN implementation starts in stage 1.

## Stage 1 handoff boundaries

- `ensure_month_reference(month)` explicitly captures missing current baselines;
  it never overwrites any existing baseline, verified or partial snapshot and
  never commits the caller's transaction. Historical source candidates are not
  automatically chosen. `get_month_reference` returns a detached payload copy.
- The read-only scan lists account/business months, missing keys, raw daily/monthly
  and meal identity candidates, sources and conflicts. Workbook archives are
  listed as `not_inspected`; this stage does not claim to reconstruct their data.
- Explicit CLI entry points: `flask --app manage scan-month-references` (read only)
  and `flask --app manage capture-month-references --month 2026-06` (writes only
  missing baselines). For multiple months, repeat `--month`; one transaction covers
  all requested months. These are deployment/operator commands; they were exercised
  only through fixture app runners, never against the user's database.
- Apply schema migrations before using the new model on a real installation:
  `flask --app manage db upgrade`; the compatible legacy upgrade path also adds
  active fields and the snapshot table, with no history capture/recalculation.
  No deployment or production migration was performed in this session.
- Stage 2 must still connect historical membership, permissions, queries, downloads
  and calculations; resolve proven archive candidates explicitly and preserve quality
  information. The active field alone does not yet filter maintenance candidates.
  Do not enable full shared-reference removal until that stage is verified.


## Stage 2 handoff boundaries

- Historical consumers now resolve monthly employees, departments, shifts, attendance
  sources and member eligibility through `month_reference_views`, `month_employees`
  and `month_employee`. Current account grants still apply to the selected month's
  department tree and membership; revoking grants immediately removes access.
- Calendar, query bootstrap/filter candidates, summaries, manager calculations,
  attendance overrides, annual saved-row labels, late offsets, downloads and meal
  recalculation use the selected month's identity. Existing meal-item identity
  snapshots remain authoritative for their original documents. Frontend bootstrap
  caches and candidate refreshes distinguish months.
- Daily/monthly imports and card/DingTalk writes capture a new month in their business
  transaction. Existing captured months do not enroll later hires or refresh references
  during reimports or reads. Global ingestion switches are frozen too. Capture remains
  `baseline`, rather than claiming verified history.
- Current employee/department/shift candidate and export lists filter `is_active`.
  Re-importing or creating an inactive business key reactivates its original local row.
  Physical delete, batch delete and empty-department cleanup preserve snapshot-bound
  rows. Snapshot-bound numbers currently cannot be changed (409); this is the stated
  conservative assumption pending the user's numbering preference, not a new permanent
  product requirement. Names and other current attributes remain editable.
- `reference_change_blockers(month, proposed, selected_categories)` accepts proposed
  `{kind, business_key, payload}` rows and returns conflicts with `month`,
  `required_categories`, `affected_months` and `reason`. Existing attendance and meal
  consumers must be explicitly selected together before changing a shared monthly
  reference. Stage 7 must call this against final selections; it never adds categories
  or months automatically. No new shared-reference restore/deletion defaults are enabled.
- Explicit operators can use `correct-month-reference --month --kind --key
  --payload-file --category` and `reconcile-month-evidence --month --decisions-file
  --category [--inspect-archives]`. Both check locks and shared consumers, affect only
  the selected month, retain field provenance, and leave quality `partial`.
  Reconciliation decisions use `{business_key, field, value}` from the read-only scan;
  conflicting candidates require exact explicit choice. Department-name evidence must
  map uniquely to a monthly department or be corrected first.
- `scan-month-references --inspect-archives` optionally inspects archived workbooks
  read-only, reports source filenames/rows and conflicting identity candidates; unreadable
  archives stay marked. Baseline and missing warnings are returned by calendars and
  shown in the UI. An uncaptured legacy month keeps compatibility reads with an explicit
  warning; it is not protected historical truth until evidence is reviewed and references
  explicitly captured/reconciled. The deployment migration and legacy-data review are
  prerequisites to enabling future shared-reference restore on an installation.
- These commands were exercised only via isolated fixture runners. Production capture,
  reconciliation, migration and external sync were not performed. Continue at stage 3
  (account activity/auth-version/token revocation), then format/coverage/restore stages.
