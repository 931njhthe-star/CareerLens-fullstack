"""Render Web Service 진입점 (공개).

Streamlit Cloud가 부르는 주소는 이것 하나입니다. 여기서 API 키를 확인한 뒤
같은 프로세스 안의 에이전트(agent/core.py)를 함수로 호출합니다.
HTTP·인증은 이 파일, LLM·DB는 agent/core.py로 나눠 두어 서로를 몰라도 되게 했습니다.
"""

import os
import secrets
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import psycopg
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException
from openai import OpenAIError
from pydantic import BaseModel, Field

# agent.core가 import 시점에 OPENAI_API_KEY를 읽으므로 그보다 먼저 불러야 합니다.
# Render에는 .env 파일이 없어 아무 일도 하지 않고, 대시보드 환경변수가 그대로 쓰입니다.
# 경로를 비워 두면 실행 위치에 따라 못 찾는 경우가 있어 저장소 루트를 직접 가리킵니다.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from agent import core  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")

API_KEY = os.getenv("GATEWAY_API_KEY", "")


@asynccontextmanager
async def lifespan(_: FastAPI):
    # init_db는 재시도하며 time.sleep으로 기다리지만, 시작 단계라 아직 받을 요청이 없어 막혀도 괜찮습니다.
    core.init_db()
    yield


app = FastAPI(title="Render 에이전트 챗봇", lifespan=lifespan)


@app.middleware("http")
async def utf8_charset(request, call_next):
    # FastAPI는 Content-Type을 charset 없이 "application/json"으로 보냅니다. Windows PowerShell 5의
    # Invoke-RestMethod는 이때 UTF-8이 아닌 인코딩으로 읽어 한글이 깨집니다. 401·422 오류 응답까지 덮으려고 미들웨어로 붙입니다.
    response = await call_next(request)
    if response.headers.get("content-type") == "application/json":
        response.headers["content-type"] = "application/json; charset=utf-8"
    return response


def check_api_key(x_api_key: str = Header(default="")):
    # 키가 비어 있으면 로컬 개발로 보고 통과시킵니다. Render에서는 render.yaml이 값을 생성하므로 항상 검사합니다.
    if API_KEY and not secrets.compare_digest(x_api_key, API_KEY):
        raise HTTPException(status_code=401, detail="API 키가 올바르지 않습니다.")


class ChatRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=64)
    message: str = Field(min_length=1, max_length=1000)


@app.get("/healthz")
def healthz():
    # DB·LLM 상태와 묶지 않습니다. 묶으면 OpenAI 장애만으로 Render가 서비스를 재시작합니다.
    return {"status": "ok", "llm": core.client is not None}


# async가 아닌 def로 둡니다. OpenAI·psycopg 호출이 동기라서 async def 안에서 부르면 이벤트 루프 전체가 멈춥니다.
@app.post("/api/chat", dependencies=[Depends(check_api_key)])
def chat(req: ChatRequest):
    try:
        reply, used = core.chat(req.session_id, req.message.strip())
    except OpenAIError as exc:
        raise HTTPException(status_code=502, detail=f"LLM 호출 실패: {type(exc).__name__}") from exc
    except psycopg.Error as exc:
        raise HTTPException(status_code=503, detail="데이터베이스 오류") from exc
    return {"reply": reply, "tools_used": used}


@app.get("/api/messages", dependencies=[Depends(check_api_key)])
def messages(session_id: str):
    try:
        return core.get_messages(session_id)
    except psycopg.Error as exc:
        raise HTTPException(status_code=503, detail="데이터베이스 오류") from exc
