@echo off
cd /d "%~dp0"
start "" http://127.0.0.1:8772
"C:\Users\ADMIN\AppData\Local\Programs\Python\Python314\python.exe" server.py
