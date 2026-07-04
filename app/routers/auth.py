from fastapi import APIRouter
from app.deps import DBSession, CurrentUser
from app.schemas.auth import UserRegister, UserLogin, TokenResponse, UserOut
from app.services.auth_service import create_user, authenticate_user, create_access_token

router = APIRouter(prefix="/api/auth", tags=["Auth"])


@router.post("/register", response_model=dict, status_code=201)
async def register(body: UserRegister, db: DBSession):
    user = await create_user(db, body.email, body.username, body.password)
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
