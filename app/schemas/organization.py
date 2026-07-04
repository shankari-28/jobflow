from pydantic import BaseModel, field_validator
from datetime import datetime
from typing import Optional, List
import re


class OrgCreate(BaseModel):
    name: str
    slug: Optional[str] = None

    @field_validator("slug", mode="before")
    @classmethod
    def make_slug(cls, v, info):
        if v:
            return re.sub(r"[^a-z0-9-]", "-", v.lower()).strip("-")
        return None


class OrgUpdate(BaseModel):
    name: Optional[str] = None


class OrgOut(BaseModel):
    id: str
    name: str
    slug: str
    owner_id: str
    created_at: datetime
    model_config = {"from_attributes": True}


class OrgMemberAdd(BaseModel):
    user_id: str
    role: str = "member"


class OrgMemberOut(BaseModel):
    org_id: str
    user_id: str
    role: str
    joined_at: datetime
    model_config = {"from_attributes": True}
