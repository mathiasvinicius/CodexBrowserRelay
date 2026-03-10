Option Explicit

Dim shell
Dim serviceDir
Dim runner
Dim command

serviceDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
runner = serviceDir & "\run-relay-service.cmd"

Set shell = CreateObject("WScript.Shell")
command = "cmd.exe /c """ & runner & """"

' 0 = hidden window, False = fire-and-forget.
shell.Run command, 0, False
