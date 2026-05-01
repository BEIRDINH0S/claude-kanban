# Assets de la landing

## Vidéo de démo (optionnel)

Si tu veux remplacer le mockup CSS animé par une vraie vidéo de démo de l'app :

1. Enregistre une démo (QuickTime, OBS, screen capture macOS Cmd+Shift+5).
2. Compresse en `.mp4` H.264, idéalement < 8 Mo, ratio ~16:9, ~1280×720, autoplay-friendly (pas de son nécessaire).
   Exemple ffmpeg :
   ```
   ffmpeg -i raw.mov -vf scale=1280:-2 -c:v libx264 -crf 24 -preset slow -movflags +faststart -an demo.mp4
   ```
3. Génère un poster (frame fixe pour l'affichage avant lecture) :
   ```
   ffmpeg -i demo.mp4 -ss 00:00:01 -frames:v 1 demo-poster.jpg
   ```
4. Pose les deux fichiers ici : `docs/assets/demo.mp4` et `docs/assets/demo-poster.jpg`.
5. Dans `docs/index.html`, dé-commente le bloc `<video>` dans la section `<!-- THE STAGE -->`
   (cherche `To plug a real demo video later`) et supprime ou laisse en place le mockup CSS
   (il continuera à fonctionner si la vidéo échoue à charger).

Tant qu'aucune vidéo n'est posée ici, la landing affiche un mockup kanban CSS-animé qui montre une carte
qui voyage à travers les 5 colonnes (Todo → En cours → Review → Idle → Done) avec une popup de permission
qui apparaît en Review et un curseur fantôme qui clique "Approuver". C'est suffisant pour que la page reste vivante.
