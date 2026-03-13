"""Teacher-managed exam test endpoints (PDF upload + retrieval)."""
import hashlib
import io
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pypdf import PdfReader
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

try:
    from ..database import get_db
    from ..models import ExamTest, StudentAccount, TeacherAccount, TestStudentAccess
    from ..schemas import (
        ExamTestRead,
        QuestionPreviewItem,
        QuestionPreviewResponse,
        TestScheduleResponse,
        UsnPreviewResponse,
    )
except ImportError:
    from database import get_db
    from models import ExamTest, StudentAccount, TeacherAccount, TestStudentAccess
    from schemas import (
        ExamTestRead,
        QuestionPreviewItem,
        QuestionPreviewResponse,
        TestScheduleResponse,
        UsnPreviewResponse,
    )


router = APIRouter(prefix="/api/v1/tests", tags=["tests"])
UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads" / "tests"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
USN_PATTERNS = [
    re.compile(r"^\d[A-Z]{2}\d{2}[A-Z]{2,4}\d{3}$"),
    re.compile(r"^[A-Z]{2}\d{2}[A-Z]{2,4}\d{3}$"),
]
QUESTION_LINE_PATTERN = re.compile(r"^(\d{1,3})[\).:-]\s+(.+)$")
OPTION_LINE_PATTERN = re.compile(r"^[\(\[]?([A-D])[\)\].:-]\s+(.+)$", re.IGNORECASE)
ANSWER_LINE_PATTERN = re.compile(
    r"^(?:answer|ans|correct\s*answer)\s*[:\-]\s*([A-D])\b",
    re.IGNORECASE,
)
PDF_HEADER = b"%PDF"
TEXT_DECODE_ENCODINGS = ("utf-8", "utf-16", "latin-1")


def _to_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _as_exam_test_read(test: ExamTest) -> ExamTestRead:
    return ExamTestRead(
        id=test.id,
        test_id=test.test_id,
        title=test.title,
        pdf_url=test.pdf_url,
        start_time=_to_utc(test.start_time),
        end_time=_to_utc(test.end_time),
        duration_minutes=test.duration_minutes,
        teacher_id=test.teacher_id,
        created_at=_to_utc(test.created_at),
    )


def _hash_password(raw_password: str) -> str:
    return hashlib.sha256(raw_password.encode("utf-8")).hexdigest()


def _authenticate_teacher(teacher_username: str, teacher_password: str, teacher: TeacherAccount | None):
    if teacher is None or teacher.password_hash != _hash_password(teacher_password):
        raise HTTPException(status_code=401, detail="Invalid teacher credentials")


def _is_valid_usn(candidate: str) -> bool:
    return any(pattern.fullmatch(candidate) for pattern in USN_PATTERNS)


def _parse_usn_pdf(content: bytes) -> tuple[list[str], list[str], int]:
    reader = PdfReader(io.BytesIO(content))
    raw_text = "\n".join((page.extract_text() or "") for page in reader.pages)
    candidates = re.findall(r"\b[A-Za-z0-9-]{6,24}\b", raw_text)

    accepted: list[str] = []
    rejected: list[str] = []
    for token in candidates:
        normalized = re.sub(r"[^A-Za-z0-9]", "", token.upper().strip())
        if not normalized:
            continue

        if _is_valid_usn(normalized):
            accepted.append(normalized)
        else:
            rejected.append(normalized)

    unique_accepted = sorted(set(accepted))
    unique_rejected = sorted(set(rejected))[:200]
    return unique_accepted, unique_rejected, len(candidates)


def _extract_question_source_text(content: bytes) -> str:
    stripped = content.lstrip()
    if stripped.startswith(PDF_HEADER):
        reader = PdfReader(io.BytesIO(content))
        return "\n".join((page.extract_text() or "") for page in reader.pages)

    for encoding in TEXT_DECODE_ENCODINGS:
        try:
            decoded = content.decode(encoding)
        except UnicodeDecodeError:
            continue

        if decoded.strip():
            return decoded

    raise ValueError("Unsupported question file format")


def _parse_question_source(content: bytes) -> tuple[list[QuestionPreviewItem], list[str], int]:
    raw_text = _extract_question_source_text(content)
    lines = [line.strip() for line in raw_text.splitlines() if line.strip()]

    parsed: list[QuestionPreviewItem] = []
    ignored_lines: list[str] = []
    current: dict | None = None

    for line in lines:
        question_match = QUESTION_LINE_PATTERN.match(line)
        if question_match:
            if current is not None:
                parsed.append(QuestionPreviewItem(**current))

            current = {
                "question_number": int(question_match.group(1)),
                "question_text": question_match.group(2).strip(),
                "option_a": None,
                "option_b": None,
                "option_c": None,
                "option_d": None,
                "correct_option": None,
            }
            continue

        option_match = OPTION_LINE_PATTERN.match(line)
        if option_match and current is not None:
            key = f"option_{option_match.group(1).lower()}"
            current[key] = option_match.group(2).strip()
            continue

        answer_match = ANSWER_LINE_PATTERN.match(line)
        if answer_match and current is not None:
            current["correct_option"] = answer_match.group(1).upper()
            continue

        if current is not None:
            current["question_text"] = f"{current['question_text']} {line}".strip()
        else:
            ignored_lines.append(line)

    if current is not None:
        parsed.append(QuestionPreviewItem(**current))

    return parsed, ignored_lines[:30], len(lines)


@router.post("/preview-usns", response_model=UsnPreviewResponse)
async def preview_usn_pdf(
    teacher_username: str = Form(...),
    teacher_password: str = Form(...),
    student_usn_pdf: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    if not student_usn_pdf.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Student USN list must be uploaded as a PDF")

    teacher_result = await db.execute(
        select(TeacherAccount).where(TeacherAccount.username == teacher_username)
    )
    teacher = teacher_result.scalar_one_or_none()
    _authenticate_teacher(teacher_username, teacher_password, teacher)

    usn_pdf_content = await student_usn_pdf.read()
    try:
        parsed_usns, rejected_tokens, total_candidates = _parse_usn_pdf(usn_pdf_content)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Could not parse USN PDF") from exc

    return UsnPreviewResponse(
        parsed_usns=parsed_usns,
        rejected_tokens=rejected_tokens,
        total_candidates=total_candidates,
        accepted_count=len(parsed_usns),
    )


@router.post("/preview-questions", response_model=QuestionPreviewResponse)
async def preview_question_pdf(
    teacher_username: str = Form(...),
    teacher_password: str = Form(...),
    question_pdf: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    teacher_result = await db.execute(
        select(TeacherAccount).where(TeacherAccount.username == teacher_username)
    )
    teacher = teacher_result.scalar_one_or_none()
    _authenticate_teacher(teacher_username, teacher_password, teacher)

    pdf_content = await question_pdf.read()
    try:
        parsed_questions, ignored_lines_sample, lines_scanned = _parse_question_source(pdf_content)
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=(
                "Could not parse the question file. Upload a real PDF or a plain text file that starts "
                "with numbered questions like '1. Question text'."
            ),
        ) from exc

    if not parsed_questions:
        raise HTTPException(
            status_code=400,
            detail=(
                "No questions detected. Use numbered questions like '1. Question text' and options "
                "like 'A) Option text'."
            ),
        )

    return QuestionPreviewResponse(
        parsed_questions=parsed_questions,
        total_detected_questions=len(parsed_questions),
        lines_scanned=lines_scanned,
        ignored_lines_sample=ignored_lines_sample,
    )


@router.post("/upload", response_model=ExamTestRead, status_code=status.HTTP_201_CREATED)
async def upload_test_pdf(
    teacher_username: str = Form(...),
    teacher_password: str = Form(...),
    test_id: str = Form(...),
    title: str = Form(...),
    duration_minutes: int = Form(...),
    pdf_file: UploadFile = File(...),
    student_usn_pdf: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    normalized_test_id = test_id.strip().upper()

    teacher_result = await db.execute(
        select(TeacherAccount).where(TeacherAccount.username == teacher_username)
    )
    teacher = teacher_result.scalar_one_or_none()
    _authenticate_teacher(teacher_username, teacher_password, teacher)

    if duration_minutes <= 0:
        raise HTTPException(status_code=400, detail="duration_minutes must be greater than zero")

    # Automatic schedule: test opens immediately on upload and closes after duration.
    parsed_start = datetime.now(timezone.utc)
    parsed_end = parsed_start + timedelta(minutes=duration_minutes)

    test_result = await db.execute(
        select(ExamTest).where(ExamTest.test_id == normalized_test_id)
    )
    if test_result.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="Test ID already exists")

    if not pdf_file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF uploads are allowed for the test paper")

    if not student_usn_pdf.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Student USN list must be uploaded as a PDF")

    usn_pdf_content = await student_usn_pdf.read()
    try:
        usns, rejected_tokens, _ = _parse_usn_pdf(usn_pdf_content)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Could not parse USN PDF") from exc

    if not usns:
        detail = "No valid USNs found in the uploaded PDF"
        if rejected_tokens:
            detail = f"{detail}. Sample rejected tokens: {', '.join(rejected_tokens[:10])}"
        raise HTTPException(status_code=400, detail=detail)

    saved_name = f"{uuid.uuid4()}-{os.path.basename(pdf_file.filename)}"
    destination = UPLOAD_DIR / saved_name

    with destination.open("wb") as out_file:
        content = await pdf_file.read()
        out_file.write(content)

    pdf_url = f"/uploads/tests/{saved_name}"

    test = ExamTest(
        test_id=normalized_test_id,
        title=title,
        pdf_url=pdf_url,
        start_time=parsed_start,
        end_time=parsed_end,
        duration_minutes=duration_minutes,
        teacher_id=teacher.id,
    )
    db.add(test)
    await db.flush()

    for usn in usns:
        student_result = await db.execute(select(StudentAccount).where(StudentAccount.username == usn))
        student = student_result.scalar_one_or_none()
        if student is None:
            student = StudentAccount(
                username=usn,
                full_name=usn,
                password_hash="managed_by_test_id",
            )
            db.add(student)
            await db.flush()

        access_result = await db.execute(
            select(TestStudentAccess).where(
                TestStudentAccess.test_id == test.id,
                TestStudentAccess.student_id == student.id,
            )
        )
        if access_result.scalar_one_or_none() is None:
            db.add(TestStudentAccess(test_id=test.id, student_id=student.id))

    await db.commit()
    await db.refresh(test)

    return _as_exam_test_read(test)


@router.get("/{test_id}/schedule", response_model=TestScheduleResponse)
async def get_test_schedule(test_id: str, db: AsyncSession = Depends(get_db)):
    """Public endpoint — returns schedule metadata only (no PDF URL)."""
    result = await db.execute(
        select(ExamTest).where(ExamTest.test_id == test_id.strip().upper())
    )
    test = result.scalar_one_or_none()
    if test is None:
        raise HTTPException(status_code=404, detail="Test not found")
    return TestScheduleResponse(
        test_id=test.test_id,
        title=test.title,
        start_time=_to_utc(test.start_time),
        end_time=_to_utc(test.end_time),
        duration_minutes=test.duration_minutes,
    )


@router.get("/{test_id}", response_model=ExamTestRead)
async def get_test_by_code(test_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ExamTest).where(ExamTest.test_id == test_id))
    test = result.scalar_one_or_none()
    if test is None:
        raise HTTPException(status_code=404, detail="Test not found")
    return _as_exam_test_read(test)


@router.get("/", response_model=list[ExamTestRead])
async def list_tests(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ExamTest).order_by(ExamTest.created_at.desc()))
    tests = list(result.scalars().all())
    return [_as_exam_test_read(test) for test in tests]
