# OCR every image in a folder with the Windows built-in OCR engine (Windows.Media.Ocr).
# Writes one JSON file with the recognised lines and their bounding boxes, so the layout
# (title band, two columns) can be reconstructed by tools/import-kimeru-pptx.js.
#
#   powershell -ExecutionPolicy Bypass -File tools\ocr-images.ps1 -InputDir <folder> -OutFile <file.json>
param(
  [Parameter(Mandatory = $true)][string]$InputDir,
  [Parameter(Mandatory = $true)][string]$OutFile,
  [string]$Language = 'en-US'
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, [Type]$type) {
  $t = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
  $t.Wait() | Out-Null
  $t.Result
}

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new($Language))
if (-not $engine) { throw "No Windows OCR language pack for $Language" }

$results = @()
Get-ChildItem -Path $InputDir -File | Where-Object { $_.Extension -match '^\.(jpe?g|png|bmp)$' } | ForEach-Object {
  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($_.FullName)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $ocr = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  $lines = @()
  foreach ($line in $ocr.Lines) {
    $xs = $line.Words | ForEach-Object { $_.BoundingRect.X }
    $ys = $line.Words | ForEach-Object { $_.BoundingRect.Y }
    $x2 = $line.Words | ForEach-Object { $_.BoundingRect.X + $_.BoundingRect.Width }
    $y2 = $line.Words | ForEach-Object { $_.BoundingRect.Y + $_.BoundingRect.Height }
    $lines += [pscustomobject]@{
      text = $line.Text
      x = [int]($xs | Measure-Object -Minimum).Minimum
      y = [int]($ys | Measure-Object -Minimum).Minimum
      x2 = [int]($x2 | Measure-Object -Maximum).Maximum
      y2 = [int]($y2 | Measure-Object -Maximum).Maximum
    }
  }
  $results += [pscustomobject]@{ file = $_.Name; width = $bitmap.PixelWidth; height = $bitmap.PixelHeight; lines = $lines }
  $stream.Dispose()
}
$results | ConvertTo-Json -Depth 5 | Out-File -FilePath $OutFile -Encoding utf8
Write-Output "OCR'd $($results.Count) images -> $OutFile"
