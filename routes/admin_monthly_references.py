"""Administrator-only snapshot inspection and explicit preview/apply endpoints."""
from functools import wraps

from flask import g, jsonify, request
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
            from services.monthly_reference_progress_service import start_reference_progress
            update = None
            try:
                token = request.args.get('progress_token')
                update = start_reference_progress(token, g.current_user.id) if token is not None else None
                response = function(*args, progress=update, **kwargs)
                if update:
                    update(status='completed', phase='complete', stage='快照任务完成', completed=1, total=1)
                return response
            except LookupError as exc:
                db.session.rollback()
                if update:
                    update(status='failed', stage='快照任务失败')
                return jsonify(error=str(exc)), 404
            except (ReferencePreviewChanged, IntegrityError):
                db.session.rollback()
                if update:
                    update(status='failed', stage='快照任务失败')
                return jsonify(error='资料已发生变化，请重新核对并预览'), 409
            except ValueError as exc:
                db.session.rollback()
                if update:
                    update(status='failed', stage='快照任务失败')
                return jsonify(error=str(exc)), 400
            except Exception:
                db.session.rollback()
                if update:
                    update(status='failed', stage='快照任务失败')
                raise
        return wrapped

    @bp.get('/monthly-references/progress')
    @admin_required
    def progress():
        from services.monthly_reference_progress_service import get_reference_progress
        try:
            return jsonify(get_reference_progress(request.args.get('progress_token'), g.current_user.id))
        except ValueError as exc:
            return jsonify(error=str(exc)), 400

    @bp.get('/monthly-references')
    @admin_required
    @handled
    def reference_months(progress=None):
        return jsonify(list_reference_months(progress=progress))

    @bp.get('/monthly-references/<month>')
    @admin_required
    @handled
    def detail(month, progress=None):
        return jsonify(reference_detail(month, request.args.get('inspect_archives') == '1',
                                        include_evidence=request.args.get('summary') != '1', progress=progress))

    @bp.post('/monthly-references/<month>/preview')
    @admin_required
    @handled
    def preview(month, progress=None):
        compared, _ = preview_reference_operation(month, request.get_json(silent=True), progress=progress)
        return jsonify(compared)

    @bp.post('/monthly-references/<month>/apply')
    @admin_required
    @handled
    def apply(month, progress=None):
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            raise ValueError('请先预览快照变更并确认')
        operation = {key: value for key, value in body.items() if key != 'fingerprint'}
        result = apply_reference_operation(month, operation, body.get('fingerprint'), progress=progress)
        if progress:
            progress(phase='commit', stage='提交快照变更', completed=0, total=0)
        db.session.commit()
        return jsonify(result)
