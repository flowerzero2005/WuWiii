param(
  [string]$Foreground = (Join-Path $PSScriptRoot '..\..\docs\brand\candidates\airi-locked-layers\airi-foreground-locked.png'),
  [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\..\docs\brand\candidates\airi-chat-icon-v1')
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

function New-ChatBubblePath {
  param(
    [System.Drawing.RectangleF]$Rectangle,
    [float]$Radius,
    [System.Drawing.PointF]$TailTip,
    [float]$TailAttachLeft,
    [float]$TailAttachRight
  )

  $diameter = $Radius * 2
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $path.StartFigure()
  $path.AddArc($Rectangle.Left, $Rectangle.Top, $diameter, $diameter, 180, 90)
  $path.AddLine($Rectangle.Left + $Radius, $Rectangle.Top, $Rectangle.Right - $Radius, $Rectangle.Top)
  $path.AddArc($Rectangle.Right - $diameter, $Rectangle.Top, $diameter, $diameter, 270, 90)
  $path.AddLine($Rectangle.Right, $Rectangle.Top + $Radius, $Rectangle.Right, $Rectangle.Bottom - $Radius)
  $path.AddArc($Rectangle.Right - $diameter, $Rectangle.Bottom - $diameter, $diameter, $diameter, 0, 90)
  $path.AddLine($Rectangle.Right - $Radius, $Rectangle.Bottom, $TailAttachRight, $Rectangle.Bottom)
  $path.AddBezier(
    [System.Drawing.PointF]::new($TailAttachRight, $Rectangle.Bottom),
    [System.Drawing.PointF]::new($TailAttachRight - ($Radius * 0.22), $Rectangle.Bottom + ($Radius * 0.30)),
    [System.Drawing.PointF]::new($TailTip.X + ($Radius * 0.28), $TailTip.Y - ($Radius * 0.06)),
    $TailTip
  )
  $path.AddBezier(
    $TailTip,
    [System.Drawing.PointF]::new($TailTip.X + ($Radius * 0.34), $TailTip.Y - ($Radius * 0.32)),
    [System.Drawing.PointF]::new($TailAttachLeft - ($Radius * 0.10), $Rectangle.Bottom + ($Radius * 0.10)),
    [System.Drawing.PointF]::new($TailAttachLeft, $Rectangle.Bottom)
  )
  $path.AddLine($TailAttachLeft, $Rectangle.Bottom, $Rectangle.Left + $Radius, $Rectangle.Bottom)
  $path.AddArc($Rectangle.Left, $Rectangle.Bottom - $diameter, $diameter, $diameter, 90, 90)
  $path.AddLine($Rectangle.Left, $Rectangle.Bottom - $Radius, $Rectangle.Left, $Rectangle.Top + $Radius)
  $path.CloseFigure()
  return $path
}

function Set-HighQualityGraphics {
  param([System.Drawing.Graphics]$Graphics)

  $Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $Graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
}

$resolvedForeground = (Resolve-Path -LiteralPath $Foreground).Path
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
[System.IO.Directory]::CreateDirectory($resolvedOutput) | Out-Null

$foregroundImage = [System.Drawing.Bitmap]::FromFile($resolvedForeground)
$width = $foregroundImage.Width
$height = $foregroundImage.Height

try {
  $background = [System.Drawing.Bitmap]::new($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $plainBackground = $null
  $simpleBackground = $null
  $backgroundGraphics = [System.Drawing.Graphics]::FromImage($background)
  Set-HighQualityGraphics $backgroundGraphics

  try {
    $backgroundRectangle = [System.Drawing.Rectangle]::new(0, 0, $width, $height)
    $gradient = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
      $backgroundRectangle,
      [System.Drawing.ColorTranslator]::FromHtml('#C8F5E8'),
      [System.Drawing.ColorTranslator]::FromHtml('#70D9BE'),
      35
    )
    $backgroundGraphics.FillRectangle($gradient, $backgroundRectangle)
    $gradient.Dispose()
    $plainBackground = [System.Drawing.Bitmap]$background.Clone()

    # The bubble sits behind the locked character. Most of it is intentionally cropped.
    $bubbleRectangle = [System.Drawing.RectangleF]::new($width * 0.64, $height * 0.10, $width * 0.47, $height * 0.43)
    $bubblePath = New-ChatBubblePath `
      $bubbleRectangle `
      ($width * 0.085) `
      ([System.Drawing.PointF]::new($width * 0.735, $height * 0.585)) `
      ($width * 0.765) `
      ($width * 0.855)
    $bubbleFill = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(82, 255, 247, 232))
    $bubbleStroke = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(108, 36, 112, 98), $width * 0.007)
    $bubbleStroke.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $backgroundGraphics.FillPath($bubbleFill, $bubblePath)
    $backgroundGraphics.DrawPath($bubbleStroke, $bubblePath)
    $simpleBackground = [System.Drawing.Bitmap]$background.Clone()

    $dotSize = $width * 0.022
    $dotY = $height * 0.29
    $dotColors = @(
      [System.Drawing.Color]::FromArgb(170, 40, 127, 113),
      [System.Drawing.Color]::FromArgb(180, 95, 226, 193),
      [System.Drawing.Color]::FromArgb(190, 255, 149, 130)
    )
    for ($index = 0; $index -lt 3; $index++) {
      $dotBrush = [System.Drawing.SolidBrush]::new($dotColors[$index])
      $dotX = $width * (0.84 + ($index * 0.055))
      $backgroundGraphics.FillEllipse($dotBrush, $dotX, $dotY, $dotSize, $dotSize)
      $dotBrush.Dispose()
    }

    $bubbleFill.Dispose()
    $bubbleStroke.Dispose()
    $bubblePath.Dispose()
  }
  finally {
    $backgroundGraphics.Dispose()
  }

  $waveDecoration = [System.Drawing.Bitmap]::new($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $waveGraphics = [System.Drawing.Graphics]::FromImage($waveDecoration)
  Set-HighQualityGraphics $waveGraphics

  try {
    # Decorations stay left of x=0.48w or right of x=0.86w, outside the hand.
    $flowPath = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $flowPath.StartFigure()
    $flowPath.AddBezier(
      [System.Drawing.PointF]::new($width * 0.06, $height * 0.92),
      [System.Drawing.PointF]::new($width * 0.18, $height * 0.87),
      [System.Drawing.PointF]::new($width * 0.34, $height * 0.96),
      [System.Drawing.PointF]::new($width * 0.47, $height * 0.90)
    )
    $flowPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(74, 31, 102, 91), $width * 0.006)
    $flowPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $flowPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $waveGraphics.DrawPath($flowPen, $flowPath)

    $waveDots = @(
      @{ X = 0.12; Y = 0.925; Size = 0.012; Color = [System.Drawing.Color]::FromArgb(82, 40, 127, 113) },
      @{ X = 0.17; Y = 0.902; Size = 0.015; Color = [System.Drawing.Color]::FromArgb(92, 95, 226, 193) },
      @{ X = 0.23; Y = 0.906; Size = 0.011; Color = [System.Drawing.Color]::FromArgb(105, 255, 149, 130) },
      @{ X = 0.875; Y = 0.925; Size = 0.012; Color = [System.Drawing.Color]::FromArgb(76, 40, 127, 113) },
      @{ X = 0.915; Y = 0.904; Size = 0.016; Color = [System.Drawing.Color]::FromArgb(94, 95, 226, 193) },
      @{ X = 0.962; Y = 0.922; Size = 0.010; Color = [System.Drawing.Color]::FromArgb(110, 255, 149, 130) }
    )
    foreach ($dot in $waveDots) {
      $size = $width * $dot.Size
      $brush = [System.Drawing.SolidBrush]::new($dot.Color)
      $waveGraphics.FillEllipse($brush, $width * $dot.X, $height * $dot.Y, $size, $size)
      $brush.Dispose()
    }

    $flowPen.Dispose()
    $flowPath.Dispose()
  }
  finally {
    $waveGraphics.Dispose()
  }

  $backgroundPath = Join-Path $resolvedOutput 'airi-chat-background-layer-v1.png'
  $wavePath = Join-Path $resolvedOutput 'airi-wave-decoration-layer-v1.png'
  $finalPath = Join-Path $resolvedOutput 'airi-chat-icon-composite-v1.png'
  $smallPath = Join-Path $resolvedOutput 'airi-chat-icon-composite-v1-32.png'
  $background.Save($backgroundPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $waveDecoration.Save($wavePath, [System.Drawing.Imaging.ImageFormat]::Png)

  $final = [System.Drawing.Bitmap]::new($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $finalGraphics = [System.Drawing.Graphics]::FromImage($final)
  Set-HighQualityGraphics $finalGraphics
  try {
    $finalGraphics.DrawImage($background, 0, 0, $width, $height)
    $finalGraphics.DrawImage($foregroundImage, 0, 0, $width, $height)
    $finalGraphics.DrawImage($waveDecoration, 0, 0, $width, $height)
  }
  finally {
    $finalGraphics.Dispose()
  }
  $final.Save($finalPath, [System.Drawing.Imaging.ImageFormat]::Png)

  $simpleFinal = [System.Drawing.Bitmap]::new($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $simpleFinalGraphics = [System.Drawing.Graphics]::FromImage($simpleFinal)
  Set-HighQualityGraphics $simpleFinalGraphics
  try {
    $simpleFinalGraphics.DrawImage($simpleBackground, 0, 0, $width, $height)
    $simpleFinalGraphics.DrawImage($foregroundImage, 0, 0, $width, $height)
  }
  finally {
    $simpleFinalGraphics.Dispose()
  }

  $plainFinal = [System.Drawing.Bitmap]::new($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $plainFinalGraphics = [System.Drawing.Graphics]::FromImage($plainFinal)
  Set-HighQualityGraphics $plainFinalGraphics
  try {
    $plainFinalGraphics.DrawImage($plainBackground, 0, 0, $width, $height)
    $plainFinalGraphics.DrawImage($foregroundImage, 0, 0, $width, $height)
  }
  finally {
    $plainFinalGraphics.Dispose()
  }

  $opticalDirectory = Join-Path $resolvedOutput 'optical-sizes'
  [System.IO.Directory]::CreateDirectory($opticalDirectory) | Out-Null
  $opticalSources = [ordered]@{
    256 = $final
    128 = $final
    64 = $final
    48 = $final
    32 = $simpleFinal
    24 = $simpleFinal
    16 = $plainFinal
  }
  foreach ($entry in $opticalSources.GetEnumerator()) {
    $size = [int]$entry.Key
    $scale = switch ($size) {
      32 { 1.04 }
      24 { 1.08 }
      16 { 1.15 }
      default { 1.0 }
    }
    $drawSize = [int][System.Math]::Round($size * $scale)
    $offset = [int][System.Math]::Floor(($size - $drawSize) / 2)
    $optical = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $opticalGraphics = [System.Drawing.Graphics]::FromImage($optical)
    Set-HighQualityGraphics $opticalGraphics
    try {
      $opticalGraphics.DrawImage($entry.Value, $offset, $offset, $drawSize, $drawSize)
    }
    finally {
      $opticalGraphics.Dispose()
    }

    $opticalPath = Join-Path $opticalDirectory "airi-icon-${size}.png"
    $optical.Save($opticalPath, [System.Drawing.Imaging.ImageFormat]::Png)
    if ($size -eq 32) {
      $optical.Save($smallPath, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    $optical.Dispose()
    Write-Output "optical-${size}=$opticalPath"
  }

  $plainFinal.Dispose()
  $simpleFinal.Dispose()
  $final.Dispose()
  $waveDecoration.Dispose()
  $simpleBackground.Dispose()
  $plainBackground.Dispose()
  $background.Dispose()

  Write-Output "size=${width}x${height}"
  Write-Output "background=$backgroundPath"
  Write-Output "wave=$wavePath"
  Write-Output "composite=$finalPath"
  Write-Output "small=$smallPath"
}
finally {
  $foregroundImage.Dispose()
}
