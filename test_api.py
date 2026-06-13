import urllib.request
import json
import urllib.parse

def login():
    req = urllib.request.Request("http://127.0.0.1:5000/api/auth/login", data=json.dumps({"username": "admin", "password": "123"}).encode('utf-8'), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as response:
            cookie = response.headers.get("Set-Cookie")
            return cookie
    except Exception as e:
        print(e)
        return None

cookie = login()
print("Cookie:", cookie)
if cookie:
    req2 = urllib.request.Request("http://127.0.0.1:5000/api/admin/employee-attendance-overrides?month=2026-06", headers={"Cookie": cookie})
    try:
        with urllib.request.urlopen(req2) as response:
            print("Status:", response.status)
            print("Body:", response.read().decode('utf-8')[:200])
    except urllib.error.HTTPError as e:
        print("Status:", e.code)
        print("Body:", e.read().decode('utf-8'))
