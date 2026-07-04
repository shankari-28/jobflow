# JobFlow — Distributed Job Scheduling Platform

JobFlow is a production-grade, distributed background job scheduling and execution platform. It is built with **FastAPI**, **SQLAlchemy**, and **MySQL**, featuring a premium responsive Single Page Application (SPA) dashboard, standalone worker processes, and robust multi-worker concurrency protection using `SELECT ... FOR UPDATE SKIP LOCKED`.

---

## Key Features

- **🔐 Robust Authentication & Scoping**: JWT-based token authorization. Workspace isolation guarantees that workers and dashboards only see resources (projects, queues, workers, jobs) they are explicitly granted access to.
- **💼 Workspace Management**: Full UI dashboard for creating and managing Organizations and Projects. No auto-seeded defaults; you control your namespace.
- **⚙️ Queue Configurations**: Custom priority weights, queue-specific concurrency limits, and retry policies (Exponential, Linear, or Fixed delays with optional Jitter). Support for pausing/resuming queues dynamically.
- **🚀 Advanced Job Dispatching**: Support for immediate, delayed (seconds), scheduled (specific timestamps), recurring (cron-based), and batch job executions.
- **⚡ Distributed Concurrency Control**: Standalone worker processes run independently and claim jobs atomically using database-level locking (`SKIP LOCKED`), preventing race conditions and duplicate executions.
- **📈 Real-Time Dashboard**: Premium dark-mode UI with live charts, worker heartbeats, CPU/Memory statistics, execution logs, and live monitoring of queues.
- **📥 Dead Letter Queue (DLQ)**: Failed tasks automatically retry. Once retries are exhausted, they are promoted to the DLQ where you can view tracebacks and trigger manual requeues from the UI.

---

## Architecture Overview

```mermaid
graph TD
    subgraph Vercel [Vercel Hosting]
        ClientApp[SPA Frontend / Dashboard]
    end

    subgraph Railway [Railway Hosting]
        APIServer[FastAPI Server]
        DB[(MySQL Database)]
        APIServer -->|Write Jobs / Queues| DB
        APIServer -->|Background Watchdog & Cron| APScheduler[APScheduler Engine]
        APScheduler -->|Promote / Re-queue| DB
    end
    
    subgraph Worker Nodes [Worker Pools / Scaling]
        Worker1[Worker A]
        Worker2[Worker B]
    end

    ClientApp -->|HTTP/REST + JWT over HTTPS| APIServer
    Worker1 -->|SELECT FOR UPDATE SKIP LOCKED| DB
    Worker2 -->|SELECT FOR UPDATE SKIP LOCKED| DB
    Worker1 -->|Heartbeat & Resource Stats| DB
    Worker2 -->|Heartbeat & Resource Stats| DB
```

---

## Quick Start (Local Setup)

### 1. Pre-requisites
- **Python 3.10+**
- **MySQL 8.0+**

### 2. Installation
Clone the repository and install the dependencies:
```bash
git clone https://github.com/shankari-28/jobflow.git
cd jobflow
pip install -r requirements.txt
```

### 3. Environment Configuration
Create a `.env` file in the root directory:
```env
DATABASE_HOST=localhost
DATABASE_PORT=3306
DATABASE_USER=root
DATABASE_PASSWORD=your_mysql_password
DATABASE_NAME=jobqueue
SECRET_KEY=generate-a-secure-random-key-in-production
```

### 4. Database Setup & Initialization
Run the database initializer script to automatically create the database and tables:
```bash
python init_db.py
```

### 5. Running the Application
**Start the API & Web Server:**
```bash
python -m uvicorn app.main:app --port 8000 --reload
```
Open `http://localhost:8000` in your web browser, register your account, and manage your organizations, projects, and queues.

---

## Spawning Workers

Workers run as standalone, independent OS processes to ensure distributed correctness:

### Option A: From the Web UI
Go to the **Workers** tab in the dashboard, click **Start Worker**, select your target project, set the concurrency, and click **Spawn**. The API server will immediately spin up a worker process in the background.

### Option B: From the Terminal
You can manually run one or more workers on any machine scoped to a specific project:
```bash
python worker.py --id worker-billing-1 --project YOUR_PROJECT_ID --concurrency 5 --poll 1.0
```

---

## Developer Integration Guide

Other developers can integrate JobFlow into their own websites, backends, or microservices:

### 1. Scheduling Jobs via REST API
Simply make a POST request from any language/server to dispatch jobs to your queues:

```javascript
// Example in Node.js
const axios = require('axios');

async function triggerImageProcessing(imageUrl) {
  const response = await axios.post(
    'https://your-jobflow-host.com/api/queues/YOUR_QUEUE_ID/jobs',
    {
      name: "Optimize Profile Avatar",
      job_type: "immediate",
      payload: {
        __handler: "image_resize",
        url: imageUrl,
        width: 200,
        height: 200
      }
    },
    { headers: { Authorization: 'Bearer DEVELOPER_JWT_TOKEN' } }
  );
  console.log('Job enqueued with ID:', response.data.data.id);
}
```

### 2. Creating Custom Workers
To run tasks specific to your application, add a custom handler to the `HANDLERS` dictionary inside `worker.py`:

```python
# worker.py
async def handler_resize_image(payload: dict) -> dict:
    url = payload["url"]
    # Perform image resizing logic here...
    return {"status": "success", "width": payload["width"]}

# Register it in the HANDLERS mapping:
HANDLERS = {
    "echo": handler_echo,
    "sleep": handler_sleep,
    "image_resize": handler_resize_image, # Your custom handler
}
```
Run the worker script. It will now pull matching jobs from your hosted instance, process them, and log results back to the database automatically.

---

## Production Hosting & Deployment

When deploying to hosted cloud platforms (e.g. Railway, Render, Fly.io, AWS):

### 1. Database Configuration
Specify a single database connection string using the `DATABASE_URL_STR` environment variable. JobFlow will automatically configure SQLAlchemy to use the correct driver:
- **Async API Engine**: `mysql+aiomysql://`
- **Sync Migrations/Initializer**: `mysql+pymysql://`

```env
DATABASE_URL_STR=mysql://username:password@your-database-host:3306/database_name
```

### 2. Deploying the API Server (Frontend & Backend)
JobFlow serves its SPA dashboard directly from FastAPI's root directory (`/`). You only need to host the FastAPI application:
- **Build Command**: `pip install -r requirements.txt`
- **Start Command**: `python -m uvicorn app.main:app --host 0.0.0.0 --port $PORT`

### 3. Scaling Workers
Workers can run on different virtual machines, ECS containers, or background worker processes (e.g. Render Background Workers or Railway Services). Just pass the `DATABASE_URL_STR` environment variable and run the startup command:
```bash
python worker.py --project YOUR_PRODUCTION_PROJECT_ID --concurrency 20
```
Use the **Stop Worker** action on the Web UI to terminate them gracefully when scaling down.
