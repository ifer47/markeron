; After copy/registry/shortcuts: invalidate Explorer icon cache so the brand-blue
; asset replaces any previously cached black glyph (common after in-place updates).
!macro NSIS_HOOK_POSTINSTALL
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x0000, p 0, p 0)'
!macroend
