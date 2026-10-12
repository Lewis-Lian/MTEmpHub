"""Administrator-only snapshot inspection and explicit preview/apply endpoints."""
from functools import wraps

from flask import jsonify, request
from sqlalchemy.exc import IntegrityError

from models import db
from services.monthly_reference_management_service import (
    ReferencePreviewChanged, apply_reference_operation, list_reference_months,
    preview_reference_operation, reference_detail,
)


def register_monthly_reference_routes(bp, admin_required):
    def handled(function):
        @wraps(function)
        def wrapped(*args, **kwargs):
            try:
                return function(*args, **kwargs)
            except LookupError as exc:
                db.session.rollback()
                return jsonify(error=str(exc)), 404
            except (ReferencePreviewChanged, IntegrityError):
                db.session.rollback()
                return jsonify(error='资料已发生变化，请重新核对并预览'), 409
            except ValueError as exc:
                db.session.rollback()
                return jsonify(error=str(exc)), 400
        return wrapped

    @bp.get('/monthly-references')
    @admin_required
    @handled
    def reference_months():
        return jsonify(list_reference_months())

    @bp.get('/monthly-references/<month>')
    @admin_required
    @handled
    def detail(month):
        return jsonify(reference_detail(month, request.args.get('inspect_archives') == '1'))

    @bp.post('/monthly-references/<month>/preview')
    @admin_required
    @handled
    def preview(month):
        compared, _ = preview_reference_operation(month, request.get_json(silent=True))
        return jsonify(compared)

    @bp.post('/monthly-references/<month>/apply')
    @admin_required
    @handled
    def apply(month):
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            raise ValueError('请先预览快照变更并确认')
        operation = {key: value for key, value in body.items() if key != 'fingerprint'}
        result = apply_reference_operation(month, operation, body.get('fingerprint'))
        db.session.commit()
        return jsonify(result)
