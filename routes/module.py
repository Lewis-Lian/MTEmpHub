from __future__ import annotations

from flask import Blueprint, abort, g

from routes.auth import frontend_redirect, login_required
from utils.app_navigation import module_by_slug, visible_entries


module_bp = Blueprint("module", __name__, url_prefix="/module")


@module_bp.route("/<slug>")
@login_required
def module_home(slug: str):
    if slug == "home":
        return frontend_redirect("/employee/home")

    module = module_by_slug(slug)
    if not module:
        abort(404)

    entries = visible_entries(g.current_user, module)
    if not entries:
        abort(403)
    return frontend_redirect(entries[0]["href"])
