# OGP画像(1200x630 PNG)を生成する。羊皮紙調の背景+業界名+タグライン。
# 使い方: powershell -File gen-og.ps1 <og-meta.json> <repo-root>
param([string]$MetaPath, [string]$RepoRoot)
Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $RepoRoot "assets\og"
New-Item -ItemType Directory -Force $outDir | Out-Null

function New-OgImage {
  param([string]$OutFile, [string]$Title, [string]$Subtitle, [string]$Stats)
  $bmp = New-Object System.Drawing.Bitmap(1200, 630)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = "AntiAlias"
  $g.TextRenderingHint = "AntiAliasGridFit"

  # 羊皮紙グラデーション背景
  $rect = New-Object System.Drawing.Rectangle(0, 0, 1200, 630)
  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, [System.Drawing.Color]::FromArgb(248,250,252), [System.Drawing.Color]::FromArgb(232,237,242), 55)
  $g.FillRectangle($bg, $rect)

  # 装飾: 経緯線風の薄い円弧
  $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(30, 100, 115, 125), 2)
  $g.DrawEllipse($pen, 700, -150, 700, 700)
  $g.DrawEllipse($pen, 780, -70, 540, 540)
  $g.DrawEllipse($pen, 860, 10, 380, 380)
  $penD = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(40, 100, 115, 125), 3)
  $penD.DashStyle = "Dash"
  $g.DrawLine($penD, 80, 500, 1120, 500)

  # 枠線(二重)
  $penB = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(150, 61, 75, 88), 4)
  $g.DrawRectangle($penB, 18, 18, 1163, 593)
  $penB2 = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(100, 61, 75, 88), 2)
  $g.DrawRectangle($penB2, 28, 28, 1143, 573)

  $ink = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(31, 42, 51))
  $inkSoft = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(200, 85, 100, 115))
  $gold = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(15, 118, 110))

  # コンパスローズ紋章(8方位)
  function Draw-Rose {
    param($gr, [float]$cx, [float]$cy, [float]$R, $mainBrush, $subBrush, $outlinePen)
    $w = $R * 0.19
    $r2 = $R * 0.58
    $pt = { param($x, $y) New-Object System.Drawing.PointF($x, $y) }
    # 斜め4方位(小)
    foreach ($a in @(45, 135, 225, 315)) {
      $rad = $a * [Math]::PI / 180
      $tipX = $cx + $r2 * [Math]::Sin($rad); $tipY = $cy - $r2 * [Math]::Cos($rad)
      $perp = $rad + [Math]::PI / 2
      $bx = $w * 0.6 * [Math]::Sin($perp); $by = -$w * 0.6 * [Math]::Cos($perp)
      $gr.FillPolygon($subBrush, [System.Drawing.PointF[]]@(
        (& $pt $tipX $tipY), (& $pt ($cx + $bx) ($cy + $by)), (& $pt $cx $cy), (& $pt ($cx - $bx) ($cy - $by))))
    }
    # 主4方位(北=金)
    foreach ($a in @(0, 90, 180, 270)) {
      $rad = $a * [Math]::PI / 180
      $tipX = $cx + $R * [Math]::Sin($rad); $tipY = $cy - $R * [Math]::Cos($rad)
      $perp = $rad + [Math]::PI / 2
      $bx = $w * [Math]::Sin($perp); $by = -$w * [Math]::Cos($perp)
      $brush = if ($a -eq 0) { $mainBrush } else { $subBrush }
      $poly = [System.Drawing.PointF[]]@(
        (& $pt $tipX $tipY), (& $pt ($cx + $bx) ($cy + $by)), (& $pt $cx $cy), (& $pt ($cx - $bx) ($cy - $by)))
      $gr.FillPolygon($brush, $poly)
      if ($outlinePen) { $gr.DrawPolygon($outlinePen, $poly) }
    }
    $gr.FillEllipse($mainBrush, ($cx - $R * 0.09), ($cy - $R * 0.09), ($R * 0.18), ($R * 0.18))
  }
  # 右側の大きな透かしローズ
  $wmMain = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(22, 15, 118, 110))
  $wmSub = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(16, 61, 75, 88))
  Draw-Rose $g 1030 170 190 $wmMain $wmSub $null
  # ブランド紋章
  $penC = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(200, 61, 75, 88), 3)
  $g.DrawEllipse($penC, 57, 53, 50, 50)
  $penC2 = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(90, 138, 160, 178), 1.5)
  $g.DrawEllipse($penC2, 62, 58, 40, 40)
  $roseOutline = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(150, 61, 75, 88), 1)
  Draw-Rose $g 82 78 21 $gold $inkSoft $roseOutline
  $brand = New-Object System.Drawing.Font("Yu Gothic UI", 30, [System.Drawing.FontStyle]::Bold)
  $g.DrawString("あきないマップ", $brand, $inkSoft, 116, 58)

  # タイトル(業界名)
  $titleSize = 92
  if ($Title.Length -gt 8) { $titleSize = 72 }
  if ($Title.Length -gt 12) { $titleSize = 56 }
  $fTitle = New-Object System.Drawing.Font("Yu Gothic UI", $titleSize, [System.Drawing.FontStyle]::Bold)
  $g.DrawString($Title, $fTitle, $ink, 52, 150)

  # タグライン(長ければ折返し)
  $fSub = New-Object System.Drawing.Font("Yu Gothic UI", 30)
  $subRect = New-Object System.Drawing.RectangleF(60, 330, 1080, 150)
  $g.DrawString($Subtitle, $fSub, $ink, $subRect)

  # 下部: 統計とURL
  $fStats = New-Object System.Drawing.Font("Yu Gothic UI", 26, [System.Drawing.FontStyle]::Bold)
  $g.DrawString($Stats, $fStats, $gold, 60, 520)
  $fUrl = New-Object System.Drawing.Font("Yu Gothic UI", 24)
  $g.DrawString("fanasocorpdev.github.io/shoryu-zukan", $fUrl, $inkSoft, 600, 522)

  $g.Dispose()
  $bmp.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

$meta = Get-Content $MetaPath -Raw -Encoding UTF8 | ConvertFrom-Json

# サイト全体のデフォルト
New-OgImage -OutFile (Join-Path $outDir "default.png") -Title "日本の商流が見える地図" -Subtitle "誰が誰に、何を届けて、いくら払うのか。全上場3,709社を業界地図に収容。" -Stats "23業界 / 上場全社カバー"

foreach ($m in $meta) {
  $stats = "$($m.nodes)ノード / $($m.companies)社を収容"
  New-OgImage -OutFile (Join-Path $outDir "$($m.id).png") -Title $m.name -Subtitle $m.tagline -Stats $stats
}
Write-Output "generated: $((Get-ChildItem $outDir).Count) images"
