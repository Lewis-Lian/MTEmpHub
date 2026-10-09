from flask_sqlalchemy import SQLAlchemy


db = SQLAlchemy()

# Register month-owned references for both create_all and Alembic metadata.
from .monthly_reference_snapshot import MonthlyReferenceSnapshot  # noqa: E402, F401
