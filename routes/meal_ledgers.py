from flask import Blueprint, g, jsonify, request, send_file

from models import db
from models.meal_ledger import MealLedgerRecord, MealLedgerImport
from routes.auth_helpers import admin_required, page_permission_required, any_page_permission_required
from routes.meal_tickets import handled
from services import meal_ledger_service as ledger
from services.meal_ticket_service import MealError, begin_write

meal_ledgers_bp = Blueprint('meal_ledgers', __name__, url_prefix='/api/meal-ledgers')


@meal_ledgers_bp.get('/annual')
@page_permission_required('meal_ledger_query')
@handled
def annual():
    return jsonify(ledger.annual(request.args.get('year')))


@meal_ledgers_bp.get('/<kind>')
@page_permission_required('meal_ledger_query')
@handled
def get_records(kind):
    if kind not in ledger.KINDS:
        raise MealError('台账类型不存在', 404)
    month = ledger.month_checked(request.args.get('month'))
    if kind == 'department':
        return jsonify(ledger.departments(month))
    return jsonify([ledger.serialize(r) for r in ledger.records(kind, month)])


@meal_ledgers_bp.post('/<kind>')
@admin_required
@handled
def create_record(kind):
    operator = g.current_user.username
    body = request.get_json(silent=True) or {}
    begin_write()
    record = ledger.create(kind, body, operator)
    result = ledger.serialize(record)
    db.session.commit()
    return jsonify(result)


@meal_ledgers_bp.post('/records/<int:identifier>/void')
@admin_required
@handled
def void_record(identifier):
    operator = g.current_user.username
    body = request.get_json(silent=True) or {}
    begin_write()
    record = MealLedgerRecord.query.filter_by(id=identifier).with_for_update().first()
    if not record:
        raise MealError('记录不存在', 404)
    ledger.void(record, body.get('reason'), operator)
    result = ledger.serialize(record)
    db.session.commit()
    return jsonify(result)


@meal_ledgers_bp.post('/imports/preview')
@admin_required
@handled
def preview_import():
    from services.meal_ledger_import import preview, serialized
    upload = request.files.get('file')
    if upload is None:
        raise MealError('请选择 xlsx 文件')
    result = preview(request.form.get('kind'), request.form.get('month'), upload, g.current_user.username)
    data = serialized(result)
    db.session.commit()
    return jsonify(data)


@meal_ledgers_bp.post('/imports/<int:identifier>/confirm')
@admin_required
@handled
def confirm_import(identifier):
    from services.meal_ledger_import import confirm, serialized
    operator = g.current_user.username
    body = request.get_json(silent=True) or {}
    begin_write()
    record = MealLedgerImport.query.filter_by(id=identifier).with_for_update().first()
    if record is None:
        raise MealError('导入预览不存在', 404)
    result = serialized(confirm(record, body.get('rows'), operator))
    db.session.commit()
    return jsonify(result)


@meal_ledgers_bp.get('/imports')
@admin_required
@handled
def imports():
    from services.meal_ledger_import import serialized
    return jsonify([serialized(r) for r in MealLedgerImport.query.order_by(MealLedgerImport.id.desc()).all()])


@meal_ledgers_bp.get('/export')
@any_page_permission_required(('meal_ticket_query', 'meal_ledger_query'))
@handled
def export():
    from services.meal_ledger_export import export as build
    from routes.meal_tickets import accessible
    report = request.args.get('report')
    user = g.current_user
    person_report = report in ('recharge', 'department')
    full_department = report == 'department' and user.can_access_page('meal_ledger_query')
    if user.role != 'admin' and not full_department and not user.can_access_page('meal_ticket_query' if person_report else 'meal_ledger_query'):
        raise MealError('无此报表下载权限', 403)
    output, filename = build(report, request.args.get('month'), request.args.get('year'),
        accessible() if person_report and not full_department else None, request.args)
    return send_file(output, as_attachment=True, download_name=filename,
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
