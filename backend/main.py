"""
Hawkeye – FastAPI application entry point.

Starts the async database, mounts routers, and configures CORS so the
React dev server (port 5173) can communicate freely during development.
"""
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import inspect, text

try:
    from .database import Base, engine
    from .routers import auth, resources, sessions, tests, ws
except ImportError:
    from database import Base, engine
    from routers import auth, resources, sessions, tests, ws


def _ensure_exam_test_schedule_columns(sync_conn):
    inspector = inspect(sync_conn)
    if "exam_tests" not in inspector.get_table_names():
        return

    existing = {column["name"] for column in inspector.get_columns("exam_tests")}
    datetime_type = "TIMESTAMPTZ" if sync_conn.dialect.name == "postgresql" else "DATETIME"

    if "start_time" not in existing:
        sync_conn.execute(text(f"ALTER TABLE exam_tests ADD COLUMN start_time {datetime_type}"))
    if "end_time" not in existing:
        sync_conn.execute(text(f"ALTER TABLE exam_tests ADD COLUMN end_time {datetime_type}"))
    if "duration_minutes" not in existing:
        sync_conn.execute(text("ALTER TABLE exam_tests ADD COLUMN duration_minutes INTEGER"))


def _ensure_question_columns(sync_conn):
    inspector = inspect(sync_conn)
    if "questions" not in inspector.get_table_names():
        return

    existing = {column["name"] for column in inspector.get_columns("questions")}
    if "correct_option" not in existing:
        sync_conn.execute(text("ALTER TABLE questions ADD COLUMN correct_option VARCHAR(1)"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create all tables on startup (dev convenience – use Alembic in prod)."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_ensure_exam_test_schedule_columns)
        await conn.run_sync(_ensure_question_columns)
    yield


app = FastAPI(title="Hawkeye – Integrity-First Exam Monitor", lifespan=lifespan)

# Allow the React dev server and any local origin during development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ws.router)
app.include_router(resources.router)
app.include_router(sessions.router)
app.include_router(auth.router)
app.include_router(tests.router)

uploads_dir = Path(__file__).resolve().parent / "uploads"
uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")


@app.get("/health")
async def health():
    return {"status": "ok"}
