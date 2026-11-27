; Custom installer steps (included by electron-builder's NSIS template).
;
; When TibPortal updates itself, the installer runs with --updated. In that
; case we skip every question so only the progress bar shows, then close the
; installer and reopen TibPortal. A normal first install is unchanged.

; Skip "Install for just me / all users" on updates: keep whatever the
; existing install uses.
!macro customInstallMode
  ${if} ${isUpdated}
    ${if} $hasPerMachineInstallation == "1"
    ${andIf} $hasPerUserInstallation == "0"
      StrCpy $isForceMachineInstall "1"
    ${else}
      StrCpy $isForceCurrentInstall "1"
    ${endif}
  ${endif}
!macroend

; Same finish page as the default, except that on an update it is skipped
; and TibPortal starts straight away.
!macro customFinishPage
  Function StartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  Function finishPagePre
    ${if} ${isUpdated}
      HideWindow
      Call StartApp
      Abort
    ${endif}
  FunctionEnd

  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !define MUI_PAGE_CUSTOMFUNCTION_PRE finishPagePre
  !insertmacro MUI_PAGE_FINISH
!macroend
