"""
Streamlit 모니터링 대시보드 — 실시간 봇 성과를 시각화한다.

실행: streamlit run dashboard/app.py
"""
import json
import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

import pandas as pd
import streamlit as st

# 프로젝트 루트를 path에 추가
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

import config

DB_PATH = config.DB_PATH


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def load_completed_trades() -> pd.DataFrame:
    """entries JOIN exits → 완료 거래 DataFrame"""
    sql = """
        SELECT
            e.id AS entry_id,
            e.timestamp AS entry_time,
            e.strategy_name,
            e.coin,
            e.price AS entry_price,
            e.amount,
            e.total_krw,
            e.reason AS entry_reason,
            e.rsi_value,
            e.volume_ratio,
            e.trend,
            e.volatility,
            x.timestamp AS exit_time,
            x.price AS exit_price,
            x.exit_reason,
            x.pnl_pct,
            x.hold_minutes
        FROM entries e
        JOIN exits x ON e.id = x.entry_id
        ORDER BY e.id ASC
    """
    with get_conn() as conn:
        df = pd.read_sql(sql, conn)
    if not df.empty:
        df["entry_time"] = pd.to_datetime(df["entry_time"])
        df["exit_time"] = pd.to_datetime(df["exit_time"])
    return df


def load_events() -> pd.DataFrame:
    sql = "SELECT * FROM events ORDER BY id DESC LIMIT 100"
    with get_conn() as conn:
        df = pd.read_sql(sql, conn)
    if not df.empty:
        df["timestamp"] = pd.to_datetime(df["timestamp"])
    return df


def load_open_positions() -> pd.DataFrame:
    sql = """
        SELECT e.*
        FROM entries e
        LEFT JOIN exits x ON e.id = x.entry_id
        WHERE x.id IS NULL
        ORDER BY e.id DESC
    """
    with get_conn() as conn:
        df = pd.read_sql(sql, conn)
    return df


# ── 페이지 설정 ────────────────────────────────────────────

st.set_page_config(page_title="Bithumb Trading Bot", page_icon="📊", layout="wide")
st.title("📊 Bithumb Trading Bot Dashboard")

if not Path(DB_PATH).exists():
    st.warning(f"데이터베이스를 찾을 수 없습니다: {DB_PATH}")
    st.stop()

# ── 메인 레이아웃 ──────────────────────────────────────────

trades_df = load_completed_trades()
events_df = load_events()
open_df = load_open_positions()

# ── 핵심 지표 ──────────────────────────────────────────────

st.header("핵심 지표")
col1, col2, col3, col4, col5 = st.columns(5)

if not trades_df.empty:
    total = len(trades_df)
    wins = (trades_df["pnl_pct"] > 0).sum()
    win_rate = wins / total * 100
    avg_pnl = trades_df["pnl_pct"].mean()
    total_return = ((1 + trades_df["pnl_pct"] / 100).prod() - 1) * 100

    gross_profit = trades_df[trades_df["pnl_pct"] > 0]["pnl_pct"].sum()
    gross_loss = abs(trades_df[trades_df["pnl_pct"] <= 0]["pnl_pct"].sum())
    pf = gross_profit / gross_loss if gross_loss > 0 else float("inf")

    col1.metric("총 거래", f"{total}건")
    col2.metric("승률", f"{win_rate:.1f}%")
    col3.metric("평균 수익", f"{avg_pnl:+.2f}%")
    col4.metric("누적 수익", f"{total_return:+.2f}%")
    col5.metric("Profit Factor", f"{pf:.2f}")
else:
    col1.metric("총 거래", "0건")
    col2.metric("승률", "N/A")
    col3.metric("평균 수익", "N/A")
    col4.metric("누적 수익", "N/A")
    col5.metric("Profit Factor", "N/A")

# ── 미청산 포지션 ──────────────────────────────────────────

if not open_df.empty:
    st.header("미청산 포지션")
    st.dataframe(open_df[["id", "timestamp", "coin", "price", "amount", "reason"]])

# ── 에쿼티 커브 ────────────────────────────────────────────

if not trades_df.empty:
    st.header("에쿼티 커브")
    equity = [1.0]
    for pnl in trades_df["pnl_pct"]:
        equity.append(equity[-1] * (1 + pnl / 100))

    equity_df = pd.DataFrame({
        "거래": range(len(equity)),
        "에쿼티": equity,
    })
    st.line_chart(equity_df.set_index("거래"))

    # ── 손익 분포 ──────────────────────────────────────────

    st.header("손익 분포")
    col_a, col_b = st.columns(2)
    with col_a:
        st.bar_chart(trades_df["pnl_pct"])
    with col_b:
        exit_reasons = trades_df["exit_reason"].apply(
            lambda x: "손절" if "손절" in str(x)
            else "익절" if "익절" in str(x)
            else "RSI" if "RSI" in str(x) or "과매수" in str(x)
            else "기타"
        ).value_counts()
        st.bar_chart(exit_reasons)

    # ── 최근 거래 목록 ────────────────────────────────────

    st.header("최근 거래")
    display_cols = [
        "entry_id", "entry_time", "coin", "entry_price", "exit_price",
        "pnl_pct", "hold_minutes", "entry_reason", "exit_reason",
    ]
    st.dataframe(
        trades_df[display_cols].tail(20).sort_values("entry_id", ascending=False),
        use_container_width=True,
    )

# ── 최근 이벤트 ────────────────────────────────────────────

if not events_df.empty:
    st.header("최근 이벤트")
    st.dataframe(
        events_df[["timestamp", "event_type", "coin", "detail"]].head(20),
        use_container_width=True,
    )

# ── 자동 새로고침 ──────────────────────────────────────────

st.caption(f"마지막 업데이트: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
st.caption("페이지를 새로고침하면 최신 데이터가 표시됩니다.")
