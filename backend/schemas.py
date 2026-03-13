"""
Pydantic v2 schemas for request/response validation and serialisation.
"""
import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


# ---------------------------------------------------------------------------
# ExternalResource schemas
# ---------------------------------------------------------------------------

class ExternalResourceBase(BaseModel):
    title: str
    url: str
    is_active: bool = True


class ExternalResourceCreate(ExternalResourceBase):
    pass


class ExternalResourceRead(ExternalResourceBase):
    id: uuid.UUID

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# User schemas
# ---------------------------------------------------------------------------

class UserBase(BaseModel):
    username: str
    role: str  # 'admin' (monitor channel) | 'student'


class UserCreate(UserBase):
    pass


class UserRead(UserBase):
    id: uuid.UUID

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# ExamSession schemas
# ---------------------------------------------------------------------------

class ExamSessionRead(BaseModel):
    id: uuid.UUID
    student_id: uuid.UUID
    status: str
    trust_score: int
    start_time: datetime

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# TrackingEvent schemas (used by the WebSocket layer)
# ---------------------------------------------------------------------------

class TrackingEventIn(BaseModel):
    """Payload sent by the student client over WebSocket."""
    event_type: str
    payload: Optional[dict] = None


class TrackingEventRead(BaseModel):
    id: uuid.UUID
    session_id: uuid.UUID
    event_type: str
    payload: Optional[dict]
    timestamp: datetime

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Session orchestration schemas
# ---------------------------------------------------------------------------

class SessionStartRequest(BaseModel):
    student_username: str
    test_id: str


class SessionStartResponse(BaseModel):
    session_id: uuid.UUID
    student_name: str
    student_identifier: str
    test_id: str
    test_title: str
    test_pdf_url: str
    test_start_time: Optional[datetime] = None
    test_end_time: Optional[datetime] = None
    duration_minutes: int = 45
    status: str
    trust_score: int
    started_at: datetime


class SessionRead(BaseModel):
    id: uuid.UUID
    student_name: str
    student_identifier: str
    test_id: Optional[str] = None
    started_at: datetime
    status: str
    trust_score: int
    violations: int
    correct_answers: Optional[int] = None
    total_questions: Optional[int] = None
    score_percent: Optional[float] = None


class SessionCompleteResponse(BaseModel):
    session_id: uuid.UUID
    status: str


class SessionEventRead(BaseModel):
    id: uuid.UUID
    session_id: uuid.UUID
    event_type: str
    payload: Optional[dict]
    timestamp: datetime

    model_config = ConfigDict(from_attributes=True)


class TeacherAuthRequest(BaseModel):
    username: str
    password: str


class AuthResponse(BaseModel):
    user_id: uuid.UUID
    username: str


class StudentRegisterRequest(BaseModel):
    full_name: str
    username: str
    password: str


class StudentLoginRequest(BaseModel):
    username: str
    password: str


class StudentLoginResponse(BaseModel):
    user_id: uuid.UUID
    username: str
    full_name: str


class ExamTestRead(BaseModel):
    id: uuid.UUID
    test_id: str
    title: str
    pdf_url: str
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    duration_minutes: Optional[int] = None
    teacher_id: uuid.UUID
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UsnPreviewResponse(BaseModel):
    parsed_usns: list[str]
    rejected_tokens: list[str]
    total_candidates: int
    accepted_count: int


class QuestionPreviewItem(BaseModel):
    question_number: int
    question_text: str
    option_a: Optional[str] = None
    option_b: Optional[str] = None
    option_c: Optional[str] = None
    option_d: Optional[str] = None
    correct_option: Optional[str] = None


class QuestionPreviewResponse(BaseModel):
    parsed_questions: list[QuestionPreviewItem]
    total_detected_questions: int
    lines_scanned: int
    ignored_lines_sample: list[str]


class TestScheduleResponse(BaseModel):
    test_id: str
    title: str
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    duration_minutes: Optional[int] = None
