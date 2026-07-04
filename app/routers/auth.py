from fastapi import APIRouter
from app.deps import DBSession, CurrentUser
from app.schemas.auth import UserRegister, UserLogin, TokenResponse, UserOut
from app.services.auth_service import create_user, authenticate_user, create_access_token

router = APIRouter(prefix="/api/auth", tags=["Auth"])


@router.post("/register", response_model=dict, status_code=201)
async def register(body: UserRegister, db: DBSession):
    username = body.username
    if not username:
        import uuid
        if body.first_name:
            username = body.first_name
            if body.last_name:
                username += f"_{body.last_name}"
        else:
            username = body.email.split("@")[0]
        
        # Clean non-alphanumeric characters
        username = "".join(c for c in username if c.isalnum() or c in ("-", "_")).strip()
        if not username or len(username) < 3:
            username = f"user_{str(uuid.uuid4())[:8]}"
        else:
            username = f"{username}_{str(uuid.uuid4())[:6]}"

    user = await create_user(db, body.email, username, body.password)

    # Seed default organization & project for instant onboarding
    from app.models.organization import Organization, OrgMember, MemberRole
    from app.models.project import Project

    org = Organization(
        name="Default Org",
        slug=f"default-org-{user.id[:6]}",
        owner_id=user.id
    )
    db.add(org)
    await db.flush()

    member = OrgMember(
        org_id=org.id,
        user_id=user.id,
        role=MemberRole.owner
    )
    db.add(member)

    project = Project(
        org_id=org.id,
        name="Default Project",
        description="Auto-generated default project for onboarding"
    )
    db.add(project)
    await db.flush()

    return {"success": True, "data": {"id": user.id, "email": user.email, "username": user.username}}


@router.post("/login", response_model=dict)
async def login(body: UserLogin, db: DBSession):
    user = await authenticate_user(db, body.email, body.password)
    token = create_access_token({"sub": user.id, "email": user.email})
    return {
        "success": True,
        "data": TokenResponse(
            access_token=token,
            token_type="bearer",
            user_id=user.id,
            username=user.username,
            email=user.email,
        ).model_dump(),
    }


@router.get("/me", response_model=dict)
async def me(current_user: CurrentUser):
    return {
        "success": True,
        "data": {
            "id": current_user.id,
            "email": current_user.email,
            "username": current_user.username,
            "is_active": current_user.is_active,
            "created_at": current_user.created_at.isoformat(),
        },
    }
