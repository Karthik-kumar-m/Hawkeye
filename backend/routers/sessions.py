"""Session APIs used by student and teacher monitoring portals."""
import uuid
import io
import re
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pypdf import PdfReader
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

try:
    from ..database import get_db
    from ..models import (
        ExamSession,
        ExamTest,
        Question,
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
        SessionSummaryResponse,
    )
except ImportError:
    from database import get_db
    from models import (
        ExamSession,
        ExamTest,
        Question,
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
        SessionSummaryResponse,
    )


router = APIRouter(prefix="/api/v1/sessions", tags=["sessions"])

QUESTION_LINE_PATTERN = re.compile(r"^(\d{1,3})[\).:-]\s+(.+)$")
OPTION_LINE_PATTERN = re.compile(r"^[\(\[]?([A-D])[\)\].:-]\s+(.+)$", re.IGNORECASE)
ANSWER_LINE_PATTERN = re.compile(
    r"^(?:answer|ans|correct\s*answer)\s*[:\-]\s*([A-D])\b",
    re.IGNORECASE,
)


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


def _normalize_answer_option(selected_value: object, option_map: dict[str, str | None]) -> str | None:
    """Normalize submitted answer into option key A/B/C/D when possible."""
    if selected_value is None:
        return None

    raw = str(selected_value).strip()
    if not raw:
        return None

    upper = raw.upper()
    if upper in {"A", "B", "C", "D"}:
        return upper

    for key, text in option_map.items():
        if text and raw.casefold() == text.strip().casefold():
            return key

    return None


def _parse_questions_from_pdf_url(pdf_url: str) -> list[dict]:
    """Parse question/option/answer blocks from uploaded test PDF for legacy tests."""
    relative = pdf_url.lstrip("/")
    pdf_path = Path(__file__).resolve().parent.parent / relative
    if not pdf_path.exists() or not pdf_path.is_file():
        return []

    try:
        with pdf_path.open("rb") as f:
            content = f.read()
        reader = PdfReader(io.BytesIO(content))
        raw_text = "\n".join((page.extract_text() or "") for page in reader.pages)
    except Exception:
        return []

    lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
    parsed: list[dict] = []
    current: dict | None = None

    for line in lines:
        question_match = QUESTION_LINE_PATTERN.match(line)
        if question_match:
            if current is not None:
                parsed.append(current)
            current = {
                "question_number": int(question_match.group(1)),
                "option_a": None,
                "option_b": None,
                "option_c": None,
                "option_d": None,
                "correct_option": None,
            }
            continue

        option_match = OPTION_LINE_PATTERN.match(line)
        if option_match and current is not None:
            current[f"option_{option_match.group(1).lower()}"] = option_match.group(2).strip()
            continue

        answer_match = ANSWER_LINE_PATTERN.match(line)
        if answer_match and current is not None:
            current["correct_option"] = answer_match.group(1).upper()

    if current is not None:
        parsed.append(current)

    return parsed


async def _compute_session_score(
    db: AsyncSession,
    exam_session: ExamSession,
    test_id_code: str | None,
) -> tuple[int | None, int | None, float | None]:
    """Return (correct_answers, total_questions, score_percent) for a session."""
    if not test_id_code:
        return None, None, None

    test_result = await db.execute(
        select(ExamTest).where(func.upper(ExamTest.test_id) == test_id_code.upper())
    )
    test_obj = test_result.scalar_one_or_none()
    if test_obj is None:
        return None, None, None

    submission_result = await db.execute(
        select(TrackingEvent)
        .where(
            TrackingEvent.session_id == exam_session.id,
            TrackingEvent.event_type == "EXAM_SUBMITTED",
        )
        .order_by(TrackingEvent.timestamp.desc())
        .limit(1)
    )
    submission = submission_result.scalar_one_or_none()
    answers_payload = (submission.payload or {}).get("answers", {}) if submission else {}
    if not isinstance(answers_payload, dict):
        answers_payload = {}

    questions_result = await db.execute(
        select(Question)
        .where(Question.test_id == test_obj.id)
        .order_by(Question.question_number.asc())
    )
    questions = questions_result.scalars().all()

    gradable_questions = [
        question
        for question in questions
        if (question.correct_option or "").upper() in {"A", "B", "C", "D"}
    ]
    total_questions = len(gradable_questions)
    if total_questions == 0:
        parsed_questions = _parse_questions_from_pdf_url(test_obj.pdf_url)
        gradable_parsed = [
            question
            for question in parsed_questions
            if (question.get("correct_option") or "") in {"A", "B", "C", "D"}
        ]
        if not gradable_parsed:
            return None, None, None

        correct_answers = 0
        for question in gradable_parsed:
            submitted = answers_payload.get(str(question.get("question_number")))
            normalized = _normalize_answer_option(
                submitted,
                {
                    "A": question.get("option_a"),
                    "B": question.get("option_b"),
                    "C": question.get("option_c"),
                    "D": question.get("option_d"),
                },
            )
            if normalized and normalized == (question.get("correct_option") or ""):
                correct_answers += 1

        score_percent = round((correct_answers / len(gradable_parsed)) * 100, 1)
        return correct_answers, len(gradable_parsed), score_percent

    correct_answers = 0
    for question in gradable_questions:
        submitted = answers_payload.get(str(question.question_number))
        normalized = _normalize_answer_option(
            submitted,
            {
                "A": question.option_a,
                "B": question.option_b,
                "C": question.option_c,
                "D": question.option_d,
            },
        )
        if normalized and normalized == (question.correct_option or "").upper():
            correct_answers += 1

    score_percent = round((correct_answers / total_questions) * 100, 1)
    return correct_answers, total_questions, score_percent


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

    active_session_result = await db.execute(
        select(ExamSession)
        .where(ExamSession.student_id == user.id, ExamSession.status == "active")
        .order_by(ExamSession.start_time.desc())
        .limit(1)
    )
    active_session = active_session_result.scalar_one_or_none()
    if active_session is not None:
        # Smart duplicate handling: allow resume if the prior attempt is still active.
        return SessionStartResponse(
            session_id=active_session.id,
            student_name=student.full_name,
            student_identifier=student.username,
            test_id=test.test_id,
            test_title=test.title,
            test_pdf_url=test.pdf_url,
            test_start_time=test_start_time,
            test_end_time=test_end_time,
            duration_minutes=test.duration_minutes or 45,
            status=active_session.status,
            trust_score=active_session.trust_score,
            started_at=active_session.start_time,
        )

    prior_session_result = await db.execute(
        select(ExamSession)
        .where(ExamSession.student_id == user.id)
        .order_by(ExamSession.start_time.desc())
        .limit(1)
    )
    prior_session = prior_session_result.scalar_one_or_none()
    if prior_session is not None:
        raise HTTPException(
            status_code=409,
            detail="Exam already completed for this student and test",
        )

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
        correct_answers, total_questions, score_percent = await _compute_session_score(
            db,
            exam_session,
            test_id,
        )

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
                correct_answers=correct_answers,
                total_questions=total_questions,
                score_percent=score_percent,
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


@router.get("/{session_id}/summary", response_model=SessionSummaryResponse)
async def get_session_summary(session_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    session_result = await db.execute(select(ExamSession).where(ExamSession.id == session_id))
    exam_session = session_result.scalar_one_or_none()
    if exam_session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    user_result = await db.execute(select(User).where(User.id == exam_session.student_id))
    user = user_result.scalar_one_or_none()

    test_id_code = None
    if user is not None:
                _, _, test_id_code = _unpack_username(user.username)

    violation_result = await db.execute(
        select(TrackingEvent).where(
            TrackingEvent.session_id == exam_session.id,
            TrackingEvent.event_type == "VIOLATION_DETECTED",
        )
    )
    violations = len(violation_result.scalars().all())

    correct_answers, total_questions, score_percent = await _compute_session_score(
        db,
        exam_session,
        test_id_code,
    )

    return SessionSummaryResponse(
        session_id=exam_session.id,
        status=exam_session.status,
        trust_score=exam_session.trust_score,
        violations=violations,
        correct_answers=correct_answers,
        total_questions=total_questions,
        score_percent=score_percent,
    )


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