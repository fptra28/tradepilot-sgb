@echo off
REM Setup lokal TradePilot v1: migrasi DB (0001, 0002) lalu rebuild backend.
cd /d "%~dp0.."
set LOG=%~dp0trade-pilot-setup.log
echo [%date% %time%] mulai > "%LOG%"
echo === docker compose up -d db >> "%LOG%"
docker compose up -d db >> "%LOG%" 2>&1
set /a TRIES=0
:waitdb
docker compose exec -T db sh -c "pg_isready -U $POSTGRES_USER -d $POSTGRES_DB" >> "%LOG%" 2>&1
if %errorlevel%==0 goto migrate
set /a TRIES+=1
if %TRIES% GEQ 30 goto dbfail
timeout /t 2 /nobreak >nul
goto waitdb
:migrate
echo === migrasi 0001 >> "%LOG%"
docker compose exec -T db sh -c "psql -v ON_ERROR_STOP=1 -U $POSTGRES_USER -d $POSTGRES_DB" < lib\db\migrations\0001_trade_pilot_v1.sql >> "%LOG%" 2>&1
echo exit=%errorlevel% >> "%LOG%"
echo === migrasi 0002 >> "%LOG%"
docker compose exec -T db sh -c "psql -v ON_ERROR_STOP=1 -U $POSTGRES_USER -d $POSTGRES_DB" < lib\db\migrations\0002_trade_pilot_contract_alignment.sql >> "%LOG%" 2>&1
echo exit=%errorlevel% >> "%LOG%"
echo === rebuild app >> "%LOG%"
docker compose up -d --build app >> "%LOG%" 2>&1
echo exit=%errorlevel% >> "%LOG%"
timeout /t 15 /nobreak >nul
echo === status >> "%LOG%"
docker compose ps >> "%LOG%" 2>&1
echo === logs app >> "%LOG%"
docker compose logs app --tail 60 >> "%LOG%" 2>&1
echo === selesai >> "%LOG%"
goto end
:dbfail
echo DB tidak siap setelah 60 detik >> "%LOG%"
:end
exit
