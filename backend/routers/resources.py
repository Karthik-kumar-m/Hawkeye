"""
REST CRUD endpoints for ExternalResource.
  GET    /api/v1/resources        – list all active resources
  POST   /api/v1/resources        – create a new resource
  DELETE /api/v1/resources/{id}   – delete a resource by id
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import ExternalResource
from ..schemas import ExternalResourceCreate, ExternalResourceRead

router = APIRouter(prefix="/api/v1/resources", tags=["resources"])


@router.get("/", response_model=list[ExternalResourceRead])
async def list_resources(db: AsyncSession = Depends(get_db)):
    """Return all resources (active and inactive)."""
    result = await db.execute(select(ExternalResource))
    return result.scalars().all()


@router.post("/", response_model=ExternalResourceRead, status_code=status.HTTP_201_CREATED)
async def create_resource(
    body: ExternalResourceCreate,
    db: AsyncSession = Depends(get_db),
):
    """Persist a new ExternalResource and return it."""
    resource = ExternalResource(**body.model_dump())
    db.add(resource)
    await db.commit()
    await db.refresh(resource)
    return resource


@router.delete("/{resource_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_resource(
    resource_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Hard-delete a resource by its UUID primary key."""
    result = await db.execute(
        select(ExternalResource).where(ExternalResource.id == resource_id)
    )
    resource = result.scalar_one_or_none()
    if resource is None:
        raise HTTPException(status_code=404, detail="Resource not found")
    await db.delete(resource)
    await db.commit()
