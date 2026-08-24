; Custom uninstaller behavior for Tracked 26.
; electron-builder includes this automatically via nsis.include in
; package.json, and calls the customUnInstall macro during the
; uninstall section — after program files are removed, before the
; uninstaller exits.

!macro customUnInstall
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Delete all local data and settings stored on this PC for Tracked 26?$\r$\n$\r$\nThis removes your progress, heatmap, targets, and profile saved on this device. It can't be undone.$\r$\n$\r$\nAnything already synced to your Google account is not affected — sign in again after reinstalling to get it back." \
    IDYES delete_local_data IDNO skip_local_data

  delete_local_data:
    ; Electron's userData directory (localStorage backing store, cached
    ; config, etc.) — this is the app's productName under Roaming AppData
    ; on a per-user install.
    RMDir /r "$APPDATA\Tracked 26"
    ; electron-updater's own cache lives in Local AppData, separate from
    ; userData — clean that up too so nothing is left behind.
    RMDir /r "$LOCALAPPDATA\Tracked 26-updater"
    Goto done_local_data

  skip_local_data:
  done_local_data:
!macroend
