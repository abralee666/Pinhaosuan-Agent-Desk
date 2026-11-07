$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
$taskPicker = New-Object System.Windows.Forms.FolderBrowserDialog
$taskPicker.Description = '选择拼好算项目文件夹'
$taskPicker.ShowNewFolderButton = $true
try {
  if ($taskPicker.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    @{workspace=$taskPicker.SelectedPath} | ConvertTo-Json -Compress
  } else { '{"workspace":null}' }
} finally { $taskPicker.Dispose() }
