"""
WebSocket routes:
  /ws/admin/{admin_id}   – admin receives broadcast events
  /ws/student/{session_id} – student sends tracking events
"""
import json
from datetime import datetime, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from ..database import AsyncSessionLocal
from ..models import ExamSession, TrackingEvent
from ..schemas import TrackingEventIn
from ..ws_manager import manager

router = APIRouter()


@router.websocket("/ws/admin/{admin_id}")
async def ws_admin(websocket: WebSocket, admin_id: str):
    """
    Admin connection: just stays open and receives JSON payloads
    broadcast by the student handler whenever an event is processed.
    """
    await manager.connect(websocket, role="admin", user_id=admin_id)
    try:
        while True:
            # Keep the connection alive; admins are passive receivers
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(role="admin", user_id=admin_id)


@router.websocket("/ws/student/{session_id}")
async def ws_student(websocket: WebSocket, session_id: str):
    """
    Student connection: receives JSON events, persists them to the DB,
    optionally decrements trust_score on VIOLATION_DETECTED, then
    broadcasts the enriched event to all admin connections.

    DB operations use a fresh async session per message so the session
    lifetime is as short as possible.
    """
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
                    session_id=session_id,
                    event_type=event_in.event_type,
                    payload=event_in.payload,
                    timestamp=datetime.now(timezone.utc),
                )
                db.add(event)

                # 2. If it's a violation, decrement trust_score
                if event_in.event_type == "VIOLATION_DETECTED":
                    result = await db.execute(
                        select(ExamSession).where(ExamSession.id == session_id)
                    )
                    session_obj = result.scalar_one_or_none()
                    if session_obj:
                        session_obj.trust_score = max(0, session_obj.trust_score - 10)
                        trust_score = session_obj.trust_score
                    else:
                        trust_score = None
                else:
                    trust_score = None

                await db.commit()

            # 3. Build broadcast payload and fan-out to admins
            broadcast_payload = {
                "session_id": session_id,
                "event_type": event_in.event_type,
                "payload": event_in.payload,
                "trust_score": trust_score,
            }
            await manager.broadcast_to_admins(broadcast_payload)

            # Acknowledge back to student
            await websocket.send_json({"status": "ok"})

    except WebSocketDisconnect:
        manager.disconnect(role="student", user_id=session_id)
