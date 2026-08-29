!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

;SilentInstall silent

;Function .onInstSuccess
;  SetOutPath $INSTDIR
;  Exec "$INSTDIR\Thread.exe"
;FunctionEnd