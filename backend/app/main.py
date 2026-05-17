# pyrefly: ignore [missing-import]
from fastapi import FastAPI
# pyrefly: ignore [missing-import]
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.routes import health, items, chat, scheduler as scheduler_router

app = FastAPI(title="NR2Dashboard API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL, "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(items.router)
app.include_router(chat.router)
app.include_router(scheduler_router.router)


@app.on_event("startup")
async def startup():
    from app.scheduler_worker import scheduler, check_and_run
    scheduler.add_job(check_and_run, "interval", minutes=1, id="scheduler_poll", replace_existing=True)
    scheduler.start()
    print("[main] APScheduler started — polling every 60s")
