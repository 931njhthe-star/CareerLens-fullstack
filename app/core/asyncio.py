import asyncio
import sys


def uvicorn_loop_factory(use_subprocess: bool = False) -> asyncio.AbstractEventLoop:
    if use_subprocess and sys.platform == 'win32':
        raise RuntimeError('The Windows selector loop does not support Uvicorn subprocess workers or reload')
    factory = asyncio.SelectorEventLoop if sys.platform == 'win32' else asyncio.new_event_loop
    return factory()


def run(coroutine):
    # psycopg async connections require a selector loop on Windows.
    factory = asyncio.SelectorEventLoop if sys.platform == 'win32' else None
    with asyncio.Runner(loop_factory=factory) as runner:
        return runner.run(coroutine)
