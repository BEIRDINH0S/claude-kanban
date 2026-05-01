# Landing assets

## Demo video (optional)

If you want to replace the CSS-animated mockup with a real demo of the app:

1. Record a demo (QuickTime, OBS, macOS screen capture Cmd+Shift+5).
2. Compress to `.mp4` H.264, ideally < 8 MB, ~16:9 ratio, ~1280×720,
   autoplay-friendly (sound not required).
   ffmpeg example:
   ```
   ffmpeg -i raw.mov -vf scale=1280:-2 -c:v libx264 -crf 24 -preset slow -movflags +faststart -an demo.mp4
   ```
3. Generate a poster (still frame shown before playback):
   ```
   ffmpeg -i demo.mp4 -ss 00:00:01 -frames:v 1 demo-poster.jpg
   ```
4. Drop both files here: `docs/assets/demo.mp4` and
   `docs/assets/demo-poster.jpg`.
5. In `docs/index.html`, uncomment the `<video>` block inside the
   `<!-- THE STAGE -->` section (search for `To plug a real demo video
   later`) and either delete or keep the CSS mockup (it still works as a
   fallback if the video fails to load).

While no video is dropped here, the landing shows a CSS-animated kanban
mockup with a card traveling through the 5 columns (Todo → In progress →
Review → Idle → Done), a permission popup that appears on Review, and a
ghost cursor that clicks "Approve". Enough to keep the page alive.

## Demo GIF (for the README)

The repo's main `README.md` references `docs/assets/demo.gif`. Same
recording, exported as a 10–15 s GIF. Recommended tools:

- **macOS**: Gifski (`brew install gifski`), or `ffmpeg` →
  `palette.png` → `gif`.
- **Windows**: ScreenToGif.

Keep it under ~4 MB so GitHub serves it inline in the README without
falling back to a download.

## Screenshots

The README also references commented-out screenshot lines:

```markdown
<!-- ![Board view](docs/assets/board.png) -->
<!-- ![Zoom view with diff](docs/assets/zoom-diff.png) -->
<!-- ![Permission popup](docs/assets/permissions.png) -->
```

When you have the screenshots, drop them here with those exact names and
uncomment the lines.
