"""
Async database setup using SQLAlchemy 2.0 with asyncpg driver.
The async engine and session factory ensure database calls never block
the FastAPI / WebSocket event loop.
"""
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase

# Replace with real credentials / use env vars in production
DATABASE_URL = "postgresql+asyncpg://user:pass@localhost/dbname"

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
