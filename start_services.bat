@echo off
echo Starting services...

:: TwitchRaidの起動
start cmd /k "cd /d C:\Users\mlove\Documents\Python Plactice\twitchRaid && python main.py"

:: VOICEVOXの起動
start "" "C:\Users\mlove\AppData\Local\Programs\VOICEVOX\VOICEVOX.exe"

:: RVCの起動
start cmd /k "cd /d E:\RVC1006Nvidia\RVC1006Nvidia && python infer-web.py"

:: RVCの起動を確認
echo Waiting for RVC to start...
powershell -ExecutionPolicy Bypass -File "%~dp0check_rvc.ps1"
if %ERRORLEVEL% NEQ 0 (
    echo RVC failed to start properly
    exit /b 1
)

:: 1分待機してからyomiage-botを起動
start cmd /k "cd /d C:\Users\mlove\Documents\Python Plactice\yomiage-bot && .\recording\Scripts\activate && python main.py"

echo All services have been started. 