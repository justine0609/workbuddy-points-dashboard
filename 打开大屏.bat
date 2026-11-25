@echo off
chcp 65001 >nul
title WorkBuddy 积分消耗大屏
echo ============================================
echo   WorkBuddy 积分消耗可视化大屏
echo ============================================
echo.

rem 定位到脚本所在目录
cd /d "%~dp0"

rem 尝试用 Python 启动本地服务
where python >nul 2>nul
if %errorlevel%==0 (
    echo [1/2] 正在启动本地服务 (端口 8090)...
    start "" python -m http.server 8090 --bind 127.0.0.1
    goto :open
)

rem 没有 Python，尝试用 py 启动器
where py >nul 2>nul
if %errorlevel%==0 (
    echo [1/2] 正在启动本地服务 (端口 8090)...
    start "" py -m http.server 8090 --bind 127.0.0.1
    goto :open
)

echo [错误] 未检测到 Python，无法启动本地服务。
echo        请安装 Python 后重试，或手动用其它方式起一个静态服务器。
echo        也可以直接把 CSV 文件拖进浏览器里打开的页面，点「导入数据」。
pause
exit /b 1

:open
rem 等待服务就绪
timeout /t 2 /nobreak >nul
echo [2/2] 正在打开大屏...
start "" "http://127.0.0.1:8090/index.html"
echo.
echo 大屏已打开。若浏览器未自动弹出，请手动访问：
echo    http://127.0.0.1:8090/index.html
echo.
echo 关闭大屏后，可关闭这个黑色窗口以停止服务。
pause
