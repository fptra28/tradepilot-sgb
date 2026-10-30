@echo off
REM Rebuild + recreate container app memakai OPENAI_API_KEY dari .env (bukan env var Windows).
cd /d "%~dp0.."
set LOG=%~dp0trade-pilot-setup.log
set "OPENAI_API_KEY="
echo [%date% %time%] recreate app > "%LOG%"
echo === migrasi 0003 (idempotent) >> "%LOG%"
docker compose exec -T db sh -c "psql -v ON_ERROR_STOP=1 -U $POSTGRES_USER -d $POSTGRES_DB" < lib\db\migrations\0003_tp_admin_audit.sql >> "%LOG%" 2>&1
echo exit=%errorlevel% >> "%LOG%"
echo === migrasi 0004 (idempotent) >> "%LOG%"
docker compose exec -T db sh -c "psql -v ON_ERROR_STOP=1 -U $POSTGRES_USER -d $POSTGRES_DB" < lib\db\migrations\0004_tp_admin_audit_details.sql >> "%LOG%" 2>&1
echo exit=%errorlevel% >> "%LOG%"
echo === migrasi 0005 (idempotent) >> "%LOG%"
docker compose exec -T db sh -c "psql -v ON_ERROR_STOP=1 -U $POSTGRES_USER -d $POSTGRES_DB" < lib\db\migrations\0005_tp_settings.sql >> "%LOG%" 2>&1
echo exit=%errorlevel% >> "%LOG%"
echo === migrasi 0006 (idempotent) >> "%LOG%"
docker compose exec -T db sh -c "psql -v ON_ERROR_STOP=1 -U $POSTGRES_USER -d $POSTGRES_DB" < lib\db\migrations\0006_tp_operational_health.sql >> "%LOG%" 2>&1
echo exit=%errorlevel% >> "%LOG%"
docker compose up -d --build --force-recreate app >> "%LOG%" 2>&1
echo exit=%errorlevel% >> "%LOG%"
timeout /t 10 /nobreak >nul
docker compose exec -T app sh -c "case \"$OPENAI_API_KEY\" in sk-*) echo OPENAI_KEY_OK;; *) echo OPENAI_KEY_BAD;; esac" >> "%LOG%" 2>&1
docker compose ps app >> "%LOG%" 2>&1
echo === selesai >> "%LOG%"
exit
