; Installer hooks. Keep these cheap: they run inside the NSIS installer, not in
; the app process.

; Timestamp marker: the file mtime records when the install section actually
; started. The app reads it on the next launch, so a slow download -> installer
; handoff (Defender scanning the unsigned installer) can be told apart from a
; slow install.
!macro NSIS_HOOK_PREINSTALL
  ClearErrors
  FileOpen $9 "$LOCALAPPDATA\${BUNDLEID}\logs\logs\updater-timing.log" a
  ${If} $9 != ""
    FileSeek $9 0 END
    FileWrite $9 "installer started$\r$\n"
    FileClose $9
  ${EndIf}
!macroend

; After copy/registry/shortcuts: invalidate Explorer icon cache so the brand-blue
; asset replaces any previously cached black glyph (common after in-place updates).
!macro NSIS_HOOK_POSTINSTALL
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x0000, p 0, p 0)'
!macroend
