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
  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, [System.Drawing.Color]::FromArgb(244,232,208), [System.Drawing.Color]::FromArgb(228,210,178), 55)
  $g.FillRectangle($bg, $rect)

  # 装飾: 経緯線風の薄い円弧
  $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(40, 120, 90, 50), 2)
  $g.DrawEllipse($pen, 700, -150, 700, 700)
  $g.DrawEllipse($pen, 780, -70, 540, 540)
  $g.DrawEllipse($pen, 860, 10, 380, 380)
  $penD = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(60, 120, 90, 50), 3)
  $penD.DashStyle = "Dash"
  $g.DrawLine($penD, 80, 500, 1120, 500)

  # 枠線(二重)
  $penB = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(180, 92, 64, 32), 4)
  $g.DrawRectangle($penB, 18, 18, 1163, 593)
  $penB2 = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(120, 92, 64, 32), 2)
  $g.DrawRectangle($penB2, 28, 28, 1143, 573)

  $ink = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(58, 40, 20))
  $inkSoft = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(200, 92, 64, 32))
  $gold = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(146, 100, 12))

  # コンパス紋章(円+針)
  $penC = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(200, 92, 64, 32), 3)
  $g.DrawEllipse($penC, 62, 58, 40, 40)
  $needle = [System.Drawing.PointF[]]@(
    (New-Object System.Drawing.PointF(82, 62)), (New-Object System.Drawing.PointF(89, 78)),
    (New-Object System.Drawing.PointF(82, 94)), (New-Object System.Drawing.PointF(75, 78)))
  $g.FillPolygon($gold, $needle)
  $brand = New-Object System.Drawing.Font("Yu Mincho", 30, [System.Drawing.FontStyle]::Bold)
  $g.DrawString("あきないマップ", $brand, $inkSoft, 112, 58)

  # タイトル(業界名)
  $titleSize = 92
  if ($Title.Length -gt 8) { $titleSize = 72 }
  if ($Title.Length -gt 12) { $titleSize = 56 }
  $fTitle = New-Object System.Drawing.Font("Yu Mincho", $titleSize, [System.Drawing.FontStyle]::Bold)
  $g.DrawString($Title, $fTitle, $ink, 52, 150)

  # タグライン(長ければ折返し)
  $fSub = New-Object System.Drawing.Font("Yu Gothic UI", 30)
  $subRect = New-Object System.Drawing.RectangleF(60, 330, 1080, 150)
  $g.DrawString($Subtitle, $fSub, $ink, $subRect)

  # 下部: 統計とURL
  $fStats = New-Object System.Drawing.Font("Yu Gothic UI", 26, [System.Drawing.FontStyle]::Bold)
  $g.DrawString($Stats, $fStats, $gold, 60, 520)
  $fUrl = New-Object System.Drawing.Font("Yu Gothic UI", 24)
  $g.DrawString("fanasocorpdev.github.io/shoryu-zukan — 永久無料", $fUrl, $inkSoft, 600, 522)

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
