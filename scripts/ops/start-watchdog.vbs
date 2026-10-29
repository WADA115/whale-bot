' start-watchdog.vbs - start the watchdog with no console window
Option Explicit
Dim sh, fso, repo, ps1
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
repo = fso.GetParentFolderName(fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName)))
ps1 = repo & "\scripts\ops\watchdog.ps1"
sh.CurrentDirectory = repo
sh.Run "powershell -NoProfile -ExecutionPolicy Bypass -File " & Chr(34) & ps1 & Chr(34), 0, False
