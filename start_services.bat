@echo off
echo Starting services...

:: VOICEVOXの起動
start "" "C:\Users\mlove\AppData\Local\Programs\VOICEVOX\VOICEVOX.exe"

:: RVCの起動
start cmd /k "cd /d E:\RVC1006Nvidia && go-web.bat"

:: TwitchRaidの起動
start cmd /k "cd /d E:\twitchRaid && python.exe main.py"

:: Whisperサーバーの起動
start cmd /k "cd /d E:\yomiage-bot-ts && python.exe whisper_server.py"

start cmd /k "cd /d E:\yomiage-bot-ts && npm run dev"

echo All services have been started. 