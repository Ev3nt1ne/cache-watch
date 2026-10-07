# Milliseconds since the person last touched this Windows desktop (any window), as `idle=<ms>`.
# Read from stdin by `powershell.exe -Command -`, so every statement is one line.
# GetLastInputInfo is system-wide: typing in any window counts, not only in Claude Code.
$s = 'using System;using System.Runtime.InteropServices;public class CwIdle{[StructLayout(LayoutKind.Sequential)]public struct LASTINPUTINFO{public uint cbSize;public uint dwTime;}[DllImport("user32.dll")]public static extern bool GetLastInputInfo(ref LASTINPUTINFO p);[DllImport("kernel32.dll")]public static extern uint GetTickCount();public static uint Ms(){LASTINPUTINFO l=new LASTINPUTINFO();l.cbSize=(uint)Marshal.SizeOf(l);if(!GetLastInputInfo(ref l)){return 0;}return GetTickCount()-l.dwTime;}}'
Add-Type -TypeDefinition $s
"idle=$([CwIdle]::Ms())"
