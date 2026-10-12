import asyncio
from hashlib import sha256
from time import perf_counter
from openai import AsyncOpenAI
from app.core.config import Settings


class LLM:
    def __init__(self, config: Settings):
        self.config = config
        self.client = AsyncOpenAI(api_key=config.openai_api_key.get_secret_value() or 'not-configured', timeout=config.llm_timeout_seconds, max_retries=1)
        self.limit = asyncio.Semaphore(config.llm_concurrency)

    async def parse(self, schema, instruction: str, payload: str, audit=None, call_context=None):
        started = perf_counter()
        request_hash = sha256((instruction + '\0' + payload).encode('utf-8')).hexdigest()
        response = None
        try:
            if not self.config.openai_api_key.get_secret_value(): raise RuntimeError('OPENAI_API_KEY not configured')
            async with self.limit:
                response = await self.client.responses.parse(model=self.config.openai_model,
                    reasoning={'effort': 'low'}, max_output_tokens=8000,
                    input=[{'role': 'system', 'content': instruction}, {'role': 'user', 'content': payload}], text_format=schema)
            if response.output_parsed is None: raise ValueError('No structured output (refusal or incomplete response)')
        except Exception as exc:
            if audit:
                await audit({'context': call_context or {}, 'schema': schema.__name__, 'model': self.config.openai_model,
                    'request_hash': request_hash, 'success': False, 'duration_ms': round((perf_counter() - started) * 1000),
                    'error_type': type(exc).__name__})
            raise
        if audit:
            parsed = response.output_parsed
            await audit({'context': call_context or {}, 'schema': schema.__name__, 'model': self.config.openai_model,
                'request_hash': request_hash, 'success': True, 'duration_ms': round((perf_counter() - started) * 1000),
                'response_text': response.output_text,
                'response_json': parsed.model_dump(mode='json') if hasattr(parsed, 'model_dump') else parsed,
                'usage': {
                    'input_tokens': response.usage.input_tokens if response.usage else None,
                    'output_tokens': response.usage.output_tokens if response.usage else None,
                    'total_tokens': response.usage.total_tokens if response.usage else None,
                }})
        return response.output_parsed

    async def embed(self, texts: list[str]) -> list[list[float]]:
        if self.config.embedding_dimensions != 1536: raise ValueError('Schema v4 requires 1536 dimensions')
        vectors = []
        for offset in range(0, len(texts), 32):
            async with self.limit:
                response = await self.client.embeddings.create(model=self.config.embedding_model, input=texts[offset:offset+32], dimensions=1536)
            vectors.extend(r.embedding for r in sorted(response.data, key=lambda r: r.index))
        return vectors

    async def close(self):
        await self.client.close()
