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
    role: str  # 'admin' | 'student'


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
