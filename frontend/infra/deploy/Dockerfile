FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /opt/careerlens
COPY CareerLens-backend/requirements.lock.txt /tmp/backend-requirements.txt
COPY CareerLens-frontend/requirements.txt /tmp/frontend-requirements.txt
RUN pip install --no-cache-dir -r /tmp/backend-requirements.txt -r /tmp/frontend-requirements.txt
# Explicit allowlist: never copy either repository's .env, runtime, reports or Git metadata.
COPY CareerLens-backend/app ./CareerLens-backend/app
COPY CareerLens-backend/workers ./CareerLens-backend/workers
COPY CareerLens-frontend/src ./CareerLens-frontend/src
COPY CareerLens-frontend/public ./CareerLens-frontend/public
COPY CareerLens-frontend/data/career-postings.json ./CareerLens-frontend/data/career-postings.json
COPY CareerLens-frontend/server.py CareerLens-frontend/resume_conversion.py CareerLens-frontend/guest_analysis_service.py CareerLens-frontend/guest_analysis_engine.py CareerLens-frontend/job_catalog_service.py ./CareerLens-frontend/
RUN useradd --uid 10001 --create-home careerlens && mkdir -p /var/lib/careerlens/guest /var/lib/careerlens/reports /var/lib/careerlens/execution-reports && chown -R careerlens:careerlens /var/lib/careerlens
USER careerlens
WORKDIR /opt/careerlens/CareerLens-frontend
CMD ["python", "server.py", "--host", "0.0.0.0", "--port", "5300"]
