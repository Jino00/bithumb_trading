"""
텔레그램 알림 모듈 — 거래 이벤트를 텔레그램 메시지로 발송한다.

알림 대상:
  - 매수/매도 체결
  - MDD 초과
  - 전략 비활성화
  - 봇 시작/종료
  - 오류 발생
"""
import logging

import requests

logger = logging.getLogger(__name__)

_TELEGRAM_API = "https://api.telegram.org/bot{token}/sendMessage"


class TelegramNotifier:
    """
    텔레그램 Bot API를 통해 메시지를 발송한다.

    Args:
        bot_token: 텔레그램 봇 토큰
        chat_id: 수신 채팅 ID
    """

    def __init__(self, bot_token: str, chat_id: str) -> None:
        self._token = bot_token
        self._chat_id = chat_id
        self._enabled = bool(bot_token and chat_id)
        if self._enabled:
            logger.info("텔레그램 알림 활성화")
        else:
            logger.info("텔레그램 알림 비활성화 (토큰 또는 chat_id 미설정)")

    @property
    def enabled(self) -> bool:
        return self._enabled

    def send(self, message: str) -> bool:
        """메시지를 텔레그램으로 발송한다. 실패 시 False 반환."""
        if not self._enabled:
            return False
        try:
            url = _TELEGRAM_API.format(token=self._token)
            resp = requests.post(
                url,
                json={"chat_id": self._chat_id, "text": message, "parse_mode": "HTML"},
                timeout=10,
            )
            if resp.status_code == 200:
                return True
            logger.warning(f"텔레그램 전송 실패: {resp.status_code} {resp.text}")
            return False
        except Exception as e:
            logger.error(f"텔레그램 전송 오류: {e}")
            return False

    # ── 편의 메서드 (이벤트별 포맷) ────────────────────────

    def notify_buy(self, coin: str, price: float, amount: float, reason: str) -> None:
        self.send(
            f"<b>매수 체결</b>\n"
            f"코인: {coin}\n"
            f"가격: {price:,.0f}원\n"
            f"수량: {amount:.8f}\n"
            f"이유: {reason}"
        )

    def notify_sell(
        self, coin: str, price: float, amount: float, pnl_pct: float, reason: str
    ) -> None:
        emoji = "+" if pnl_pct >= 0 else ""
        self.send(
            f"<b>매도 체결</b>\n"
            f"코인: {coin}\n"
            f"가격: {price:,.0f}원\n"
            f"수량: {amount:.8f}\n"
            f"수익률: {emoji}{pnl_pct:.2f}%\n"
            f"이유: {reason}"
        )

    def notify_mdd_exceeded(self, drawdown_pct: float, limit_pct: float) -> None:
        self.send(
            f"<b>MDD 한도 초과</b>\n"
            f"현재 낙폭: {drawdown_pct:.2f}%\n"
            f"한도: {limit_pct:.1f}%\n"
            f"거래가 중단되었습니다."
        )

    def notify_strategy_deactivated(self, win_rate: float, threshold: float) -> None:
        self.send(
            f"<b>전략 비활성화</b>\n"
            f"실전 승률: {win_rate:.1f}%\n"
            f"임계값: {threshold:.1f}%\n"
            f"전략이 자동 비활성화되었습니다."
        )

    def notify_bot_start(self, mode: str, coin: str) -> None:
        self.send(
            f"<b>봇 시작</b>\n"
            f"모드: {mode}\n"
            f"코인: {coin}"
        )

    def notify_bot_stop(self, reason: str = "graceful shutdown") -> None:
        self.send(f"<b>봇 종료</b>\n이유: {reason}")

    def notify_error(self, error: str) -> None:
        self.send(f"<b>오류 발생</b>\n{error}")

    # ── 포트폴리오 (멀티코인) 알림 ───────────────────────────

    def notify_coin_activated(
        self, coin: str, params: dict, win_rate: float, pf: float, range_pct: float
    ) -> None:
        self.send(
            f"<b>코인 활성화</b>\n"
            f"코인: {coin}\n"
            f"파라미터: RSI({params.get('period')},{params.get('oversold')},{params.get('overbought')})\n"
            f"백테스트 승률: {win_rate:.1f}%\n"
            f"PF: {pf:.2f}\n"
            f"변동폭: {range_pct:.1f}%"
        )

    def notify_coin_deactivated(self, coin: str, reason: str, draining: bool = False) -> None:
        status = "드레인 모드" if draining else "즉시 제거"
        self.send(
            f"<b>코인 비활성화</b>\n"
            f"코인: {coin}\n"
            f"사유: {reason}\n"
            f"상태: {status}"
        )

    def notify_portfolio_status(self, status_text: str) -> None:
        self.send(f"<b>포트폴리오 현황</b>\n<pre>{status_text}</pre>")
