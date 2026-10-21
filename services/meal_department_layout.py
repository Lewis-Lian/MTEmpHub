"""Installation-level print layout; independent of monthly business backup data."""
import json

from models.department import Department
from models.meal_ticket import MealTicketItem
from models.meal_ledger import MealLedgerRecord
from models.system_setting import SystemSetting
from services.meal_ticket_service import MealError, cents


SETTING_KEY = 'meal_department_print_layout'
DEPARTMENT_ALIASES = {'保洁': '行政部-保洁', '计划下单': '计划部', '计划物控': '计划部'}
DEFAULT_LAYOUT = {
    'left': ['胡存寿-木皮线', '周云志-备料线1', '刘春霞-备料线2', '刘春霞-备料线3',
        '吴堂华-组拼线', '杨增贵-贴面线', '吴光贵-镶嵌线', '张大兰-门套线', '叶靖峰-墙柜1',
        '吴惠连-墙柜2', '吴玲红-装配线', '翁庆玲-往复一线', '吴荣贵-往复二三（1）线',
        '陈祥宇-往复二三（2）线', '逢平门扇包装线', '逢平门套包装线', '吴通政衍生品包装', '19'],
    'right': ['总经办', '行政部', '行政部-保洁', '后勤机动队', '安全管理部', '财务部', '品质部',
        '计划部', '装车机动队', '技术部', '设备动力部', '生产部', '叉车队26'],
}


def print_department_name(name):
    name = name.strip()
    return DEPARTMENT_ALIASES.get(name, name)


def load_layout():
    value = SystemSetting.get_value(SETTING_KEY)
    saved = json.loads(value) if value else DEFAULT_LAYOUT
    layout, seen = {}, set()
    for side in ('left', 'right'):
        layout[side] = []
        for name in saved[side]:
            name = print_department_name(name)
            if name not in seen:
                layout[side].append(name)
                seen.add(name)
    return layout


def layout_options():
    layout = load_layout()
    known = set(layout['left'] + layout['right'])
    names = {name for name, in Department.query.with_entities(Department.dept_name).filter_by(is_active=True)}
    names.update(name for name, in MealTicketItem.query.with_entities(MealTicketItem.dept_name).distinct())
    names.update(row.data['dept_name'] for row in MealLedgerRecord.query.filter_by(kind='department', voided=False))
    return {**layout, 'unassigned': sorted({print_department_name(name) for name in names} - known)}


def print_department_totals(items):
    groups = {}
    for item in items:
        name = print_department_name(item['dept_name'])
        if name not in groups:
            groups[name] = {**item, 'dept_name': name}
            continue
        group = groups[name]
        group['count'] += item['count']
        for key in ('paid_amount', 'external_card_amount', 'external_paper_amount', 'total_paid_amount'):
            group[key] = (cents(group[key]) + cents(item[key])) / 100
        for key in ('remark', 'registrar'):
            group[key] = '；'.join(dict.fromkeys(filter(None, (*group[key].split('；'), item[key]))))
        if item.get('historical_amount') is not None:
            group['historical_amount'] = item['historical_amount']
    return list(groups.values())


def save_layout(body):
    if not isinstance(body, dict) or any(not isinstance(body.get(side), list) for side in ('left', 'right')):
        raise MealError('请分别设置左右两侧部门列表')
    layout = {}
    seen = set()
    for side in ('left', 'right'):
        layout[side] = []
        for name in body[side]:
            if not isinstance(name, str) or not name.strip() or len(name) > 120:
                raise MealError('部门名称必须为 1 至 120 字')
            name = print_department_name(name)
            if name in seen:
                raise MealError('同一部门不能重复放置')
            seen.add(name)
            layout[side].append(name)
    SystemSetting.set_value(SETTING_KEY, json.dumps(layout, ensure_ascii=False))
