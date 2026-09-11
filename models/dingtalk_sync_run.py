from datetime import datetime

from . import db


class DingTalkSyncRun(db.Model):
    __tablename__ = "dingtalk_sync_runs"

    id = db.Column(db.Integer, primary_key=True)
    account_set_id = db.Column(
        db.Integer,
        db.ForeignKey("account_sets.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    month = db.Column(db.String(7), nullable=False, index=True)
    source = db.Column(db.String(20), nullable=False, default="dingtalk")
    status = db.Column(db.String(20), nullable=False)
    read_count = db.Column(db.Integer, nullable=False, default=0)
    imported_count = db.Column(db.Integer, nullable=False, default=0)
    unmatched_count = db.Column(db.Integer, nullable=False, default=0)
    unmatched = db.Column(db.JSON, nullable=False, default=list)
    error_message = db.Column(db.Text, nullable=True)
    started_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    finished_at = db.Column(db.DateTime, nullable=True)

    account_set = db.relationship("AccountSet", back_populates="dingtalk_sync_runs")

    def to_dict(self):
        return {
            "status": self.status,
            "read_count": self.read_count,
            "imported_count": self.imported_count,
            "unmatched_count": self.unmatched_count,
            "unmatched": list(self.unmatched or []),
            "sync_run_id": self.id,
            "error": self.error_message,
        }
