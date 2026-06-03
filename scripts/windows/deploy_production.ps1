[CmdletBinding()]
param(
    [string]$ProjectRoot = "",
    [string]$PythonCmd = "python",
    [string]$PipIndexUrl = "https://pypi.tuna.tsinghua.edu.cn/simple",
    [string]$PipTrustedHost = "pypi.tuna.tsinghua.edu.cn",
    [int]$Port = 5000,
    [string]$VenvDir = ".venv-win-prod",
    [string]$ServiceName = "attendance-system",
    [string]$NssmPath = "",
    [switch]$UpgradeLegacySchema,
    [switch]$InstallService,
    [switch]$SkipInitAdmin
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $scriptBase = if ($PSScriptRoot) { $PSScriptRoot } elseif ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } else { (Get-Location).Path }
    $ProjectRoot = (Resolve-Path (Join-Path $scriptBase "..\..")).Path
}

$bootstrapScript = Join-Path $ProjectRoot "scripts\windows\bootstrap_windows.ps1"
$installServiceScript = Join-Path $ProjectRoot "scripts\windows\install_service.ps1"
$envPath = Join-Path $ProjectRoot ".env"
$venvPython = Join-Path $ProjectRoot "$VenvDir\Scripts\python.exe"

function Set-OrAppendEnvValue {
    param(
        [string]$Path,
        [string]$Key,
        [string]$Value
    )

    if (!(Test-Path $Path)) {
        Set-Content -Path $Path -Value "$Key=$Value" -Encoding UTF8
        return
    }

    $content = Get-Content -Path $Path -Encoding UTF8
    $updated = $false
    $next = foreach ($line in $content) {
        if ($line -match "^\s*$Key=") {
            $updated = $true
            "$Key=$Value"
        } else {
            $line
        }
    }

    if (-not $updated) {
        $next += "$Key=$Value"
    }

    Set-Content -Path $Path -Value $next -Encoding UTF8
}

Write-Host "[1/6] 准备生产虚拟环境与依赖"
& $bootstrapScript `
    -ProjectRoot $ProjectRoot `
    -PythonCmd $PythonCmd `
    -PipIndexUrl $PipIndexUrl `
    -PipTrustedHost $PipTrustedHost `
    -Port $Port `
    -VenvDir $VenvDir `
    -InitEnv

if (!(Test-Path $venvPython)) {
    throw "未找到生产虚拟环境 Python：$venvPython"
}

Write-Host "[2/6] 写入生产环境标记"
Set-OrAppendEnvValue -Path $envPath -Key "APP_ENV" -Value "production"

Write-Host "[3/6] 初始化数据库"
& $venvPython -m flask --app manage.py init-db

if ($UpgradeLegacySchema) {
    Write-Host "[4/6] 执行旧数据库兼容升级"
    & $venvPython -m flask --app manage.py upgrade-legacy-schema
} else {
    Write-Host "[4/6] 跳过旧数据库兼容升级（如使用历史库，请加 -UpgradeLegacySchema）"
}

if ($SkipInitAdmin) {
    Write-Host "[5/6] 跳过管理员初始化"
} else {
    Write-Host "[5/6] 初始化默认管理员"
    & $venvPython -m flask --app manage.py init-admin
}

if ($InstallService) {
    Write-Host "[6/6] 安装并启动 Windows 服务"
    & $installServiceScript `
        -ProjectRoot $ProjectRoot `
        -ServiceName $ServiceName `
        -Port $Port `
        -VenvDir $VenvDir `
        -NssmPath $NssmPath

    Write-Host ""
    Write-Host "部署完成。请执行健康检查："
    Write-Host "Invoke-RestMethod http://127.0.0.1:$Port/health"
} else {
    Write-Host "[6/6] 未安装服务（如需安装，请加 -InstallService）"
    Write-Host ""
    Write-Host "手动启动命令："
    Write-Host ".\$VenvDir\Scripts\python.exe -m waitress --host=0.0.0.0 --port=$Port wsgi:app"
}
