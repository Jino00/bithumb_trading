"""
Streamlit 모니터링 대시보드 — 실시간 봇 성과를 시각화한다.

실행: streamlit run dashboard/app.py
"""
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

import pandas as pd
import streamlit as st

# 프로젝트 루트를 path에 추가
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

import config  # noqa: E402

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

# ── 페이퍼 트레이딩 실시간 현황 (paper_state.json) ─────────

PAPER_STATE_PATH = PROJECT_ROOT / "paper_state.json"
if PAPER_STATE_PATH.exists():
    import json
    with open(PAPER_STATE_PATH) as f:
        paper = json.load(f)

    kpi = paper.get("kpi", {})
    pkpi = paper.get("portfolio_kpi", {})

    st.header("실시간 포트폴리오")
    pc1, pc2, pc3, pc4 = st.columns(4)
    pc1.metric("총 자산", f"{kpi.get('total_value', 0):,.0f}원")
    pc2.metric("수익률", f"{kpi.get('total_return_pct', 0):+.2f}%")
    pc3.metric("거래", f"{kpi.get('total_trades', 0)}건")
    pc4.metric("승률", f"{kpi.get('win_rate', 0):.1f}%")

    # 메인 슬롯 테이블
    positions = paper.get("positions", [])
    if positions:
        st.subheader(f"메인 슬롯 ({len(positions)}개)")
        main_rows = []
        for p in positions:
            main_rows.append({
                "코인": p.get("coin", ""),
                "전략": p.get("active_strategy_name", ""),
                "배분(원)": f"{p.get('allocated_krw', 0):,.0f}",
                "수익률": f"{p.get('total_return_pct', 0):+.2f}%",
                "거래": p.get("total_trades", 0),
                "승률": f"{p.get('win_rate', 0):.0f}%",
                "레짐": p.get("regime", ""),
                "간격": p.get("interval", ""),
            })
        st.dataframe(pd.DataFrame(main_rows), use_container_width=True)

    # ── AI 탐색 슬롯 (완전 분리) ──────────────────────────
    exp = paper.get("exploration", {})
    if exp.get("enabled"):
        st.header("🧪 AI 탐색 슬롯")
        ec1, ec2, ec3, ec4, ec5 = st.columns(5)
        ec1.metric("활성 슬롯", f"{exp.get('active_slots', 0)}개")
        ec2.metric("탐색 자본", f"{exp.get('capital', 0) / 1e8:.0f}억원")
        ec3.metric("승격", f"{exp.get('promoted_count', 0)}개")
        ec4.metric("폐기", f"{exp.get('discarded_count', 0)}개")
        ec5.metric("사이클", f"{exp.get('cycle_count', 0)}")

        exp_slots = exp.get("slots", [])
        if exp_slots:
            # 타입별 탭으로 분리
            type_names = {
                "PARAM_MUTATION": "파라미터 변형",
                "STRATEGY_COMBO": "전략 조합",
                "NOVEL_FILTER": "신규 필터",
                "REGIME_OVERRIDE": "레짐 분기",
                "TIME_RULE": "시간대 제한",
            }
            types_present = sorted(set(
                s.get("variant_type", "") for s in exp_slots
            ))
            tabs = st.tabs([
                f"{type_names.get(t, t)} ({sum(1 for s in exp_slots if s.get('variant_type')==t)})"
                for t in types_present
            ])
            for tab, vtype in zip(tabs, types_present):
                with tab:
                    rows = []
                    for s in exp_slots:
                        if s.get("variant_type") != vtype:
                            continue
                        tc = s.get("trade_count", 0)
                        rows.append({
                            "ID": s.get("variant_id", ""),
                            "코인": s.get("coin", ""),
                            "설명": s.get("description", ""),
                            "거래": tc,
                            "승률": f"{s.get('win_rate', 0):.0f}%" if tc > 0 else "-",
                            "PF": f"{s.get('profit_factor', 0):.2f}" if tc > 0 else "-",
                            "PnL(원)": f"{s.get('total_pnl_krw', 0):+,.0f}" if tc > 0 else "-",
                            "상태": "평가 중" if tc >= 20 else f"수집 중 ({tc}/20)",
                        })
                    st.dataframe(pd.DataFrame(rows), use_container_width=True)

    # ── 🚀 급등 전용 슬롯 (완전 분리) ────────────────────
    surge = paper.get("surge_slots", {})
    if surge.get("max_slots"):
        st.header("🚀 급등 전용 슬롯")
        sc1, sc2, sc3, sc4 = st.columns(4)
        sc1.metric("활성", f"{surge.get('active_slots', 0)} / {surge.get('max_slots', 10)}")
        sc2.metric("거래", f"{surge.get('trade_count', 0)}건")
        sc3.metric("PnL", f"{surge.get('total_pnl', 0):+,.0f}원")
        stats = surge.get("learning_stats", {})
        sc4.metric("승률", f"{stats.get('win_rate', 0):.0f}%" if stats.get("total", 0) > 0 else "대기")

        # 학습 통계
        if stats.get("total", 0) > 0:
            st.subheader("학습 현황")
            col_a, col_b = st.columns(2)
            with col_a:
                st.markdown("**페이즈별 성과**")
                phase_rows = []
                for phase, ps in stats.get("by_phase", {}).items():
                    phase_rows.append({
                        "페이즈": phase,
                        "거래": ps["count"],
                        "승률": f"{ps['win_rate']:.0f}%",
                        "평균 PnL": f"{ps['avg_pnl']:+.2f}%",
                    })
                if phase_rows:
                    st.dataframe(pd.DataFrame(phase_rows), use_container_width=True)
            with col_b:
                st.markdown("**급등 빈도 TOP 코인**")
                top_coins = stats.get("top_coins", [])
                if top_coins:
                    coin_rows = [{"코인": c["coin"], "급등 횟수": c["count"]} for c in top_coins]
                    st.dataframe(pd.DataFrame(coin_rows), use_container_width=True)

            params = surge.get("optimal_params", {})
            st.info(f"학습된 최적 파라미터: 트레일링 {params.get('trailing_pct', 2.0)}% | 최대보유 {params.get('max_hold_sec', 1800)}초")

        # 현재 보유 슬롯
        surge_slots = surge.get("slots", [])
        if surge_slots:
            st.subheader("보유 중")
            slot_rows = [
                {"코인": s["coin"], "페이즈": s["phase"],
                 "진입": s["entry_time"], "투자금": f"{s['allocated_krw']:,.0f}원"}
                for s in surge_slots
            ]
            st.dataframe(pd.DataFrame(slot_rows), use_container_width=True)

# ── 자동 새로고침 ──────────────────────────────────────────

st.caption(f"마지막 업데이트: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
st.caption("페이지를 새로고침하면 최신 데이터가 표시됩니다.")
