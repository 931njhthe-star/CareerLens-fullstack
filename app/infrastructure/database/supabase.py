import httpx
from app.core.config import Settings


class DatabaseError(Exception):
    def __init__(self, status: int):
        self.status = status
        super().__init__(f'Database request failed ({status})')


class DB:
    def __init__(self, config: Settings):
        self.config = config
        self.http = httpx.AsyncClient(timeout=30)

    async def request(self, method, path, *, params=None, data=None, headers=None, content=None):
        if not self.config.supabase_url or not self.config.supabase_service_role_key.get_secret_value():
            raise RuntimeError('Supabase credentials not configured')
        key = self.config.supabase_service_role_key.get_secret_value()
        base = {'apikey': key, 'Authorization': f'Bearer {key}', 'Prefer': 'return=representation'}
        response = await self.http.request(method, self.config.supabase_url.rstrip('/') + path,
            params=params, json=data, content=content, headers={**base, **(headers or {})})
        if response.is_error: raise DatabaseError(response.status_code)
        return response.json() if response.content else None

    async def select(self, table, **params):
        return await self.request('GET', f'/rest/v1/{table}', params=params)

    async def insert(self, table, data):
        return await self.request('POST', f'/rest/v1/{table}', data=data)

    async def upsert(self, table, data, conflict):
        return await self.request('POST', f'/rest/v1/{table}', params={'on_conflict': conflict}, data=data,
                                  headers={'Prefer': 'resolution=merge-duplicates,return=representation'})

    async def update(self, table, data, **filters):
        return await self.request('PATCH', f'/rest/v1/{table}', params=filters, data=data)

    async def delete(self, table, **filters):
        return await self.request('DELETE', f'/rest/v1/{table}', params=filters)

    async def rpc(self, name, data):
        return await self.request('POST', f'/rest/v1/rpc/{name}', data=data)

    async def close(self):
        await self.http.aclose()
