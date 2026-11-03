# Talks to scanners through Windows Image Acquisition (WIA), which every Windows PC has.
# Called by main.js. Settings arrive in environment variables so nothing is pasted into the script.
#   QUIRE_SCAN_ACTION  list | scan | dialog
#   QUIRE_SCAN_DEVICE  WIA device ID (empty = first scanner)
#   QUIRE_SCAN_SOURCE  flatbed | feeder | duplex
#   QUIRE_SCAN_DPI     e.g. 300
#   QUIRE_SCAN_COLOR   color | grey | bw
#   QUIRE_SCAN_PAPER   auto | a4 | letter | legal | a5
#   QUIRE_SCAN_MAX     feeder: stop after this many pages (0 = until empty)
#   QUIRE_SCAN_OUT     folder for the scanned JPEG files
# Output: one line of JSON on stdout.
$ErrorActionPreference = 'Stop'
$JPEG = '{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}'
function Out-Json($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 4)) }
function Set-Prop($props, [int]$id, $value) {
  foreach ($p in $props) { if ($p.PropertyID -eq $id) { try { $p.Value = $value; return $true } catch { return $false } } }
  return $false
}
try {
  $dm = New-Object -ComObject WIA.DeviceManager
  $scanners = @($dm.DeviceInfos | Where-Object { $_.Type -eq 1 })
  $action = $env:QUIRE_SCAN_ACTION

  if ($action -eq 'list') {
    $list = @($scanners | ForEach-Object { @{ id = $_.DeviceID; name = [string]$_.Properties.Item('Name').Value } })
    Out-Json @{ ok = $true; devices = $list }; exit 0
  }

  $out = $env:QUIRE_SCAN_OUT
  $intent = switch ($env:QUIRE_SCAN_COLOR) { 'grey' { 2 } 'bw' { 4 } default { 1 } }

  if ($action -eq 'dialog') {
    # The scanner maker's own window, with every setting the driver offers.
    $dlg = New-Object -ComObject WIA.CommonDialog
    $img = $dlg.ShowAcquireImage(1, $intent, 0, $JPEG, $false, $true, $false)
    if ($null -eq $img) { Out-Json @{ ok = $true; files = @() }; exit 0 }
    $f = Join-Path $out 'page-001.jpg'; $img.SaveFile($f)
    Out-Json @{ ok = $true; files = @($f) }; exit 0
  }

  if ($scanners.Count -eq 0) { Out-Json @{ ok = $false; error = 'No scanner found. Check that it is switched on and connected, and that its Windows driver is installed.' }; exit 0 }
  $info = $scanners | Where-Object { $_.DeviceID -eq $env:QUIRE_SCAN_DEVICE } | Select-Object -First 1
  if (-not $info) { $info = $scanners[0] }
  $dev = $info.Connect()

  # Document Handling Select (3088): 1 = feeder, 2 = flatbed, 4 = duplex
  $source = $env:QUIRE_SCAN_SOURCE
  $feeder = $source -eq 'feeder' -or $source -eq 'duplex'
  $sel = switch ($source) { 'feeder' { 1 } 'duplex' { 5 } default { 2 } }
  if ($feeder) {
    if (-not (Set-Prop $dev.Properties 3088 $sel)) {
      if ($source -eq 'duplex' -and (Set-Prop $dev.Properties 3088 1)) { $warn = 'This scanner has no two-sided mode, so only the front of each page was scanned.' }
      else { Out-Json @{ ok = $false; error = 'This scanner has no document feeder. Choose Flatbed instead.' }; exit 0 }
    }
    $max = [int]$env:QUIRE_SCAN_MAX; if ($max -lt 0) { $max = 0 }
    [void](Set-Prop $dev.Properties 3096 $max)  # Pages: 0 = scan until the feeder is empty
  } else { [void](Set-Prop $dev.Properties 3088 2) }

  # Paper size: millimetres, plus the WIA page-size code feeders understand (3097: 0 A4, 1 Letter, 3 Legal, 2 custom)
  $paper = switch ($env:QUIRE_SCAN_PAPER) { 'a4' { @(210, 297, 0) } 'letter' { @(215.9, 279.4, 1) } 'legal' { @(215.9, 355.6, 3) } 'a5' { @(148, 210, 2) } default { $null } }
  if ($paper -and $feeder) { [void](Set-Prop $dev.Properties 3097 $paper[2]) }

  $item = $dev.Items.Item(1)
  $dpi = [int]$env:QUIRE_SCAN_DPI; if ($dpi -lt 75) { $dpi = 300 }
  [void](Set-Prop $item.Properties 6146 $intent)  # colour intent
  [void](Set-Prop $item.Properties 6147 $dpi)     # horizontal resolution
  [void](Set-Prop $item.Properties 6148 $dpi)     # vertical resolution
  if ($paper) {
    # Scan area from the top-left corner, in pixels at the chosen resolution. A size larger than the glass is clipped by the driver.
    [void](Set-Prop $item.Properties 6149 0); [void](Set-Prop $item.Properties 6150 0)
    $w = [int][Math]::Round($paper[0] / 25.4 * $dpi); $h = [int][Math]::Round($paper[1] / 25.4 * $dpi)
    if (-not (Set-Prop $item.Properties 6151 $w)) { foreach ($p in $item.Properties) { if ($p.PropertyID -eq 6151) { try { $p.Value = $p.SubTypeMax } catch {} } } }
    if (-not (Set-Prop $item.Properties 6152 $h)) { foreach ($p in $item.Properties) { if ($p.PropertyID -eq 6152) { try { $p.Value = $p.SubTypeMax } catch {} } } }
  }

  $files = @(); $n = 0
  while ($true) {
    try { $img = $item.Transfer($JPEG) }
    catch {
      $code = $_.Exception.HResult
      if ($n -gt 0 -and $feeder) { break }                       # feeder is empty: done
      if ($code -eq -2145320957) { $msg = 'The document feeder is empty. Put the pages in and try again.' }  # 0x80210003
      elseif ($code -eq -2145320954) { $msg = 'The scanner is busy. Wait a moment and try again.' }          # 0x80210006
      elseif ($code -eq -2145320958) { $msg = 'Paper is jammed in the scanner.' }                             # 0x80210002
      elseif ($code -eq -2145320959) { $msg = 'The scanner reported a general error. Try turning it off and on.' }
      else { $msg = 'The scan did not work: ' + $_.Exception.Message }
      Out-Json @{ ok = $false; error = $msg; files = $files }; exit 0
    }
    $n++; $f = Join-Path $out ('page-{0:D3}.jpg' -f $n); $img.SaveFile($f); $files += $f
    if (-not $feeder -or $n -ge 500 -or ($max -gt 0 -and $n -ge $max)) { break }
  }
  Out-Json @{ ok = $true; files = $files; warning = $warn }
} catch {
  $m = $_.Exception.Message
  if ($m -match 'WIA.DeviceManager') { $m = 'Windows scanning (WIA) is not available on this PC.' }
  Out-Json @{ ok = $false; error = $m }
}
