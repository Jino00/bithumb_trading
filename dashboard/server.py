# FastAPI 메인 애플리케이션 — 대시보드 백엔드 진입점.
"""
REST API + WebSocket + 정적 파일 서빙을 통합한다.
개발 시: uvicorn dashboard.server:app --reload --port 8080
프로덕션: main.py --dashboard 로 봇과 함께 기동.
"""
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

import config
from dashboard.db_reader import DBReader
from dashboard.shared_state import SharedStateReader

logger = logging.getLogger(__name__)

# ── 공유 인스턴스 ──────────────────────────────────────────────────

db_reader = DBReader()
state_reader = SharedStateReader()

FRONTEND_DIST = Path(__file__).parent / "frontend" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"대시보드 서버 시작 (port={config.DASHBOARD_PORT})")
    yield
    logger.info("대시보드 서버 종료")


app = FastAPI(
    title="Bithumb Trading Bot Dashboard",
    version="1.0.0",
    lifespan=lifespan,
)

# ── CORS (개발용 Vite 프록시) ────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── 라우터 등록 ──────────────────────────────────────────────────

from dashboard.routers.analytics import router as analytics_router  # noqa: E402
from dashboard.routers.portfolio import router as portfolio_router  # noqa: E402
from dashboard.routers.system import router as system_router  # noqa: E402
from dashboard.routers.trades import router as trades_router  # noqa: E402
from dashboard.routers.ws import router as ws_router  # noqa: E402

app.include_router(portfolio_router, prefix="/api/portfolio", tags=["portfolio"])
app.include_router(trades_router, prefix="/api/trades", tags=["trades"])
app.include_router(analytics_router, prefix="/api/analytics", tags=["analytics"])
app.include_router(system_router, prefix="/api/system", tags=["system"])
app.include_router(ws_router, prefix="/ws", tags=["websocket"])


# ── 정적 파일 서빙 (프로덕션) ────────────────────────────────────

if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True))


# ── 실행 헬퍼 ────────────────────────────────────────────────────

def run_dashboard(port: int = 8080) -> None:
    """별도 프로세스에서 대시보드 서버를 기동한다."""
    import uvicorn
    uvicorn.run(
        "dashboard.server:app",
        host="0.0.0.0",
        port=port,
        log_level="info",
    )
