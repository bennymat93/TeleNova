#!/bin/bash
# Play-test samples (CI only, never shipped): 6-second files of the formats people actually have, written into the
# web copy of the SIMULATOR build: <web>/_samples/. Needs ffmpeg (brew install ffmpeg).
#   ./make_samples.sh <web folder>
set -euo pipefail
OUT="$1/_samples"
mkdir -p "$OUT"
V="-f lavfi -i testsrc2=size=640x360:rate=25:duration=6"
A="-f lavfi -i sine=frequency=440:sample_rate=48000:duration=6"
mk() { local name="$1"; shift; ffmpeg -hide_banner -loglevel error -y $V $A "$@" -shortest "$OUT/$name" || echo "could not make $name"; }
mk mp4_h264_aac.mp4      -c:v libx264 -pix_fmt yuv420p -c:a aac -movflags +faststart
mk mov_h264_aac.mov      -c:v libx264 -pix_fmt yuv420p -c:a aac
mk mp4_hevc_aac.mp4      -c:v libx265 -tag:v hvc1 -pix_fmt yuv420p -c:a aac -movflags +faststart
mk mkv_h264_aac.mkv      -c:v libx264 -pix_fmt yuv420p -c:a aac
mk mkv_h264_ac3.mkv      -c:v libx264 -pix_fmt yuv420p -c:a ac3 -ac 2
mk mkv_h264_eac3.mkv     -c:v libx264 -pix_fmt yuv420p -c:a eac3 -ac 2
mk mkv_h264_dts.mkv      -c:v libx264 -pix_fmt yuv420p -c:a dca -strict -2 -ac 2
mk mkv_hevc_aac.mkv      -c:v libx265 -pix_fmt yuv420p -c:a aac
mk mkv_hevc_eac3.mkv     -c:v libx265 -pix_fmt yuv420p -c:a eac3 -ac 2
mk mkv_h264_flac.mkv     -c:v libx264 -pix_fmt yuv420p -c:a flac
mk avi_mpeg4_mp3.avi     -c:v mpeg4 -q:v 5 -c:a libmp3lame
mk ts_h264_aac.ts        -c:v libx264 -pix_fmt yuv420p -c:a aac -f mpegts
mk webm_vp9_opus.webm    -c:v libvpx-vp9 -b:v 300k -c:a libopus
mk webm_vp8_opus.webm    -c:v libvpx -b:v 300k -c:a libopus
ffmpeg -hide_banner -loglevel error -y $A -c:a libmp3lame "$OUT/audio.mp3" || true
ffmpeg -hide_banner -loglevel error -y $A -c:a flac "$OUT/audio.flac" || true
ffmpeg -hide_banner -loglevel error -y $A -c:a aac "$OUT/audio.m4a" || true
ls -la "$OUT"
# speech for the AI-from-sound test: a known English sentence (macOS say), as HLS (TS segments) and as MP4
if command -v say >/dev/null 2>&1; then
  say -o "$OUT/speech.aiff" "Hello. This is a test of the subtitles. The weather today is sunny and warm. We are going to the beach this afternoon, and then we will have dinner with our friends. Tomorrow it will rain, so we will stay at home and watch a film. Thank you for watching, and see you next time." || true
  if [ -f "$OUT/speech.aiff" ]; then
    D="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/speech.aiff" | cut -d. -f1)"; D=$((D + 1))
    mkdir -p "$OUT/speech_hls"
    ffmpeg -hide_banner -loglevel error -y -f lavfi -i "testsrc2=size=640x360:rate=25:duration=$D" -i "$OUT/speech.aiff" \
      -c:v libx264 -pix_fmt yuv420p -c:a aac -ar 48000 -shortest -f hls -hls_time 4 -hls_playlist_type vod \
      -hls_segment_filename "$OUT/speech_hls/s%03d.ts" "$OUT/speech_hls/index.m3u8" || true
    ffmpeg -hide_banner -loglevel error -y -f lavfi -i "testsrc2=size=640x360:rate=25:duration=$D" -i "$OUT/speech.aiff" \
      -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest -movflags +faststart "$OUT/speech.mp4" || true
  fi
fi
ls -la "$OUT" "$OUT/speech_hls" 2>/dev/null || true
