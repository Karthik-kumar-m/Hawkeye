"""Session APIs used by student and teacher monitoring portals."""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

try:
    from ..database import get_db
    from ..models import (
        ExamSession,
        ExamTest,
        StudentAccount,
        TestStudentAccess,
        TrackingEvent,
        User,
    )
    from ..schemas import (
        SessionCompleteResponse,
        SessionEventRead,
        SessionRead,
        SessionStartRequest,
        SessionStartResponse,
    )
except ImportError:
    from database import get_db
    from models import (
        ExamSession,
        ExamTest,
        StudentAccount,
        TestStudentAccess,
        TrackingEvent,
        User,
    )
    from schemas import (
        SessionCompleteResponse,
        SessionEventRead,
        SessionRead,
        SessionStartRequest,
        SessionStartResponse,
    )


router = APIRouter(prefix="/api/v1/sessions", tags=["sessions"])


def _to_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _pack_username(student_identifier: str, student_name: str, test_id: str) -> str:
    return f"{student_identifier}::{student_name}::{test_id}"


def _unpack_username(username: str) -> tuple[str, str, str | None]:
    chunks = username.split("::")
    if len(chunks) == 3:
        return chunks[0], chunks[1], chunks[2]
    if len(chunks) == 2:
        return chunks[0], chunks[1], None
    return username, username, None


@router.post("/start", response_model=SessionStartResponse)
async def start_session(body: SessionStartRequest, db: AsyncSession = Depends(get_db)):
    normalized_username = body.student_username.strip().upper()
    normalized_test_id = body.test_id.strip().upper()

    student_result = await db.execute(
        select(StudentAccount).where(func.upper(StudentAccount.username) == normalized_username)
    )
    student = student_result.scalar_one_or_none()
    if student is None:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    test_result = await db.execute(
        select(ExamTest).where(func.upper(ExamTest.test_id) == normalized_test_id)
    )
    test = test_result.scalar_one_or_none()
    if test is None:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    access_result = await db.execute(
        select(TestStudentAccess).where(
            TestStudentAccess.test_id == test.id,
            TestStudentAccess.student_id == student.id,
        )
    )
    access = access_result.scalar_one_or_none()
    if access is None:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    now_utc = datetime.now(timezone.utc)
    test_start_time = _to_utc(test.start_time)
    test_end_time = _to_utc(test.end_time)
    if test_start_time and now_utc < test_start_time:
        raise HTTPException(status_code=403, detail="Test has not started yet")
    if test_end_time and now_utc > test_end_time:
        raise HTTPException(status_code=403, detail="Test window has ended")

    packed_username = _pack_username(student.username, student.full_name, test.test_id)

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
        student_name=student.full_name,
        student_identifier=student.username,
        test_id=test.test_id,
        test_title=test.title,
        test_pdf_url=test.pdf_url,
        test_start_time=test_start_time,
        test_end_time=test_end_time,
        duration_minutes=test.duration_minutes or 45,
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
        student_identifier, student_name, test_id = _unpack_username(user.username)

        sessions.append(
            SessionRead(
                id=exam_session.id,
                student_name=student_name,
                student_identifier=student_identifier,
                test_id=test_id,
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