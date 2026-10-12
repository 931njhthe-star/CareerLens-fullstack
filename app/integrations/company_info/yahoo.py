import asyncio
from datetime import datetime, timezone
import yfinance as yf

# Explicit mappings only; never let the model invent a listed parent company.
TICKERS = {'NAVER': '035420.KS', '네이버': '035420.KS', '카카오': '035720.KS', 'KAKAO': '035720.KS', '삼성전자': '005930.KS', 'LG전자': '066570.KS', 'SK하이닉스': '000660.KS'}


def collect(ticker: str) -> dict:
    info = yf.Ticker(ticker).get_info()
    if not info or not info.get('longName'): raise ValueError('No verified company profile')
    keys = ['longName', 'industry', 'sector', 'longBusinessSummary', 'fullTimeEmployees', 'totalRevenue', 'marketCap', 'currency', 'revenueGrowth']
    return {'source': 'yahoo_finance', 'ticker': ticker, 'collected_at': datetime.now(timezone.utc).isoformat(),
            'url': f'https://finance.yahoo.com/quote/{ticker}/',
            'data': {k: info.get(k) for k in keys},
            'competitor_data_available': False,
            'limitation': '기업 전체 정보이며 실제 지원자 수·경력 분포를 제공하지 않음. 재무규모만으로 채용 난도·학력 추정 금지.'}


async def financial_context(db, company_id: str | None, company_name: str) -> dict:
    if not company_id: return {'status': 'unavailable', 'reason': '기업 연결 없음', 'competitor_data_available': False}
    tickers = await db.select('company_tickers', company_id=f'eq.{company_id}', order='is_primary.desc', limit=1)
    ticker = tickers[0]['ticker'] if tickers else TICKERS.get(company_name.strip())
    if not ticker: return {'status': 'unavailable', 'reason': '검증된 티커 없음·비상장 가능', 'competitor_data_available': False}
    if tickers:
        cached = await db.select('company_financials', company_ticker_id=f"eq.{tickers[0]['id']}", statement_type='eq.summary', period_type='eq.snapshot', order='collected_at.desc', limit=1)
        if cached:
            stamp = datetime.fromisoformat(cached[0]['collected_at'].replace('Z', '+00:00'))
            if (datetime.now(timezone.utc) - stamp).total_seconds() < 86400:
                return cached[0]['raw_data']
    try:
        result = await asyncio.wait_for(asyncio.to_thread(collect, ticker), timeout=20)
    except Exception:
        return {'status': 'unavailable', 'reason': '기업정보 조회 실패', 'ticker': ticker, 'competitor_data_available': False}
    if not tickers:
        tickers = await db.insert('company_tickers', {'company_id': company_id, 'ticker': ticker, 'exchange': ticker.rsplit('.', 1)[-1], 'is_primary': True})
    data = result['data']
    await db.upsert('company_financials', {'company_ticker_id': tickers[0]['id'], 'source': 'yahoo_finance', 'statement_type': 'summary', 'period_type': 'snapshot',
        'period_end': datetime.now(timezone.utc).date().isoformat(), 'currency': data.get('currency'), 'revenue': data.get('totalRevenue'), 'market_cap': data.get('marketCap'),
        'raw_data': result, 'collected_at': result['collected_at']}, 'company_ticker_id,source,statement_type,period_type,period_end')
    return result
