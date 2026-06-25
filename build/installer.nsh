; Custom NSIS behaviour for the C2PA Inspector assisted installer.
;
;  - The finish page shows a checkbox to create a Desktop shortcut (checked
;    by default).
;  - If that checkbox is left unchecked, the install folder is opened on
;    finish so the user can find the installed .exe.
;  - The Desktop shortcut we create is removed on uninstall.
;
; Note: electron-builder injects this file in the script header, before
; common.nsh / MUI2 and in BOTH the installer and uninstaller passes. So the
; finish-page functions are defined *inside* customFinishPage (which expands
; after MUI2, installer pass only) and we use ${PRODUCT_FILENAME} (a global
; command-line define) instead of ${APP_EXECUTABLE_FILENAME} (defined later).

!include "LogicLib.nsh"
!include "nsDialogs.nsh"

!macro customFinishPage
  ; Reuse the MUI "show readme" slot as a generic checkbox.
  !define MUI_FINISHPAGE_SHOWREADME ""
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "Create a shortcut on the Desktop"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION CreateDesktopShortcutOnFinish

  ; Runs first when the user presses Finish (before the checkbox action).
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE OnFinishLeave

  !insertmacro MUI_PAGE_FINISH

  ; Defined after MUI_PAGE_FINISH so $mui.FinishPage.ShowReadme exists, and so
  ; these functions are only compiled in the installer (not uninstaller) pass.
  Function CreateDesktopShortcutOnFinish
    CreateShortcut "$DESKTOP\${PRODUCT_FILENAME}.lnk" "$INSTDIR\${PRODUCT_FILENAME}.exe"
  FunctionEnd

  Function OnFinishLeave
    ${NSD_GetState} $mui.FinishPage.ShowReadme $0
    ${If} $0 == 0
      ExecShell "open" "$INSTDIR"
    ${EndIf}
  FunctionEnd
!macroend

; We create the Desktop shortcut ourselves, so remove it on uninstall.
!macro customUnInstall
  Delete "$DESKTOP\${PRODUCT_FILENAME}.lnk"
!macroend
