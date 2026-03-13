#!/usr/bin/env python3
"""Backfill AllowedStudent and Question tables from existing test data.

Usage:
  /workspaces/Hawkeye/.venv/bin/python backend/scripts/extract_exam_data.py
"""

from __future__ import annotations

import asyncio
import io
import re
import sys
from pathlib import Path

from pypdf import PdfReader
from sqlalchemy import delete, select

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from database import AsyncSessionLocal, Base, engine
from models import AllowedStudent, ExamTest, Question, StudentAccount, TestStudentAccess

OPTION_PATTERN = re.compile(r"^[\(\[]?([A-D])[\)\].:]\s*(.+)$", re.IGNORECASE)
QUESTION_PATTERN = re.compile(r"^(\d{1,3})[\).:-]\s+(.+)$")


def extract_text_from_pdf(pdf_path: Path) -> str:
    with pdf_path.open("rb") as f:
        reader = PdfReader(io.BytesIO(f.read()))
    return "\n".join((page.extract_text() or "") for page in reader.pages)


def parse_mcq_questions(raw_text: str) -> list[dict]:
    """Parse basic MCQ structure from PDF text.

    Expected layout:
      1. Question text
      A) Option 1
      B) Option 2
      C) Option 3
      D) Option 4
    """
    lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
    questions: list[dict] = []
    current: dict | None = None

    for line in lines:
        q_match = QUESTION_PATTERN.match(line)
        if q_match:
            if current:
                questions.append(current)
            current = {
                "question_number": int(q_match.group(1)),
                "question_text": q_match.group(2).strip(),
                "option_a": None,
                "option_b": None,
                "option_c": None,
                "option_d": None,
            }
            continue

        opt_match = OPTION_PATTERN.match(line)
        if opt_match and current is not None:
            key = f"option_{opt_match.group(1).lower()}"
            current[key] = opt_match.group(2).strip()
            continue

        # Continuation lines get appended to current question text.
        if current is not None:
            current["question_text"] = f"{current['question_text']} {line}".strip()

    if current:
        questions.append(current)

    return questions


async def backfill_allowed_students() -> int:
    async with AsyncSessionLocal() as session:
        # Remove prior backfilled rows to keep reruns deterministic.
        await session.execute(delete(AllowedStudent))

        result = await session.execute(
            select(TestStudentAccess, StudentAccount)
            .join(StudentAccount, StudentAccount.id == TestStudentAccess.student_id)
        )
        rows = result.all()

        created = 0
        for access, student in rows:
            session.add(
                AllowedStudent(
                    test_id=access.test_id,
                    usn=student.username,
                    full_name=student.full_name,
                )
            )
            created += 1

        await session.commit()
        return created


async def backfill_questions() -> tuple[int, int]:
    async with AsyncSessionLocal() as session:
        await session.execute(delete(Question))

        tests_result = await session.execute(select(ExamTest))
        tests = list(tests_result.scalars().all())

        inserted = 0
        skipped_tests = 0

        for test in tests:
            pdf_path = Path(__file__).resolve().parent.parent / test.pdf_url.lstrip("/")
            if not pdf_path.exists():
                skipped_tests += 1
                continue

            raw_text = extract_text_from_pdf(pdf_path)
            parsed_questions = parse_mcq_questions(raw_text)
            if not parsed_questions:
                skipped_tests += 1
                continue

            for question in parsed_questions:
                session.add(
                    Question(
                        test_id=test.id,
                        question_number=question["question_number"],
                        question_text=question["question_text"],
                        option_a=question["option_a"],
                        option_b=question["option_b"],
                        option_c=question["option_c"],
                        option_d=question["option_d"],
                    )
                )
                inserted += 1

        await session.commit()
        return inserted, skipped_tests


async def main() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    allowed_count = await backfill_allowed_students()
    question_count, skipped_tests = await backfill_questions()

    print(f"AllowedStudent rows inserted: {allowed_count}")
    print(f"Question rows inserted: {question_count}")
    print(f"Tests skipped for questions: {skipped_tests}")


if __name__ == "__main__":
    asyncio.run(main())
