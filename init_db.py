import sys
import pymysql
from sqlalchemy import create_engine
from app.config import settings
from app.database import Base
from app.models import *  # ensure all models are imported to register with Base

def main():
    print("Connecting to MySQL server...")
    try:
        # Connect without database specified to create it if it doesn't exist
        connection = pymysql.connect(
            host=settings.DATABASE_HOST,
            port=settings.DATABASE_PORT,
            user=settings.DATABASE_USER,
            password=settings.DATABASE_PASSWORD,
        )
        with connection.cursor() as cursor:
            print(f"Creating database '{settings.DATABASE_NAME}' if not exists...")
            cursor.execute(f"CREATE DATABASE IF NOT EXISTS {settings.DATABASE_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
        connection.commit()
        connection.close()
        print("Database created or already exists.")
    except Exception as e:
        print(f"Error creating database: {e}", file=sys.stderr)
        sys.exit(1)

    print("Initializing tables via SQLAlchemy...")
    try:
        # Use synchronous engine to create tables
        engine = create_engine(settings.SYNC_DATABASE_URL)
        Base.metadata.create_all(bind=engine)
        print("All tables initialized successfully!")
    except Exception as e:
        print(f"Error initializing tables: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
