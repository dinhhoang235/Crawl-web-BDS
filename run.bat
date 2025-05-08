@echo off
title Web Crawler
color 0A

echo Checking if node_modules exists...
if not exist node_modules (
    echo Installing dependencies...
    npm install
)

echo.
echo Running the crawl...
cmd /k npm start

echo.
echo [DONE] Press any key to exit...
pause
