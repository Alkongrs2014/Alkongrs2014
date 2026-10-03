' Launch local/run.mjs with no console window.
'
' schtasks /TR "node ..." runs node.exe as a console app, so Windows opens a
' visible terminal on every fire -- every two minutes for the quotes job.
' WshShell.Run with window style 0 starts the same process hidden.
'
' Usage (from Task Scheduler):
'   wscript.exe "<repo>\local\run-hidden.vbs" quotes --publish
'
' WAIT for node instead of returning immediately. With bWaitOnReturn = False
' wscript.exe exits the instant node starts, so Task Scheduler marks the task
' "finished, result 0x0" before any work happens. That silently disables three
' safety nets: ExecutionTimeLimit can never kill a hung run, LastTaskResult
' always reads success, and MultipleInstances=IgnoreNew never sees an overlap.
' Waiting costs nothing -- window style 0 keeps it hidden either way -- and it
' makes the exit code real. See data/.run.lock for the in-app overlap guard,
' which had to exist precisely because the scheduler's own guard was inert.
'
' Comments are kept ASCII on purpose: VBScript files are read as ANSI, so
' UTF-8 Arabic here would be mojibake. See local/README.md for the Arabic notes.

Dim sh, fso, root, args, a, code
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))

args = ""
For Each a In WScript.Arguments
  args = args & " " & a
Next

sh.CurrentDirectory = root

' Keep every run's output (stdout + stderr) in data\logs\runs\YYYY-MM-DD-<job>.log
' (2026-10-03). Before this, scheduled output was discarded, so a slow or failed
' run left no trace to diagnose. cmd /c returns node's own exit code, so the
' waiting and the exit-code semantics above are unchanged. One file per job and
' day: concurrent jobs never append to the same file. run.mjs prunes old files.
Dim logDir, job, d, logFile
If Not fso.FolderExists(root & "\data") Then fso.CreateFolder(root & "\data")
If Not fso.FolderExists(root & "\data\logs") Then fso.CreateFolder(root & "\data\logs")
logDir = root & "\data\logs\runs"
If Not fso.FolderExists(logDir) Then fso.CreateFolder(logDir)
job = "run"
If WScript.Arguments.Count > 0 Then job = WScript.Arguments(0)
d = Now
logFile = logDir & "\" & Year(d) & "-" & Right("0" & Month(d), 2) & "-" & Right("0" & Day(d), 2) & "-" & job & ".log"
code = sh.Run("cmd /c node """ & root & "\local\run.mjs""" & args & " >> """ & logFile & """ 2>&1", 0, True)
WScript.Quit code
