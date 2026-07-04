from pydantic_settings import BaseSettings
from sqlalchemy.engine import URL


class Settings(BaseSettings):
    # Database URL override for hosted environments (e.g. Railway, Render, Heroku)
    DATABASE_URL_STR: Optional[str] = None

    # Database
    DATABASE_HOST: str = "localhost"
    DATABASE_PORT: int = 3306
    DATABASE_USER: str = "root"
    DATABASE_PASSWORD: str = ""
    DATABASE_NAME: str = "jobqueue"

    # Auth
    SECRET_KEY: str = "changeme-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24 hours

    # Worker tuning
    WORKER_POLL_INTERVAL: float = 1.0
    WORKER_HEARTBEAT_INTERVAL: float = 5.0
    WORKER_STALE_SECONDS: int = 60
    SCHEDULER_INTERVAL_SECONDS: int = 10

    @property
    def DATABASE_URL(self) -> str:
        """Build the async MySQL URL using URL.create() or direct connection string."""
        if self.DATABASE_URL_STR:
            url = self.DATABASE_URL_STR
            if url.startswith("mysql://"):
                return url.replace("mysql://", "mysql+aiomysql://", 1)
            if url.startswith("mysql+pymysql://"):
                return url.replace("mysql+pymysql://", "mysql+aiomysql://", 1)
            return url
        return URL.create(
            drivername="mysql+aiomysql",
            username=self.DATABASE_USER,
            password=self.DATABASE_PASSWORD,
            host=self.DATABASE_HOST,
            port=self.DATABASE_PORT,
            database=self.DATABASE_NAME,
        ).render_as_string(hide_password=False)

    @property
    def SYNC_DATABASE_URL(self) -> str:
        """Synchronous URL used by Alembic migrations (pymysql driver)."""
        if self.DATABASE_URL_STR:
            url = self.DATABASE_URL_STR
            if url.startswith("mysql://"):
                return url.replace("mysql://", "mysql+pymysql://", 1)
            if url.startswith("mysql+aiomysql://"):
                return url.replace("mysql+aiomysql://", "mysql+pymysql://", 1)
            return url
        return URL.create(
            drivername="mysql+pymysql",
            username=self.DATABASE_USER,
            password=self.DATABASE_PASSWORD,
            host=self.DATABASE_HOST,
            port=self.DATABASE_PORT,
            database=self.DATABASE_NAME,
        ).render_as_string(hide_password=False)

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
