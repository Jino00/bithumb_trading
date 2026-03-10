# 페이퍼 트레이딩 API 라우터 — /api/paper/* 엔드포인트.
from fastapi import APIRouter

from dashboard.schemas import PaperOverview
from dashboard.shared_state import PaperStateReader

router = APIRouter()

_paper_reader = PaperStateReader(cache_ttl=1.0)


@router.get("/overview", response_model=PaperOverview)
async def paper_overview():
    """페이퍼 트레이딩 전체 상태를 반환한다."""
    data = _paper_reader.read()
    if data is None:
        return PaperOverview()
    return PaperOverview(**data)
