#!/bin/bash
set -uo pipefail

FFMPEG_DIR="/c/Users/shohan hossain/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.1-full_build/bin"
export PATH="$FFMPEG_DIR:$PATH"

WORKDIR="/tmp/thumb-extract"
OUTDIR="D:/code/public/thumbnails/candidates"
mkdir -p "$WORKDIR" "$OUTDIR"

N_FRAMES=6

# slug|driveId pairs
PROJECTS=(
"serious-history-scene-1|1G6UEwH2WazlSFgCHkij5IbCI30e0oSST"
"ferry-intro|159nu9Gok_XFc91gZcM-1ydHe9aozAi0O"
"napoleon|1YXhQCLLBPhOqqa1WkLHYr3XcFyxH5VnZ"
"ww2-soldiers|1WKtfPy7fAtuKykJzrxpd2KK7_2BzXcVK"
"goska|1FPJv6wuMzyq_O37bWyKR7G5tiMRZtbea"
"roman-empire|1zBHU-QzaR1exa-7qwwJOogdoaIqmPQNm"
"historical-figures|1TMxyfP4A2-ahx2-YtfEVXGciIto4dGOF"
"arena|1wNEmi9oGrtqX-qG1HOokjmIXA-qnOlCt"
"einstein|1BSP_q9Ne3qDmZmScuyvahqVvohAcAaos"
"ww2|1vXV86qGyNtP4q8qO3dhbAGcxtTR41Z6O"
"crazy-drug|1n60FLIeBDcjoZnu__dqwckeiIPGiRore"
"date-or-detonate|1f1HJXSZ4ErKjzAh8qbEcceANenD8EYDB"
"why-it-sucks|1c5dVOirqb7Lw9osJpb3vcyJWVaoFU83S"
"goska-raw-cut|18dX5rvYwL3Cu8VHPvrx3rCSvJyhcTTPW"
"serious-history-alt-cut|1_5Tz54HSGsYVfuJePagZHFBsj2clVQGI"
"ready|1Q04QRrAlC6POiABTeFYLm1-FSFh1rXA9"
"war|1uK7O3s8r4n_s9j0nN-nHDJ5H4yhCtc69"
"ww1-soldiers|16cAvSU6PB1NfQV4dQlQ6-aEdXMlsgwse"
"ww2-cut-2|1OCSAy66ITGvIFIY9lo-8mUtRXocA7CSq"
"historical-short|1DQWNKMf9ifeT4Z12H3LjAaGWXe9iTdmD"
"cleopatra-historical|1HWNVj28mQr0dBOcVH-UpxoEFpjIZIisA"
"dantal|1SY5YeBSTtPTTXMbnK0obKGXzA62SU5-i"
"axolotl|1rEQlq1N14CszKdKH_c1v_hjtP7xjWKue"
"king-cobra|12VCocczqYXOCn9jUGVOvGHHVA57sFVjL"
"pigeon|1j72imn8jw5qo0MKex8l5yVChbw5AilYW"
"fox|1jjy2zaIWwkxLSWOpetyVz_J09QRjkWDC"
"hippo|1mYcmWkxBIVICkdDYJx9_ItvgMlJ9ktO5"
"anaconda|178OyE8nvS4FGfGuranDytAWQlBtYHbaL"
"bat|17-YivHNaoIvZ1_czQwhrJ7gs9lmhav13"
"nemo|1Bt3hR69tughb0p-6UEwVAtVNiHVQrm_l"
"police-officer|1-GZ_fsIZ0KCIY-FOWhpSZReTtD30HgUw"
"character-study|1nSjrBHQKqOOWieovu4fI-zNjMU0_SKwR"
"nike|1SlDulgLe5snOnr4Z22kxdc0yNB1WyplT"
"tesla|125xROw9CS_o8Aro2jXWwrnP_fxYbH3kp"
"uber|1P5DC6tTamS9vaJK_CyxG6z7h6p2T9kD_"
"sigmund-freud|1aKGafxq-ys3RTGgdH4ys5Z_uTf6vRpTh"
"amazon|16NrlJ8ik8t1x3PRdeoajbbPqcCRRiMTY"
"cleopatra|1Mq0NCkIyg8PIHrpy7nGR3dAchzloTEAo"
"fragrance|1oIhHu5UfFail2r4sAKN-jgZFEh9STdJm"
"maikel-junction|1DUgv-giy3DANPjVLUySHEAHR1ArbvMHT"
"ryanair|1FHAcHK20I6PqncaKFfWuOVSaOwRfCXCW"
"wealth-explainer|17kGol4c9bsLotmJlamkFHg1yk5joDbDy"
"game-piece|1qPI8P0pDGrtGLgd8MrDtFduXRGHluMxA"
)

total=${#PROJECTS[@]}
i=0
for pair in "${PROJECTS[@]}"; do
  i=$((i+1))
  slug="${pair%%|*}"
  driveId="${pair##*|}"
  outdir="$OUTDIR/$slug"

  if [ -f "$outdir/frame-01.jpg" ]; then
    echo "SKIP $slug ($i/$total) already has frames"
    continue
  fi

  mkdir -p "$outdir"
  video="$WORKDIR/$slug.mp4"

  curl -L -s --max-time 600 -o "$video" "https://drive.usercontent.google.com/download?id=${driveId}&export=download&confirm=t"

  size=$(stat -c%s "$video" 2>/dev/null || echo 0)
  if [ "$size" -lt 10000 ]; then
    echo "FAIL $slug ($i/$total) download too small ($size bytes)"
    rm -f "$video"
    continue
  fi

  duration=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$video" 2>/dev/null)
  if [ -z "$duration" ] || [ "$(echo "$duration < 0.5" | awk '{print ($1<1)?1:0}')" = "1" ]; then
    echo "FAIL $slug ($i/$total) unreadable video (duration=$duration)"
    rm -f "$video"
    continue
  fi

  for f in $(seq 1 $N_FRAMES); do
    ts=$(awk -v d="$duration" -v f="$f" -v n="$N_FRAMES" 'BEGIN{printf "%.2f", d*f/(n+2)}')
    idx=$(printf "%02d" $f)
    ffmpeg -y -ss "$ts" -i "$video" -frames:v 1 -q:v 3 -vf "scale=480:-1" "$outdir/frame-$idx.jpg" -loglevel error
  done

  rm -f "$video"
  echo "DONE $slug ($i/$total)"
done

echo "ALL_COMPLETE"
