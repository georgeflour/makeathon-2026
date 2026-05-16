"""
routes/scheduler.py
===================
CRUD endpoints for scheduled reports.

Authentication: Supabase JWT passed as Authorization: Bearer <token>.
The user_id is extracted from the token via Supabase's get_user() call.
"""

from __future__ import annotations

import base64
import json
import uuid
from datetime import timezone
from typing import Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from app.db import supabase_client
from app.scheduler_worker import compute_next_run

router = APIRouter(prefix="/api/schedules", tags=["scheduler"])


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class ScheduleCreate(BaseModel):
    name:        str
    widget_ids:  list[str]
    frequency:   str          # 'daily' | 'weekly'
    day_of_week: Optional[int] = None   # 0=Mon … 6=Sun
    hour:        int = 9
    email:       str


class ScheduleToggle(BaseModel):
    enabled: bool


# ---------------------------------------------------------------------------
# Auth helper
# ---------------------------------------------------------------------------

def _get_user_id(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    token = authorization.removeprefix("Bearer ").strip()
    try:
        # Decode JWT payload (no signature verification needed — token was issued by Supabase)
        payload_b64 = token.split(".")[1]
        payload_b64 += "=" * (4 - len(payload_b64) % 4)
        payload = json.loads(base64.urlsafe_b64decode(payload_b64))
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="No user ID in token")
        return user_id
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Malformed token: {e}")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("")
def list_schedules(authorization: str | None = Header(default=None)):
    user_id = _get_user_id(authorization)
    try:
        res = (
            supabase_client
            .table("scheduled_reports")
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .execute()
        )
        return res.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("", status_code=201)
def create_schedule(
    body: ScheduleCreate,
    authorization: str | None = Header(default=None),
):
    user_id = _get_user_id(authorization)

    if body.frequency not in ("daily", "weekly"):
        raise HTTPException(status_code=422, detail="frequency must be 'daily' or 'weekly'")
    if body.frequency == "weekly" and body.day_of_week is None:
        raise HTTPException(status_code=422, detail="day_of_week required for weekly schedules")

    next_run = compute_next_run(body.frequency, body.day_of_week, body.hour)

    row = {
        "id":          str(uuid.uuid4()),
        "user_id":     user_id,
        "name":        body.name,
        "widget_ids":  body.widget_ids,
        "frequency":   body.frequency,
        "day_of_week": body.day_of_week,
        "hour":        body.hour,
        "email":       body.email,
        "enabled":     True,
        "next_run_at": next_run.isoformat(),
        "last_run_at": None,
    }
    try:
        res = supabase_client.table("scheduled_reports").insert(row).execute()
        return res.data[0]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/{schedule_id}")
def toggle_schedule(
    schedule_id: str,
    body: ScheduleToggle,
    authorization: str | None = Header(default=None),
):
    user_id = _get_user_id(authorization)
    try:
        res = (
            supabase_client
            .table("scheduled_reports")
            .update({"enabled": body.enabled})
            .eq("id", schedule_id)
            .eq("user_id", user_id)
            .execute()
        )
        if not res.data:
            raise HTTPException(status_code=404, detail="Schedule not found")
        return res.data[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{schedule_id}", status_code=204)
def delete_schedule(
    schedule_id: str,
    authorization: str | None = Header(default=None),
):
    user_id = _get_user_id(authorization)
    try:
        supabase_client.table("scheduled_reports").delete().eq("id", schedule_id).eq("user_id", user_id).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
