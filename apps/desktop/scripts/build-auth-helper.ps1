$ErrorActionPreference = 'Stop'
$desktopRoot = Split-Path -Parent $PSScriptRoot
$vswhere = Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'Microsoft Visual Studio/Installer/vswhere.exe'
if (!(Test-Path -LiteralPath $vswhere)) { throw 'Visual Studio C++ tools are required to build the Windows auth helper.' }
$vsRoot = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (!$vsRoot) { throw 'Install the Visual Studio Desktop development with C++ workload.' }
$toolRoot = (Get-ChildItem -LiteralPath (Join-Path $vsRoot 'VC/Tools/MSVC') -Directory | Sort-Object Name -Descending | Select-Object -First 1).FullName
$kitRoot = Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'Windows Kits/10'
$sdk = (Get-ChildItem -LiteralPath (Join-Path $kitRoot 'Include') -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'cppwinrt/winrt/Windows.Security.Credentials.UI.h') } | Sort-Object Name -Descending | Select-Object -First 1).Name
if (!$sdk) { throw 'Windows SDK C++/WinRT headers are required.' }
$output = Join-Path $desktopRoot 'public/resources/native'
New-Item -ItemType Directory -Path $output -Force | Out-Null
$objectDirectory = Join-Path $desktopRoot 'dist/native-auth-build'
New-Item -ItemType Directory -Path $objectDirectory -Force | Out-Null
$arguments = @('/nologo', '/std:c++17', '/EHsc', '/O2', '/MT', '/DWIN32_LEAN_AND_MEAN', '/DNOMINMAX', ('/I' + (Join-Path $toolRoot 'include')))
foreach ($part in @('cppwinrt','winrt','um','shared','ucrt')) { $arguments += '/I' + (Join-Path $kitRoot ('Include/' + $sdk + '/' + $part)) }
$arguments += @((Join-Path $desktopRoot 'native/windows/auth.cpp'), ('/Fo' + (Join-Path $objectDirectory 'thread-auth.obj')), ('/Fe' + (Join-Path $output 'thread-auth.exe')), '/link', ('/LIBPATH:' + (Join-Path $toolRoot 'lib/x64')), ('/LIBPATH:' + (Join-Path $kitRoot ('Lib/' + $sdk + '/um/x64'))), ('/LIBPATH:' + (Join-Path $kitRoot ('Lib/' + $sdk + '/ucrt/x64'))), 'windowsapp.lib', 'runtimeobject.lib', 'user32.lib')
& (Join-Path $toolRoot 'bin/Hostx64/x64/cl.exe') @arguments
if ($LASTEXITCODE -ne 0) { throw 'Native authentication helper compilation failed.' }
Write-Output 'Built Thread Windows authentication helper (x64).'
