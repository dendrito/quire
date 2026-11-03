# Builds Quire PDF Studio for Windows on this PC.
# Needs Node.js 20 or newer (https://nodejs.org). Run from PowerShell:
#   cd path\to\quire\windows
#   powershell -ExecutionPolicy Bypass -File .\build-local.ps1
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host 'Node.js is not installed. Get the LTS installer from https://nodejs.org and run this again.' -ForegroundColor Red
  exit 1
}

$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
Write-Host "Installing build tools (first run only)..."
npm install
Write-Host "Building Quire PDF Studio for Windows ($arch)..."
npm run sync-web
npx electron-builder --win nsis portable "--$arch"

Write-Host ''
Write-Host 'Done. In the dist folder you will find:' -ForegroundColor Green
Write-Host '  Quire-PDF-Studio-...-setup.exe   installer (Start menu + desktop shortcut, opens PDFs)'
Write-Host '  Quire-PDF-Studio-...-portable.exe  runs without installing'
Start-Process (Join-Path $PSScriptRoot 'dist')
