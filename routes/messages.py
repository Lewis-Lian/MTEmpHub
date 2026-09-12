from datetime import datetime

from flask import Blueprint, g, jsonify, request

from models.message import Message
from models.employee import Employee
from models.user import User, UserEmployeeAssignment
from models import db
from routes.auth_helpers import admin_required, login_required


messages_bp = Blueprint("messages", __name__)


def _serialize_message(message: Message) -> dict[str, object]:
    return {
        "id": message.id,
        "title": message.title,
        "content": message.content,
        "sender": message.sender.profile_name or message.sender.username,
        "created_at": message.created_at.isoformat(),
        "unread": message.read_at is None,
    }


@messages_bp.get("/api/query/messages")
@login_required
def list_messages():
    messages = (
        Message.query.filter_by(recipient_id=g.current_user.id)
        .order_by(Message.created_at.desc(), Message.id.desc())
        .limit(50)
        .all()
    )
    return jsonify({"messages": [_serialize_message(item) for item in messages], "unread_count": sum(item.read_at is None for item in messages)})


@messages_bp.post("/api/query/messages/<int:message_id>/read")
@login_required
def mark_message_read(message_id: int):
    message = Message.query.filter_by(id=message_id, recipient_id=g.current_user.id).first()
    if not message:
        return jsonify({"error": "消息不存在"}), 404
    if message.read_at is None:
        message.read_at = datetime.utcnow()
        db.session.commit()
    return jsonify({"message": _serialize_message(message)})


@messages_bp.post("/api/admin/messages")
@admin_required
def send_message():
    data = request.json or {}
    raw_recipient_ids = data.get("recipient_ids")
    if raw_recipient_ids is None:
        raw_recipient_ids = [data.get("recipient_id")]
    recipient_ids = sorted({int(value) for value in raw_recipient_ids if str(value).isdigit()})
    title = (data.get("title") or "").strip()
    content = (data.get("content") or "").strip()
    recipients = User.query.filter(User.id.in_(recipient_ids)).all() if recipient_ids else []
    if len(recipients) != len(recipient_ids):
        return jsonify({"error": "请选择有效的收件账号"}), 400
    if not title or not content:
        return jsonify({"error": "标题和内容不能为空"}), 400
    messages = [Message(sender_id=g.current_user.id, recipient_id=recipient.id, title=title, content=content) for recipient in recipients]
    db.session.add_all(messages)
    db.session.commit()
    return jsonify({"created_count": len(messages), "message": _serialize_message(messages[0])}), 201


@messages_bp.get("/api/admin/message-recipients")
@admin_required
def message_recipients():
    assignments = (
        UserEmployeeAssignment.query.join(User).join(Employee)
        .order_by(Employee.emp_no.asc(), Employee.name.asc())
        .all()
    )
    grouped: dict[int, dict[str, object]] = {}
    for assignment in assignments:
        employee = assignment.employee
        row = grouped.setdefault(employee.id, {
            "id": employee.id,
            "account_ids": [],
            "emp_no": employee.emp_no,
            "name": employee.name,
            "dept_id": employee.dept_id,
            "dept_name": employee.department.dept_name if employee.department else "",
            "is_manager": bool(employee.is_manager),
        })
        row["account_ids"].append(assignment.user.id)
    return jsonify(list(grouped.values()))
