"""
Async database setup using SQLAlchemy 2.0.
Defaults to SQLite for zero-setup local development, while still supporting
PostgreSQL via DATABASE_URL override.
"""
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
import os

# Uses env var when provided; defaults to local SQLite database.
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "sqlite+aiosqlite:///./hawkeye.db",
)

# echo=True logs all SQL – set False in production
engine = create_async_engine(DATABASE_URL, echo=True)

# expire_on_commit=False avoids lazy-load issues after commit in async context
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    """Shared declarative base for all ORM models."""
    pass


async def get_db() -> AsyncSession:
    """
    FastAPI dependency that yields an async DB session and guarantees
    the session is closed after the request finishes.
    """
    async with AsyncSessionLocal() as session:
        yield session
