// ───────────────────────────────────────────────────────────────────────────
//  Tile hover spotlight
//  ────────────────────
//  Writes --mx/--my CSS custom properties onto each .tile as the cursor
//  moves over it. The matching CSS in styles/bento.css uses those props in
//  a radial-gradient pseudo-element so the spotlight follows the mouse.
// ───────────────────────────────────────────────────────────────────────────

(function () {
  var tiles = document.querySelectorAll(".tile");
  for (var i = 0; i < tiles.length; i++) {
    (function (tile) {
      tile.addEventListener("mousemove", function (e) {
        var rect = tile.getBoundingClientRect();
        var x = ((e.clientX - rect.left) / rect.width)  * 100;
        var y = ((e.clientY - rect.top)  / rect.height) * 100;
        tile.style.setProperty("--mx", x + "%");
        tile.style.setProperty("--my", y + "%");
      });
    })(tiles[i]);
  }
})();
