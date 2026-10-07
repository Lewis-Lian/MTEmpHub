"""Preserve the confirmed 2026 history through August; September resumes automatic calculation."""
import sqlalchemy as sa


def migrate_legacy_manager_stats(connection):
    table = sa.Table('manager_month_stats', sa.MetaData(), autoload_with=connection)
    rows = connection.execute(sa.select(table).where(table.c.year == 2026)).mappings().all()
    for row in rows:
        # Recorded corrections already have explicit provenance and must remain untouched.
        if row['manual_values'] is not None:
            continue
        keys = [f'm{month}' for month in range(1, 9)]
        if row['stat_type'] == 'overtime':
            keys.insert(0, 'prev_dec')
        manual = {key: float(row[key] or 0) for key in keys}
        automatic = dict(row['automatic_values'] or {})
        for month in range(9, 13):
            key = f'm{month}'
            automatic.setdefault(key, float(row[key] or 0))
        # Keep displayed numbers and remaining balances until the user recalculates September.
        connection.execute(table.update().where(table.c.id == row['id']).values(
            manual_values=manual, automatic_values=automatic))
