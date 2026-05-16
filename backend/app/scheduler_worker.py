"""
scheduler_worker.py
===================
APScheduler-based background worker.

Every minute, polls the scheduled_reports table for jobs whose next_run_at
has passed. For each due job:
  1. Fetches the user's saved_widgets from app_users.settings
  2. Filters to the widget_ids listed in the schedule
  3. Generates a PDF via pdf_generator
  4. Sends the PDF via SMTP
  5. Updates last_run_at and computes next_run_at
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import resend
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.config import settings
from app.db import supabase_client
from app.pdf_generator import generate_pdf

# ---------------------------------------------------------------------------
# APScheduler instance (imported and started in main.py)
# ---------------------------------------------------------------------------
scheduler = AsyncIOScheduler(timezone="UTC")


# ---------------------------------------------------------------------------
# next_run_at calculation
# ---------------------------------------------------------------------------

def compute_next_run(frequency: str, day_of_week: int | None, hour: int) -> datetime:
    """Return the next UTC datetime this schedule should fire."""
    now = datetime.now(timezone.utc)
    candidate = now.replace(minute=0, second=0, microsecond=0, hour=hour)

    if frequency == "daily":
        if candidate <= now:
            candidate += timedelta(days=1)
        return candidate

    # weekly — day_of_week: 0=Mon … 6=Sun (Python weekday() convention)
    dow = day_of_week if day_of_week is not None else 0
    days_ahead = (dow - now.weekday()) % 7
    candidate = candidate + timedelta(days=days_ahead)
    if candidate <= now:
        candidate += timedelta(weeks=1)
    return candidate


# ---------------------------------------------------------------------------
# Main poll job
# ---------------------------------------------------------------------------

async def check_and_run() -> None:
    if not supabase_client:
        return

    now_iso = datetime.now(timezone.utc).isoformat()

    try:
        result = (
            supabase_client
            .table("scheduled_reports")
            .select("*")
            .lte("next_run_at", now_iso)
            .eq("enabled", True)
            .execute()
        )
        due = result.data or []
    except Exception as e:
        print(f"[scheduler] DB poll failed: {e}")
        return

    for schedule in due:
        await _run_schedule(schedule)


async def _run_schedule(schedule: dict) -> None:
    schedule_id  = schedule["id"]
    user_id      = schedule["user_id"]
    name         = schedule["name"]
    widget_ids   = schedule.get("widget_ids") or []
    frequency    = schedule["frequency"]
    email        = schedule["email"]
    day_of_week  = schedule.get("day_of_week")
    hour         = schedule.get("hour", 9)

    print(f"[scheduler] running schedule {schedule_id!r} ({name!r}) → {email}")

    # 1. Fetch user's saved_widgets
    try:
        user_res = (
            supabase_client
            .table("app_users")
            .select("settings")
            .eq("id", user_id)
            .single()
            .execute()
        )
        settings_data = user_res.data.get("settings") or {}
        all_widgets: list[dict] = settings_data.get("saved_widgets") or []
    except Exception as e:
        print(f"[scheduler] failed to fetch widgets for user {user_id}: {e}")
        return

    # 2. Filter to selected widget_ids
    widgets = [w for w in all_widgets if w.get("id") in widget_ids]
    if not widgets:
        print(f"[scheduler] no matching widgets for schedule {schedule_id!r} — skipping PDF, sending empty report")

    # 3. Generate PDF
    try:
        pdf_bytes = generate_pdf(name, frequency, widgets)
    except Exception as e:
        print(f"[scheduler] PDF generation failed: {e}")
        _update_schedule(schedule_id, frequency, day_of_week, hour, success=False)
        return

    # 4. Send email via SMTP
    try:
        _send_email(email, name, frequency, pdf_bytes)
    except Exception as e:
        print(f"[scheduler] email send failed: {e}")
        _update_schedule(schedule_id, frequency, day_of_week, hour, success=False)
        return

    # 5. Update timestamps
    _update_schedule(schedule_id, frequency, day_of_week, hour, success=True)
    print(f"[scheduler] schedule {schedule_id!r} done — email sent to {email}")


def _send_email(to: str, schedule_name: str, frequency: str, pdf_bytes: bytes) -> None:
    if not settings.RESEND_API_KEY:
        raise RuntimeError("RESEND_API_KEY not configured")

    resend.api_key = settings.RESEND_API_KEY

    label = "Weekly" if frequency == "weekly" else "Daily"
    date_str = datetime.now(timezone.utc).strftime("%d %b %Y")
    filename = f"report_{date_str.replace(' ', '_')}.pdf"

    resend.Emails.send({
        "from": settings.REPORT_FROM_EMAIL,
        "to": [to],
        "subject": f"{label} Report — {date_str}",
        "html": (
            f"<p>Hello,</p>"
            f"<p>Please find attached your <strong>{label.lower()} analytics report</strong> "
            f"for <em>{schedule_name}</em>.</p>"
            f"<p>— NR2Dashboard</p>"
        ),
        "attachments": [{"filename": filename, "content": list(pdf_bytes)}],
    })


def _update_schedule(
    schedule_id: str,
    frequency: str,
    day_of_week: int | None,
    hour: int,
    success: bool,
) -> None:
    next_run = compute_next_run(frequency, day_of_week, hour)
    try:
        supabase_client.table("scheduled_reports").update({
            "last_run_at": datetime.now(timezone.utc).isoformat(),
            "next_run_at": next_run.isoformat(),
        }).eq("id", schedule_id).execute()
    except Exception as e:
        print(f"[scheduler] failed to update schedule {schedule_id}: {e}")
