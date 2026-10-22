@echo off
cd /d "%~dp0"
echo.
echo === Masters Compendium: build ===
echo [1/2] Installing PyQt6, aiohttp, qrcode and PyInstaller...
python -m pip install -q -U -r requirements.txt pyinstaller
if errorlevel 1 goto :err
taskkill /im MastersCompendium.exe /f >nul 2>&1

echo [2/2] Building the portable exe...
if exist "dist\MastersCompendium.exe" del /f /q "dist\MastersCompendium.exe"
python -m PyInstaller --noconfirm --clean MastersCompendium.spec
if errorlevel 1 goto :err
echo.
echo DONE: %CD%\dist\MastersCompendium.exe
echo Copy the exe anywhere (desktop, USB drive) - it keeps its data in MastersCompendium_data next to itself.
echo On first start Windows Firewall asks for network access - allow it, otherwise phones can't connect.
echo.
pause
exit /b 0

:err
echo.
echo BUILD FAILED - see messages above
pause
exit /b 1
