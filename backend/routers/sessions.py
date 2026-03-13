"""Session APIs used by student and admin portals."""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

try:
    from ..database import get_db
    from ..models import ExamSession, TrackingEvent, User
    from ..schemas import (
        SessionCompleteResponse,
        SessionEventRead,
        SessionRead,
        SessionStartRequest,
        SessionStartResponse,
    )
except ImportError:
    from database import get_db
    from models import ExamSession, TrackingEvent, User
    from schemas import (
        SessionCompleteResponse,
        SessionEventRead,
        SessionRead,
        SessionStartRequest,
        SessionStartResponse,
    )


router = APIRouter(prefix="/api/v1/sessions", tags=["sessions"])


def _pack_username(student_identifier: str, student_name: str) -> str:
    return f"{student_identifier}::{student_name}"


def _unpack_username(username: str) -> tuple[str, str]:
    if "::" in username:
        student_identifier, student_name = username.split("::", 1)
        return student_identifier, student_name
    return username, username


@router.post("/start", response_model=SessionStartResponse)
async def start_session(body: SessionStartRequest, db: AsyncSession = Depends(get_db)):
    packed_username = _pack_username(body.student_identifier, body.student_name)

    user_result = await db.execute(
        select(User).where(User.username == packed_username, User.role == "student")
    )
    user = user_result.scalar_one_or_none()

    if user is None:
        user = User(username=packed_username, role="student")
        db.add(user)
        await db.flush()

    session = ExamSession(student_id=user.id, status="active", trust_score=100)
    db.add(session)
    await db.commit()
    await db.refresh(session)

    return SessionStartResponse(
        session_id=session.id,
        student_name=body.student_name,
        student_identifier=body.student_identifier,
        status=session.status,
        trust_score=session.trust_score,
        started_at=session.start_time,
    )


@router.get("/", response_model=list[SessionRead])
async def list_sessions(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ExamSession, User)
        .join(User, User.id == ExamSession.student_id)
        .order_by(ExamSession.start_time.desc())
    )
    rows = result.all()

    sessions: list[SessionRead] = []
    for exam_session, user in rows:
        violation_result = await db.execute(
            select(TrackingEvent).where(
                TrackingEvent.session_id == exam_session.id,
                TrackingEvent.event_type == "VIOLATION_DETECTED",
            )
        )
        violations = len(violation_result.scalars().all())
        student_identifier, student_name = _unpack_username(user.username)

        sessions.append(
            SessionRead(
                id=exam_session.id,
                student_name=student_name,
                student_identifier=student_identifier,
                started_at=exam_session.start_time,
                status=exam_session.status,
                trust_score=exam_session.trust_score,
                violations=violations,
            )
        )

    return sessions


@router.post("/{session_id}/complete", response_model=SessionCompleteResponse)
async def complete_session(session_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ExamSession).where(ExamSession.id == session_id))
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    session.status = "completed"
    await db.commit()

    return SessionCompleteResponse(session_id=session.id, status=session.status)


@router.get("/{session_id}/events", response_model=list[SessionEventRead])
async def list_session_events(session_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    session_result = await db.execute(select(ExamSession).where(ExamSession.id == session_id))
    session = session_result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    result = await db.execute(
        select(TrackingEvent)
        .where(TrackingEvent.session_id == session_id)
        .order_by(TrackingEvent.timestamp.desc())
        .limit(200)
    )
    return list(result.scalars().all())