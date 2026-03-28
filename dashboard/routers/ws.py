# WebSocket 핸들러 — 2초 간격 실시간 상태 푸시.
import asyncio
import json
import logging
from datetime import datetime

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from dashboard.shared_state import PaperStateReader, SharedStateReader

logger = logging.getLogger(__name__)

router = APIRouter()

# WebSocket 전용 Reader (서버 모듈 순환 참조 방지)
_ws_state_reader = SharedStateReader(cache_ttl=1.0)
_ws_paper_reader = PaperStateReader(cache_ttl=1.0)


@router.websocket("/live")
async def websocket_live(ws: WebSocket):
    """실시간 봇 상태를 2초 간격으로 푸시한다."""
    await ws.accept()
    logger.info("WebSocket 클라이언트 연결")

    try:
        while True:
            # ★ 페이퍼 트레이딩 데이터 우선
            paper_data = _ws_paper_reader.read()
            state = _ws_state_reader.read()

            # ★ 페이퍼가 최근 업데이트되었으면 페이퍼 우선 사용
            paper_fresh = (
                paper_data
                and paper_data.get("updated_at")
                and paper_data.get("kpi", {}).get("cycle_count", 0) > 0
            )

            # 실전 봇이 활성이고 페이퍼가 없을 때만 실전 데이터 사용
            if state.get("bot_active", False) and not paper_fresh:
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
                        "current_price": extra.get("current_price"),
                        "unrealized_pnl": extra.get("unrealized_pnl"),
                        "entry_reason": extra.get("entry_reason"),
                        "rsi_at_entry": extra.get("rsi_at_entry"),
                        "stop_loss_pct": extra.get("stop_loss_pct"),
                        "take_profit_pct": extra.get("take_profit_pct"),
                        "strategy": info.get("strategy", ""),
                        "live_win_rate": info.get("live_win_rate", 0.0),
                        "risk_dd": info.get("risk_dd", 0.0),
                        "activated_at": info.get("activated_at"),
                    })

                message = {
                    "type": "state_update",
                    "timestamp": datetime.now().isoformat(timespec="seconds"),
                    "bot_active": True,
                    "mode": state.get("mode", "UNKNOWN"),
                    "portfolio_equity": portfolio.get("portfolio_equity", 1.0),
                    "portfolio_mdd_pct": portfolio.get("portfolio_mdd_pct", 0.0),
                    "total_trades": portfolio.get("total_trades", 0),
                    "active_coins": portfolio.get("active_coins", []),
                    "positions": positions,
                    "paper": paper_data.get("kpi") if paper_data else None,
                }

            # ★ 실전 봇이 없으면 페이퍼 데이터로 WebSocket 전송
            elif paper_data and paper_data.get("updated_at"):
                pkpi = paper_data.get("portfolio_kpi", paper_data.get("kpi", {}))
                kpi = paper_data.get("kpi", {})

                positions = []
                for pos in paper_data.get("positions", []):
                    positions.append({
                        "coin": pos.get("coin", ""),
                        "draining": pos.get("draining", False),
                        "active": True,
                        "has_position": pos.get("position") is not None,
                        "entry_price": pos.get("position", {}).get("entry_price") if pos.get("position") else None,
                        "current_price": None,
                        "unrealized_pnl": None,
                        "strategy": pos.get("active_strategy_name", ""),
                        "live_win_rate": pos.get("win_rate", 0.0),
                        "risk_dd": 0.0,
                        "activated_at": pos.get("activated_at"),
                    })

                message = {
                    "type": "state_update",
                    "timestamp": datetime.now().isoformat(timespec="seconds"),
                    "bot_active": True,
                    "mode": paper_data.get("mode", "MULTI"),
                    "portfolio_equity": kpi.get("total_return_pct", 0.0) / 100 + 1.0,
                    "portfolio_mdd_pct": 0.0,
                    "total_trades": pkpi.get("total_trades", 0),
                    "active_coins": pkpi.get("active_coins", []),
                    "positions": positions,
                    "paper": kpi,
                }

            else:
                message = {
                    "type": "state_update",
                    "timestamp": datetime.now().isoformat(timespec="seconds"),
                    "bot_active": False,
                    "mode": "UNKNOWN",
                    "portfolio_equity": 1.0,
                    "portfolio_mdd_pct": 0.0,
                    "total_trades": 0,
                    "active_coins": [],
                    "positions": [],
                    "paper": None,
                }

            await ws.send_text(json.dumps(message, default=str))

            # ping/pong keepalive — 클라이언트 응답 없으면 연결 해제
            try:
                await asyncio.wait_for(ws.receive_text(), timeout=2)
            except asyncio.TimeoutError:
                pass  # 타임아웃은 정상 (클라이언트가 메시지 안 보냄)

    except WebSocketDisconnect:
        logger.info("WebSocket 클라이언트 연결 해제")
    except Exception as e:
        logger.error(f"WebSocket 오류: {e}")
