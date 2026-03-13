"""
Hawkeye – FastAPI application entry point.

Starts the async database, mounts routers, and configures CORS so the
React dev server (port 5173) can communicate freely during development.
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

try:
    from .database import Base, engine
    from .routers import resources, sessions, ws
except ImportError:
    from database import Base, engine
    from routers import resources, sessions, ws


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create all tables on startup (dev convenience – use Alembic in prod)."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield


app = FastAPI(title="SENTINEL – Integrity-First Exam Monitor", lifespan=lifespan)

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


@app.get("/health")
async def health():
    return {"status": "ok"}
