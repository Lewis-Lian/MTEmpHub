from app import app
from models.user import User
import json

with app.app_context():
    u = User.query.filter_by(username='123').first()
    print("User found:", u is not None)
    if u:
        print("Page permissions type:", type(u.page_permissions))
        print("Raw page_permissions:", repr(u.page_permissions))
        print("Effective permissions:", u.effective_page_permissions())
