# 페이퍼 트레이딩 API 라우터 — /api/paper/* 엔드포인트.
import asyncio
import os
import signal
import subprocess
import sys
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel

from dashboard.schemas import PaperOverview
from dashboard.shared_state import PaperStateReader

router = APIRouter()

_paper_reader = PaperStateReader(cache_ttl=1.0)

# 봇 프로세스 추적
_bot_process: asyncio.subprocess.Process | None = None
_bot_log_handle = None
_PROJECT_ROOT = Path(__file__).parent.parent.parent


class BotStatus(BaseModel):
    running: bool
    pid: int | None = None
    message: str = ""


class BotStartRequest(BaseModel):
    capital: int = 10_000_000
    verbose: bool = True


@router.get("/overview", response_model=PaperOverview)
async def paper_overview():
    """페이퍼 트레이딩 전체 상태를 반환한다."""
    data = _paper_reader.read()
    if data is None:
        return PaperOverview()
    return PaperOverview(**data)


async def _check_external_process() -> int | None:
    """외부에서 시작된 paper_portfolio_manager 프로세스 PID를 반환한다."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "pgrep", "-f", "paper_portfolio_manager",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=5)
        if stdout and stdout.decode().strip():
            return int(stdout.decode().strip().split()[0])
    except Exception:
        pass
    return None


@router.get("/bot/status", response_model=BotStatus)
async def bot_status():
    """페이퍼 트레이딩 봇 실행 상태를 확인한다."""
    global _bot_process
    if _bot_process and _bot_process.returncode is None:
        return BotStatus(running=True, pid=_bot_process.pid)
    # 외부에서 시작된 프로세스 확인
    pid = await _check_external_process()
    if pid:
        return BotStatus(running=True, pid=pid, message="외부 프로세스")
    return BotStatus(running=False)


@router.post("/bot/start", response_model=BotStatus)
async def bot_start(req: BotStartRequest):
    """페이퍼 트레이딩 봇을 시작한다."""
    global _bot_process, _bot_log_handle

    # 이미 실행 중인지 확인
    status = await bot_status()
    if status.running:
        return BotStatus(
            running=True, pid=status.pid,
            message="이미 실행 중",
        )

    cmd = [
        sys.executable, "paper_portfolio_manager.py",
        "--capital", str(req.capital),
    ]
    if req.verbose:
        cmd.append("--verbose")

    # 이전 로그 핸들 정리
    if _bot_log_handle and not _bot_log_handle.closed:
        _bot_log_handle.close()

    _bot_log_handle = open("/tmp/paper_trading.log", "w")
    _bot_process = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=str(_PROJECT_ROOT),
        stdout=_bot_log_handle,
        stderr=asyncio.subprocess.STDOUT,
    )
    return BotStatus(
        running=True, pid=_bot_process.pid,
        message=f"시작됨 (자본: {req.capital:,}원)",
    )


@router.post("/bot/stop", response_model=BotStatus)
async def bot_stop():
    """페이퍼 트레이딩 봇을 중지한다."""
    global _bot_process, _bot_log_handle

    # API에서 시작한 프로세스
    if _bot_process and _bot_process.returncode is None:
        _bot_process.terminate()
        try:
            await asyncio.wait_for(_bot_process.wait(), timeout=10)
        except asyncio.TimeoutError:
            _bot_process.kill()
        _bot_process = None
        if _bot_log_handle and not _bot_log_handle.closed:
            _bot_log_handle.close()
            _bot_log_handle = None
        return BotStatus(running=False, message="중지됨")

    # 외부에서 시작된 프로세스
    pid = await _check_external_process()
    if pid:
        try:
            os.kill(pid, signal.SIGTERM)
            return BotStatus(running=False, message="외부 프로세스 중지됨")
        except Exception as e:
            return BotStatus(running=False, message=f"중지 실패: {e}")
    return BotStatus(running=False, message="실행 중인 봇 없음")
