from app import app
from flask import g, jsonify
from models.user import User
from routes.api_query import _serialize_employee, _coerce_response
from routes.query_core import account_sets_api, departments_api, _accessible_emp_ids
from models.employee import Employee
from sqlalchemy.orm import joinedload

with app.app_context():
    g.current_user = User.query.filter_by(username='123').first()
    try:
        emp_ids = _accessible_emp_ids()
        print("emp_ids count:", len(emp_ids))
        if emp_ids:
            employees = (
                Employee.query.options(joinedload(Employee.department))
                .filter(Employee.id.in_(emp_ids))
                .order_by(Employee.emp_no.asc())
                .all()
            )
        else:
            employees = []
        print("employees count:", len(employees))
        
        # Test account_sets_api
        with app.test_request_context():
            ac, ac_status = _coerce_response(account_sets_api())
            print("ac status:", ac_status)
            dep, dep_status = _coerce_response(departments_api())
            print("dep status:", dep_status)
            
    except Exception as e:
        import traceback
        traceback.print_exc()
