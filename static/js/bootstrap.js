/**
 * Shared namespace for the whole app. Every other script attaches to this
 * object instead of using ES module import/export (no build step -- plain
 * <script> tags loaded in dependency order, see templates/index.html).
 */
window.AB = window.AB || {};
window.AB.audio = window.AB.audio || {};
window.AB.scenario = window.AB.scenario || {};
window.AB.session = window.AB.session || {};
window.AB.model = window.AB.model || {};
window.AB.ui = window.AB.ui || {};
window.AB.ui.settings = window.AB.ui.settings || {};
