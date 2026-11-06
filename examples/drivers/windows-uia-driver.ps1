# Meerkat click-through driver for native Windows apps, using Windows UI Automation.
# Needs Windows PowerShell 5.1 (powershell.exe). Nothing to install.
# Protocol v2 (persistent): one JSON object per line on stdin, one reply per line on stdout. Logs go to stderr.
#   env UIA_WINDOW_TITLE   substring of the window title to drive (required)
#   env UIA_WINDOW_WAIT_S  seconds to wait for the window at hello (default 20)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class UiaNative {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  public static void Click(int x, int y) {
    SetCursorPos(x, y);
    mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
    mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
  }
}
'@

$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::SetIn((New-Object System.IO.StreamReader([Console]::OpenStandardInput(), $utf8)))
$script:out = New-Object System.IO.StreamWriter([Console]::OpenStandardOutput(), $utf8)
$script:out.AutoFlush = $true
$script:err = New-Object System.IO.StreamWriter([Console]::OpenStandardError(), $utf8)
$script:err.AutoFlush = $true

function Log([string]$m) { $script:err.WriteLine('[uia] ' + $m) }
function Reply($obj) { $script:out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 5)); $script:out.Flush() }

$script:win = $null
$script:title = $env:UIA_WINDOW_TITLE

function Find-Window([string]$sub, [int]$timeoutMs) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  do {
    $kids = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($k in $kids) {
      try {
        $n = $k.Current.Name
        if ($n -and $n.IndexOf($sub, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return $k }
      } catch { }
    }
    Start-Sleep -Milliseconds 250
  } while ($sw.ElapsedMilliseconds -lt $timeoutMs)
  return $null
}

# The window element is kept for the whole run, so the UI Automation tree is reused. It is looked up again only if it goes stale.
function Ensure-Window {
  if ($script:win) {
    try { $null = $script:win.Current.Name; return } catch { Log 'window handle went stale, looking again'; $script:win = $null }
  }
  if ($script:title) { $script:win = Find-Window $script:title 3000 }
  if (-not $script:win) { throw "window titled $($script:title) is gone" }
}

function Get-All {
  Ensure-Window
  $script:win.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
}

function Get-Value($el) {
  try {
    $p = $null
    if ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) { return [string]$p.Current.Value }
  } catch { }
  return $null
}

function Window-Names {
  $names = New-Object System.Collections.Generic.List[string]
  try {
    foreach ($e in (Get-All)) {
      $n = $e.Current.Name
      if ($n -and -not $names.Contains($n)) { $names.Add($n); if ($names.Count -ge 10) { break } }
    }
  } catch { }
  if ($names.Count -eq 0) { return '(no named elements)' }
  return (($names | ForEach-Object { '"' + $_ + '"' }) -join ', ')
}

# Best match first: exact name on Button/MenuItem/Hyperlink, contains on those, exact on any, contains on any.
# With $matchValue, an element whose ValuePattern text contains the text also counts (so assert can read typed text).
function Find-ByText([string]$text, [bool]$matchValue) {
  $prefIds = @([System.Windows.Automation.ControlType]::Button.Id, [System.Windows.Automation.ControlType]::MenuItem.Id, [System.Windows.Automation.ControlType]::Hyperlink.Id)
  $b = @($null, $null, $null, $null)
  foreach ($e in (Get-All)) {
    $n = $null; $id = $null; $ct = $null
    try { $n = $e.Current.Name; $id = $e.Current.AutomationId; $ct = $e.Current.ControlType.Id } catch { continue }
    $isPref = $prefIds -contains $ct
    $exact = ($n -and ($n -ceq $text)) -or ($id -and ($id -ceq $text))
    $has = $n -and ($n.IndexOf($text, [StringComparison]::OrdinalIgnoreCase) -ge 0)
    if ($exact -and $isPref) { return $e }
    if ($has -and $isPref -and -not $b[0]) { $b[0] = $e }
    if ($exact -and -not $b[1]) { $b[1] = $e }
    if ($has -and -not $b[2]) { $b[2] = $e }
    if ($matchValue -and -not $b[3]) {
      $v = Get-Value $e
      if ($v -and $v.IndexOf($text, [StringComparison]::OrdinalIgnoreCase) -ge 0) { $b[3] = $e }
    }
  }
  foreach ($x in $b) { if ($x) { return $x } }
  return $null
}

function Find-Editable([string]$selector) {
  $edit = [System.Windows.Automation.ControlType]::Edit.Id
  $doc = [System.Windows.Automation.ControlType]::Document.Id
  $generic = (-not $selector) -or (@('edit', 'text', 'textbox', 'input', 'document') -contains $selector.ToLower())
  foreach ($e in (Get-All)) {
    try {
      $ct = $e.Current.ControlType.Id
      if ($ct -ne $edit -and $ct -ne $doc) { continue }
      $p = $null
      if (-not $e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) { continue }
      if ($p.Current.IsReadOnly) { continue }
      if ($generic) { return $e }
      $n = $e.Current.Name; $id = $e.Current.AutomationId
      if (($n -and $n.IndexOf($selector, [StringComparison]::OrdinalIgnoreCase) -ge 0) -or ($id -and ($id -ceq $selector))) { return $e }
    } catch { }
  }
  return $null
}

function Do-Click($el) {
  $p = $null
  if ($el.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) { $p.Invoke(); return 'invoke' }
  $pt = $null
  $ok = $false
  try { $ok = $el.TryGetClickablePoint([ref]$pt) } catch { }
  if (-not $ok) {
    $r = $el.Current.BoundingRectangle
    if ($r.IsEmpty -or $r.Width -le 0) { throw 'element has no clickable area' }
    $x = [int]($r.X + $r.Width / 2); $y = [int]($r.Y + $r.Height / 2)
  } else { $x = [int]$pt.X; $y = [int]$pt.Y }
  [UiaNative]::Click($x, $y)
  return 'mouse'
}

function Step-Result($id, [bool]$ok, $actual, $expected, $detail) {
  $r = [ordered]@{ id = $id; ok = $ok }
  if ($null -ne $actual) { $r.actual = [string]$actual }
  if ($null -ne $expected) { $r.expected = [string]$expected }
  if ($null -ne $detail) { $r.detail = [string]$detail }
  return $r
}

function Run-Step($id, $step, [int]$timeoutMs) {
  $t = [string]$step.type
  $name = $null
  if ($step.text) { $name = [string]$step.text } elseif ($step.selector) { $name = [string]$step.selector }
  switch ($t) {
    'open' {
      $path = [string]$step.url
      if (-not $path) { return Step-Result $id $false 'no path' 'open needs url (the program to start)' $null }
      $proc = $null
      if ($step.args) { $proc = Start-Process -FilePath $path -ArgumentList @($step.args) -PassThru } else { $proc = Start-Process -FilePath $path -PassThru }
      Log "started $path (pid $($proc.Id))"
      $script:win = $null
      if (-not $script:title) { return Step-Result $id $true "started $path" $null 'UIA_WINDOW_TITLE not set, window not awaited' }
      $script:win = Find-Window $script:title $timeoutMs
      if (-not $script:win) { return Step-Result $id $false "no window titled $($script:title) within $timeoutMs ms" "window titled $($script:title)" $null }
      return Step-Result $id $true "window $($script:win.Current.Name)" $null $null
    }
    'click' {
      if (-not $name) { return Step-Result $id $false 'no target' 'click needs text or selector' $null }
      $sw = [Diagnostics.Stopwatch]::StartNew()
      $el = $null
      do { $el = Find-ByText $name $false; if ($el) { break }; Start-Sleep -Milliseconds 200 } while ($sw.ElapsedMilliseconds -lt $timeoutMs)
      if (-not $el) { return Step-Result $id $false ('not found; window has: ' + (Window-Names)) "element named $name" $null }
      $how = Do-Click $el
      return Step-Result $id $true "clicked $($el.Current.Name) via $how" $null $null
    }
    'type' {
      $val = ''
      if ($null -ne $step.value) { $val = [string]$step.value } elseif ($null -ne $step.text) { $val = [string]$step.text }
      $sel = [string]$step.selector
      $sw = [Diagnostics.Stopwatch]::StartNew()
      $el = $null
      do { $el = Find-Editable $sel; if ($el) { break }; Start-Sleep -Milliseconds 200 } while ($sw.ElapsedMilliseconds -lt $timeoutMs)
      if (-not $el) {
        $want = 'an editable text element'
        if ($sel) { $want = "editable element $sel" }
        return Step-Result $id $false ('no editable field; window has: ' + (Window-Names)) $want $null
      }
      try { $el.SetFocus() } catch { }
      $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($val)
      return Step-Result $id $true ('typed ' + $val.Length + ' characters') $null $null
    }
    'wait-for' {
      if (-not $name) { return Step-Result $id $false 'no target' 'wait-for needs text' $null }
      $sw = [Diagnostics.Stopwatch]::StartNew()
      do {
        if (Find-ByText $name $true) { return Step-Result $id $true "found $name" $null $null }
        Start-Sleep -Milliseconds 200
      } while ($sw.ElapsedMilliseconds -lt $timeoutMs)
      return Step-Result $id $false ('not found within ' + $timeoutMs + ' ms; window has: ' + (Window-Names)) "element named $name" $null
    }
    'assert' {
      if (-not $name) { return Step-Result $id $false 'no target' 'assert needs text' $null }
      if (Find-ByText $name $true) { return Step-Result $id $true "found $name" $null $null }
      return Step-Result $id $false ('not found; window has: ' + (Window-Names)) "element named $name" $null
    }
    'screenshot' {
      $p = [string]$step.path
      if (-not $p) { return Step-Result $id $false 'no path' 'screenshot needs path' $null }
      Ensure-Window
      $r = $script:win.Current.BoundingRectangle
      if ($r.IsEmpty -or $r.Width -le 0 -or $r.Height -le 0) { return Step-Result $id $false 'window has no visible area (minimised?)' 'window bounds' $null }
      $full = [IO.Path]::GetFullPath($p)
      $dir = [IO.Path]::GetDirectoryName($full)
      if (-not (Test-Path -LiteralPath $dir)) { $null = New-Item -ItemType Directory -Path $dir -Force }
      $bmp = New-Object System.Drawing.Bitmap ([int]$r.Width), ([int]$r.Height)
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      try { $g.CopyFromScreen([int]$r.X, [int]$r.Y, 0, 0, $bmp.Size) } finally { $g.Dispose() }
      try { $bmp.Save($full, [System.Drawing.Imaging.ImageFormat]::Png) } finally { $bmp.Dispose() }
      return Step-Result $id $true "saved $p" $null $null
    }
    default { return Step-Result $id $false "unsupported step type $t" 'one of open, click, type, wait-for, assert, screenshot' $null }
  }
}

Log 'driver up'
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if (-not $line.Trim()) { continue }
  try { $msg = $line | ConvertFrom-Json } catch { Log "bad json: $line"; continue }
  if ($msg.type -eq 'hello') {
    if (-not $script:title) { Reply ([ordered]@{ type = 'ready'; ok = $false; detail = 'UIA_WINDOW_TITLE is not set' }); continue }
    $wait = 20
    if ($env:UIA_WINDOW_WAIT_S) { $wait = [int]$env:UIA_WINDOW_WAIT_S }
    $script:win = Find-Window $script:title ($wait * 1000)
    if ($script:win) {
      Log "window found: $($script:win.Current.Name)"
      Reply ([ordered]@{ type = 'ready'; ok = $true; capabilities = @('open', 'click', 'type', 'wait-for', 'assert', 'screenshot') })
    } else {
      Reply ([ordered]@{ type = 'ready'; ok = $false; detail = "no window titled $($script:title) within $wait s" })
    }
  } elseif ($msg.type -eq 'stop') {
    Reply ([ordered]@{ type = 'stopped' })
    exit 0
  } elseif ($msg.type -eq 'step') {
    $to = 5000
    if ($msg.timeoutMs) { $to = [int]$msg.timeoutMs }
    try { $res = Run-Step $msg.id $msg.step $to }
    catch { $res = Step-Result $msg.id $false $_.Exception.Message 'step to complete' $null; Log ('step error: ' + $_.Exception.Message) }
    Reply $res
  } else {
    Log "ignoring message type $($msg.type)"
  }
}
exit 0
