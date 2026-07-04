from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from app.deps import DBSession, CurrentUser
from app.models.project import Project
from app.models.organization import Organization
from app.schemas.project import ProjectCreate, ProjectUpdate, ProjectOut

router = APIRouter(tags=["Projects"])


@router.get("/api/orgs/{org_id}/projects", response_model=dict)
async def list_projects(org_id: str, db: DBSession, current_user: CurrentUser):
    result = await db.execute(select(Project).where(Project.org_id == org_id))
    projects = result.scalars().all()
    return {"success": True, "data": [ProjectOut.model_validate(p).model_dump() for p in projects]}


@router.post("/api/orgs/{org_id}/projects", response_model=dict, status_code=201)
async def create_project(org_id: str, body: ProjectCreate, db: DBSession, current_user: CurrentUser):
    org_result = await db.execute(select(Organization).where(Organization.id == org_id))
    if not org_result.scalar_one_or_none():
        raise HTTPException(404, "Organization not found")
    project = Project(org_id=org_id, name=body.name, description=body.description)
    db.add(project)
    await db.flush()
    await db.refresh(project)
    return {"success": True, "data": ProjectOut.model_validate(project).model_dump()}


@router.get("/api/projects/{project_id}", response_model=dict)
async def get_project(project_id: str, db: DBSession, current_user: CurrentUser):
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(404, "Project not found")
    return {"success": True, "data": ProjectOut.model_validate(project).model_dump()}


@router.put("/api/projects/{project_id}", response_model=dict)
async def update_project(project_id: str, body: ProjectUpdate, db: DBSession, current_user: CurrentUser):
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(404, "Project not found")
    if body.name is not None:
        project.name = body.name
    if body.description is not None:
        project.description = body.description
    await db.flush()
    await db.refresh(project)
    return {"success": True, "data": ProjectOut.model_validate(project).model_dump()}


@router.delete("/api/projects/{project_id}", response_model=dict)
async def delete_project(project_id: str, db: DBSession, current_user: CurrentUser):
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(404, "Project not found")
    await db.delete(project)
    await db.flush()
    return {"success": True, "data": {"deleted": True}}
