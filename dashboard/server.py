# FastAPI 메인 애플리케이션 — 대시보드 백엔드 진입점.
"""
REST API + WebSocket + 정적 파일 서빙을 통합한다.
개발 시: uvicorn dashboard.server:app --reload --port 8080
프로덕션: main.py --dashboard 로 봇과 함께 기동.
"""
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
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
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://localhost:58117"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── 라우터 등록 ──────────────────────────────────────────────────

from dashboard.routers.analytics import router as analytics_router  # noqa: E402
from dashboard.routers.paper import router as paper_router  # noqa: E402
from dashboard.routers.portfolio import router as portfolio_router  # noqa: E402
from dashboard.routers.screening import router as screening_router  # noqa: E402
from dashboard.routers.system import router as system_router  # noqa: E402
from dashboard.routers.trades import router as trades_router  # noqa: E402
from dashboard.routers.ws import router as ws_router  # noqa: E402
from dashboard.routers.journal import router as journal_router  # noqa: E402
from dashboard.routers.insights import router as insights_router  # noqa: E402
from dashboard.routers.binance import router as binance_router  # noqa: E402

app.include_router(portfolio_router, prefix="/api/portfolio", tags=["portfolio"])
app.include_router(trades_router, prefix="/api/trades", tags=["trades"])
app.include_router(analytics_router, prefix="/api/analytics", tags=["analytics"])
app.include_router(system_router, prefix="/api/system", tags=["system"])
app.include_router(paper_router, prefix="/api/paper", tags=["paper"])
app.include_router(screening_router, prefix="/api/screening", tags=["screening"])
app.include_router(ws_router, prefix="/ws", tags=["websocket"])
app.include_router(journal_router)
app.include_router(binance_router)
app.include_router(insights_router)


# ── 정적 파일 서빙 (프로덕션, SPA catch-all) ──────────────────────

if FRONTEND_DIST.exists():
    # 정적 에셋 (JS/CSS/이미지) — /assets 경로
    app.mount(
        "/assets",
        StaticFiles(directory=str(FRONTEND_DIST / "assets")),
        name="assets",
    )

    # SPA catch-all: API/WS/assets 외 모든 경로 → index.html
    @app.get("/{full_path:path}")
    async def spa_catch_all(request: Request, full_path: str):
        """React Router 클라이언트 사이드 라우팅 지원."""
        file_path = (FRONTEND_DIST / full_path).resolve()
        if file_path.is_relative_to(FRONTEND_DIST.resolve()) and file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(FRONTEND_DIST / "index.html")


# ── 실행 헬퍼 ────────────────────────────────────────────────────

def run_dashboard(port: int = 8080) -> None:
    """별도 프로세스에서 대시보드 서버를 기동한다."""
    import uvicorn
    uvicorn.run(
        "dashboard.server:app",
        host="127.0.0.1",
        port=port,
        log_level="info",
    )
