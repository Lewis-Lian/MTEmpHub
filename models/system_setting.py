from . import db


class SystemSetting(db.Model):
    __tablename__ = "system_settings"

    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(100), unique=True, nullable=False, index=True)
    value = db.Column(db.Text, nullable=True)

    @classmethod
    def get_value(cls, key: str, default=None):
        setting = cls.query.filter_by(key=key).first()
        return setting.value if setting is not None else default

    @classmethod
    def set_value(cls, key: str, value: str):
        setting = cls.query.filter_by(key=key).first()
        if setting is None:
            setting = cls(key=key)
            db.session.add(setting)
        setting.value = value
        return setting
