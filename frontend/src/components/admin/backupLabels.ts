import type { MonthlyBackupRow } from '../../api/accountSetBackup';

export const BACKUP_CATEGORIES: Record<string, string> = {
  account_settings: '账套参数与厂休', attendance: '考勤数据', meal_tickets: '菜票核算与充值',
  meal_ledgers: '菜票独立台账', archives: '原始文件', departments: '当前部门资料',
  employees: '当前员工资料', shifts: '班次与默认分配', accounts: '账号、密码与权限',
  cross_month: '跨月请假与加班', annual_stats: '年度统计与年假',
};
export const DATASET_LABELS: Record<string, string> = {
  account_set: '账套参数', factory_rest: '厂休', employees: '员工资料', departments: '部门资料', shifts: '班次资料',
  employee_shift_assignments: '员工默认班次', daily_records: '日报', monthly_reports: '月报',
  leave_records: '请假单', overtime_records: '加班单', daily_overrides: '逐日修正', employee_overrides: '员工月度修正',
  manager_overrides: '管理人员月度修正', annual_leave: '年度年假余额', manager_stats: '管理人员年度统计',
  override_history: '修正历史', sync_history: '同步历史', imports: '考勤原始文件', snapshots: '月度历史资料快照',
  users: '账号', user_employee_assignments: '账号人员授权', user_department_assignments: '账号部门授权',
  meal_batches: '菜票核算批次', meal_items: '菜票明细', meal_adjustments: '菜票补扣', meal_payments: '菜票充值与冲正',
  meal_imports: '菜票历史导入', meal_import_rows: '菜票导入明细', meal_ledger_records: '菜票独立台账记录', meal_ledger_imports: '菜票台账导入',
};
export const STATUS_LABELS = {new: '备份新增', changed: '值不一致', system_only: '系统独有', same: '一致'};
export const QUALITY_LABELS: Record<string, string> = {verified: '来源可证', baseline: '旧数据基线', partial: '资料不完整', missing: '缺少快照'};
export const EXITS_CURRENT = new Set(['employees', 'departments', 'shifts', 'users']);
const FIELD_LABELS: Record<string, string> = {
  emp_no: '工号', name: '姓名', dept_no: '部门编号', dept_name: '部门名称', parent_dept_no: '上级部门编号', parent_no: '上级部门编号',
  card_no: '卡号', dingtalk_user_id: '钉钉人员标识', is_active: '当前有效状态', resigned_at: '离职日期',
  is_manager: '管理人员', is_nursing: '哺乳期', meal_ticket_as_manager: '菜票按管理人员核算', include_in_manager_stats: '纳入管理人员统计',
  employee_stats_attendance_source: '员工考勤统计来源', manager_stats_attendance_source: '管理人员考勤统计来源',
  username: '用户名', role: '角色', disabled: '禁用状态', is_disabled: '禁用状态', permissions: '页面权限', page_permissions: '页面权限', profile_dept_no: '账号所属部门',
  avatar_preset: '头像样式', shift_no: '班次编号', shift_name: '班次名称', start_time: '开始时间', end_time: '结束时间',
  month: '业务月份', year: '年份', recharge_month: '充值月份', status: '状态', version: '版本', rule_version: '核算规则版本',
  amount_cents: '金额（分）', base_cents: '基础金额（分）', rate_cents: '单价（分）', days: '天数', payment_date: '支付日期',
  reason: '原因', reference: '凭据', kind: '类型', operator: '操作人', data: '业务资料', source: '来源资料', payload: '历史资料',

  is_locked: '锁定状态', is_cross_day: '跨日班次', time_slots: '班次时段', profile_emp_no: '账号关联工号', profile_name: '账号显示姓名',
  login_disabled_until_admin_unlock: '需管理员解锁', login_disabled_reason: '登录禁用原因',
  account_month: '账套月份', rest_date: '厂休日期', rest_period: '厂休时段', record_date: '日期', report_month: '报表月份',
  check_in_times: '上班打卡', check_out_times: '下班打卡', leave_hours: '请假工时', leave_type: '请假类型', overtime_hours: '加班工时', overtime_type: '加班类型', exception_reason: '异常原因',
  raw_data: '原始资料', employee_payload: '员工统计资料', manager_payload: '管理人员统计资料', employee_raw_data: '员工原始资料', manager_raw_data: '管理人员原始资料',
  leave_no: '请假单号', overtime_no: '加班单号', apply_date: '申请日期', approval_status: '审批状态', approval_comment: '审批意见', is_revoked: '撤销状态', is_manual_edited: '人工修改状态',
  is_weekend: '周末', is_holiday: '节假日', salary_option: '计薪方式', effective_hours: '有效工时', is_evening_overtime: '晚班加班', is_actual_attendance: '计入实际出勤',
  half_days: '半天出勤', actual_attendance_days: '实际出勤天数', late_early_minutes: '迟到早退分钟', injury_days: '工伤天数', business_trip_days: '出差天数', marriage_days: '婚假天数', funeral_days: '丧假天数',
  total_days: '总年假天数', used_days: '已用年假天数', stat_type: '统计类型', prev_dec: '上年十二月', remaining: '剩余数量', remark: '备注',
  override_type: '修正类型', action_type: '操作类型', changed_fields_json: '变更项目', before_values_json: '修正前资料', after_values_json: '修正后资料', source_file_name: '来源文件',
  read_count: '读取条数', imported_count: '导入条数', unmatched_count: '未匹配条数', unmatched: '未匹配资料', error_message: '错误信息', updated_at: '更新时间', finished_at: '完成时间',
  source_filename: '来源文件', file_type: '文件类型', key: '业务编号', batch_key: '核算批次编号', item_key: '菜票明细编号', emp_no_snapshot: '历史工号',
  created_by: '创建人', confirmed_by: '确认人', confirmed_at: '确认时间', reconciliation: '核对资料', error: '错误信息',
  request_key: '请求编号', request_digest: '请求内容是否变化', reversal_of: '冲正原记录', import_key: '导入编号', active_slot: '有效记录槽位', source_key: '来源编号',
  voided: '作废状态', void_reason: '作废原因', void_operator: '作废操作人', voided_at: '作废时间', business_key: '历史业务编号', source_digest: '来源内容是否变化', file_digest: '文件内容是否变化',
  query_home: '首页权限', meal_ledger_query: '菜票台账查询权限', meal_ticket_query: '菜票查询权限', individual_attendance: '个人考勤查询权限',
  manager_query: '管理人员考勤查询权限', manager_overtime_query: '管理人员加班查询权限', manager_annual_leave_query: '管理人员年假查询权限', manager_department_hours_query: '管理人员部门工时查询权限',
  employee_dashboard: '员工考勤查询权限', abnormal_query: '员工异常查询权限', punch_records: '员工打卡查询权限', department_hours_query: '员工部门工时查询权限', summary_download: '汇总下载权限',
  quality: '来源质量', provenance: '快照来源', schema_version: '资料格式版本', password_changed: '密码',
};
export function fieldLabel(field: {name: string; label?: string}) {
  if (/^m([1-9]|1[0-2])$/.test(field.name)) return `${field.name.slice(1)} 月`;
  if (/^agg_\d+$/.test(field.name)) return `汇总项目 ${Number(field.name.slice(4))}`;
  return FIELD_LABELS[field.name] ?? (field.label && /[\u3400-\u9fff]/.test(field.label) ? field.label : '其他资料变化');
}
export function rowIdentity(row: MonthlyBackupRow) {
  const raw = row.row_key.slice(row.scope.length + 1);
  try { const parts = JSON.parse(raw); return Array.isArray(parts) ? parts.filter(part => part !== 'slot' && part !== 'filename').join(' · ') : '记录'; }
  catch { return '记录'; }
}
export function rowLabel(row: MonthlyBackupRow) {
  const name = row.backup?.name ?? row.system?.name ?? row.backup?.dept_name ?? row.system?.dept_name ?? row.backup?.profile_name ?? row.system?.profile_name;
  return `${DATASET_LABELS[row.dataset] ?? '业务记录'} ${rowIdentity(row)}${typeof name === 'string' && name ? ` · ${name}` : ''}`;
}
export function humanBackupMessage(message: string) {
  return message.replace(/[a-z][a-z0-9_]+/g, key => FIELD_LABELS[key] ?? DATASET_LABELS[key] ?? ({employee:'员工',department:'部门',shift:'班次'} as Record<string,string>)[key] ?? key);
}
const SOURCE_LABELS: Record<string, string> = {current_baseline: '旧数据基线', normal_capture: '月度采集', legacy_baseline: '旧数据基线', archive: '归档提取', backup_restore: '备份恢复', explicit_month_correction: '月内明确修正', explicit_evidence_selection: '明确选择历史证据'};
export function snapshotSource(provenance: unknown): string {
  const source = provenance && typeof provenance === 'object' ? (provenance as {source?: unknown}).source : provenance;
  return SOURCE_LABELS[String(source)] ?? '来源已记录，需核对';
}
export function displayBackupValue(value: unknown, name = ''): string {
  if (name === 'password_hash') return '密码内容不展示';
  if (value === null || value === undefined) return '空';
  if (/hash|digest|sha256/.test(name)) return '内容摘要（不展示）';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (name === 'changed_fields_json' && Array.isArray(value)) return value.map(item => fieldLabel({name:String(item)})).join('、');
  if (Array.isArray(value)) return value.map(item => displayBackupValue(item)).join('、') || '空';
  if (typeof value === 'object') return Object.entries(value).filter(([key]) => key !== 'password_hash').map(([key, item]) => `${fieldLabel({name:key})}：${displayBackupValue(item, key)}`).join('；') || '空';
  if (typeof value === 'string') {
    if (/^[\[{]/.test(value.trim())) { try { return displayBackupValue(JSON.parse(value)); } catch { return '结构化资料（请核对来源）'; } }
    return QUALITY_LABELS[value] ?? SOURCE_LABELS[value] ?? ({admin:'管理员',readonly:'只读账号',local:'本地考勤',card_db:'考勤机',dingtalk:'钉钉',employee:'员工',department:'部门',shift:'班次',full:'全天',am:'上午',pm:'下午'} as Record<string,string>)[value] ?? value;
  }
  return String(value);
}
