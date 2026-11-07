param()
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
  $taskPath = $env:AGENT_DESK_SHELL_PATH
  if (-not $taskPath -or -not (Test-Path -LiteralPath $taskPath)) { throw '文件不存在' }
  if ($env:AGENT_DESK_SHELL_ACTION -ne 'open') {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class DeskShell {
  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr window, int command);
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("shell32.dll", CharSet=CharSet.Unicode)]
  public static extern int SHParseDisplayName(string name, IntPtr binding, out IntPtr pidl, uint attrs, out uint result);
  [DllImport("shell32.dll")]
  public static extern IntPtr ILFindLastID(IntPtr pidl);
  [DllImport("shell32.dll")]
  public static extern int SHOpenFolderAndSelectItems(IntPtr pidl, uint count, IntPtr children, uint flags);
}
"@
  }
  if ($env:AGENT_DESK_SHELL_ACTION -eq 'reveal') {
    $taskPidl = [IntPtr]::Zero
    $taskAttrs = [uint32]0
    $taskParent = [IntPtr]::Zero
    $taskChildren = [IntPtr]::Zero
    try {
      [Runtime.InteropServices.Marshal]::ThrowExceptionForHR([DeskShell]::SHParseDisplayName($taskPath, [IntPtr]::Zero, [ref]$taskPidl, 0, [ref]$taskAttrs))
      [Runtime.InteropServices.Marshal]::ThrowExceptionForHR([DeskShell]::SHParseDisplayName([System.IO.Path]::GetDirectoryName($taskPath), [IntPtr]::Zero, [ref]$taskParent, 0, [ref]$taskAttrs))
      $taskChildren = [Runtime.InteropServices.Marshal]::AllocHGlobal([IntPtr]::Size)
      [Runtime.InteropServices.Marshal]::WriteIntPtr($taskChildren, [DeskShell]::ILFindLastID($taskPidl))
      [Runtime.InteropServices.Marshal]::ThrowExceptionForHR([DeskShell]::SHOpenFolderAndSelectItems($taskParent, 1, $taskChildren, 0))
    } finally {
      if ($taskChildren -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::FreeHGlobal($taskChildren) }
      if ($taskParent -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::FreeCoTaskMem($taskParent) }
      if ($taskPidl -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::FreeCoTaskMem($taskPidl) }
    }
  } else {
    $taskStart = New-Object System.Diagnostics.ProcessStartInfo
    $taskStart.FileName = $taskPath
    $taskStart.UseShellExecute = $true
    $taskStart.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Normal
    [System.Diagnostics.Process]::Start($taskStart) | Out-Null
  }
  if ($env:AGENT_DESK_SHELL_ACTION -ne 'open') {
    $taskShell = New-Object -ComObject Shell.Application
    $taskDirectory = if ($env:AGENT_DESK_SHELL_ACTION -eq 'reveal') { [System.IO.Path]::GetDirectoryName($taskPath) } else { $taskPath }
    $taskConfirmed = $false
    for ($taskAttempt = 0; $taskAttempt -lt 80 -and -not $taskConfirmed; $taskAttempt++) {
      foreach ($taskWindow in $taskShell.Windows()) {
        try {
          if ($taskWindow.Document.Folder.Self.Path -ieq $taskDirectory) {
            if ($env:AGENT_DESK_SHELL_ACTION -eq 'reveal') {
              $taskItem = $taskWindow.Document.Folder.ParseName([System.IO.Path]::GetFileName($taskPath))
              $taskWindow.Document.SelectItem($taskItem, 29)
              foreach ($taskSelected in $taskWindow.Document.SelectedItems()) {
                if ($taskSelected.Path -ieq $taskPath) { $taskConfirmed = $true }
              }
            } else { $taskConfirmed = $true }
            [DeskShell]::ShowWindow([IntPtr]$taskWindow.HWND, 9) | Out-Null
            [DeskShell]::SetForegroundWindow([IntPtr]$taskWindow.HWND) | Out-Null
          }
        } catch { }
      }
      if (-not $taskConfirmed) { Start-Sleep -Milliseconds 100 }
    }
    if (-not $taskConfirmed) { throw 'Explorer did not confirm the folder or file selection. Please retry.' }
  }
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
