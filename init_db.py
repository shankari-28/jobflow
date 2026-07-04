import sys
import pymysql
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from app.config import settings
from app.database import Base
from app.models import *  # ensure all models are imported to register with Base

def main():
    print("Connecting to MySQL server...")
    try:
        if settings.DATABASE_URL_STR:
            url = make_url(settings.DATABASE_URL_STR)
            host = url.host
            port = url.port or 3306
            user = url.username
            password = url.password
            db_name = url.database
        else:
            host = settings.DATABASE_HOST
            port = settings.DATABASE_PORT
            user = settings.DATABASE_USER
            password = settings.DATABASE_PASSWORD
            db_name = settings.DATABASE_NAME

        # Connect without database specified to create it if it doesn't exist
        connection = pymysql.connect(
            host=host,
            port=port,
            user=user,
            password=password,
        )
        with connection.cursor() as cursor:
            print(f"Creating database '{db_name}' if not exists...")
            cursor.execute(f"CREATE DATABASE IF NOT EXISTS {db_name} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
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
        
        # Check if workers table exists, and if so, migrate it
        from sqlalchemy import inspect, text
        inspector = inspect(engine)
        if "workers" in inspector.get_table_names():
            columns = [c["name"] for c in inspector.get_columns("workers")]
            if "project_id" not in columns:
                print("Migrating workers table: adding project_id column...")
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE workers ADD COLUMN project_id VARCHAR(36) NULL"))
                    conn.execute(text("ALTER TABLE workers ADD CONSTRAINT fk_workers_projects FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL"))
                print("workers table migrated successfully.")

        Base.metadata.create_all(bind=engine)
        print("All tables initialized successfully!")
    except Exception as e:
        print(f"Error initializing tables: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
