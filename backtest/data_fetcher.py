"""
과거 OHLCV 데이터 수집기
빗썸 클라이언트를 통해 1년치 데이터를 가져온다.
"""
import logging
from datetime import datetime, timedelta
from typing import Optional

import pandas as pd

logger = logging.getLogger(__name__)


class DataFetcher:
    def __init__(self, client) -> None:
        """
        Args:
            client: BithumbClient 인스턴스
        """
        self.client = client

    def fetch(
        self,
        coin: str,
        days: int = 365,
        interval: str = "1h",
    ) -> Optional[pd.DataFrame]:
        """
        과거 데이터 수집.
        pybithumb은 최대 제공 범위 내에서 전체 OHLCV를 반환하므로
        get_historical_ohlcv 결과를 날짜로 필터링한다.

        Args:
            coin: 코인 심볼 (예: 'BTC')
            days: 수집 일수 (기본 365일)
            interval: 캔들 단위

        Returns:
            DataFrame(open, high, low, close, volume) | None
        """
        logger.info(f"과거 데이터 수집 시작 [{coin}] {days}일 / {interval}")
        try:
            df = self.client.get_historical_ohlcv(coin, interval=interval)
            if df is None or df.empty:
                logger.error("데이터 수집 결과 없음")
                return None

            # 날짜 필터링
            cutoff = datetime.now() - timedelta(days=days)
            if df.index.tz is not None:
                cutoff = cutoff.astimezone(df.index.tz)

            df = df[df.index >= cutoff].copy()

            logger.info(f"수집 완료: {len(df)}개 캔들 ({df.index[0]} ~ {df.index[-1]})")
            return df

        except Exception as e:
            logger.error(f"데이터 수집 오류: {e}")
            return None

    @staticmethod
    def validate(df: pd.DataFrame) -> bool:
        """필수 컬럼 존재 여부 확인"""
        required = {"open", "high", "low", "close", "volume"}
        return required.issubset(set(df.columns))
