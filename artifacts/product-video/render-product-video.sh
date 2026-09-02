#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h}"
CAPTURES="$ROOT/captures"
RENDER="$ROOT/render"
PUBLIC_MEDIA="$ROOT/../../apps/frontend/public/media/product-video"
SYNTHESIZER_RATE="${PLUTOMIX_DEMO_NARRATION_RATE:-180}"
mkdir -p "$RENDER" "$PUBLIC_MEDIA"

if ! command -v say >/dev/null 2>&1; then
  echo "The macOS say command is required to render narration." >&2
  exit 1
fi
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is required to render the product video." >&2
  exit 1
fi

say -r "$SYNTHESIZER_RATE" -f "$ROOT/narration.txt" -o "$RENDER/narration.aiff"
node "$ROOT/create-title-overlays.mjs"

make_scene() {
  local number="$1"
  local image="$2"
  local duration="$3"
  local anchor="$4"
  local title_fade_out=$(( duration - 1.0 ))
  local zoom="1.035"
  local x="iw/2-(iw/zoom/2)"
  local y="ih/2-(ih/zoom/2)"

  if [[ "$anchor" == "right" ]]; then
    zoom="1.075"
    x="iw-(iw/zoom)"
  elif [[ "$anchor" == "left" ]]; then
    zoom="1.055"
    x="0"
  fi

  ffmpeg -loglevel error -y \
    -loop 1 -framerate 30 -i "$CAPTURES/$image" \
    -loop 1 -framerate 30 -i "$RENDER/title-$number.png" \
    -t "$duration" \
    -filter_complex "[0:v]scale=1920:1080,zoompan=z='min(zoom+0.00018,$zoom)':x='$x':y='$y':d=1:s=1920x1080:fps=30[base];[1:v]format=rgba,fade=t=in:st=0.65:d=0.35:alpha=1,fade=t=out:st=$title_fade_out:d=0.35:alpha=1[card];[base][card]overlay=0:0:shortest=1,format=yuv420p[out]" \
    -map "[out]" \
    -an -c:v libx264 -preset slow -crf 18 -movflags +faststart \
    "$RENDER/scene-$number.mp4"
}

make_scene "01" "01-builder-workspace.png" "7.5" "center"
make_scene "02" "02-builder-evidence-gate.png" "8.0" "right"
make_scene "03" "03-analysis-portfolio.png" "8.5" "center"
make_scene "04" "04-portfolio-intelligence.png" "8.5" "center"
make_scene "05" "05-application-decisions.png" "8.5" "center"
make_scene "06" "06-governed-brainx.png" "8.0" "left"
make_scene "07" "07-delivery-decision-graph.png" "9.0" "center"
make_scene "08" "08-product-document.png" "8.0" "left"
make_scene "09" "09-hosting.png" "8.0" "left"
make_scene "10" "10-builder-close.png" "8.5" "center"

ffmpeg -loglevel error -y \
  -i "$RENDER/scene-01.mp4" \
  -i "$RENDER/scene-02.mp4" \
  -i "$RENDER/scene-03.mp4" \
  -i "$RENDER/scene-04.mp4" \
  -i "$RENDER/scene-05.mp4" \
  -i "$RENDER/scene-06.mp4" \
  -i "$RENDER/scene-07.mp4" \
  -i "$RENDER/scene-08.mp4" \
  -i "$RENDER/scene-09.mp4" \
  -i "$RENDER/scene-10.mp4" \
  -i "$RENDER/narration.aiff" \
  -f lavfi -i "aevalsrc=0.08*sin(2*PI*110*t)+0.05*sin(2*PI*164.81*t)+0.04*sin(2*PI*220*t):s=48000:d=78" \
  -filter_complex "
    [0:v][1:v]xfade=transition=fade:duration=0.5:offset=7.0[v1];
    [v1][2:v]xfade=transition=fade:duration=0.5:offset=14.5[v2];
    [v2][3:v]xfade=transition=fade:duration=0.5:offset=22.5[v3];
    [v3][4:v]xfade=transition=fade:duration=0.5:offset=30.5[v4];
    [v4][5:v]xfade=transition=fade:duration=0.5:offset=38.5[v5];
    [v5][6:v]xfade=transition=fade:duration=0.5:offset=46.0[v6];
    [v6][7:v]xfade=transition=fade:duration=0.5:offset=54.5[v7];
    [v7][8:v]xfade=transition=fade:duration=0.5:offset=62.0[v8];
    [v8][9:v]xfade=transition=fade:duration=0.5:offset=69.5,fade=t=in:st=0:d=0.6,fade=t=out:st=77.2:d=0.8[vout];
    [10:a]adelay=700|700,volume=1.25,highpass=f=80,lowpass=f=12000,apad=whole_dur=78[narration];
    [11:a]volume=0.16,lowpass=f=500,afade=t=in:st=0:d=2,afade=t=out:st=75:d=3[bed];
    [narration][bed]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95,loudnorm=I=-16:TP=-1.5:LRA=7[aout]
  " \
  -map "[vout]" -map "[aout]" \
  -t 78 -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \
  -c:a aac -b:a 192k -ar 48000 -movflags +faststart \
  "$ROOT/plutomix-product-video.mp4"

ffmpeg -loglevel error -y -ss 00:00:39 -i "$ROOT/plutomix-product-video.mp4" -frames:v 1 "$ROOT/poster.png"
ffmpeg -loglevel error -y -i "$ROOT/plutomix-product-video.mp4" -vf "fps=1/8,scale=384:216,tile=5x2:padding=8:margin=8" -frames:v 1 "$ROOT/video-contact-sheet.png"

cp "$ROOT/plutomix-product-video.mp4" "$PUBLIC_MEDIA/plutomix-product-video.mp4"
cp "$ROOT/poster.png" "$PUBLIC_MEDIA/plutomix-product-video-poster.png"
cp "$ROOT/captions.vtt" "$PUBLIC_MEDIA/plutomix-product-video.vtt"
cmp "$ROOT/plutomix-product-video.mp4" "$PUBLIC_MEDIA/plutomix-product-video.mp4"
cmp "$ROOT/poster.png" "$PUBLIC_MEDIA/plutomix-product-video-poster.png"
cmp "$ROOT/captions.vtt" "$PUBLIC_MEDIA/plutomix-product-video.vtt"

ffprobe -v error -show_entries format=duration:stream=codec_name,codec_type,width,height -of json "$ROOT/plutomix-product-video.mp4"
