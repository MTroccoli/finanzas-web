window.Mods = window.Mods || {};
window.Mods.presupuesto = {
  async render() {
    document.getElementById('content').innerHTML = `
      <div class="placeholder-mod">
        <div class="ph-icon">🎯</div>
        <div class="ph-title">Presupuesto</div>
        <div class="ph-text">Próximamente · límites por categoría</div>
      </div>
    `;
  },
};
