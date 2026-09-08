' Launch local/run.mjs with no console window.
'
' schtasks /TR "node ..." runs node.exe as a console app, so Windows opens a
' visible terminal on every fire -- every two minutes for the quotes job.
' WshShell.Run with window style 0 starts the same process hidden.
'
' Usage (from Task Scheduler):
'   wscript.exe "<repo>\local\run-hidden.vbs" quotes --publish
'
' Comments are kept ASCII on purpose: VBScript files are read as ANSI, so
' UTF-8 Arabic here would be mojibake. See local/README.md for the Arabic notes.

Dim sh, fso, root, args, a
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))

args = ""
For Each a In WScript.Arguments
  args = args & " " & a
Next

sh.CurrentDirectory = root
sh.Run "node """ & root & "\local\run.mjs""" & args, 0, False
