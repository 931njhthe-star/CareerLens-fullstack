"""Async PostgreSQL adapter with the small PostgREST-like surface used by the app."""
from __future__ import annotations

import csv
import io
import re
from typing import Any

from pgvector import Vector
from pgvector.psycopg import register_vector_async
from psycopg import sql
from psycopg.errors import CheckViolation, ForeignKeyViolation, UniqueViolation
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from app.core.config import Settings


TABLES = frozenset({
    'app_users', 'refresh_tokens', 'profiles', 'resumes', 'companies', 'company_tickers',
    'job_postings', 'company_financials', 'company_prices', 'document_chunks',
    'evaluation_rubrics', 'evaluation_criteria', 'evaluation_runs', 'criterion_results',
    'evaluation_events', 'match_results', 'analysis_reports', 'mock_applications',
    'agent_executions', 'node_executions', 'intermediate_artifacts', 'progress_events',
    'evaluation_input_snapshots', 'validation_issues', 'evaluation_stage_timings',
})
RPC_ARGS = {
    'claim_evaluation': ('p_worker', 'p_lease_seconds'),
    'create_evaluation': ('p_user', 'p_resume', 'p_job', 'p_rubric', 'p_key', 'p_fingerprint', 'p_snapshot', 'p_model'),
    'search_resume_chunks': ('p_resume_id', 'p_source_hash', 'p_model', 'p_query', 'p_limit'),
    'update_evaluation_progress': ('p_run', 'p_stage', 'p_percent'),
    'get_evaluation_performance': ('p_days', 'p_run_limit'),
}
JSON_COLUMNS = frozenset({
    'parsed_data', 'responsibilities', 'requirements', 'preferred_requirements', 'raw_data',
    'metadata', 'method_config', 'event_data', 'overall_formula', 'report_data', 'token_usage',
    'content', 'evidence', 'applied_methods', 'input_snapshot', 'snapshot', 'resume_snapshot',
    'job_snapshot', 'financial_snapshot', 'model_config_snapshot', 'prompt_config_snapshot',
    'input_manifest', 'details', 'event_payload', 'validation_data',
})


class DatabaseError(Exception):
    def __init__(self, status: int = 503):
        self.status = status
        super().__init__('PostgreSQL request failed')


def _identifier(value: str) -> sql.Identifier:
    if not re.fullmatch(r'[a-z_][a-z0-9_]*', value):
        raise ValueError('Invalid database identifier')
    return sql.Identifier(value)


def _adapt(value: Any, column: str | None = None) -> Any:
    if column in {'embedding', 'p_query'} and value is not None:
        return Vector(value)
    if isinstance(value, (dict, list)):
        return Jsonb(value)
    return value


def _split_in_values(value: str) -> list[str]:
    try:
        return next(csv.reader(io.StringIO(value), skipinitialspace=True, strict=True))
    except (csv.Error, StopIteration):
        raise ValueError('Invalid in filter') from None


def _split_projection(value: str) -> list[str]:
    parts, start, depth = [], 0, 0
    for index, char in enumerate(value):
        if char == '(':
            depth += 1
        elif char == ')':
            depth -= 1
            if depth < 0:
                raise ValueError('Invalid projection')
        elif char == ',' and depth == 0:
            parts.append(value[start:index].strip())
            start = index + 1
    if depth != 0:
        raise ValueError('Invalid projection')
    parts.append(value[start:].strip())
    return parts


class DB:
    def __init__(self, config: Settings):
        self.config = config
        self.pool = AsyncConnectionPool(
            conninfo=config.database_url.get_secret_value(),
            min_size=1,
            max_size=config.database_pool_max_size,
            open=False,
            kwargs={'row_factory': dict_row, 'prepare_threshold': 0},
            configure=self._configure,
        )

    @staticmethod
    async def _configure(conn) -> None:
        await register_vector_async(conn)

    async def open(self) -> None:
        if not self.config.database_url.get_secret_value():
            raise RuntimeError('DATABASE_URL is required')
        await self.pool.open(wait=True)

    async def health(self) -> bool:
        async with self.pool.connection() as conn:
            await conn.execute('SELECT 1')
        return True

    async def _run(self, query, params=(), *, fetch=True):
        try:
            async with self.pool.connection() as conn:
                cursor = await conn.execute(query, params)
                return await cursor.fetchall() if fetch else None
        except UniqueViolation:
            raise DatabaseError(409) from None
        except (ForeignKeyViolation, CheckViolation):
            raise DatabaseError(400) from None
        except Exception as exc:
            if isinstance(exc, DatabaseError):
                raise
            raise DatabaseError(503) from None

    def _where(self, filters: dict[str, Any], prefix: str | None = None):
        clauses, values = [], []
        for field, expression in filters.items():
            ident = sql.Identifier(prefix, field) if prefix else _identifier(field)
            if not isinstance(expression, str):
                raise ValueError('Filters must use PostgREST-style expressions')
            operator, dot, raw = expression.partition('.')
            if not dot:
                raise ValueError('Filter operator is required')
            if operator == 'in':
                if not raw.startswith('(') or not raw.endswith(')'):
                    raise ValueError('Invalid in filter')
                items = _split_in_values(raw[1:-1])
                if not items:
                    clauses.append(sql.SQL('FALSE'))
                else:
                    clauses.append(sql.SQL('{} IN ({})').format(
                        ident, sql.SQL(', ').join(sql.Placeholder() for _ in items),
                    ))
                    values.extend(items)
                continue
            operators = {'eq': '=', 'neq': '<>', 'gt': '>', 'gte': '>=', 'lt': '<', 'lte': '<=', 'is': 'IS'}
            if operator not in operators:
                raise ValueError('Unsupported filter operator')
            if operator == 'is' and raw in {'null', 'true', 'false'}:
                clauses.append(sql.SQL('{} IS {}').format(ident, sql.SQL(raw.upper())))
            else:
                clauses.append(sql.SQL('{} {} %s').format(ident, sql.SQL(operators[operator])))
                values.append(raw)
        return clauses, values

    @staticmethod
    def _table(table: str) -> sql.Identifier:
        if table not in TABLES:
            raise ValueError('Unknown database table')
        return sql.Identifier('public', table)

    async def select(self, table: str, **params):
        table_ident = self._table(table)
        projection = params.pop('select', '*')
        ordering = params.pop('order', None)
        limit = params.pop('limit', None)
        offset = params.pop('offset', None)
        projection_parts = ['*'] if projection == '*' else _split_projection(projection)
        relation_parts = [part for part in projection_parts if part.startswith('evaluation_criteria(')]
        if len(relation_parts) > 1:
            raise ValueError('Only one relation selection is supported')
        filters, values = self._where(params, 't' if relation_parts else None)

        relation = re.fullmatch(r'evaluation_criteria\(([a-z_,]+)\)', relation_parts[0]) if relation_parts else None
        if relation_parts and not relation:
            raise ValueError('Invalid relation selection')
        if relation:
            if table != 'criterion_results':
                raise ValueError('Unsupported relation selection')
            relation_fields = relation.group(1).split(',')
            allowed = {'criterion_code', 'name_ko', 'domain_code', 'weight'}
            if not relation_fields or any(field not in allowed for field in relation_fields):
                raise ValueError('Unsupported relation fields')
            relation_json = sql.SQL('jsonb_build_object({}) AS evaluation_criteria').format(
                sql.SQL(', ').join(
                    part for field in relation_fields
                    for part in (sql.Literal(field), sql.SQL('ec.{}').format(_identifier(field)))
                )
            )
            direct_fields = [part for part in projection_parts if part != relation_parts[0]]
            selected_columns = [sql.SQL('t.{}').format(_identifier(field)) for field in direct_fields]
            selected_columns.append(relation_json)
            columns = sql.SQL(', ').join(selected_columns)
            from_sql = sql.SQL('{} AS t LEFT JOIN public.evaluation_criteria AS ec ON ec.id=t.criterion_id').format(table_ident)
            query = sql.SQL('SELECT {} FROM {}').format(columns, from_sql)
            if filters:
                query += sql.SQL(' WHERE ') + sql.SQL(' AND ').join(filters)
        else:
            if projection == '*':
                columns = sql.SQL('*')
            else:
                selected = projection_parts
                if not selected:
                    raise ValueError('Empty projection')
                columns = sql.SQL(', ').join(_identifier(field) for field in selected)
            query = sql.SQL('SELECT {} FROM {}').format(columns, table_ident)
            if filters:
                query += sql.SQL(' WHERE ') + sql.SQL(' AND ').join(filters)

        if ordering:
            order_terms = []
            for term in ordering.split(','):
                bits = term.strip().split('.')
                if len(bits) not in (1, 2) or (len(bits) == 2 and bits[1].lower() not in {'asc', 'desc'}):
                    raise ValueError('Invalid order clause')
                direction = sql.SQL(' DESC' if len(bits) == 2 and bits[1].lower() == 'desc' else ' ASC')
                order_terms.append(_identifier(bits[0]) + direction)
            query += sql.SQL(' ORDER BY ') + sql.SQL(', ').join(order_terms)
        if limit is not None:
            query += sql.SQL(' LIMIT %s')
            values.append(max(0, min(int(limit), 10000)))
        if offset is not None:
            query += sql.SQL(' OFFSET %s')
            values.append(max(0, int(offset)))
        return await self._run(query, values)

    @staticmethod
    def _row_values(row):
        columns = list(row)
        return columns, [_adapt(row[col], col) for col in columns]

    async def insert(self, table: str, data):
        table_ident = self._table(table)
        rows = data if isinstance(data, list) else [data]
        if not rows:
            return []
        columns = list(dict.fromkeys(key for row in rows for key in row))
        if not columns:
            raise ValueError('Insert data is empty')
        names = sql.SQL(', ').join(_identifier(col) for col in columns)
        row_sql = sql.SQL('({})').format(sql.SQL(', ').join(sql.Placeholder() for _ in columns))
        values = [_adapt(row.get(col), col) for row in rows for col in columns]
        query = sql.SQL('INSERT INTO {} ({}) VALUES {} RETURNING *').format(
            table_ident, names, sql.SQL(', ').join(row_sql for _ in rows),
        )
        return await self._run(query, values)

    async def upsert(self, table: str, data, conflict: str):
        table_ident = self._table(table)
        rows = data if isinstance(data, list) else [data]
        if not rows:
            return []
        columns = list(dict.fromkeys(key for row in rows for key in row))
        conflicts = [item.strip() for item in conflict.split(',')]
        names = sql.SQL(', ').join(_identifier(col) for col in columns)
        row_sql = sql.SQL('({})').format(sql.SQL(', ').join(sql.Placeholder() for _ in columns))
        update_columns = [col for col in columns if col not in conflicts]
        if update_columns:
            action = sql.SQL('DO UPDATE SET {}').format(sql.SQL(', ').join(
                sql.SQL('{} = EXCLUDED.{}').format(_identifier(col), _identifier(col)) for col in update_columns
            ))
        else:
            action = sql.SQL('DO NOTHING')
        query = sql.SQL('INSERT INTO {} ({}) VALUES {} ON CONFLICT ({}) {} RETURNING *').format(
            table_ident, names, sql.SQL(', ').join(row_sql for _ in rows),
            sql.SQL(', ').join(_identifier(col) for col in conflicts), action,
        )
        values = [_adapt(row.get(col), col) for row in rows for col in columns]
        return await self._run(query, values)

    async def update(self, table: str, data: dict, **filters):
        if not filters:
            raise ValueError('Refusing an unfiltered update')
        table_ident = self._table(table)
        columns = list(data)
        assignments = sql.SQL(', ').join(sql.SQL('{} = %s').format(_identifier(col)) for col in columns)
        clauses, values = self._where(filters)
        query = sql.SQL('UPDATE {} SET {} WHERE {} RETURNING *').format(
            table_ident, assignments, sql.SQL(' AND ').join(clauses),
        )
        return await self._run(query, [_adapt(data[col], col) for col in columns] + values)

    async def delete(self, table: str, **filters):
        if not filters:
            raise ValueError('Refusing an unfiltered delete')
        clauses, values = self._where(filters)
        query = sql.SQL('DELETE FROM {} WHERE {} RETURNING *').format(
            self._table(table), sql.SQL(' AND ').join(clauses),
        )
        return await self._run(query, values)

    async def rpc(self, name: str, data: dict):
        args = RPC_ARGS.get(name)
        if not args or set(data) != set(args):
            raise ValueError('Unsupported RPC or arguments')
        values = [_adapt(data[arg], 'p_query' if arg == 'p_query' else arg) for arg in args]
        placeholders = sql.SQL(', ').join(sql.Placeholder() for _ in args)
        if name in {'claim_evaluation', 'create_evaluation', 'search_resume_chunks'}:
            query = sql.SQL('SELECT * FROM public.{}({})').format(_identifier(name), placeholders)
            return await self._run(query, values)
        query = sql.SQL('SELECT public.{}({}) AS result').format(_identifier(name), placeholders)
        rows = await self._run(query, values)
        result = rows[0]['result'] if rows else None
        return result if name == 'get_evaluation_performance' else rows

    async def create_account(self, email: str, password_hash: str):
        try:
            async with self.pool.connection() as conn:
                row = await (await conn.execute(
                    'INSERT INTO public.app_users (email, password_hash) VALUES (%s, %s) RETURNING id, email',
                    (email, password_hash),
                )).fetchone()
                await conn.execute('INSERT INTO public.profiles (user_id) VALUES (%s)', (row['id'],))
                return row
        except UniqueViolation:
            raise DatabaseError(409) from None
        except Exception:
            raise DatabaseError(503) from None

    async def rotate_refresh_token(self, old_hash: str, new_hash: str, expires_at: str):
        query = '''
            WITH revoked AS (
                UPDATE public.refresh_tokens
                SET revoked_at = now()
                WHERE token_hash = %s AND revoked_at IS NULL AND expires_at > now()
                RETURNING user_id
            )
            INSERT INTO public.refresh_tokens (user_id, token_hash, expires_at)
            SELECT user_id, %s, %s FROM revoked
            RETURNING user_id
        '''
        rows = await self._run(query, (old_hash, new_hash, expires_at))
        return rows[0]['user_id'] if rows else None

    async def close(self):
        await self.pool.close()
