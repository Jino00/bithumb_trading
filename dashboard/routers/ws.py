# WebSocket 핸들러 — 2초 간격 실시간 상태 푸시.
import asyncio
import json
import logging
from datetime import datetime

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from dashboard.shared_state import SharedStateReader

logger = logging.getLogger(__name__)

router = APIRouter()

# WebSocket 전용 Reader (서버 모듈 순환 참조 방지)
_ws_state_reader = SharedStateReader(cache_ttl=1.0)


@router.websocket("/live")
async def websocket_live(ws: WebSocket):
    """실시간 봇 상태를 2초 간격으로 푸시한다."""
    await ws.accept()
    logger.info("WebSocket 클라이언트 연결")

    try:
        while True:
            state = _ws_state_reader.read()
            portfolio = state.get("portfolio", {})
            slots = portfolio.get("slots", {})
            slots_extra = state.get("slots_extra", {})

            positions = []
            for coin, info in slots.items():
                extra = slots_extra.get(coin, {})
                positions.append({
                    "coin": coin,
                    "draining": info.get("draining", False),
                    "active": info.get("active", True),
                    "has_position": info.get("has_position", False),
                    "entry_id": extra.get("entry_id"),
                    "entry_price": extra.get("entry_price"),
                    "entry_time": extra.get("entry_time"),
                    "strategy": info.get("strategy", ""),
                    "live_win_rate": info.get("live_win_rate", 0.0),
                    "risk_dd": info.get("risk_dd", 0.0),
                    "activated_at": info.get("activated_at"),
                })

            message = {
                "type": "state_update",
                "timestamp": datetime.now().isoformat(timespec="seconds"),
                "bot_active": state.get("bot_active", False),
                "mode": state.get("mode", "UNKNOWN"),
                "portfolio_equity": portfolio.get("portfolio_equity", 1.0),
                "portfolio_mdd_pct": portfolio.get("portfolio_mdd_pct", 0.0),
                "total_trades": portfolio.get("total_trades", 0),
                "active_coins": portfolio.get("active_coins", []),
                "positions": positions,
            }

            await ws.send_text(json.dumps(message, default=str))
            await asyncio.sleep(2)

    except WebSocketDisconnect:
        logger.info("WebSocket 클라이언트 연결 해제")
    except Exception as e:
        logger.error(f"WebSocket 오류: {e}")
