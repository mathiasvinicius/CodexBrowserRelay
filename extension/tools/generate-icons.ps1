$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

function New-RoundedRectanglePath {
  param(
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Radius
  )

  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $diameter = $Radius * 2

  $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
  $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
  $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-CloudPath {
  param([float]$Size)

  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.StartFigure()
  $path.AddBezier(
    [System.Drawing.PointF]::new($Size * 0.25, $Size * 0.58),
    [System.Drawing.PointF]::new($Size * 0.20, $Size * 0.44),
    [System.Drawing.PointF]::new($Size * 0.28, $Size * 0.30),
    [System.Drawing.PointF]::new($Size * 0.40, $Size * 0.33)
  )
  $path.AddBezier(
    [System.Drawing.PointF]::new($Size * 0.40, $Size * 0.33),
    [System.Drawing.PointF]::new($Size * 0.43, $Size * 0.18),
    [System.Drawing.PointF]::new($Size * 0.61, $Size * 0.17),
    [System.Drawing.PointF]::new($Size * 0.66, $Size * 0.31)
  )
  $path.AddBezier(
    [System.Drawing.PointF]::new($Size * 0.66, $Size * 0.31),
    [System.Drawing.PointF]::new($Size * 0.78, $Size * 0.31),
    [System.Drawing.PointF]::new($Size * 0.84, $Size * 0.42),
    [System.Drawing.PointF]::new($Size * 0.79, $Size * 0.54)
  )
  $path.AddBezier(
    [System.Drawing.PointF]::new($Size * 0.79, $Size * 0.54),
    [System.Drawing.PointF]::new($Size * 0.77, $Size * 0.66),
    [System.Drawing.PointF]::new($Size * 0.66, $Size * 0.72),
    [System.Drawing.PointF]::new($Size * 0.54, $Size * 0.68)
  )
  $path.AddBezier(
    [System.Drawing.PointF]::new($Size * 0.54, $Size * 0.68),
    [System.Drawing.PointF]::new($Size * 0.46, $Size * 0.76),
    [System.Drawing.PointF]::new($Size * 0.30, $Size * 0.72),
    [System.Drawing.PointF]::new($Size * 0.25, $Size * 0.58)
  )
  $path.CloseFigure()
  return $path
}

function Draw-CodexRelayIcon {
  param(
    [int]$Size,
    [string]$OutputPath
  )

  $bitmap = New-Object System.Drawing.Bitmap($Size, $Size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $shadowPath = New-RoundedRectanglePath ($Size * 0.11) ($Size * 0.13) ($Size * 0.78) ($Size * 0.78) ($Size * 0.19)
  $shadowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(34, 40, 58, 220))
  $graphics.FillPath($shadowBrush, $shadowPath)

  $tileRect = [System.Drawing.RectangleF]::new($Size * 0.09, $Size * 0.08, $Size * 0.78, $Size * 0.78)
  $tilePath = New-RoundedRectanglePath $tileRect.X $tileRect.Y $tileRect.Width $tileRect.Height ($Size * 0.18)
  $tileBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    [System.Drawing.PointF]::new($tileRect.X, $tileRect.Y),
    [System.Drawing.PointF]::new($tileRect.Right, $tileRect.Bottom),
    [System.Drawing.Color]::FromArgb(255, 255, 255, 255),
    [System.Drawing.Color]::FromArgb(255, 245, 247, 255)
  )
  $graphics.FillPath($tileBrush, $tilePath)
  $tilePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(70, 98, 114, 210), [Math]::Max(1, $Size * 0.010))
  $graphics.DrawPath($tilePen, $tilePath)

  $cloudPath = New-CloudPath $Size
  $glowPath = New-CloudPath $Size
  $glowMatrix = New-Object System.Drawing.Drawing2D.Matrix
  $glowMatrix.Scale(1.04, 1.04)
  $glowMatrix.Translate($Size * -0.005, $Size * -0.012)
  $glowPath.Transform($glowMatrix)
  $glowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(72, 98, 112, 255))
  $graphics.FillPath($glowBrush, $glowPath)

  $matrix = New-Object System.Drawing.Drawing2D.Matrix
  $matrix.Translate($Size * 0.005, $Size * 0.01)
  $cloudPath.Transform($matrix)

  $cloudBounds = $cloudPath.GetBounds()
  $cloudBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    [System.Drawing.PointF]::new($cloudBounds.X, $cloudBounds.Y),
    [System.Drawing.PointF]::new($cloudBounds.Right, $cloudBounds.Bottom),
    [System.Drawing.Color]::FromArgb(255, 182, 190, 255),
    [System.Drawing.Color]::FromArgb(255, 49, 44, 255)
  )
  $blend = New-Object System.Drawing.Drawing2D.ColorBlend
  $blend.Positions = @(0.0, 0.36, 1.0)
  $blend.Colors = @(
    [System.Drawing.Color]::FromArgb(255, 181, 188, 255),
    [System.Drawing.Color]::FromArgb(255, 109, 127, 255),
    [System.Drawing.Color]::FromArgb(255, 46, 41, 255)
  )
  $cloudBrush.InterpolationColors = $blend
  $graphics.FillPath($cloudBrush, $cloudPath)

  $cloudStroke = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(48, 255, 255, 255), [Math]::Max(1, $Size * 0.008))
  $graphics.DrawPath($cloudStroke, $cloudPath)

  $glyphPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(248, 250, 255), [Math]::Max(2, $Size * 0.06))
  $glyphPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $glyphPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

  $graphics.DrawLines(
    $glyphPen,
    [System.Drawing.PointF[]]@(
      [System.Drawing.PointF]::new($Size * 0.39, $Size * 0.42),
      [System.Drawing.PointF]::new($Size * 0.46, $Size * 0.50),
      [System.Drawing.PointF]::new($Size * 0.39, $Size * 0.58)
    )
  )
  $graphics.DrawLine(
    $glyphPen,
    [System.Drawing.PointF]::new($Size * 0.55, $Size * 0.58),
    [System.Drawing.PointF]::new($Size * 0.67, $Size * 0.58)
  )

  $directory = Split-Path -Parent $OutputPath
  if (-not (Test-Path $directory)) {
    New-Item -ItemType Directory -Path $directory | Out-Null
  }

  $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)

  $glyphPen.Dispose()
  $cloudStroke.Dispose()
  $cloudBrush.Dispose()
  $glowBrush.Dispose()
  $glowPath.Dispose()
  $tilePen.Dispose()
  $tileBrush.Dispose()
  $shadowBrush.Dispose()
  $shadowPath.Dispose()
  $tilePath.Dispose()
  $cloudPath.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
}

$root = Split-Path -Parent $PSScriptRoot
$iconsDir = Join-Path $root 'icons'

Draw-CodexRelayIcon -Size 16 -OutputPath (Join-Path $iconsDir 'icon16.png')
Draw-CodexRelayIcon -Size 32 -OutputPath (Join-Path $iconsDir 'icon32.png')
Draw-CodexRelayIcon -Size 48 -OutputPath (Join-Path $iconsDir 'icon48.png')
Draw-CodexRelayIcon -Size 128 -OutputPath (Join-Path $iconsDir 'icon128.png')
