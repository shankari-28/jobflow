web: python init_db.py && uvicorn app.main:app --host 0.0.0.0 --port $PORT
worker: python worker.py --id worker-alpha --concurrency 5 --poll 1.0
