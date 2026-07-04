import re
from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from app.deps import DBSession, CurrentUser
from app.models.organization import Organization, OrgMember, MemberRole
from app.schemas.organization import OrgCreate, OrgUpdate, OrgOut, OrgMemberAdd, OrgMemberOut

router = APIRouter(prefix="/api/orgs", tags=["Organizations"])


def _make_slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


@router.get("", response_model=dict)
async def list_orgs(db: DBSession, current_user: CurrentUser):
    result = await db.execute(
        select(Organization).join(OrgMember, Organization.id == OrgMember.org_id)
        .where(OrgMember.user_id == current_user.id)
    )
    orgs = result.scalars().all()
    return {"success": True, "data": [OrgOut.model_validate(o).model_dump() for o in orgs]}


@router.post("", response_model=dict, status_code=201)
async def create_org(body: OrgCreate, db: DBSession, current_user: CurrentUser):
    slug = body.slug or _make_slug(body.name)
    # Ensure slug uniqueness
    existing = await db.execute(select(Organization).where(Organization.slug == slug))
    if existing.scalar_one_or_none():
        slug = f"{slug}-{current_user.id[:6]}"

    org = Organization(name=body.name, slug=slug, owner_id=current_user.id)
    db.add(org)
    await db.flush()

    # Add owner as member
    member = OrgMember(org_id=org.id, user_id=current_user.id, role=MemberRole.owner)
    db.add(member)
    await db.flush()
    await db.refresh(org)
    return {"success": True, "data": OrgOut.model_validate(org).model_dump()}


@router.get("/{org_id}", response_model=dict)
async def get_org(org_id: str, db: DBSession, current_user: CurrentUser):
    result = await db.execute(select(Organization).where(Organization.id == org_id))
    org = result.scalar_one_or_none()
    if not org:
        raise HTTPException(404, "Organization not found")
    return {"success": True, "data": OrgOut.model_validate(org).model_dump()}


@router.put("/{org_id}", response_model=dict)
async def update_org(org_id: str, body: OrgUpdate, db: DBSession, current_user: CurrentUser):
    result = await db.execute(select(Organization).where(Organization.id == org_id))
    org = result.scalar_one_or_none()
    if not org:
        raise HTTPException(404, "Organization not found")
    if org.owner_id != current_user.id:
        raise HTTPException(403, "Only org owner can update")
    if body.name:
        org.name = body.name
    await db.flush()
    await db.refresh(org)
    return {"success": True, "data": OrgOut.model_validate(org).model_dump()}


@router.delete("/{org_id}", response_model=dict)
async def delete_org(org_id: str, db: DBSession, current_user: CurrentUser):
    result = await db.execute(select(Organization).where(Organization.id == org_id))
    org = result.scalar_one_or_none()
    if not org:
        raise HTTPException(404, "Organization not found")
    if org.owner_id != current_user.id:
        raise HTTPException(403, "Only org owner can delete")
    await db.delete(org)
    await db.flush()
    return {"success": True, "data": {"deleted": True}}


@router.post("/{org_id}/members", response_model=dict, status_code=201)
async def add_member(org_id: str, body: OrgMemberAdd, db: DBSession, current_user: CurrentUser):
    result = await db.execute(select(Organization).where(Organization.id == org_id))
    org = result.scalar_one_or_none()
    if not org:
        raise HTTPException(404, "Organization not found")
    member = OrgMember(org_id=org_id, user_id=body.user_id, role=body.role)
    db.add(member)
    await db.flush()
    await db.refresh(member)
    return {"success": True, "data": OrgMemberOut.model_validate(member).model_dump()}
