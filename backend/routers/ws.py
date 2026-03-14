"""
WebSocket routes:
    /ws/admin/{monitor_id}   – teacher monitor receives broadcast events
  /ws/student/{session_id} – student sends tracking events
"""
import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select

try:
    from ..database import AsyncSessionLocal
    from ..models import ExamSession, TrackingEvent
    from ..schemas import TrackingEventIn
    from ..ws_manager import manager
except ImportError:
    from database import AsyncSessionLocal
    from models import ExamSession, TrackingEvent
    from schemas import TrackingEventIn
    from ws_manager import manager

router = APIRouter()


def _compute_violation_penalty(payload: dict | None) -> int:
    """Return a practical trust-score deduction based on violation severity."""
    if not isinstance(payload, dict):
        return 2

    reason = str(payload.get("reason") or "").strip().lower()
    away_seconds_raw = payload.get("away_seconds")
    away_seconds = 0.0
    try:
        away_seconds = float(away_seconds_raw) if away_seconds_raw is not None else 0.0
    except (TypeError, ValueError):
        away_seconds = 0.0

    # Lower penalties for minor/accidental events, higher for strong cheating signals.
    if reason in {"right_click", "clipboard_event_blocked", "blocked_keyboard_shortcut"}:
        return 2
    if reason == "window_resized_below_threshold":
        return 3
    if reason in {"window_focus_lost", "tab_switch_start"}:
        return 4
    if reason == "fullscreen_exited":
        return 6
    if reason == "idle_timeout":
        return 3
    if reason in {"tab_switch_duration", "window_focus_returned"}:
        if away_seconds >= 120:
            return 7
        if away_seconds >= 60:
            return 5
        return 3

    # Safe default for unknown violations.
    return 2


@router.websocket("/ws/admin/{admin_id}")
async def ws_admin(websocket: WebSocket, admin_id: str):
    """
    Teacher monitor connection on the legacy /ws/admin path.
    This stays open and receives JSON payloads broadcast by the student
    handler whenever an event is processed.
    """
    await manager.connect(websocket, role="admin", user_id=admin_id)
    try:
        while True:
            # Keep the connection alive; monitor clients are passive receivers.
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(role="admin", user_id=admin_id)


@router.websocket("/ws/student/{session_id}")
async def ws_student(websocket: WebSocket, session_id: str):
    """
    Student connection: receives JSON events, persists them to the DB,
    optionally decrements trust_score on VIOLATION_DETECTED, then
    broadcasts the enriched event to all monitor connections.

    DB operations use a fresh async session per message so the session
    lifetime is as short as possible.
    """
    try:
        session_uuid = uuid.UUID(session_id)
    except ValueError:
        await websocket.accept()
        await websocket.send_json({"error": "Invalid session id"})
        await websocket.close(code=1008)
        return

    await manager.connect(websocket, role="student", user_id=session_id)
    try:
        while True:
            raw = await websocket.receive_text()

            # --- Parse incoming event -----------------------------------------
            try:
                data = json.loads(raw)
                event_in = TrackingEventIn(**data)
            except (json.JSONDecodeError, Exception):
                await websocket.send_json({"error": "Invalid event format"})
                continue

            # --- Async DB write (non-blocking) ---------------------------------
            async with AsyncSessionLocal() as db:
                # 1. Persist the tracking event
                event = TrackingEvent(
                    session_id=session_uuid,
                    event_type=event_in.event_type,
                    payload=event_in.payload,
                    timestamp=datetime.now(timezone.utc),
                )
                db.add(event)

                # 2. If it's a violation, decrement trust_score using reason-aware penalty
                if event_in.event_type == "VIOLATION_DETECTED":
                    result = await db.execute(
                        select(ExamSession).where(ExamSession.id == session_uuid)
                    )
                    session_obj = result.scalar_one_or_none()
                    if session_obj:
                        penalty = _compute_violation_penalty(event_in.payload)
                        session_obj.trust_score = max(0, session_obj.trust_score - penalty)
                        trust_score = session_obj.trust_score
                    else:
                        trust_score = None
                    session_status = session_obj.status if session_obj else None
                elif event_in.event_type == "EXAM_SUBMITTED":
                    result = await db.execute(
                        select(ExamSession).where(ExamSession.id == session_uuid)
                    )
                    session_obj = result.scalar_one_or_none()
                    if session_obj:
                        session_obj.status = "completed"
                        trust_score = session_obj.trust_score
                        session_status = session_obj.status
                    else:
                        trust_score = None
                        session_status = None
                else:
                    trust_score = None
                    session_status = None

                await db.commit()
                await db.refresh(event)

            # 3. Build broadcast payload and fan-out to monitor clients.
            broadcast_payload = {
                "session_id": str(session_uuid),
                "event_id": str(event.id),
                "event_type": event_in.event_type,
                "payload": event_in.payload,
                "event_timestamp": event.timestamp.isoformat() if event.timestamp else None,
                "trust_score": trust_score,
                "session_status": session_status,
            }
            await manager.broadcast_to_admins(broadcast_payload)

            # Acknowledge back to student
            await websocket.send_json({"status": "ok"})

    except WebSocketDisconnect:
        manager.disconnect(role="student", user_id=session_id)
