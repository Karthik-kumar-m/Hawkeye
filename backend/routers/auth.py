"""Authentication endpoints for teacher and student accounts."""
import hashlib

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

try:
    from ..database import get_db
    from ..models import StudentAccount, TeacherAccount
    from ..schemas import (
        AuthResponse,
        StudentLoginRequest,
        StudentLoginResponse,
        StudentRegisterRequest,
        TeacherAuthRequest,
    )
except ImportError:
    from database import get_db
    from models import StudentAccount, TeacherAccount
    from schemas import (
        AuthResponse,
        StudentLoginRequest,
        StudentLoginResponse,
        StudentRegisterRequest,
        TeacherAuthRequest,
    )


router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


def _hash_password(raw_password: str) -> str:
    return hashlib.sha256(raw_password.encode("utf-8")).hexdigest()


@router.post("/teachers/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def register_teacher(body: TeacherAuthRequest, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(TeacherAccount).where(TeacherAccount.username == body.username))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="Teacher username already exists")

    teacher = TeacherAccount(username=body.username, password_hash=_hash_password(body.password))
    db.add(teacher)
    await db.commit()
    await db.refresh(teacher)

    return AuthResponse(user_id=teacher.id, username=teacher.username)


@router.post("/teachers/login", response_model=AuthResponse)
async def login_teacher(body: TeacherAuthRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(TeacherAccount).where(TeacherAccount.username == body.username))
    teacher = result.scalar_one_or_none()
    if teacher is None or teacher.password_hash != _hash_password(body.password):
        raise HTTPException(status_code=401, detail="Invalid teacher credentials")

    return AuthResponse(user_id=teacher.id, username=teacher.username)


@router.post("/students/register", response_model=StudentLoginResponse, status_code=status.HTTP_201_CREATED)
async def register_student(body: StudentRegisterRequest, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(StudentAccount).where(StudentAccount.username == body.username))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="Student username already exists")

    student = StudentAccount(
        full_name=body.full_name,
        username=body.username,
        password_hash=_hash_password(body.password),
    )
    db.add(student)
    await db.commit()
    await db.refresh(student)

    return StudentLoginResponse(user_id=student.id, username=student.username, full_name=student.full_name)


@router.post("/students/login", response_model=StudentLoginResponse)
async def login_student(body: StudentLoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(StudentAccount).where(StudentAccount.username == body.username))
    student = result.scalar_one_or_none()
    if student is None or student.password_hash != _hash_password(body.password):
        raise HTTPException(status_code=401, detail="Invalid student credentials")

    return StudentLoginResponse(user_id=student.id, username=student.username, full_name=student.full_name)
